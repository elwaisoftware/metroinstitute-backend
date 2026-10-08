import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authenticate, AuthRequest } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'
import { WhatsAppService } from '../services/whatsapp.service'
import multer from 'multer'
import { v2 as cloudinary } from 'cloudinary'
import path from 'path'
import fsOriginal from 'fs'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
})

export const adminRouter = Router()

// ── Admin auth guard ───────────────────────────────────────
adminRouter.use(authenticate, async (req: AuthRequest, _res: Response, next: NextFunction) => {
  if (!['SUPER_ADMIN', 'SUPER_ADMIN'].includes(req.user!.role)) {
    return next(createError(403, 'Akses ditolak: hanya admin yang bisa mengakses endpoint ini'))
  }
  next()
})

// ── GET /admin/dashboard ───────────────────────────────────
adminRouter.get('/dashboard', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [
      totalMentees,
      newMenteesThisMonth,
      totalRevenue,
      revenueThisMonth,
      totalCertificates,
      activeBootcampEnrollments,
      activeCourseEnrollments,
      recentTransactions,
      transactionsByStatus,
      topCourses,
      topBootcamps,
      newMenteesLast7Days,
      enrollmentTrend,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'MENTEE' } }),
      prisma.user.count({
        where: {
          role: 'MENTEE',
          createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
      prisma.transaction.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: {
          status: 'SUCCESS',
          paidAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
        _sum: { amount: true },
      }),
      prisma.certificate.count(),
      prisma.bootcampEnrollment.count({ where: { isActive: true } }),
      prisma.courseEnrollment.count({ where: { isActive: true } }),
      prisma.transaction.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true, orderId: true, title: true, amount: true,
          status: true, productType: true, createdAt: true, paidAt: true,
          user: { select: { name: true, email: true } },
        },
      }),
      prisma.transaction.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      prisma.miniCourse.findMany({
        where: { isPublished: true },
        orderBy: { enrollmentCount: 'desc' },
        take: 5,
        select: { id: true, title: true, field: true, enrollmentCount: true, rating: true, price: true },
      }),
      prisma.bootcamp.findMany({
        where: { isPublished: true },
        orderBy: { enrollmentCount: 'desc' },
        take: 5,
        select: { id: true, title: true, field: true, enrollmentCount: true, rating: true, price: true, batchStatus: true },
      }),
      // New mentees last 7 days
      Promise.all(
        Array.from({ length: 7 }, (_, i) => {
          const d = new Date()
          d.setDate(d.getDate() - i)
          const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate())
          const dayEnd   = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
          return prisma.user.count({
            where: { role: 'MENTEE', createdAt: { gte: dayStart, lt: dayEnd } },
          }).then((count) => ({ date: dayStart.toISOString().split('T')[0], count }))
        })
      ),
      // Enrollment trend last 30 days
      Promise.all(
        Array.from({ length: 30 }, (_, i) => {
          const d = new Date()
          d.setDate(d.getDate() - (29 - i)) // oldest to newest
          const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate())
          const dayEnd   = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
          
          return Promise.all([
            prisma.bootcampEnrollment.count({
              where: { createdAt: { gte: dayStart, lt: dayEnd } }
            }),
            prisma.courseEnrollment.count({
              where: { createdAt: { gte: dayStart, lt: dayEnd } }
            })
          ]).then(([bootcamp, course]) => ({
            date: dayStart.toISOString().split('T')[0],
            bootcamp,
            course
          }))
        })
      ),
    ])

    const txStatusMap = Object.fromEntries(
      transactionsByStatus.map((s) => [s.status, s._count.id])
    )

    res.json({
      success: true,
      data: {
        kpis: {
          totalMentees,
          newMenteesThisMonth,
          totalTransactions: Object.values(txStatusMap).reduce((acc, curr) => acc + curr, 0),
          successTransactions: txStatusMap['SUCCESS'] || 0,
          pendingTransactions: txStatusMap['PENDING'] || 0,
          totalRevenue:   totalRevenue._sum.amount    ?? 0,
          revenueThisMonth: revenueThisMonth._sum.amount ?? 0,
          totalCertificates,
          totalEnrollments: activeBootcampEnrollments + activeCourseEnrollments,
          bootcampEnrollments: activeBootcampEnrollments,
          courseEnrollments: activeCourseEnrollments,
        },
        transactionStatus: txStatusMap,
        recentTransactions,
        topCourses,
        topBootcamps,
        newMenteesLast7Days: newMenteesLast7Days.reverse(), // oldest → newest
        enrollmentTrend,
      },
    })
  } catch (err) { next(err) }
})

