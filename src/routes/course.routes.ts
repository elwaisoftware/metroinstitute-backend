import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authenticate, AuthRequest } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'
import { grantXp } from '../utils/xp'
import { updateBadge } from '../utils/badge'

export const courseRouter = Router()
courseRouter.use(authenticate)

// ── GET /courses ───────────────────────────────────────────
courseRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { search, field, level, sort = 'newest', status } = req.query as Record<string, string>

    const where: Record<string, unknown> = {}
    if (req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
      where.isPublished = true
    } else if (status) {
      where.isPublished = status === 'PUBLISHED'
    }

    if (field) where.field = field
    if (level) where.level = level
    if (search) where.title = { contains: search as string, mode: 'insensitive' }

    const orderBy: Record<string, unknown>[] =
      sort === 'popular'   ? [{ enrollmentCount: 'desc' }]
      : sort === 'rating'  ? [{ rating: 'desc' }]
      : sort === 'price_asc' ? [{ price: 'asc' }]
      : [{ createdAt: 'desc' }]

    const courses = await prisma.miniCourse.findMany({
      where,
      orderBy,
      select: {
        id: true, title: true, shortDescription: true, field: true, level: true,
        price: true, thumbnailUrl: true, totalDuration: true, rating: true,
        reviewCount: true, enrollmentCount: true, tags: true,
        isPublished: true, isFeatured: true,
      },
    })

    res.json({ success: true, data: courses })
  } catch (err) { next(err) }
})

