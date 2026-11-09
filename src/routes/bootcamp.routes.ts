import { Router, Response, NextFunction, Request } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authenticate, AuthRequest, optionalAuth } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'
import { grantXp } from '../utils/xp'
import { updateBadge } from '../utils/badge'

export const bootcampRouter = Router()

export function computeBootcampStatus(b: any, now = new Date()): 'OPEN' | 'CLOSED' | 'ONGOING' | 'COMPLETED' {
  let effectiveDeadline = b.registrationDeadline ? new Date(b.registrationDeadline) : null
  if (effectiveDeadline && effectiveDeadline.getUTCHours() === 0 && effectiveDeadline.getUTCMinutes() === 0 && effectiveDeadline.getUTCSeconds() === 0) {
    effectiveDeadline = new Date(effectiveDeadline.getTime() + 24 * 60 * 60 * 1000 - 1)
  }

  const startDate = b.batchStartDate ? new Date(b.batchStartDate) : null
  let endDate = b.batchEndDate ? new Date(b.batchEndDate) : null
  if (endDate && endDate.getUTCHours() === 0 && endDate.getUTCMinutes() === 0 && endDate.getUTCSeconds() === 0) {
    endDate = new Date(endDate.getTime() + 24 * 60 * 60 * 1000 - 1)
  }

  // 1. Berakhir (COMPLETED) jika tanggal akhir batch telah lewat
  if (endDate && now > endDate) {
    return 'COMPLETED'
  }

  // Jika tidak ada tanggal akhir spesifik, periksa apakah hari pelaksanaan sudah lewat (lewat 24 jam)
  if (startDate && !endDate) {
    const endOfStartDay = new Date(startDate.getTime() + 24 * 60 * 60 * 1000 - 1)
    if (now > endOfStartDay) {
      return 'COMPLETED'
    }
  }

  // 2. Sedang Berlangsung (ONGOING) jika sudah masuk tanggal pelaksanaan
  if (startDate && now >= startDate) {
    if (!endDate || now <= endDate) {
      return 'ONGOING'
    }
  }

  // 3. Ditutup (CLOSED) jika batas akhir pendaftaran telah lewat
  if (effectiveDeadline && now >= effectiveDeadline) {
    return 'CLOSED'
  }

  // 4. Ditutup jika tanggal mulai pendaftaran masih di masa depan (belum dibuka)
  if (b.registrationStartDate && now < new Date(b.registrationStartDate) && b.batchStatus !== 'OPEN') {
    return 'CLOSED'
  }

  // 5. TERBUKA jika batas pendaftaran masih aktif di masa depan
  if (effectiveDeadline && now < effectiveDeadline) {
    return 'OPEN'
  }

  // 6. Ditutup jika admin secara manual mengatur status CLOSED
  if (b.batchStatus === 'CLOSED') {
    return 'CLOSED'
  }

  // 7. Terbuka jika admin mengatur OPEN, atau jika dalam periode pendaftaran aktif
  if (b.batchStatus === 'OPEN') {
    return 'OPEN'
  }
  if (b.batchStatus === 'COMPLETED') {
    return 'COMPLETED'
  }
  if (b.isPublished) {
    if (!effectiveDeadline && (!startDate || now < startDate)) return 'OPEN'
  }

  return 'CLOSED'
}