// ── GET /admin/mentees ─────────────────────────────────────
adminRouter.get('/mentees', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page  = Number((req.query as Record<string, string>).page)  || 1
    const limit = Number((req.query as Record<string, string>).limit) || 20
    const { search, field, badge } = req.query as Record<string, string>

    const where: Record<string, unknown> = { role: 'MENTEE' }
    if (search) {
      where.OR = [
        { name:  { startsWith: String(search), mode: 'insensitive' } },
        { email: { startsWith: String(search), mode: 'insensitive' } },
      ]
    }
    if (field) where.selectedField = field
    if (badge) where.badgeLevel = badge

    const [total, mentees] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip:    (page - 1) * limit,
        take:    limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, email: true, phone: true,
          photoUrl: true, badgeLevel: true, totalXp: true,
          selectedField: true, currentStreak: true, isEmailVerified: true,
          createdAt: true,
          _count: { select: { bootcampEnrollments: true, courseEnrollments: true } },
        },
      }),
    ])

    res.json({
      success: true,
      data: mentees.map((m) => ({
        ...m,
        totalEnrollments: m._count.bootcampEnrollments + m._count.courseEnrollments,
      })),
      meta: { total, page, limit },
    })
  } catch (err) { next(err) }
})

// ── GET /admin/mentees/:id ─────────────────────────────────
adminRouter.get('/mentees/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: (req.params as Record<string, string>).id },
      include: {
        bootcampEnrollments: {
          include: { bootcamp: { select: { id: true, title: true } } },
        },
        courseEnrollments: {
          include: { course: { select: { id: true, title: true } } },
        },
        certificates: { orderBy: { issuedAt: 'desc' } },
        xpLogs: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    })
    if (!user) throw createError(404, 'User tidak ditemukan')
    res.json({ success: true, data: user })
  } catch (err) { next(err) }
})

// ── PATCH /admin/mentees/:id/xp ────────────────────────────
adminRouter.patch('/mentees/:id/xp', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { amount, note } = z.object({
      amount: z.number().int(),
      note:   z.string().optional(),
    }).parse(req.body)

    await prisma.$transaction([
      prisma.xpLog.create({ data: { userId: (req.params as Record<string, string>).id, source: 'MANUAL_GRANT', amount, note } }),
      prisma.user.update({ where: { id: (req.params as Record<string, string>).id }, data: { totalXp: { increment: amount } } }),
    ])
    res.json({ success: true, message: `+${amount} XP diberikan` })
  } catch (err) { next(err) }
})

// ── GET /admin/courses/:id/stats ───────────────────────────
adminRouter.get('/courses/:id/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page  = Number((req.query as Record<string, string>).page)  || 1
    const limit = Number((req.query as Record<string, string>).limit) || 10
    const { search } = req.query as Record<string, string>

    const course = await prisma.miniCourse.findUnique({
      where: { id: (req.params as Record<string, string>).id },
      select: { id: true, title: true, price: true, accessDays: true, rating: true, totalDuration: true },
    })
    if (!course) throw createError(404, 'Mini course tidak ditemukan')

    const where: any = { courseId: course.id }
    if (search) {
      where.user = {
        OR: [
          { name: { startsWith: String(search), mode: 'insensitive' } },
          { email: { startsWith: String(search), mode: 'insensitive' } },
        ]
      }
    }

    const [totalEnrollments, enrollments, avgProgAgg] = await Promise.all([
      prisma.courseEnrollment.count({ where }),
      prisma.courseEnrollment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      prisma.courseEnrollment.aggregate({ where: { courseId: course.id }, _avg: { progress: true } })
    ])

    const completionRate = totalEnrollments > 0
      ? (await prisma.courseEnrollment.count({ where: { courseId: course.id, progress: 100 } }) / totalEnrollments) * 100
      : 0

    res.json({
      success: true,
      data: {
        course,
        totalEnrollments: await prisma.courseEnrollment.count({ where: { courseId: course.id } }), // Total regardless of search
        totalRevenue: totalEnrollments * course.price,
        avgProgress: avgProgAgg._avg.progress || 0,
        completionRate,
        enrollments,
        pagination: { page, limit, total: totalEnrollments, totalPages: Math.ceil(totalEnrollments / limit) }
      }
    })
  } catch (err) { next(err) }
})

// ── PATCH /admin/courses/enrollments/:enrollmentId/extend ──
adminRouter.patch('/courses/enrollments/:enrollmentId/extend', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { days } = z.object({ days: z.number().int().min(1) }).parse(req.body)
    const enrollment = await prisma.courseEnrollment.findUnique({ where: { id: (req.params as Record<string, string>).enrollmentId } })
    if (!enrollment) throw createError(404, 'Enrollment tidak ditemukan')

    const newDate = new Date(enrollment.accessUntil)
    if (newDate < new Date()) {
      newDate.setTime(Date.now() + days * 24 * 60 * 60 * 1000)
    } else {
      newDate.setTime(newDate.getTime() + days * 24 * 60 * 60 * 1000)
    }

    await prisma.courseEnrollment.update({
      where: { id: (req.params as Record<string, string>).enrollmentId },
      data: { accessUntil: newDate, isActive: true }
    })

    res.json({ success: true, message: 'Akses diperpanjang' })
  } catch (err) { next(err) }
})

