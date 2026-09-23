import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authenticate, AuthRequest } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'

export const wishlistRouter = Router()
wishlistRouter.use(authenticate)

// ── GET /wishlist ──────────────────────────────────────────
wishlistRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const items = await prisma.wishlistItem.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      include: {
        course:    { select: { id: true, title: true, price: true, field: true, level: true, thumbnailUrl: true, rating: true } },
        bootcamp:  { select: { id: true, title: true, price: true, field: true, thumbnailUrl: true, rating: true } },
      },
    })
    res.json({ success: true, data: items })
  } catch (err) { next(err) }
})

// ── POST /wishlist ─────────────────────────────────────────
wishlistRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = z.object({
      productType: z.enum(['MINI_COURSE', 'BOOTCAMP']),
      courseId:   z.string().optional(),
      bootcampId: z.string().optional(),
    }).parse(req.body)

    const existing = await prisma.wishlistItem.findFirst({
      where: { userId: req.user!.id, courseId: data.courseId, bootcampId: data.bootcampId },
    })
    if (existing) throw createError(409, 'Sudah ada di wishlist')

    const item = await prisma.wishlistItem.create({
      data: { userId: req.user!.id, ...data },
    })
    res.status(201).json({ success: true, data: item })
  } catch (err) { next(err) }
})

// ── DELETE /wishlist/course/:courseId ──────────────────────
wishlistRouter.delete('/course/:courseId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.wishlistItem.deleteMany({
      where: { userId: req.user!.id, courseId: req.params.courseId },
    })
    res.json({ success: true })
  } catch (err) { next(err) }
})

// ── DELETE /wishlist/bootcamp/:bootcampId ──────────────────
wishlistRouter.delete('/bootcamp/:bootcampId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.wishlistItem.deleteMany({
      where: { userId: req.user!.id, bootcampId: req.params.bootcampId },
    })
    res.json({ success: true })
  } catch (err) { next(err) }
})