// ── GET /courses/enrolled ──────────────────────────────────
courseRouter.get('/enrolled', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id
    const enrollments = await prisma.courseEnrollment.findMany({
      where: { userId, isActive: true },
      include: {
        course: {
          select: { id: true, title: true, field: true, thumbnailUrl: true, accessDays: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const result = enrollments.map((e) => ({
      id:          e.course.id,
      title:       e.course.title,
      field:       e.course.field,
      thumbnail:   e.course.thumbnailUrl,
      progress:    Math.round(e.progress),
      accessUntil: e.accessUntil,
      type:        'mini-course',
    }))
    res.json({ success: true, data: result })
  } catch (err) { next(err) }
})

// ── GET /courses/:id ───────────────────────────────────────
courseRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id
    const course = await prisma.miniCourse.findUnique({
      where: { id: (req.params as Record<string, string>).id, isPublished: true },
      include: {
        chapters: {
          orderBy: { orderIndex: 'asc' },
          include: {
            sessions: {
              orderBy: { orderIndex: 'asc' },
              select: {
                id: true, title: true, type: true,
                videoDuration: true, isFreePreview: true, orderIndex: true,
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
    if (!course) throw createError(404, 'Kursus tidak ditemukan')

    const [enrollment, wishlist] = await Promise.all([
      prisma.courseEnrollment.findUnique({ where: { userId_courseId: { userId, courseId: course.id } } }),
      prisma.wishlistItem.findFirst({ where: { userId, courseId: course.id } }),
    ])

    // Normalize review.content → comment for frontend
    const normalized = {
      ...course,
      reviews: course.reviews.map((r) => ({ ...r, comment: r.content })),
      isEnrolled:   !!enrollment && enrollment.isActive,
      isWishlisted: !!wishlist,
      accessUntil:  enrollment?.accessUntil ?? null,
    }

    res.json({ success: true, data: normalized })
  } catch (err) { next(err) }
})

// ── GET /courses/:id/learn/:sessionId ─────────────────────
courseRouter.get('/:id/learn/:sessionId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: courseId, sessionId } = req.params as Record<string, string>
    const userId = req.user!.id

    // Verify active enrollment with access window check
    const enrollment = await prisma.courseEnrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    })
    if (!enrollment || !enrollment.isActive || enrollment.accessUntil < new Date()) {
      throw createError(403, 'Kamu belum memiliki akses ke kursus ini')
    }

    const session = await prisma.courseSession.findUnique({
      where: { id: sessionId },
      include: {
        chapter: {
          include: {
            course: { select: { id: true, title: true, field: true } },
          },
        },
      },
    })
    if (!session || session.chapter.courseId !== courseId) {
      throw createError(404, 'Sesi tidak ditemukan')
    }

    // Sidebar chapters
    const chapters = await prisma.courseChapter.findMany({
      where: { courseId },
      orderBy: { orderIndex: 'asc' },
      include: {
        sessions: {
          orderBy: { orderIndex: 'asc' },
          select: { id: true, title: true, type: true, videoDuration: true, orderIndex: true },
        },
      },
    })

    const allSessions = chapters.flatMap((ch) => ch.sessions)
    const currentIdx  = allSessions.findIndex((s) => s.id === sessionId)

    const completedProgress = await prisma.sessionProgress.findMany({
      where: { userId, courseSessionId: { in: allSessions.map((s) => s.id) }, isCompleted: true },
      select: { courseSessionId: true },
    })
    const completedIds = new Set(completedProgress.map((p) => p.courseSessionId))

    // User's assignment for this session (if any)
    const assignment = session.type === 'ASSIGNMENT'
      ? await prisma.assignment.findFirst({
          where:   { userId, courseSessionId: sessionId },
          orderBy: { submittedAt: 'desc' },
        })
      : null

    const totalSessions   = allSessions.length
    const courseProgress  = totalSessions > 0 ? Math.round((completedIds.size / totalSessions) * 100) : 0

    res.json({
      success: true,
      data: {
        course:         session.chapter.course,
        chapters:       chapters.map((ch) => ({
          ...ch,
          sessions: ch.sessions.map((s) => ({ ...s, isCompleted: completedIds.has(s.id) })),
        })),
        currentSession: { ...session, isCompleted: completedIds.has(sessionId), assignment },
        prevSessionId:  currentIdx > 0 ? allSessions[currentIdx - 1].id : null,
        nextSessionId:  currentIdx < allSessions.length - 1 ? allSessions[currentIdx + 1].id : null,
        progress:       courseProgress,
      },
    })
  } catch (err) { next(err) }
})

// ── POST /courses/:id/sessions/:sessionId/complete ─────────
courseRouter.post('/:id/sessions/:sessionId/complete', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: courseId, sessionId } = req.params as Record<string, string>
    const userId = req.user!.id

    const enrollment = await prisma.courseEnrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    })
    if (!enrollment?.isActive) throw createError(403, 'Tidak memiliki akses')

    // Idempotent guard
    const existing = await prisma.sessionProgress.findFirst({
      where: { userId, courseSessionId: sessionId, isCompleted: true },
    })
    if (existing) return res.json({ success: true, data: { alreadyCompleted: true } })

    const session = await prisma.courseSession.findUnique({
      where: { id: sessionId },
      select: { xpReward: true, type: true, title: true },
    })
    if (!session) throw createError(404, 'Sesi tidak ditemukan')

    await prisma.sessionProgress.upsert({
      where:  { userId_courseSessionId: { userId, courseSessionId: sessionId } },
      create: { userId, courseSessionId: sessionId, isCompleted: true, completedAt: new Date() },
      update: { isCompleted: true, completedAt: new Date() },
    })

    // XP — use VIDEO_COMPLETE for video sessions
    const xpSource = session.type === 'VIDEO' ? 'VIDEO_COMPLETE' : 'ASSIGNMENT_GRADED'
    const xpEarned = await grantXp(userId, xpSource, `Sesi: ${session.title}`, session.xpReward)
    await updateBadge(userId)

    // Recalculate progress
    const allCourseSessions = await prisma.courseSession.findMany({
      where: { chapter: { courseId } },
      select: { id: true },
    })
    const completedCount = await prisma.sessionProgress.count({
      where: { userId, courseSessionId: { in: allCourseSessions.map((s) => s.id) }, isCompleted: true },
    })
    const progress = Math.round((completedCount / allCourseSessions.length) * 100)

    await prisma.courseEnrollment.update({
      where: { userId_courseId: { userId, courseId } },
      data:  { progress },
    })

    // Auto-certificate
    if (progress === 100) {
      const existingCert = await prisma.certificate.findFirst({ where: { userId, courseId } })
      if (!existingCert) {
        const credentialId = `METRO-COURSE-${Date.now().toString(36).toUpperCase()}`
        await prisma.certificate.create({
          data: { userId, courseId, productType: 'MINI_COURSE', credentialId },
        })
        await prisma.notification.create({
          data: {
            userId,
            type:  'BADGE_UPGRADE',
            title: '🎓 Sertifikat Diterbitkan!',
            body:  `Selamat! Sertifikatmu untuk kursus ini siap diunduh.`,
            data:  { credentialId, courseId },
          },
        })
      }
    }

    res.json({ success: true, data: { xpEarned, progress } })
  } catch (err) { next(err) }
})