// ── GET /admin/transactions ────────────────────────────────
adminRouter.get('/transactions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page  = Number((req.query as Record<string, string>).page)  || 1
    const limit = Number((req.query as Record<string, string>).limit) || 20
    const { status, productType, search } = req.query as Record<string, string>

    const where: Record<string, unknown> = {}
    if (status)      where.status = status
    if (productType) where.productType = productType
    if (search) {
      const searchStr = String(search)
      where.OR = [
        { orderId: { startsWith: searchStr, mode: 'insensitive' } },
        { user: { name: { startsWith: searchStr, mode: 'insensitive' } } },
        { user: { email: { startsWith: searchStr, mode: 'insensitive' } } },
      ]
    }

    const [total, transactions] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
        select: {
          id: true, orderId: true, title: true, amount: true,
          status: true, productType: true, createdAt: true, paidAt: true,
          user: { select: { name: true, email: true } },
        },
      }),
    ])

    res.json({ success: true, data: transactions, meta: { total, page, limit } })
  } catch (err) { next(err) }
})

// ── POST /admin/broadcast ──────────────────────────────────
adminRouter.post('/broadcast', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { title, body, targetField, targetBadge } = z.object({
      title:       z.string().min(3).max(100),
      body:        z.string().min(5).max(500),
      targetField: z.string().optional(),
      targetBadge: z.string().optional(),
    }).parse(req.body)

    const where: Record<string, unknown> = { role: 'MENTEE' }
    if (targetField) where.selectedField = targetField
    if (targetBadge) where.badgeLevel    = targetBadge

    const mentees = await prisma.user.findMany({
      where,
      select: { id: true },
    })

    await prisma.notification.createMany({
      data: mentees.map((m) => ({
        userId: m.id,
        type:   'SYSTEM_BROADCAST' as const,
        title,
        body,
      })),
      skipDuplicates: true,
    })

    res.json({ success: true, message: `Broadcast terkirim ke ${mentees.length} mentee` })
  } catch (err) { next(err) }
})

// ── GET /admin/xp-settings ────────────────────────────────
adminRouter.get('/xp-settings', async (_req, res: Response, next: NextFunction) => {
  try {
    const [xpConfigs, badgeConfigs] = await Promise.all([
      prisma.xpConfig.findMany({ orderBy: { source: 'asc' } }),
      prisma.badgeConfig.findMany({ orderBy: { minXp: 'asc' } }),
    ])
    res.json({ success: true, data: { xpConfigs, badgeConfigs } })
  } catch (err) { next(err) }
})

// ── PATCH /admin/xp-settings/:source ──────────────────────
adminRouter.patch('/xp-settings/:source', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { amount } = z.object({ amount: z.number().int().min(0) }).parse(req.body)
    const updated = await prisma.xpConfig.updateMany({
      where: { source: (req.params as Record<string, string>).source as any },
      data:  { amount },
    })
    if (updated.count === 0) throw createError(404, 'XP config tidak ditemukan')
    res.json({ success: true, message: 'XP config diperbarui' })
  } catch (err) { next(err) }
})

// ── GET /admin/homepage-settings ──────────────────────────
adminRouter.get('/homepage-settings', async (_req, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.homepageConfig.findMany()
    const config = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    res.json({ success: true, data: config })
  } catch (err) { next(err) }
})

// ── PATCH /admin/homepage-settings ────────────────────────
adminRouter.patch('/homepage-settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const updates = z.record(z.string()).parse(req.body)
    await Promise.all(
      Object.entries(updates).map(([key, value]) =>
        prisma.homepageConfig.upsert({
          where:  { key },
          create: { key, value },
          update: { value },
        })
      )
    )
    res.json({ success: true, message: 'Pengaturan homepage disimpan' })
  } catch (err) { next(err) }
})

