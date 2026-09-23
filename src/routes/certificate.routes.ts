import { Router, Response, NextFunction } from 'express'
import { prisma } from '../utils/prisma'
import { authenticate, AuthRequest } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'

export const certificateRouter = Router()
certificateRouter.use(authenticate)

// ── GET /certificates ──────────────────────────────────────
certificateRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const certificates = await prisma.certificate.findMany({
      where: { userId: req.user!.id },
      orderBy: { issuedAt: 'desc' },
      include: {
        course: { select: { title: true, field: true, thumbnailUrl: true } },
        bootcamp: { select: { title: true, field: true, thumbnailUrl: true } },
      },
    })
    res.json({ success: true, data: certificates })
  } catch (err) { next(err) }
})

// ── GET /certificates/:credentialId (public verification) ──
certificateRouter.get('/verify/:credentialId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const cert = await prisma.certificate.findUnique({
      where: { credentialId: req.params.credentialId },
      include: {
        user: { select: { name: true } },
        course: { select: { title: true, field: true } },
        bootcamp: { select: { title: true, field: true } },
      },
    })
    if (!cert) throw createError(404, 'Sertifikat tidak ditemukan atau tidak valid')
    res.json({ success: true, data: cert, valid: true })
  } catch (err) { next(err) }
})
