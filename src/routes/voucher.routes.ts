import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.middleware'

export const voucherRouter = Router()

// ── POST /api/v1/voucher/validate ─────────────────────────
// Mentee checks voucher validity & calculates discount
voucherRouter.post('/validate', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id
    const schema = z.object({
      code: z.string().min(1, 'Kode voucher wajib diisi'),
      productType: z.enum(['MINI_COURSE', 'BOOTCAMP', 'WEBINAR']),
      productId: z.string().optional(),
    })
    const { code, productType, productId } = schema.parse(req.body)

    const normalizedCode = code.trim().toUpperCase()
    const voucher = await prisma.voucher.findFirst({
      where: { code: { equals: normalizedCode, mode: 'insensitive' } },
    })

    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Kode voucher tidak ditemukan' })
    }

    if (!voucher.isActive) {
      return res.status(400).json({ success: false, message: 'Voucher sudah tidak aktif' })
    }

    const now = new Date()
    if (now < voucher.validFrom) {
      return res.status(400).json({ success: false, message: 'Voucher belum dapat digunakan' })
    }

    const validUntilEnd = new Date(voucher.validUntil)
    validUntilEnd.setHours(23, 59, 59, 999)
    if (now > validUntilEnd) {
      return res.status(400).json({ success: false, message: 'Voucher sudah kedaluwarsa' })
    }

    if (voucher.usageCount >= voucher.maxUsage) {
      return res.status(400).json({ success: false, message: 'Kuota penggunaan voucher ini sudah habis' })
    }

    // Check user usage limit
    const userUsage = await prisma.transaction.count({
      where: {
        userId,
        voucherId: voucher.id,
        status: 'SUCCESS',
      },
    })
    if (userUsage >= voucher.maxPerUser) {
      return res.status(400).json({
        success: false,
        message: `Kamu sudah mencapai batas penggunaan voucher ini (${voucher.maxPerUser}x)`,
      })
    }

    // Resolve base price if productId provided
    let basePrice = 0
    if (productId) {
      if (productType === 'MINI_COURSE') {
        const item = await prisma.miniCourse.findUnique({ where: { id: productId }, select: { price: true } })
        if (item) basePrice = item.price
      } else if (productType === 'BOOTCAMP') {
        const item = await prisma.bootcamp.findUnique({ where: { id: productId }, select: { price: true } })
        if (item) basePrice = item.price
      } else if (productType === 'WEBINAR') {
        const item = await prisma.webinar.findUnique({ where: { id: productId }, select: { price: true } })
        if (item) basePrice = item.price
      }
    }

    let discountAmount = 0
    if (voucher.type === 'PERCENT') {
      discountAmount = Math.round((basePrice * voucher.value) / 100)
    } else {
      discountAmount = voucher.value
    }
    if (basePrice > 0) {
      discountAmount = Math.min(basePrice, discountAmount)
    }
    const finalPrice = Math.max(0, basePrice - discountAmount)

    return res.json({
      success: true,
      data: {
        id: voucher.id,
        code: voucher.code,
        type: voucher.type, // 'PERCENT' | 'FIXED'
        value: voucher.value,
        basePrice,
        discountAmount,
        finalPrice,
        isFree: basePrice > 0 && finalPrice === 0,
      },
      message: 'Voucher berhasil diterapkan!',
    })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/v1/voucher - Admin get vouchers ───────────────
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

    const [total, rawItems] = await Promise.all([
      prisma.voucher.count({ where }),
      prisma.voucher.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' }
      })
    ])

    // Format items to support both backend fields and frontend aliases
    const items = rawItems.map((v) => ({
      ...v,
      discountType: v.type,
      discountValue: v.value,
      maxUses: v.maxUsage,
      usedCount: v.usageCount,
      productType: 'ALL',
    }))

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