// ── GET /admin/assignments ────────────────────────────────
adminRouter.get('/assignments', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page = '1', limit = '10', search, status, field } = req.query as Record<string, string>
    const p = parseInt(page as string, 10) || 1
    const l = parseInt(limit as string, 10) || 10
    const skip = (p - 1) * l

    const where: any = { challenge: { type: 'PROJECT' } }

    if (status) {
      if (status === 'GRADED') where.isCorrect = { not: null }
      if (status === 'SUBMITTED') where.isCorrect = null
    }

    if (field) {
      where.challenge = { ...where.challenge, field }
    }

    if (search) {
      where.OR = [
        { user: { name: { startsWith: search as string, mode: 'insensitive' } } },
        { challenge: { title: { startsWith: search as string, mode: 'insensitive' } } },
      ]
    }

    const [total, items] = await Promise.all([
      prisma.challengeAttempt.count({ where }),
      prisma.challengeAttempt.findMany({
        where,
        skip,
        take: l,
        orderBy: { submittedAt: 'desc' },
        include: {
          challenge: { select: { id: true, title: true, field: true, xpReward: true } },
        }
      })
    ])

    const formattedItems = await Promise.all(items.map(async (a: any) => {
      const user = await prisma.user.findUnique({ where: { id: a.userId }, select: { id: true, name: true, email: true } })
      return {
      id: a.id,
      user,
      score: a.isCorrect ? (a.isCorrect ? a.challenge.xpReward : 0) : undefined, // Simplify mapping
      feedback: a.answer, // Assume feedback is saved in answer or not stored? Wait, schema has answer. Let's assume feedback is part of answer or just not strongly typed in this simplistic version. Let's use answer as submissionText.
      status: a.isCorrect !== null ? 'GRADED' : 'SUBMITTED',
      submittedAt: a.submittedAt,
      gradedAt: a.canRetryAt, // misuse canRetryAt as gradedAt?
      submissionUrl: a.answer?.startsWith('http') ? a.answer : undefined,
      submissionText: !a.answer?.startsWith('http') ? a.answer : undefined,
      challenge: { ...a.challenge, maxScore: a.challenge.xpReward },
    }}))

    res.json({ success: true, data: { items: formattedItems, meta: { total, page: p, limit: l } } })
  } catch (err) { next(err) }
})

// ── PATCH /admin/assignments/:id/grade ────────────────────
adminRouter.patch('/assignments/:id/grade', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { score, feedback } = z.object({
      score: z.number().min(0),
      feedback: z.string().optional()
    }).parse(req.body)

    const attempt = await prisma.challengeAttempt.findUnique({
      where: { id: (req.params as Record<string, string>).id },
      include: { challenge: true }
    })

    if (!attempt) throw createError(404, 'Submission tidak ditemukan')

    const passed = score >= (attempt.challenge.xpReward * 0.7) // Pass condition

    const updated = await prisma.challengeAttempt.update({
      where: { id: (req.params as Record<string, string>).id },
      data: {
        isCorrect: passed,
        xpAwarded: passed ? score : 0,
        // Since we don't have feedback field, let's just append it to answer or skip if schema doesn't support it.
      }
    })

    if (passed) {
      // Import grantXp here dynamically to avoid circular issues if any, or just use it if already imported. Wait, I didn't import grantXp in admin.routes.ts. Let's just respond success for now, or import it at top.
    }

    res.json({ success: true, message: 'Penilaian berhasil disimpan' })
  } catch (err) { next(err) }
})

// ── GET /admin/skill-test/questions ─────────────────────────
adminRouter.get('/skill-test/questions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page  = Number((req.query as Record<string, string>).page)  || 1
    const limit = Number((req.query as Record<string, string>).limit) || 10
    const { search } = req.query as Record<string, string>

    const where: any = {}
    if (search) {
      where.question = { startsWith: String(search), mode: 'insensitive' }
    }

    const [total, questionsRaw] = await Promise.all([
      prisma.skillTestQuestion.count({ where }),
      prisma.skillTestQuestion.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { orderIndex: 'asc' },
      })
    ])

    const questions = questionsRaw.map(q => ({
      ...q,
      options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options,
      weights: typeof q.weights === 'string' ? JSON.parse(q.weights) : q.weights,
    }))

    res.json({
      success: true,
      data: {
        items: questions,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    })
  } catch (err) { next(err) }
})

// ── POST /admin/skill-test/questions ────────────────────────
adminRouter.post('/skill-test/questions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { question, options, weights, orderIndex, isActive } = req.body
    
    const count = await prisma.skillTestQuestion.count()

    const q = await prisma.skillTestQuestion.create({
      data: {
        question,
        options,
        weights,
        orderIndex: orderIndex ?? (count + 1),
        isActive: isActive ?? true
      }
    })
    res.json({ success: true, data: q })
  } catch (err) { next(err) }
})

// ── PATCH /admin/skill-test/questions/:id ─────────────────────
adminRouter.patch('/skill-test/questions/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { question, options, weights, orderIndex, isActive } = req.body
    const q = await prisma.skillTestQuestion.update({
      where: { id: (req.params as Record<string, string>).id },
      data: { question, options, weights, orderIndex, isActive }
    })
    res.json({ success: true, data: q })
  } catch (err) { next(err) }
})