// ── GET /courses/:id/sessions/:sessionId/notes ─────────────
courseRouter.get('/:id/sessions/:sessionId/notes', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const notes = await prisma.note.findMany({
      where:   { userId: req.user!.id, courseSessionId: (req.params as Record<string, string>).sessionId },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ success: true, data: notes })
  } catch (err) { next(err) }
})

// ── POST /courses/:id/sessions/:sessionId/notes ────────────
courseRouter.post('/:id/sessions/:sessionId/notes', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { content, timestampSec } = z.object({
      content:      z.string().min(1).max(2000),
      timestampSec: z.number().int().optional(),
    }).parse(req.body)

    const note = await prisma.note.create({
      data: { userId: req.user!.id, courseSessionId: (req.params as Record<string, string>).sessionId, content, timestampSec },
    })
    res.status(201).json({ success: true, data: note })
  } catch (err) { next(err) }
})

// ── DELETE /courses/:id/sessions/:sessionId/notes/:noteId ──
courseRouter.delete('/:id/sessions/:sessionId/notes/:noteId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const note = await prisma.note.findUnique({ where: { id: (req.params as Record<string, string>).noteId } })
    if (!note || note.userId !== req.user!.id) throw createError(403, 'Akses ditolak')
    await prisma.note.delete({ where: { id: (req.params as Record<string, string>).noteId } })
    res.json({ success: true })
  } catch (err) { next(err) }
})

// ── GET /courses/:id/sessions/:sessionId/qna ──────────────
courseRouter.get('/:id/sessions/:sessionId/qna', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const messages = await prisma.qnaMessage.findMany({
      where:   { courseSessionId: (req.params as Record<string, string>).sessionId, parentId: null },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { name: true, photoUrl: true, role: true } } },
    })
    res.json({ success: true, data: messages })
  } catch (err) { next(err) }
})

// ── POST /courses/:id/sessions/:sessionId/qna ─────────────
courseRouter.post('/:id/sessions/:sessionId/qna', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { content, parentId } = z.object({
      content:  z.string().min(1).max(2000),
      parentId: z.string().optional(),
    }).parse(req.body)

    const msg = await prisma.qnaMessage.create({
      data: { userId: req.user!.id, courseSessionId: (req.params as Record<string, string>).sessionId, content, parentId },
      include: { user: { select: { name: true, photoUrl: true, role: true } } },
    })
    res.status(201).json({ success: true, data: msg })
  } catch (err) { next(err) }
})

// ── POST /courses/:id/sessions/:sessionId/assignment ──────
courseRouter.post('/:id/sessions/:sessionId/assignment', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fileUrl, linkUrl, description } = z.object({
      fileUrl:     z.string().url().optional(),
      linkUrl:     z.string().url().optional(),
      description: z.string().max(2000).optional(),
    }).parse(req.body)

    const submission = await prisma.assignment.create({
      data: {
        userId:         req.user!.id,
        courseSessionId: (req.params as Record<string, string>).sessionId,
        fileUrl,
        linkUrl,
        description,
      },
    })
    res.json({ success: true, data: submission })
  } catch (err) { next(err) }
})
