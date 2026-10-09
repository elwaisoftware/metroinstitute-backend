import { Router, Response, NextFunction, Request } from 'express'
import { prisma } from '../utils/prisma'
import { authenticate, AuthRequest, optionalAuth } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'
import { grantXp } from '../utils/xp'
import { updateBadge } from '../utils/badge'

export const bootcampRouter = Router()

// ── GET /bootcamps ─────────────────────────────────────────
bootcampRouter.get('/', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, field, level, status } = req.query as Record<string, string>
    const where: Record<string, unknown> = { isPublished: true }
    if (field) where.field = field
    if (level) where.level = level
    if (status) where.batchStatus = status
    if (search) where.title = { contains: search as string, mode: 'insensitive' }

    const bootcamps = await prisma.bootcamp.findMany({
      where,
      orderBy: [{ batchStatus: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true, title: true, shortDescription: true, field: true, level: true,
        price: true, thumbnailUrl: true, totalDuration: true, rating: true,
        reviewCount: true, enrollmentCount: true, batchStatus: true,
        registrationStartDate: true, registrationDeadline: true, batchStartDate: true,
        mentorName: true, mentorPhotoUrl: true, tags: true,
        isPublished: true, isFeatured: true,
      },
    })
    
    const now = new Date()
    const mappedBootcamps = bootcamps.map(b => {
      let computedStatus = b.batchStatus
      if (computedStatus === 'COMING_SOON' && b.registrationStartDate && now >= b.registrationStartDate) {
        computedStatus = 'OPEN'
      }
      if (computedStatus === 'OPEN' && b.registrationDeadline && now >= b.registrationDeadline) {
        computedStatus = 'CLOSED'
      }
      return { ...b, batchStatus: computedStatus }
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
    }

    let computedBatchStatus = bootcamp.batchStatus
    const now = new Date()
    if (computedBatchStatus === 'COMING_SOON' && bootcamp.registrationStartDate && now >= bootcamp.registrationStartDate) {
      computedBatchStatus = 'OPEN'
    }
    if (computedBatchStatus === 'OPEN' && bootcamp.registrationDeadline && now >= bootcamp.registrationDeadline) {
      computedBatchStatus = 'CLOSED'
    }

    // Normalize reviews to use consistent field name
    const normalized = {
      ...bootcamp,
      batchStatus: computedBatchStatus,
      reviews: bootcamp.reviews.map((r) => ({ ...r, comment: r.content })),
      isEnrolled,
      isWishlisted,
    }

    res.json({ success: true, data: normalized })
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
    const assignment = session.type === 'ASSIGNMENT'
      ? await prisma.assignment.findFirst({ where: { userId, bootcampSessionId: sessionId }, orderBy: { submittedAt: 'desc' } })
      : null

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
          isCompleted: completedIds.has(sessionId),
          assignment,
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
    const xpEarned = await grantXp(userId, xpSource, `Bootcamp sesi: ${session.title}`, session.xpReward)
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
