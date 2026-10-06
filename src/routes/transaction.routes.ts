import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import MidtransClient from 'midtrans-client'
import { prisma } from '../utils/prisma'
import { authenticate, AuthRequest } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'
import { logger } from '../utils/logger'

const snap = new MidtransClient.Snap({
  isProduction: process.env.NODE_ENV === 'production',
  serverKey: process.env.MIDTRANS_SERVER_KEY!,
  clientKey: process.env.MIDTRANS_CLIENT_KEY!,
})

export const transactionRouter = Router()
transactionRouter.use(authenticate)

// ── POST /transactions/initiate ────────────────────────────
transactionRouter.post('/initiate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id
    const schema = z.object({
      productType: z.enum(['MINI_COURSE', 'BOOTCAMP']),
      courseId: z.string().optional(),
      bootcampId: z.string().optional(),
    })
    const { productType, courseId, bootcampId } = schema.parse(req.body)

    // Resolve product
    let title = '', price = 0, productId = ''
    if (productType === 'MINI_COURSE' && courseId) {
      const course = await prisma.miniCourse.findUnique({ where: { id: courseId } })
      if (!course) throw createError(404, 'Kursus tidak ditemukan')
      const existing = await prisma.courseEnrollment.findFirst({
        where: { userId, courseId, isActive: true, accessUntil: { gt: new Date() } },
      })
      if (existing) throw createError(409, 'Kamu sudah terdaftar di kursus ini')
      title = course.title; price = course.price; productId = courseId
    } else if (productType === 'BOOTCAMP' && bootcampId) {
      const bootcamp = await prisma.bootcamp.findUnique({ where: { id: bootcampId } })
      if (!bootcamp) throw createError(404, 'Bootcamp tidak ditemukan')
      const existing = await prisma.bootcampEnrollment.findFirst({
        where: { userId, bootcampId, isActive: true },
      })
      if (existing) throw createError(409, 'Kamu sudah terdaftar di bootcamp ini')
      title = bootcamp.title; price = bootcamp.price; productId = bootcampId
    } else {
      throw createError(400, 'Parameter produk tidak lengkap')
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
    if (!user) throw createError(404, 'User tidak ditemukan')

    if (price <= 0) throw createError(400, 'Harga tidak valid')

    const orderId = `METRO-${Date.now()}-${userId.slice(0, 6).toUpperCase()}`

    // Create pending transaction
    const transaction = await prisma.transaction.create({
      data: {
        orderId, userId, productType, courseId, bootcampId,
        amount: price, status: 'PENDING', title,
      },
    })

    // Create Midtrans Snap token
    const snapPayload: Record<string, unknown> = {
      transaction_details: { order_id: orderId, gross_amount: price },
      customer_details: { first_name: user.name, email: user.email },
      item_details: [{ id: productId, name: title.slice(0, 50), quantity: 1, price }],
      callbacks: {
        finish: `${process.env.FRONTEND_URL}/checkout/success?order_id=${orderId}`,
        error: `${process.env.FRONTEND_URL}/checkout/failed?order_id=${orderId}`,
        pending: `${process.env.FRONTEND_URL}/transactions`,
      },
    }
    const snapResponse = await snap.createTransaction(snapPayload as any)

    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { snapToken: snapResponse.token },
    })

    res.json({
      success: true,
      data: { orderId, snapToken: snapResponse.token, amount: price },
    })
  } catch (err) { next(err) }
})

// ── GET /transactions ──────────────────────────────────────
transactionRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, page = 1, limit = 20 } = req.query as Record<string, string>
    const where: Record<string, unknown> = { userId: req.user!.id }
    if (status) where.status = status

    const [total, transactions] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        select: {
          id: true, orderId: true, productType: true, title: true,
          amount: true, status: true, createdAt: true, paidAt: true,
        },
      }),
    ])

    res.json({ success: true, data: transactions, meta: { total, page: Number(page), limit: Number(limit) } })
  } catch (err) { next(err) }
})

// ── GET /transactions/:orderId ─────────────────────────────
transactionRouter.get('/:orderId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tx = await prisma.transaction.findUnique({
      where: { orderId: (req.params as Record<string, string>).orderId },
      select: {
        id: true, orderId: true, productType: true, title: true,
        amount: true, status: true, snapToken: true, createdAt: true, paidAt: true,
      },
    })
    if (!tx) throw createError(404, 'Transaksi tidak ditemukan')
    if ((tx as any).userId !== req.user!.id) throw createError(403, 'Akses ditolak')
    res.json({ success: true, data: tx })
  } catch (err) { next(err) }
})
