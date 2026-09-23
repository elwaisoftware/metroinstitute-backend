import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authenticate, AuthRequest } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'

export const adminRouter = Router()

// ── Admin auth guard ───────────────────────────────────────
adminRouter.use(authenticate, async (req: AuthRequest, _res: Response, next: NextFunction) => {
  if (!['SUPER_ADMIN', 'ADMIN'].includes(req.user!.role)) {
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
          totalRevenue:   totalRevenue._sum.amount    ?? 0,
          revenueThisMonth: revenueThisMonth._sum.amount ?? 0,
          totalCertificates,
          totalEnrollments: activeBootcampEnrollments + activeCourseEnrollments,
        },
        transactionStatus: txStatusMap,
        recentTransactions,
        topCourses,
        topBootcamps,
        newMenteesLast7Days: newMenteesLast7Days.reverse(), // oldest → newest
      },
    })
  } catch (err) { next(err) }
})

// ── GET /admin/mentees ─────────────────────────────────────
adminRouter.get('/mentees', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page  = Number(req.query.page)  || 1
    const limit = Number(req.query.limit) || 20
    const { search, field, badge } = req.query

    const where: Record<string, unknown> = { role: 'MENTEE' }
    if (search) {
      where.OR = [
        { name:  { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } },
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
      where: { id: req.params.id },
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
      prisma.xpLog.create({ data: { userId: req.params.id, source: 'MANUAL_GRANT', amount, note } }),
      prisma.user.update({ where: { id: req.params.id }, data: { totalXp: { increment: amount } } }),
    ])
    res.json({ success: true, message: `+${amount} XP diberikan` })
  } catch (err) { next(err) }
})

// ── GET /admin/transactions ────────────────────────────────
adminRouter.get('/transactions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page  = Number(req.query.page)  || 1
    const limit = Number(req.query.limit) || 20
    const { status, productType, search } = req.query

    const where: Record<string, unknown> = {}
    if (status)      where.status = status
    if (productType) where.productType = productType
    if (search)      where.orderId = { contains: String(search), mode: 'insensitive' }

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
        type:   'ANNOUNCEMENT' as const,
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
      where: { source: req.params.source as any },
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
