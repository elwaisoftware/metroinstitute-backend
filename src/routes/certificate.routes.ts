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
    })

    const data = await Promise.all(
      certificates.map(async (c) => {
        let course = null
        let bootcamp = null
        if (c.courseId) {
          course = await prisma.miniCourse.findUnique({ where: { id: c.courseId }, select: { title: true, field: true, thumbnailUrl: true } })
        }
        if (c.bootcampId) {
          bootcamp = await prisma.bootcamp.findUnique({ where: { id: c.bootcampId }, select: { title: true, field: true, thumbnailUrl: true } })
        }
        return { ...c, course, bootcamp }
      })
    )

    res.json({ success: true, data })
  } catch (err) { next(err) }
})

// ── GET /certificates/:credentialId (public verification) ──
certificateRouter.get('/verify/:credentialId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const cert = await prisma.certificate.findUnique({
      where: { credentialId: (req.params as Record<string, string>).credentialId },
      include: {
        user: { select: { name: true } },
      },
    })
    if (!cert) throw createError(404, 'Sertifikat tidak ditemukan atau tidak valid')

    let course = null
    let bootcamp = null
    if (cert.courseId) {
      course = await prisma.miniCourse.findUnique({ where: { id: cert.courseId }, select: { title: true, field: true } })
    }
    if (cert.bootcampId) {
      bootcamp = await prisma.bootcamp.findUnique({ where: { id: cert.bootcampId }, select: { title: true, field: true } })
    }

    res.json({ success: true, data: { ...cert, course, bootcamp }, valid: true })
  } catch (err) { next(err) }
})