// ── GET /bootcamps ─────────────────────────────────────────
bootcampRouter.get('/', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, field, level, status } = req.query as Record<string, string>
    const where: Record<string, unknown> = { isPublished: true, chapters: { some: { sessions: { some: {} } } } }
    if (field) where.field = field
    if (level) where.level = level
    if (status) {
      if (status === 'CLOSED') {
        where.batchStatus = { in: ['CLOSED', 'ONGOING', 'COMING_SOON', 'COMPLETED'] }
      } else {
        where.batchStatus = status
      }
    }
    if (search) where.title = { contains: search as string, mode: 'insensitive' }

    const bootcamps = await prisma.bootcamp.findMany({
      where,
      orderBy: [{ batchStatus: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true, title: true, shortDescription: true, field: true, level: true,
        price: true, thumbnailUrl: true, totalDuration: true, rating: true,
        reviewCount: true, enrollmentCount: true, batchStatus: true,
        registrationStartDate: true, registrationDeadline: true, batchStartDate: true, batchEndDate: true,
        mentorName: true, mentorPhotoUrl: true, tags: true,
        isPublished: true, isFeatured: true,
      },
    })
    
    const now = new Date()
    const mappedBootcamps = bootcamps
      .map(b => ({
        ...b,
        batchStatus: computeBootcampStatus(b, now),
      }))
      .filter(b => {
        // Jika filter status spesifik diminta (misal dari admin atau filter dropdown mentee), jangan sembunyikan
        if (status) return true

        // Pada katalog publik pembelian:
        // Hapus dalam 24 jam setelah pendaftaran ditutup atau jika event telah berakhir
        if (b.batchStatus === 'COMPLETED') {
          return false
        }

        let effectiveDeadline = b.registrationDeadline ? new Date(b.registrationDeadline) : null
        if (effectiveDeadline && effectiveDeadline.getUTCHours() === 0 && effectiveDeadline.getUTCMinutes() === 0 && effectiveDeadline.getUTCSeconds() === 0) {
          effectiveDeadline = new Date(effectiveDeadline.getTime() + 24 * 60 * 60 * 1000 - 1)
        }
        if (effectiveDeadline) {
          const cutoff24h = new Date(effectiveDeadline.getTime() + 24 * 60 * 60 * 1000)
          if (now > cutoff24h) {
            return false
          }
        }

        return true
      })
    
    res.json({ success: true, data: mappedBootcamps })
  } catch (err) { next(err) }
})

// ── GET /bootcamps/enrolled ────────────────────────────────
bootcampRouter.get('/enrolled', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id
    const enrollments = await prisma.bootcampEnrollment.findMany({
      where: { userId, isActive: true },
      include: {
        bootcamp: {
          select: { id: true, title: true, field: true, thumbnailUrl: true, batchStartDate: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const result = enrollments.map((e) => ({
      id:           e.bootcamp.id,
      title:        e.bootcamp.title,
      field:        e.bootcamp.field,
      thumbnailUrl: e.bootcamp.thumbnailUrl,
      startDate:    e.bootcamp.batchStartDate,
      progress:     Math.round(e.progress),
      type:         'bootcamp',
    }))
    res.json({ success: true, data: result })
  } catch (err) { next(err) }
})

// ── GET /bootcamps/:id ─────────────────────────────────────
bootcampRouter.get('/:id', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const bootcamp = await prisma.bootcamp.findFirst({
      where: { id: (req.params as Record<string, string>).id, isPublished: true },
      include: {
        chapters: {
          orderBy: { orderIndex: 'asc' },
          include: {
            sessions: {
              orderBy: { orderIndex: 'asc' },
              select: {
                id: true, title: true, type: true,
                videoDuration: true, liveScheduledAt: true, orderIndex: true,
                videoUrl: true, isFreePreview: true,
              },
            },
          },
        },
        reviews: {
          where: { isHidden: false },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { user: { select: { name: true, photoUrl: true } } },
        },
      },
    })
    if (!bootcamp) throw createError(404, 'Bootcamp tidak ditemukan')

    let isEnrolled = false
    let isWishlisted = false
    let progress = 0
    if (req.user) {
      const [enrollment, wishlist] = await Promise.all([
        prisma.bootcampEnrollment.findUnique({
          where: { userId_bootcampId: { userId: req.user.id, bootcampId: bootcamp.id } },
        }),
        prisma.wishlistItem.findFirst({
          where: { userId: req.user.id, bootcampId: bootcamp.id },
        }),
      ])
      isEnrolled = !!enrollment?.isActive
      isWishlisted = !!wishlist
      progress = enrollment?.progress ?? 0
    }

    const now = new Date()
    const computedBatchStatus = computeBootcampStatus(bootcamp, now)

    // Normalize reviews to use consistent field name
    const normalized = {
      ...bootcamp,
      batchStatus: computedBatchStatus,
      reviews: bootcamp.reviews.map((r) => ({ ...r, comment: r.content })),
      isEnrolled,
      progress,
      isWishlisted,
    }

    res.json({ success: true, data: normalized })
  } catch (err) { next(err) }
})

// ── POST /bootcamps/:id/reviews ────────────────────────────
bootcampRouter.post('/:id/reviews', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rating, content } = z.object({
      rating:  z.number().min(1).max(5),
      content: z.string().max(1000).optional(),
    }).parse(req.body)
    const userId = req.user!.id
    const bootcampId = (req.params as Record<string, string>).id

    const enrollment = await prisma.bootcampEnrollment.findUnique({
      where: { userId_bootcampId: { userId, bootcampId } }
    })
    if (!enrollment) throw createError(403, 'Kamu belum terdaftar di bootcamp ini sehingga belum bisa memberikan ulasan')
    if (enrollment.progress < 100) throw createError(403, 'Selesaikan bootcamp 100% terlebih dahulu untuk memberikan ulasan')

    const review = await prisma.review.upsert({
      where: { userId_bootcampId: { userId, bootcampId } },
      update: { rating, content },
      create: { userId, bootcampId, productType: 'BOOTCAMP', rating, content },
    })

    const agg = await prisma.review.aggregate({
      where: { bootcampId, isHidden: false },
      _avg: { rating: true },
      _count: { id: true },
    })

    await prisma.bootcamp.update({
      where: { id: bootcampId },
      data: { rating: agg._avg.rating ?? 0, reviewCount: agg._count.id },
    })

    res.json({ success: true, data: review })
  } catch (err) { next(err) }
})