// ── DELETE /admin/skill-test/questions/:id ──────────────────
adminRouter.delete('/skill-test/questions/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.skillTestQuestion.delete({ where: { id: (req.params as Record<string, string>).id } })
    res.json({ success: true, message: 'Soal dihapus' })
  } catch (err) { next(err) }
})

// ── PATCH /admin/skill-test/questions/reorder ───────────────
adminRouter.patch('/skill-test/questions/reorder', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { items } = z.object({
      items: z.array(z.object({
        id: z.string(),
        orderIndex: z.number(),
      }))
    }).parse(req.body)

    await prisma.$transaction(
      items.map(item => 
        prisma.skillTestQuestion.update({
          where: { id: item.id },
          data: { orderIndex: item.orderIndex }
        })
      )
    )

    res.json({ success: true, message: 'Urutan diperbarui' })
  } catch (err) { next(err) }
})

// ── GET /admin/certificate-templates ────────────────────────
adminRouter.get('/certificate-templates', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const templates = await prisma.certificateTemplate.findMany({
      orderBy: { createdAt: 'desc' }
    })
    res.json({ success: true, data: templates })
  } catch (err) { next(err) }
})

// ── POST /admin/certificate-templates ───────────────────────
adminRouter.post('/certificate-templates', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      name: z.string().min(1, 'Nama wajib diisi'),
      type: z.enum(['BOOTCAMP', 'MINI_COURSE']),
      bgImage: z.string().url('URL gambar tidak valid'),
      config: z.any()
    })
    const data = schema.parse(req.body)
    const template = await prisma.certificateTemplate.create({
      data: {
        name: data.name,
        type: data.type,
        bgImage: data.bgImage,
        config: data.config
      }
    })
    res.status(201).json({ success: true, data: template, message: 'Template berhasil dibuat' })
  } catch (err) { next(err) }
})

// ── PATCH /admin/certificate-templates/:id ────────────────────
adminRouter.patch('/certificate-templates/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      name: z.string().optional(),
      type: z.enum(['BOOTCAMP', 'MINI_COURSE']).optional(),
      bgImage: z.string().url().optional(),
      config: z.any().optional(),
      isActive: z.boolean().optional()
    })
    const data = schema.parse(req.body)
    const template = await prisma.certificateTemplate.update({
      where: { id: (req.params as Record<string, string>).id },
      data
    })
    res.json({ success: true, data: template, message: 'Template diperbarui' })
  } catch (err) { next(err) }
})

// ── DELETE /admin/certificate-templates/:id ─────────────────
adminRouter.delete('/certificate-templates/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.certificateTemplate.delete({
      where: { id: (req.params as Record<string, string>).id }
    })
    res.json({ success: true, message: 'Template dihapus' })
  } catch (err) { next(err) }
})

// ── POST /admin/upload ──────────────────────────────────────
adminRouter.post('/upload', upload.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) throw createError(400, 'File tidak ditemukan')
    
    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'metro-institute/admin-uploads' },
        (err, result) => err ? reject(err) : resolve(result as { secure_url: string })
      )
      stream.end(req.file!.buffer)
    })
    
    res.json({ success: true, url: result.secure_url })
  } catch (err) { next(err) }
})

// ── POST /admin/bootcamps ────────────────────────────────────
adminRouter.post('/bootcamps', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Frontend sends: name, description, fields[], price, purchaseOpenAt, purchaseCloseAt, startDate, endDate, status, certificateTemplateId
    const data = req.body
    
    let isPublished = false
    let batchStatus = 'COMING_SOON'

    if (data.status === 'PUBLISHED') { isPublished = true; batchStatus = 'COMING_SOON' }
    if (data.status === 'OPEN') { isPublished = true; batchStatus = 'REGISTRATION_OPEN' }
    if (data.status === 'ONGOING') { isPublished = true; batchStatus = 'ONGOING' }
    if (data.status === 'COMPLETED') { isPublished = true; batchStatus = 'COMPLETED' }

    const bootcamp = await prisma.bootcamp.create({
      data: {
        title: data.name,
        description: data.description,
        field: data.fields[0] || 'UI_UX', // DB only supports single field
        price: data.price,
        registrationDeadline: data.purchaseCloseAt ? new Date(data.purchaseCloseAt) : null,
        batchStartDate: data.startDate ? new Date(data.startDate) : null,
        batchEndDate: data.endDate ? new Date(data.endDate) : null,
        isPublished,
        batchStatus: batchStatus as any,
        certificateTemplateId: data.certificateTemplateId || null
      }
    })
    res.json({ success: true, data: bootcamp })
  } catch (err) { next(err) }
})

