import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import multer from 'multer'
import { v2 as cloudinary } from 'cloudinary'
import { prisma } from '../utils/prisma'
import { authenticate, AuthRequest } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'
import { grantXp } from '../utils/xp'
import { updateBadge } from '../utils/badge'

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Hanya file gambar yang diizinkan'))
  },
})

export const userRouter = Router()
userRouter.use(authenticate)

// ── GET /users/me ──────────────────────────────────────────
userRouter.get('/me', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true, name: true, email: true, phone: true,
        photoUrl: true, bio: true, status: true, institution: true,
        role: true, isEmailVerified: true, skillTestDone: true,
        selectedField: true, skillTestResult: true, currentLevel: true,
        totalXp: true, currentStreak: true, longestStreak: true,
        badgeLevel: true, createdAt: true,
      },
    })
    if (!user) throw createError(404, 'User tidak ditemukan')
    res.json({ success: true, data: user })
  } catch (err) { next(err) }
})

// ── PATCH /users/me ────────────────────────────────────────
userRouter.patch('/me', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      name: z.string().min(2).max(80).optional(),
      phone: z.string().optional(),
      bio: z.string().max(500).optional(),
      status: z.string().optional(),
      institution: z.string().optional(),
      selectedField: z.enum(['UI_UX', 'FRONTEND', 'BACKEND', 'MOBILE']).optional(),
    })
    const data = schema.parse(req.body)
    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data,
      select: { id: true, name: true, email: true, phone: true, bio: true, status: true, institution: true, selectedField: true },
    })
    res.json({ success: true, data: updated })
  } catch (err) { next(err) }
})

// ── POST /users/me/photo ───────────────────────────────────
userRouter.post('/me/photo', upload.single('photo'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) throw createError(400, 'File foto tidak ada')
    const userId = req.user!.id

    // Upload to Cloudinary
    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'metro-institute/avatars', public_id: userId, overwrite: true, transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }] },
        (err, result) => err ? reject(err) : resolve(result as { secure_url: string })
      )
      stream.end(req.file!.buffer)
    })

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { photoUrl: true } })
    const isFirstUpload = !user?.photoUrl

    await prisma.user.update({ where: { id: userId }, data: { photoUrl: result.secure_url } })

    // Grant XP for first photo
    if (isFirstUpload) {
      await grantXp(userId, 'PROFILE_PHOTO_UPLOAD', 'Upload foto profil pertama')
      await updateBadge(userId)
    }

    res.json({ success: true, data: { photoUrl: result.secure_url }, xpEarned: isFirstUpload ? 20 : 0 })
  } catch (err) { next(err) }
})

