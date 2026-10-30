import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import MidtransClient from 'midtrans-client'
import { prisma } from '../utils/prisma'
import { authenticate, AuthRequest } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'
import { logger } from '../utils/logger'
import { handleSuccessfulPayment } from './webhook.routes'

const snap = new MidtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY!,
  clientKey: process.env.MIDTRANS_CLIENT_KEY!,
})

const coreApi = new MidtransClient.CoreApi({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
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
      productType: z.enum(['MINI_COURSE', 'BOOTCAMP', 'WEBINAR']),
      courseId: z.string().optional(),
      bootcampId: z.string().optional(),
      webinarId: z.string().optional(),
      paymentMethod: z.enum(['ALL', 'CREDIT_CARD', 'BANK_TRANSFER', 'QRIS_EWALLET']).optional(),
    })
    const { productType, courseId, bootcampId, webinarId, paymentMethod } = schema.parse(req.body)

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
    } else if (productType === 'WEBINAR' && webinarId) {
      const webinar = await prisma.webinar.findUnique({
        where: { id: webinarId },
        include: { _count: { select: { registrations: true } } },
      })
      if (!webinar) throw createError(404, 'Webinar tidak ditemukan')
      if (!webinar.isPublished) throw createError(400, 'Webinar belum dipublikasikan')
      if (webinar.isEnded) throw createError(400, 'Webinar telah selesai')
      const scheduledTime = new Date(webinar.scheduledAt).getTime()
      const registrationDeadline = scheduledTime - 2 * 60 * 60 * 1000 // H-2 jam
      if (Date.now() >= registrationDeadline) {
        throw createError(400, 'Pendaftaran ditutup karena telah mencapai batas waktu H-2 jam sebelum acara')
      }
      if (webinar.quota && webinar._count.registrations >= webinar.quota) {
        throw createError(400, 'Kuota peserta webinar sudah penuh')
      }
      const existing = await prisma.webinarRegistration.findUnique({
        where: { userId_webinarId: { userId, webinarId } },
      })
      if (existing) throw createError(409, 'Kamu sudah terdaftar di webinar ini')
      title = webinar.title; price = webinar.price; productId = webinarId
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
        orderId, userId, productType, courseId, bootcampId, webinarId,
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

    let vaNumber = ''
    let bankName = 'bca'
    let qrCodeUrl = ''
    let qrString = ''

    if (paymentMethod === 'BANK_TRANSFER') {
      try {
        const chargeRes = await coreApi.charge({
          payment_type: 'bank_transfer',
          transaction_details: { order_id: orderId, gross_amount: price },
          customer_details: { first_name: user.name, email: user.email },
          item_details: [{ id: productId, name: title.slice(0, 50), quantity: 1, price }],
          bank_transfer: { bank: 'bca' },
        } as any)
        if (chargeRes.va_numbers && chargeRes.va_numbers.length > 0) {
          vaNumber = chargeRes.va_numbers[0].va_number
          bankName = chargeRes.va_numbers[0].bank
        }
      } catch (e) {
        logger.warn('Core API charge error, generating VA', e)
        vaNumber = `80777${Date.now().toString().slice(-8)}`
      }
    } else if (paymentMethod === 'QRIS_EWALLET') {
      try {
        const chargeRes = await coreApi.charge({
          payment_type: 'qris',
          transaction_details: { order_id: orderId, gross_amount: price },
          customer_details: { first_name: user.name, email: user.email },
          item_details: [{ id: productId, name: title.slice(0, 50), quantity: 1, price }],
          qris: { acquirer: 'gopay' },
        } as any)
        qrString = chargeRes.qr_string || ''
        const qrAction = chargeRes.actions?.find((a: any) => a.name === 'generate-qr-code')
        qrCodeUrl = qrAction?.url || ''
      } catch (e) {
        logger.warn('Core API QRIS charge error', e)
      }
    }

    const snapResponse = await snap.createTransaction(snapPayload as any)

    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { snapToken: snapResponse.token },
    })

    res.json({
      success: true,
      data: {
        orderId,
        snapToken: snapResponse.token,
        redirectUrl: snapResponse.redirect_url,
        amount: price,
        paymentMethod: paymentMethod || 'ALL',
        vaNumber,
        bank: bankName,
        qrCodeUrl,
        qrString,
      },
    })
  } catch (err) { next(err) }
})

// ── GET /transactions ──────────────────────────────────────
transactionRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, page = 1, limit = 20 } = req.query as Record<string, string>
    
    // Auto-cancel transactions older than 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await prisma.transaction.updateMany({
      where: {
        userId: req.user!.id,
        status: 'PENDING',
        createdAt: { lt: twentyFourHoursAgo }
      },
      data: { status: 'CANCELLED' }
    })

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
    const orderId = (req.params as Record<string, string>).orderId
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

    // Auto-cancel if pending and older than 24 hours
    await prisma.transaction.updateMany({
      where: {
        orderId,
        status: 'PENDING',
        createdAt: { lt: twentyFourHoursAgo }
      },
      data: { status: 'CANCELLED' }
    })

    const tx = await prisma.transaction.findUnique({
      where: { orderId },
      select: {
        id: true, orderId: true, productType: true, title: true,
        amount: true, status: true, snapToken: true, createdAt: true, paidAt: true, userId: true,
      },
    })
    if (!tx) throw createError(404, 'Transaksi tidak ditemukan')
    if ((tx as any).userId !== req.user!.id) throw createError(403, 'Akses ditolak')
    res.json({ success: true, data: tx })
  } catch (err) { next(err) }
})

// ── POST /transactions/:orderId/verify ─────────────────────
transactionRouter.post('/:orderId/verify', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orderId = (req.params as Record<string, string>).orderId
    const tx = await prisma.transaction.findUnique({ where: { orderId } })
    if (!tx) throw createError(404, 'Transaksi tidak ditemukan')
    if (tx.userId !== req.user!.id) throw createError(403, 'Akses ditolak')

    if (tx.status === 'SUCCESS') {
      return res.json({ success: true, status: 'SUCCESS', message: 'Transaksi sudah lunas' })
    }

    // Check with Midtrans status API
    try {
      const statusRes = await (snap as any).transaction.status(orderId)
      const tStatus = statusRes.transaction_status
      const fraud = statusRes.fraud_status
      if (tStatus === 'settlement' || (tStatus === 'capture' && fraud !== 'deny')) {
        await prisma.transaction.update({
          where: { id: tx.id },
          data: { status: 'SUCCESS', paidAt: new Date() },
        })
        await handleSuccessfulPayment(tx)
        return res.json({ success: true, status: 'SUCCESS', message: 'Pembayaran berhasil dikonfirmasi' })
      }
    } catch (e) {
      logger.warn('Midtrans status check warning', e)
    }

    res.json({ success: true, status: tx.status, message: 'Menunggu pembayaran' })
  } catch (err) { next(err) }
})

// ── POST /transactions/:orderId/simulate ───────────────────
// For Sandbox/Dev testing of direct in-app flow
transactionRouter.post('/:orderId/simulate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orderId = (req.params as Record<string, string>).orderId
    const tx = await prisma.transaction.findUnique({ where: { orderId } })
    if (!tx) throw createError(404, 'Transaksi tidak ditemukan')
    if (tx.userId !== req.user!.id) throw createError(403, 'Akses ditolak')

    if (tx.status !== 'SUCCESS') {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { status: 'SUCCESS', paidAt: new Date() },
      })
      await handleSuccessfulPayment(tx)
    }

    res.json({ success: true, status: 'SUCCESS', message: 'Pembayaran berhasil disimulasikan lunas' })
  } catch (err) { next(err) }
})

