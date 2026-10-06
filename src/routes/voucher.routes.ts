import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authenticate, requireAdmin } from '../middleware/auth.middleware'

export const voucherRouter = Router()

// GET /api/v1/voucher - Admin get vouchers
voucherRouter.get('/', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = '1', limit = '10', search, isActive } = req.query as Record<string, string>
    const pageNum = parseInt(page as string, 10)
    const limitNum = parseInt(limit as string, 10)
    const skip = (pageNum - 1) * limitNum

    const where: any = {}
    
    if (search) {
      where.code = { contains: search as string, mode: 'insensitive' }
    }
    
    if (isActive !== undefined) {
      where.isActive = isActive === 'true'
    }

    const [total, items] = await Promise.all([
      prisma.voucher.count({ where }),
      prisma.voucher.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' }
      })
    ])

    res.json({
      success: true,
      data: {
        items,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum)
        }
      }
    })
  } catch (err) { next(err) }
})

// POST /api/v1/voucher - Admin create voucher
voucherRouter.post('/', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      code: z.string().min(4).max(20),
      type: z.enum(['FIXED', 'PERCENT']),
      value: z.number().min(1),
      maxUsage: z.number().min(1),
      validFrom: z.string(),
      validUntil: z.string(),
      isActive: z.boolean(),
    })
    
    const data = schema.parse(req.body)
    
    // Check if code exists
    const existing = await prisma.voucher.findUnique({ where: { code: data.code } })
    if (existing) {
      return res.status(400).json({ success: false, message: 'Kode voucher sudah digunakan' })
    }

    const voucher = await prisma.voucher.create({
      data: {
        ...data,
        validFrom: new Date(data.validFrom),
        validUntil: new Date(data.validUntil)
      }
    })

    res.status(201).json({ success: true, data: voucher, message: 'Voucher berhasil dibuat' })
  } catch (err) { next(err) }
})

// PATCH /api/v1/voucher/:id - Admin update voucher
voucherRouter.patch('/:id', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as Record<string, string>
    const schema = z.object({
      code: z.string().min(4).max(20),
      type: z.enum(['FIXED', 'PERCENT']),
      value: z.number().min(1),
      maxUsage: z.number().min(1),
      validFrom: z.string(),
      validUntil: z.string(),
      isActive: z.boolean(),
    })
    
    const data = schema.parse(req.body)
    
    const existing = await prisma.voucher.findUnique({ where: { code: data.code } })
    if (existing && existing.id !== id) {
      return res.status(400).json({ success: false, message: 'Kode voucher sudah digunakan' })
    }

    const voucher = await prisma.voucher.update({
      where: { id },
      data: {
        ...data,
        validFrom: new Date(data.validFrom),
        validUntil: new Date(data.validUntil)
      }
    })

    res.json({ success: true, data: voucher, message: 'Voucher berhasil diperbarui' })
  } catch (err) { next(err) }
})

// DELETE /api/v1/voucher/:id - Admin delete voucher
voucherRouter.delete('/:id', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as Record<string, string>
    await prisma.voucher.delete({ where: { id } })
    res.json({ success: true, message: 'Voucher berhasil dihapus' })
  } catch (err) { next(err) }
})