// ── GET /users/basecamp ────────────────────────────────────
userRouter.get('/basecamp', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id

    const [user, bootcampEnrollments, courseEnrollments, upcomingLive, unreadCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, photoUrl: true, totalXp: true, currentStreak: true, badgeLevel: true, selectedField: true },
      }),
      prisma.bootcampEnrollment.findMany({
        where: { userId, isActive: true },
        include: { bootcamp: { include: { chapters: { include: { sessions: true } } } } },
        take: 5,
      }),
      prisma.courseEnrollment.findMany({
        where: { userId, isActive: true, accessUntil: { gt: new Date() } },
        include: { course: true },
        take: 5,
      }),
      prisma.bootcampSession.findMany({
        where: {
          type: 'LIVE',
          liveScheduledAt: { gt: new Date() },
          chapter: { bootcamp: { enrollments: { some: { userId, isActive: true } } } },
        },
        include: { chapter: { select: { bootcampId: true } } },
        orderBy: { liveScheduledAt: 'asc' },
        take: 3,
      }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ])

    // Build continue learning (last progress)
    const lastProgress = await prisma.sessionProgress.findFirst({
      where: { userId, isCompleted: false, OR: [{ bootcampSessionId: { not: null } }, { courseSessionId: { not: null } }] },
      orderBy: { updatedAt: 'desc' },
      include: {
        bootcampSession: { include: { chapter: { include: { bootcamp: true } } } },
        courseSession:   { include: { chapter: { include: { course: true } } } },
      },
    })

    let continueLearning = null
    if (lastProgress?.bootcampSession) {
      const bs = lastProgress.bootcampSession
      const bootcamp = bs.chapter.bootcamp
      continueLearning = {
        type: 'bootcamp', id: bootcamp.id, sessionId: bs.id,
        title: bootcamp.title, sessionTitle: bs.title,
        progress: bootcampEnrollments.find((e) => e.bootcampId === bootcamp.id)?.progress ?? 0,
        thumbnail: bootcamp.thumbnailUrl,
      }
    } else if (lastProgress?.courseSession) {
      const cs = lastProgress.courseSession
      const course = cs.chapter.course
      continueLearning = {
        type: 'mini-course', id: course.id, sessionId: cs.id,
        title: course.title, sessionTitle: cs.title,
        progress: courseEnrollments.find((e) => e.courseId === course.id)?.progress ?? 0,
        thumbnail: course.thumbnailUrl,
      }
    }

    // Recommendations based on selectedField
    const recommendations = await prisma.miniCourse.findMany({
      where: {
        isPublished: true,
        field: (user?.selectedField as any) || undefined,
        enrollments: { none: { userId } },
      },
      orderBy: { enrollmentCount: 'desc' },
      take: 3,
      select: { id: true, title: true, price: true, field: true, level: true, thumbnailUrl: true, rating: true },
    })

    const activeCourses = [
      ...bootcampEnrollments.map((e) => ({
        id: e.bootcampId, title: e.bootcamp.title, type: 'bootcamp' as const,
        progress: e.progress, thumbnail: e.bootcamp.thumbnailUrl, field: e.field,
      })),
      ...courseEnrollments.map((e) => ({
        id: e.courseId, title: e.course.title, type: 'mini-course' as const,
        progress: e.progress, thumbnail: e.course.thumbnailUrl, field: e.course.field,
        accessUntil: e.accessUntil.toISOString(),
      })),
    ]

    res.json({
      success: true,
      data: {
        user,
        continueLearning,
        activeCourses,
        upcomingLive: upcomingLive.map((s) => ({
          id: s.id, bootcampId: s.chapter.bootcampId, title: s.title,
          scheduledAt: s.liveScheduledAt, liveUrl: s.liveUrl,
        })),
        recommendations: recommendations.map((r) => ({ ...r, type: 'mini-course' as const })),
        unreadNotifications: unreadCount,
      },
    })
  } catch (err) { next(err) }
})

// ── GET /users/profile/:userId (public) ────────────────────
userRouter.get('/profile/:userId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: (req.params as Record<string, string>).userId },
      select: {
        id: true, name: true, photoUrl: true, bio: true,
        status: true, institution: true, totalXp: true,
        badgeLevel: true, currentStreak: true, longestStreak: true,
        selectedField: true, createdAt: true,
        certificates: {
          select: { id: true, productType: true, credentialId: true, issuedAt: true },
          orderBy: { issuedAt: 'desc' },
        },
      },
    })
    if (!user) throw createError(404, 'User tidak ditemukan')
    res.json({ success: true, data: user })
  } catch (err) { next(err) }
})

// ── GET /users/me/xp-logs ─────────────────────────────────
userRouter.get('/me/xp-logs', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id
    const page   = Number((req.query as Record<string, string>).page)  || 1
    const limit  = Number((req.query as Record<string, string>).limit) || 20
    const skip   = (page - 1) * limit
    const source = (req.query as Record<string, string>).source as string | undefined
    const search = (req.query as Record<string, string>).search as string | undefined

    const where: any = { userId }
    if (source) where.source = source
    if (search) where.note = { contains: search, mode: 'insensitive' }

    const [total, logs, user] = await Promise.all([
      prisma.xpLog.count({ where }),
      prisma.xpLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: { id: true, source: true, amount: true, note: true, createdAt: true },
      }),
      prisma.user.findUnique({
        where:  { id: userId },
        select: { totalXp: true },
      }),
    ])

    // Month & week summaries
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfWeek  = new Date(now)
    startOfWeek.setDate(now.getDate() - now.getDay())
    startOfWeek.setHours(0, 0, 0, 0)

    const [thisMonthAgg, thisWeekAgg] = await Promise.all([
      prisma.xpLog.aggregate({ where: { userId, createdAt: { gte: startOfMonth } }, _sum: { amount: true } }),
      prisma.xpLog.aggregate({ where: { userId, createdAt: { gte: startOfWeek  } }, _sum: { amount: true } }),
    ])

    res.json({
      success: true,
      data: {
        totalXp:   user?.totalXp ?? 0,
        thisMonth: thisMonthAgg._sum.amount ?? 0,
        thisWeek:  thisWeekAgg._sum.amount  ?? 0,
        logs,
        meta: { total, page, limit },
      },
    })
  } catch (err) { next(err) }
})
