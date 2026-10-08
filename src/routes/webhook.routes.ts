import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { prisma } from '../utils/prisma'
import { logger } from '../utils/logger'

export const webhookRouter = Router()

// ── POST /webhook/midtrans ─────────────────────────────────
// body is raw (configured in server.ts with rawBody middleware)
webhookRouter.post('/midtrans', async (req: Request, res: Response) => {
  try {
    let body = req.body
    if (Buffer.isBuffer(body)) body = JSON.parse(body.toString('utf8'))
    else if (typeof body === 'string') body = JSON.parse(body)
    const {
      order_id, transaction_status, fraud_status,
      gross_amount, signature_key, status_code,
    } = body

    // ── Signature verification ──
    const expectedSignature = crypto
      .createHash('sha512')
      .update(`${order_id}${status_code}${gross_amount}${process.env.MIDTRANS_SERVER_KEY}`)
      .digest('hex')

    if (signature_key !== expectedSignature) {
      logger.warn('Invalid Midtrans signature', { order_id })
      return res.status(400).json({ message: 'Invalid signature' })
    }

    // ── Find transaction ──
    const tx = await prisma.transaction.findUnique({
      where: { orderId: order_id },
    })
    if (!tx) {
      logger.warn('Transaction not found for webhook', { order_id })
      return res.status(404).json({ message: 'Transaction not found' })
    }

    // ── Map Midtrans status → TxStatus ──
    let newStatus: 'SUCCESS' | 'FAILED' | 'REFUNDED' | 'PENDING' | 'CANCELLED' = 'PENDING'
    if (transaction_status === 'settlement' || transaction_status === 'capture') {
      newStatus = fraud_status === 'deny' ? 'FAILED' : 'SUCCESS'
    } else if (['deny', 'cancel', 'expire'].includes(transaction_status)) {
      newStatus = transaction_status === 'cancel' ? 'CANCELLED' : 'FAILED'
    } else if (transaction_status === 'refund') {
      newStatus = 'REFUNDED'
    }

    // Idempotent — skip if already processed
    if (tx.status === newStatus) {
      return res.json({ message: 'Already processed' })
    }

    // ── Update transaction ──
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status:    newStatus,
        paidAt:    newStatus === 'SUCCESS' ? new Date() : undefined,
        refundedAt: newStatus === 'REFUNDED' ? new Date() : undefined,
      },
    })

    // ── Enroll user on success ──
    if (newStatus === 'SUCCESS') {
      await handleSuccessfulPayment(tx)
    }

    logger.info(`Midtrans webhook: ${order_id} → ${newStatus}`)
    return res.json({ message: 'OK' })
  } catch (err) {
    logger.error('Midtrans webhook error', { error: err })
    return res.status(500).json({ message: 'Webhook processing failed' })
  }
})

async function handleSuccessfulPayment(tx: {
  id: string; userId: string; productType: string
  courseId: string | null; bootcampId: string | null; title: string
}) {
  try {
    if (tx.productType === 'MINI_COURSE' && tx.courseId) {
      const course = await prisma.miniCourse.findUnique({
        where:  { id: tx.courseId },
        select: { accessDays: true, title: true },
      })
      const accessDays  = course?.accessDays || 365
      const accessUntil = new Date(Date.now() + accessDays * 24 * 60 * 60 * 1000)

      await prisma.courseEnrollment.upsert({
        where:  { userId_courseId: { userId: tx.userId, courseId: tx.courseId } },
        create: { userId: tx.userId, courseId: tx.courseId, accessUntil, isActive: true },
        update: { accessUntil, isActive: true },
      })

      await prisma.miniCourse.update({
        where: { id: tx.courseId },
        data:  { enrollmentCount: { increment: 1 } },
      })

      await prisma.notification.create({
        data: {
          userId: tx.userId,
          type:   'PURCHASE_SUCCESS',
          title:  '✅ Pembayaran Berhasil!',
          body:   `Akses ke kursus "${course?.title || tx.title}" telah aktif.`,
          data:   { courseId: tx.courseId },
        },
      })
    } else if (tx.productType === 'BOOTCAMP' && tx.bootcampId) {
      const bootcamp = await prisma.bootcamp.findUnique({
        where:  { id: tx.bootcampId },
        select: { title: true, field: true },
      })

      await prisma.bootcampEnrollment.upsert({
        where:  { userId_bootcampId: { userId: tx.userId, bootcampId: tx.bootcampId } },
        create: {
          userId:     tx.userId,
          bootcampId: tx.bootcampId,
          isActive:   true,
          field:      bootcamp?.field || 'FRONTEND',
        },
        update: { isActive: true },
      })

      await prisma.bootcamp.update({
        where: { id: tx.bootcampId },
        data:  { enrollmentCount: { increment: 1 } },
      })

      await prisma.notification.create({
        data: {
          userId: tx.userId,
          type:   'PURCHASE_SUCCESS',
          title:  '✅ Pembayaran Berhasil!',
          body:   `Kamu terdaftar di Bootcamp "${bootcamp?.title || tx.title}". Selamat belajar! 🚀`,
          data:   { bootcampId: tx.bootcampId },
        },
      })
    }
  } catch (err) {
    logger.error('handleSuccessfulPayment failed', { txId: tx.id, error: err })
  }
}