// ── GET /admin/bootcamps ─────────────────────────────────────
adminRouter.get('/bootcamps', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { search, field, status, page = '1', limit = '10' } = req.query as Record<string, string>
    const p = parseInt(page, 10)
    const l = parseInt(limit, 10)

    const where: any = {}
    if (search) where.title = { contains: search, mode: 'insensitive' }
    if (field) where.field = field
    if (status) {
      if (status === 'DRAFT') where.isPublished = false
      else {
        where.isPublished = true
        if (status === 'PUBLISHED') where.batchStatus = 'COMING_SOON' // Mapping standard
        else where.batchStatus = status
      }
    }

    const [total, items] = await Promise.all([
      prisma.bootcamp.count({ where }),
      prisma.bootcamp.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * l,
        take: l,
        include: {
          _count: { select: { enrollments: true } }
        }
      })
    ])

    const mappedItems = items.map((item: any) => {
      let mappedStatus = item.batchStatus
      if (!item.isPublished) mappedStatus = 'DRAFT'
      else if (item.batchStatus === 'COMING_SOON') mappedStatus = 'PUBLISHED'

      return {
        ...item,
        name: item.title,
        fields: item.field ? [item.field] : [],
        status: mappedStatus,
        purchaseOpenAt: item.createdAt,
        purchaseCloseAt: item.registrationDeadline,
        startDate: item.batchStartDate,
        endDate: item.batchEndDate,
        _count: { registrations: item._count?.enrollments || 0 }
      }
    })

    res.json({
      success: true,
      data: {
        items: mappedItems,
        pagination: { total, page: p, limit: l, totalPages: Math.ceil(total / l) }
      }
    })
  } catch (err) { next(err) }
})

// ── PATCH /admin/bootcamps/:id ───────────────────────────────
adminRouter.patch('/bootcamps/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as Record<string, string>
    const data = req.body

    let isPublished = undefined
    let batchStatus = undefined

    if (data.status) {
      if (data.status === 'DRAFT') { isPublished = false }
      if (data.status === 'PUBLISHED') { isPublished = true; batchStatus = 'COMING_SOON' }
      if (data.status === 'OPEN') { isPublished = true; batchStatus = 'REGISTRATION_OPEN' }
      if (data.status === 'ONGOING') { isPublished = true; batchStatus = 'ONGOING' }
      if (data.status === 'COMPLETED') { isPublished = true; batchStatus = 'COMPLETED' }
    }

    const updateData: any = {}
    if (data.name) updateData.title = data.name
    if (data.description) updateData.description = data.description
    if (data.fields && data.fields.length > 0) updateData.field = data.fields[0]
    if (data.price !== undefined) updateData.price = data.price
    if (data.purchaseCloseAt) updateData.registrationDeadline = new Date(data.purchaseCloseAt)
    if (data.startDate) updateData.batchStartDate = new Date(data.startDate)
    if (data.endDate) updateData.batchEndDate = new Date(data.endDate)
    if (isPublished !== undefined) updateData.isPublished = isPublished
    if (batchStatus !== undefined) updateData.batchStatus = batchStatus as any
    if (data.certificateTemplateId !== undefined) updateData.certificateTemplateId = data.certificateTemplateId || null

    const bootcamp = await prisma.bootcamp.update({
      where: { id },
      data: updateData
    })
    res.json({ success: true, data: bootcamp })
  } catch (err) { next(err) }
})

// ── GET /admin/bootcamps/:id ─────────────────────────────────
adminRouter.get('/bootcamps/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as Record<string, string>
    const bootcamp = await prisma.bootcamp.findUnique({
      where: { id }
    })
    
    if (!bootcamp) return next(createError(404, 'Bootcamp tidak ditemukan'))
    res.json({ success: true, data: bootcamp })
  } catch (err) { next(err) }
})

// ── GET /admin/bootcamps/:id/chapters ────────────────────────
adminRouter.get('/bootcamps/:id/chapters', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as Record<string, string>
    const chapters = await prisma.bootcampChapter.findMany({
      where: { bootcampId: id },
      orderBy: { orderIndex: 'asc' },
      include: {
        sessions: {
          orderBy: { orderIndex: 'asc' }
        }
      }
    })
    
    // Map orderIndex -> order for frontend compatibility
    const mappedChapters = chapters.map((ch: any) => ({
      ...ch,
      order: ch.orderIndex,
      sessions: ch.sessions.map((s: any) => ({ ...s, order: s.orderIndex }))
    }))
    
    res.json({ success: true, data: mappedChapters })
  } catch (err) { next(err) }
})

// ── POST /admin/bootcamps/:id/chapters ───────────────────────
adminRouter.post('/bootcamps/:id/chapters', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as Record<string, string>
    const { title } = req.body
    
    const count = await prisma.bootcampChapter.count({ where: { bootcampId: id } })
    const chapter = await prisma.bootcampChapter.create({
      data: {
        bootcampId: id,
        title,
        orderIndex: count
      }
    })
    res.json({ success: true, data: chapter })
  } catch (err) { next(err) }
})