// ── GET /bootcamps/:id/learn/:sessionId ────────────────────
bootcampRouter.get('/:id/learn/:sessionId', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: bootcampId, sessionId } = req.params as Record<string, string>
    const userId = req.user!.id

    // Verify enrollment
    const enrollment = await prisma.bootcampEnrollment.findUnique({
      where: { userId_bootcampId: { userId, bootcampId } },
    })
    if (!enrollment?.isActive) throw createError(403, 'Kamu belum terdaftar di bootcamp ini')

    // Get the target session
    const session = await prisma.bootcampSession.findUnique({
      where: { id: sessionId },
      include: {
        chapter: {
          include: {
            bootcamp: { select: { id: true, title: true, field: true } },
          },
        },
      },
    })
    if (!session || session.chapter.bootcampId !== bootcampId) throw createError(404, 'Sesi tidak ditemukan')

    // Get all chapters + sessions for sidebar
    const chapters = await prisma.bootcampChapter.findMany({
      where: { bootcampId },
      orderBy: { orderIndex: 'asc' },
      include: {
        sessions: {
          orderBy: { orderIndex: 'asc' },
          select: { id: true, title: true, type: true, videoDuration: true, liveScheduledAt: true, orderIndex: true },
        },
      },
    })

    const allSessions = chapters.flatMap((ch) => ch.sessions)
    const idx = allSessions.findIndex((s) => s.id === sessionId)

    // Completed session IDs
    const completedProgress = await prisma.sessionProgress.findMany({
      where: { userId, bootcampSessionId: { in: allSessions.map((s) => s.id) }, isCompleted: true },
      select: { bootcampSessionId: true },
    })
    const completedIds = new Set(completedProgress.map((p) => p.bootcampSessionId))

    // User's submission for this session
    // User's submission for this session
    const assignment = session.type === 'ASSIGNMENT'
      ? await prisma.assignment.findFirst({ where: { userId, bootcampSessionId: sessionId }, orderBy: { submittedAt: 'desc' } })
      : null

    // Attendance record for live session
    const liveAttendance = session.type === 'LIVE'
      ? await prisma.liveAttendance.findUnique({
          where: { sessionId_userId: { sessionId, userId } },
        })
      : null

    const sessionDurationMin = session.videoDuration ? Math.ceil(session.videoDuration / 60) : 90
    const minRequiredMinutes = Math.ceil(sessionDurationMin * 0.8)

    const liveSchedMs = session.liveScheduledAt ? new Date(session.liveScheduledAt).getTime() : 0
    const liveDurMs = sessionDurationMin * 60 * 1000
    const isLiveEnded = liveSchedMs > 0 && (Date.now() > (liveSchedMs + liveDurMs))

    const totalSessions = allSessions.length
    const progress = totalSessions > 0 ? Math.round((completedIds.size / totalSessions) * 100) : 0

    res.json({
      success: true,
      data: {
        bootcamp:       session.chapter.bootcamp,
        chapters:       chapters.map((ch) => ({
          ...ch,
          sessions: ch.sessions.map((s) => ({ ...s, isCompleted: completedIds.has(s.id) })),
        })),
        currentSession: {
          ...session,
          liveUrl: isLiveEnded ? null : session.liveUrl,
          isLiveEnded,
          isCompleted: completedIds.has(sessionId),
          assignment,
          attendance: liveAttendance ? {
            id: liveAttendance.id,
            status: liveAttendance.status,
            durationMinutes: liveAttendance.durationMinutes,
            sessionDurationMinutes: sessionDurationMin,
            minRequiredMinutes,
            joinTime: liveAttendance.joinTime,
            leaveTime: liveAttendance.leaveTime,
            source: liveAttendance.source,
            markedByAdmin: liveAttendance.markedByAdmin,
            adminNotes: liveAttendance.adminNotes,
            attendedAt: liveAttendance.attendedAt,
          } : null,
        },
        prevSessionId: idx > 0 ? allSessions[idx - 1].id : null,
        nextSessionId: idx < allSessions.length - 1 ? allSessions[idx + 1].id : null,
        progress,
      },
    })
  } catch (err) { next(err) }
})

