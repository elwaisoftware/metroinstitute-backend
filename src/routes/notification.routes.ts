import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authenticate, AuthRequest } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'

export const notificationRouter = Router()
notificationRouter.use(authenticate)

// ── GET /notifications ──────────────────────────────────────
notificationRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page = 1, limit = 20, unread } = req.query
    const userId = req.user!.id

    const where: Record<string, unknown> = { userId }
    if (unread === 'true') where.isRead = false

    const [total, unreadCount, notifications] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, isRead: false } }),
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        select: {
          id: true, type: true, title: true, body: true,
          data: true, isRead: true, createdAt: true,
        },
      }),
    ])

    res.json({
      success: true,
      data: notifications,
      meta: { total, unreadCount, page: Number(page), limit: Number(limit) },
    })
  } catch (err) { next(err) }
})

// ── PATCH /notifications/read-all ──────────────────────────
notificationRouter.patch('/read-all', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, isRead: false },
      data: { isRead: true },
    })
    res.json({ success: true, message: 'Semua notifikasi ditandai sudah dibaca' })
  } catch (err) { next(err) }
})

// ── PATCH /notifications/:id/read ──────────────────────────
notificationRouter.patch('/:id/read', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const notif = await prisma.notification.findUnique({ where: { id: req.params.id } })
    if (!notif || (notif as any).userId !== req.user!.id) throw createError(404, 'Notifikasi tidak ditemukan')
    await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } })
    res.json({ success: true })
  } catch (err) { next(err) }
})

// ── DELETE /notifications/:id ───────────────────────────────
notificationRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const notif = await prisma.notification.findUnique({ where: { id: req.params.id } })
    if (!notif || (notif as any).userId !== req.user!.id) throw createError(404, 'Notifikasi tidak ditemukan')
    await prisma.notification.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err) { next(err) }
})