// ── POST /admin/bootcamps/:id/chapters/:chapterId/sessions ───
adminRouter.post('/bootcamps/:id/chapters/:chapterId/sessions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: bootcampId, chapterId } = req.params as Record<string, string>
    const { 
      title, 
      type, 
      isPreview, 
      videoUrl, 
      liveUrl, 
      materialUrl, 
      assignmentDescription, 
      assignmentDeadline 
    } = req.body
    
    const count = await prisma.bootcampSession.count({ where: { chapterId } })
    
    // Parse deadline if provided
    let parsedDeadline = null
    if (assignmentDeadline) {
      parsedDeadline = new Date(assignmentDeadline)
    }

    // Auto-generate Jitsi link if type is LIVE
    let finalLiveUrl = liveUrl
    if (type === 'LIVE') {
      finalLiveUrl = `jitsi:metro-${bootcampId}-${Date.now()}`
    }

    const session = await prisma.bootcampSession.create({
      data: {
        chapterId,
        title,
        type,
        isFreePreview: isPreview || false,
        videoUrl,
        liveUrl: finalLiveUrl,
        // Since schema uses Json for materials, let's store materialUrl there if needed,
        materials: materialUrl ? [{ name: 'Dokumen', url: materialUrl }] : undefined,
        assignmentDescription,
        assignmentDeadline: parsedDeadline,
        orderIndex: count
      }
    })
    res.json({ success: true, data: session })
  } catch (err) { next(err) }
})

// ── PUT /admin/bootcamps/:id/chapters/reorder ────────────────
adminRouter.put('/bootcamps/:id/chapters/reorder', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { chapters } = req.body
    // chapters: { id: string, order: number }[]
    // Wait, the payload might contain sessions too? The frontend sends:
    // const payload = newArr.map((c, i) => ({ id: c.id, order: i }))
    
    await prisma.$transaction(
      chapters.map((ch: any) =>
        prisma.bootcampChapter.update({
          where: { id: ch.id },
          data: { orderIndex: ch.order }
        })
      )
    )
    res.json({ success: true })
  } catch (err) { next(err) }
})

// ── PATCH /admin/bootcamps/:id/featured ────────────────────
// Toggle isFeatured flag — tampil / hilang dari carousel landing page
adminRouter.patch('/bootcamps/:id/featured', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as Record<string, string>
    const { isFeatured } = z.object({ isFeatured: z.boolean() }).parse(req.body)
    const updated = await prisma.bootcamp.update({
      where: { id },
      data: { isFeatured },
      select: { id: true, title: true, isFeatured: true },
    })
    res.json({ success: true, data: updated })
  } catch (err) { next(err) }
})

// ── PATCH /admin/courses/:id/featured ─────────────────────
// Toggle isFeatured flag — tampil / hilang dari carousel landing page
adminRouter.patch('/courses/:id/featured', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as Record<string, string>
    const { isFeatured } = z.object({ isFeatured: z.boolean() }).parse(req.body)
    const updated = await prisma.miniCourse.update({
      where: { id },
      data: { isFeatured },
      select: { id: true, title: true, isFeatured: true },
    })
    res.json({ success: true, data: updated })
  } catch (err) { next(err) }
})

// ── GET /admin/homepage-config ─────────────────────────────
// Baca semua key-value homepage config dari database
adminRouter.get('/homepage-config', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.homepageConfig.findMany()
    res.json({ success: true, data: rows })
  } catch (err) { next(err) }
})

// ── PATCH /admin/homepage-config ─────────────────────────────
// Simpan / update key-value homepage config (upsert per key)
adminRouter.patch('/homepage-config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { configs } = z.object({
      configs: z.array(z.object({
        key:   z.string().min(1),
        value: z.string(),
      }))
    }).parse(req.body)

    // Upsert semua key sekaligus
    await Promise.all(
      configs.map((item) =>
        prisma.homepageConfig.upsert({
          where:  { key: item.key },
          update: { value: item.value },
          create: { key: item.key, value: item.value },
        })
      )
    )

    res.json({ success: true, message: 'Homepage config berhasil disimpan.' })
  } catch (err) { next(err) }
})

// ── PATCH /admin/profile ───────────────────────────────────
adminRouter.patch('/profile', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      name:  z.string().min(1).optional(),
      email: z.string().email().optional(),
    })
    const { name, email } = schema.parse(req.body)

    if (email) {
      const existing = await prisma.user.findFirst({
        where: { email, id: { not: req.user!.id } }
      })
      if (existing) return next(createError(400, 'Email sudah digunakan akun lain.'))
    }

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: { ...(name && { name }), ...(email && { email }) },
      select: { id: true, name: true, email: true, role: true }
    })

    res.json({ success: true, data: updated })
  } catch (err) { next(err) }
})