// ── POST /bootcamps/:id/sessions/:sessionId/complete ──────
bootcampRouter.post('/:id/sessions/:sessionId/complete', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: bootcampId, sessionId } = req.params as Record<string, string>
    const userId = req.user!.id

    const enrollment = await prisma.bootcampEnrollment.findUnique({
      where: { userId_bootcampId: { userId, bootcampId } },
    })
    if (!enrollment?.isActive) throw createError(403, 'Tidak memiliki akses')

    // Idempotent — already completed
    const existing = await prisma.sessionProgress.findFirst({
      where: { userId, bootcampSessionId: sessionId, isCompleted: true },
    })
    if (existing) return res.json({ success: true, data: { alreadyCompleted: true } })

    const session = await prisma.bootcampSession.findUnique({
      where: { id: sessionId },
      select: { xpReward: true, type: true, title: true },
    })
    if (!session) throw createError(404, 'Sesi tidak ditemukan')

    // Upsert progress
    await prisma.sessionProgress.upsert({
      where:  { userId_bootcampSessionId: { userId, bootcampSessionId: sessionId } },
      create: { userId, bootcampSessionId: sessionId, isCompleted: true, completedAt: new Date() },
      update: { isCompleted: true, completedAt: new Date() },
    })

    // Grant XP
    const xpSource = session.type === 'LIVE' ? 'LIVE_ATTEND' : 'VIDEO_COMPLETE'
    const xpAmount = session.xpReward > 0 ? session.xpReward : 10
    const xpEarned = await grantXp(userId, xpSource, `Bootcamp sesi: ${session.title}`, xpAmount)
    await updateBadge(userId)

    // Recalculate bootcamp progress
    const allBootcampSessions = await prisma.bootcampSession.findMany({
      where: { chapter: { bootcampId } },
      select: { id: true },
    })
    const completedCount = await prisma.sessionProgress.count({
      where: {
        userId,
        bootcampSessionId: { in: allBootcampSessions.map((s) => s.id) },
        isCompleted: true,
      },
    })
    const progress = Math.round((completedCount / allBootcampSessions.length) * 100)

    await prisma.bootcampEnrollment.update({
      where: { userId_bootcampId: { userId, bootcampId } },
      data:  { progress },
    })

    // Auto-certificate on 100%
    if (progress === 100) {
      const existingCert = await prisma.certificate.findFirst({ where: { userId, bootcampId } })
      if (!existingCert) {
        const credentialId = `METRO-BOOT-${Date.now().toString(36).toUpperCase()}`
        await prisma.certificate.create({
          data: { userId, bootcampId, productType: 'BOOTCAMP', credentialId },
        })
        await prisma.notification.create({
          data: {
            userId,
            type: 'BADGE_UPGRADE',  // closest NotifType for achievement
            title: '🎓 Sertifikat Bootcamp Diterbitkan!',
            body: `Selamat menyelesaikan bootcamp! Sertifikatmu siap diunduh.`,
            data: { credentialId, bootcampId },
          },
        })
      }
    }

    res.json({ success: true, data: { xpEarned, progress } })
  } catch (err) { next(err) }
})