// ── POST /api/v1/voucher - Admin create voucher ───────────
voucherRouter.post('/', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = {
      code: req.body.code,
      type: req.body.type || req.body.discountType,
      value: req.body.value !== undefined ? Number(req.body.value) : req.body.discountValue !== undefined ? Number(req.body.discountValue) : undefined,
      maxUsage: req.body.maxUsage !== undefined ? Number(req.body.maxUsage) : req.body.maxUses !== undefined ? Number(req.body.maxUses) : undefined,
      validFrom: req.body.validFrom,
      validUntil: req.body.validUntil,
      isActive: req.body.isActive !== undefined ? Boolean(req.body.isActive) : true,
    }

    const schema = z.object({
      code: z.string().min(4).max(20),
      type: z.enum(['FIXED', 'PERCENT']),
      value: z.number().min(1),
      maxUsage: z.number().min(1),
      validFrom: z.string(),
      validUntil: z.string(),
      isActive: z.boolean(),
    })
    
    const data = schema.parse(body)
    const normalizedCode = data.code.trim().toUpperCase()
    
    // Check if code exists
    const existing = await prisma.voucher.findFirst({
      where: { code: { equals: normalizedCode, mode: 'insensitive' } }
    })
    if (existing) {
      return res.status(400).json({ success: false, message: 'Kode voucher sudah digunakan' })
    }

    const voucher = await prisma.voucher.create({
      data: {
        code: normalizedCode,
        type: data.type,
        value: data.value,
        maxUsage: data.maxUsage,
        isActive: data.isActive,
        validFrom: new Date(data.validFrom),
        validUntil: new Date(data.validUntil)
      }
    })

    res.status(201).json({
      success: true,
      data: {
        ...voucher,
        discountType: voucher.type,
        discountValue: voucher.value,
        maxUses: voucher.maxUsage,
        usedCount: voucher.usageCount,
        productType: 'ALL',
      },
      message: 'Voucher berhasil dibuat'
    })
  } catch (err) { next(err) }
})

// ── PATCH /api/v1/voucher/:id - Admin update voucher ──────
voucherRouter.patch('/:id', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as Record<string, string>
    const body = {
      code: req.body.code,
      type: req.body.type || req.body.discountType,
      value: req.body.value !== undefined ? Number(req.body.value) : req.body.discountValue !== undefined ? Number(req.body.discountValue) : undefined,
      maxUsage: req.body.maxUsage !== undefined ? Number(req.body.maxUsage) : req.body.maxUses !== undefined ? Number(req.body.maxUses) : undefined,
      validFrom: req.body.validFrom,
      validUntil: req.body.validUntil,
      isActive: req.body.isActive !== undefined ? Boolean(req.body.isActive) : undefined,
    }

    const schema = z.object({
      code: z.string().min(4).max(20),
      type: z.enum(['FIXED', 'PERCENT']),
      value: z.number().min(1),
      maxUsage: z.number().min(1),
      validFrom: z.string(),
      validUntil: z.string(),
      isActive: z.boolean().optional(),
    })
    
    const data = schema.parse(body)
    const normalizedCode = data.code.trim().toUpperCase()
    
    const existing = await prisma.voucher.findFirst({
      where: { code: { equals: normalizedCode, mode: 'insensitive' } }
    })
    if (existing && existing.id !== id) {
      return res.status(400).json({ success: false, message: 'Kode voucher sudah digunakan' })
    }

    const voucher = await prisma.voucher.update({
      where: { id },
      data: {
        code: normalizedCode,
        type: data.type,
        value: data.value,
        maxUsage: data.maxUsage,
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        validFrom: new Date(data.validFrom),
        validUntil: new Date(data.validUntil)
      }
    })

    res.json({
      success: true,
      data: {
        ...voucher,
        discountType: voucher.type,
        discountValue: voucher.value,
        maxUses: voucher.maxUsage,
        usedCount: voucher.usageCount,
        productType: 'ALL',
      },
      message: 'Voucher berhasil diperbarui'
    })
  } catch (err) { next(err) }
})

// ── DELETE /api/v1/voucher/:id - Admin delete voucher ─────
voucherRouter.delete('/:id', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as Record<string, string>
    await prisma.voucher.delete({ where: { id } })
    res.json({ success: true, message: 'Voucher berhasil dihapus' })
  } catch (err) { next(err) }
})