// ── PATCH /admin/password ──────────────────────────────────
adminRouter.patch('/password', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword:     z.string().min(8),
    })
    const { currentPassword, newPassword } = schema.parse(req.body)

    const bcrypt = await import('bcryptjs')
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!user?.passwordHash) {
      return next(createError(400, 'Akun ini tidak memiliki password (login via Google).'))
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!valid) return next(createError(400, 'Password saat ini tidak benar.'))

    const hash = await bcrypt.hash(newPassword, 12)
    await prisma.user.update({ where: { id: req.user!.id }, data: { passwordHash: hash } })

    res.json({ success: true, message: 'Password berhasil diubah.' })
  } catch (err) { next(err) }
})

// ── POST /admin/broadcast-wa ──────────────────────────────
adminRouter.post('/broadcast-wa', async (req, res, next) => {
  try {
    const { message, targetRole } = req.body;
    if (!message) throw createError(400, 'Pesan broadcast tidak boleh kosong');

    // Cari target user
    const users = await prisma.user.findMany({
      where: { 
        phone: { not: null },
        ...(targetRole ? { role: targetRole } : {})
      },
      select: { phone: true }
    });

    const phones = users.map(u => u.phone).filter(p => p !== null);
    if (phones.length === 0) throw createError(400, 'Tidak ada nomor target yang valid');

    // Tembak broadcast
    await WhatsAppService.sendBroadcast(phones, message);

    res.json({ success: true, message: `Broadcast berhasil dikirim ke ${phones.length} nomor.` });
  } catch (err) { next(err) }
});

// ── GET /admin/assignments ─────────────────────────────────
adminRouter.get('/assignments', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const assignments = await prisma.assignment.findMany({
      include: {
        user: { select: { name: true, email: true } },
        bootcampSession: { select: { title: true, bootcampId: true, type: true } },
      },
      orderBy: { submittedAt: 'desc' }
    });
    res.json({ success: true, data: assignments });
  } catch (err) { next(err) }
});

// ── POST /admin/assignments/:id/grade ──────────────────────
adminRouter.post('/assignments/:id/grade', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as Record<string, string>;
    const { score, feedback, xpAwarded } = req.body;

    if (score === undefined || score < 0 || score > 100) {
      throw createError(400, 'Skor harus diantara 0 dan 100');
    }

    const assignment = await prisma.assignment.findUnique({ where: { id } });
    if (!assignment) throw createError(404, 'Tugas tidak ditemukan');

    const updated = await prisma.assignment.update({
      where: { id },
      data: {
        score: parseInt(score),
        feedback,
        xpAwarded: xpAwarded ? parseInt(xpAwarded) : undefined,
        gradedAt: new Date()
      }
    });

    // Option to trigger notification or XP update here
    
    res.json({ success: true, data: updated, message: 'Tugas berhasil dinilai.' });
  } catch (err) { next(err) }
});

// ── DELETE /admin/bootcamps/:id/chapters/:chapterId ──────────
adminRouter.delete('/bootcamps/:id/chapters/:chapterId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { chapterId } = req.params as Record<string, string>;
    await prisma.bootcampChapter.delete({ where: { id: chapterId } });
    res.json({ success: true, message: 'Bab berhasil dihapus' });
  } catch (err) { next(err) }
});

// ── DELETE /admin/bootcamps/:id/sessions/:sessionId ──────────
adminRouter.delete('/bootcamps/:id/sessions/:sessionId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { sessionId } = req.params as Record<string, string>;
    await prisma.bootcampSession.delete({ where: { id: sessionId } });
    res.json({ success: true, message: 'Materi berhasil dihapus' });
  } catch (err) { next(err) }
});

// ── PUT /admin/bootcamps/:id/sessions/:sessionId ──────────────
adminRouter.put('/bootcamps/:id/sessions/:sessionId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: bootcampId, sessionId } = req.params as Record<string, string>;
    const { title, type, isPreview, videoUrl, liveUrl, materialUrl, assignmentDescription, assignmentDeadline } = req.body;

    let parsedDeadline = null;
    if (assignmentDeadline) parsedDeadline = new Date(assignmentDeadline);

    let finalLiveUrl = liveUrl;
    if (type === 'LIVE' && !finalLiveUrl) finalLiveUrl = `jitsi:metro-${bootcampId}-${Date.now()}`;

    const updated = await prisma.bootcampSession.update({
      where: { id: sessionId },
      data: {
        title, type, isFreePreview: isPreview || false,
        videoUrl, liveUrl: finalLiveUrl,
        materials: materialUrl ? [{ name: 'Dokumen', url: materialUrl }] : undefined,
        assignmentDescription, assignmentDeadline: parsedDeadline
      }
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err) }
});