// ── GET /bootcamps/:bootcampId/my-attendance ────────────────
// Mengambil data lengkap rekap kehadiran & kelayakan sertifikat untuk mentee yang login
bootcampRouter.get('/:bootcampId/my-attendance', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { bootcampId } = req.params as Record<string, string>
    const userId = req.user!.id

    const enrollment = await prisma.bootcampEnrollment.findUnique({
      where: { userId_bootcampId: { userId, bootcampId } },
      include: {
        bootcamp: { select: { id: true, title: true } },
      },
    })
    if (!enrollment?.isActive) throw createError(403, 'Kamu belum terdaftar di bootcamp ini')

    // Ambil seluruh chapters & sessions
    const chapters = await prisma.bootcampChapter.findMany({
      where: { bootcampId },
      orderBy: { orderIndex: 'asc' },
      include: {
        sessions: {
          orderBy: { orderIndex: 'asc' },
          select: {
            id: true,
            title: true,
            type: true,
            videoDuration: true,
            liveScheduledAt: true,
            orderIndex: true,
          },
        },
      },
    })

    const allSessions = chapters.flatMap((ch) =>
      ch.sessions.map((s) => ({ ...s, chapterTitle: ch.title }))
    )

    // Progress list
    const completedProgress = await prisma.sessionProgress.findMany({
      where: {
        userId,
        bootcampSessionId: { in: allSessions.map((s) => s.id) },
        isCompleted: true,
      },
      select: { bootcampSessionId: true },
    })
    const completedIds = new Set(completedProgress.map((p) => p.bootcampSessionId))

    // Live attendances
    const attendances = await prisma.liveAttendance.findMany({
      where: {
        userId,
        sessionId: { in: allSessions.map((s) => s.id) },
      },
    })
    const attendanceMap = new Map(attendances.map((a) => [a.sessionId, a]))

    // Certificate
    const cert = await prisma.certificate.findFirst({
      where: { userId, bootcampId },
      select: { id: true, credentialId: true, issuedAt: true },
    })

    const now = new Date()
    const sessionsData = chapters.flatMap((ch) => {
      const liveSess = ch.sessions.find((s) => s.type === 'LIVE')
      const liveScheduledAt = liveSess?.liveScheduledAt || null
      const liveDurationMin = liveSess?.videoDuration ? Math.ceil(liveSess.videoDuration / 60) : 90
      const isLiveEnded = liveScheduledAt
        ? new Date(new Date(liveScheduledAt).getTime() + liveDurationMin * 60000) <= now
        : false

      return ch.sessions.map((s) => {
        const isCompleted = completedIds.has(s.id)
        const durationMin = s.videoDuration ? Math.ceil(s.videoDuration / 60) : 90
        const minRequiredMin = Math.ceil(durationMin * 0.8)
        const att = attendanceMap.get(s.id)

        let attendanceStatus = 'NOT_RECORDED'
        if (att) {
          attendanceStatus = att.status
        } else if (s.type === 'LIVE' && s.liveScheduledAt && new Date(s.liveScheduledAt) < now) {
          attendanceStatus = 'ABSENT'
        }

        return {
          id: s.id,
          chapterId: ch.id,
          chapterTitle: ch.title,
          title: s.title,
          type: s.type,
          orderIndex: s.orderIndex,
          liveScheduledAt: s.liveScheduledAt || liveScheduledAt,
          chapterLiveScheduledAt: liveScheduledAt,
          isChapterLiveEnded: isLiveEnded,
          durationMinutes: durationMin,
          minRequiredMinutes: minRequiredMin,
          isCompleted,
          attendance: att ? {
            status: att.status,
            durationMinutes: att.durationMinutes,
            minRequiredMinutes: minRequiredMin,
            joinTime: att.joinTime,
            leaveTime: att.leaveTime,
            adminNotes: att.adminNotes,
            source: att.source,
          } : (s.type === 'LIVE' ? {
            status: attendanceStatus,
            durationMinutes: 0,
            minRequiredMinutes: minRequiredMin,
            joinTime: null,
            leaveTime: null,
            adminNotes: null,
            source: 'GOOGLE_MEET_API',
          } : null),
        }
      })
    })

    const totalSessions = allSessions.length
    const attendedCount = completedIds.size
    const missingSessions = sessionsData.filter((s) => !s.isCompleted)
    const allSessionsAttended = totalSessions > 0 && attendedCount === totalSessions

    res.json({
      success: true,
      data: {
        bootcamp: enrollment.bootcamp,
        progress: enrollment.progress,
        totalSessions,
        attendedCount,
        allSessionsAttended,
        certificate: {
          isUnlocked: allSessionsAttended || Boolean(cert),
          credentialId: cert?.credentialId || null,
          issuedAt: cert?.issuedAt || null,
        },
        missingSessions: missingSessions.map((s) => ({
          id: s.id,
          title: s.title,
          chapterTitle: s.chapterTitle,
          type: s.type,
        })),
        sessions: sessionsData,
      },
    })
  } catch (err) { next(err) }
})

