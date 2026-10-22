import { Router, Response, NextFunction } from 'express'
import { prisma } from '../utils/prisma'
import { authenticate, AuthRequest } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'

export const certificateRouter = Router()

function normalizeTemplateConfig(config: any) {
  if (!config) return config
  let list = config
  if (typeof config === 'string') {
    try { list = JSON.parse(config) } catch { return config }
  }
  if (!Array.isArray(list)) return config
  return list.map((item: any) => {
    if (item && item.type === 'image' && item.src) {
      const isTransparent = Boolean(item.transparentBg)
      let src = String(item.src)
      if (isTransparent && src.includes('/image/upload/') && !src.includes('e_make_transparent')) {
        src = src.replace('/image/upload/', '/image/upload/e_make_transparent:20/')
      } else if (!isTransparent && src.includes('e_make_transparent:20/')) {
        src = src.replace('e_make_transparent:20/', '')
      }
      return { ...item, src }
    }
    return item
  })
}

// ── GET /certificates/verify/:credentialId (public verification, no auth required) ──
certificateRouter.get('/verify/:credentialId', async (req, res: Response, next: NextFunction) => {
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
    let webinar = null
    if (cert.courseId) {
      course = await prisma.miniCourse.findUnique({ where: { id: cert.courseId }, select: { title: true, field: true, certificateTemplate: { select: { bgImage: true, config: true } } } })
      if (course?.certificateTemplate?.config) {
        course.certificateTemplate.config = normalizeTemplateConfig(course.certificateTemplate.config)
      }
    }
    if (cert.bootcampId) {
      bootcamp = await prisma.bootcamp.findUnique({ where: { id: cert.bootcampId }, select: { title: true, field: true, certificateTemplate: { select: { bgImage: true, config: true } } } })
      if (bootcamp?.certificateTemplate?.config) {
        bootcamp.certificateTemplate.config = normalizeTemplateConfig(bootcamp.certificateTemplate.config)
      }
    }
    if (cert.webinarId) {
      webinar = await prisma.webinar.findUnique({ where: { id: cert.webinarId }, select: { title: true, field: true, certificateTemplate: { select: { bgImage: true, config: true } } } })
      if (webinar?.certificateTemplate?.config) {
        webinar.certificateTemplate.config = normalizeTemplateConfig(webinar.certificateTemplate.config)
      }
    }
    res.json({ success: true, data: { ...cert, course, bootcamp, webinar } })
  } catch (err) { next(err) }
})

// Protected routes below
certificateRouter.use(authenticate)

// ── GET /certificates ──────────────────────────────────────
certificateRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const certificates = await prisma.certificate.findMany({
      where: { userId: req.user!.id },
      include: {
        user: { select: { name: true } },
      },
      orderBy: { issuedAt: 'desc' },
    })

    const data = await Promise.all(
      certificates.map(async (c) => {
        let course = null
        let bootcamp = null
        let webinar = null
        if (c.courseId) {
          course = await prisma.miniCourse.findUnique({ where: { id: c.courseId }, select: { title: true, field: true, thumbnailUrl: true, certificateTemplate: { select: { bgImage: true, config: true } } } })
          if (course?.certificateTemplate?.config) {
            course.certificateTemplate.config = normalizeTemplateConfig(course.certificateTemplate.config)
          }
        }
        if (c.bootcampId) {
          bootcamp = await prisma.bootcamp.findUnique({ where: { id: c.bootcampId }, select: { title: true, field: true, thumbnailUrl: true, certificateTemplate: { select: { bgImage: true, config: true } } } })
          if (bootcamp?.certificateTemplate?.config) {
            bootcamp.certificateTemplate.config = normalizeTemplateConfig(bootcamp.certificateTemplate.config)
          }
        }
        if (c.webinarId) {
          webinar = await prisma.webinar.findUnique({ where: { id: c.webinarId }, select: { title: true, field: true, bannerUrl: true, certificateTemplate: { select: { bgImage: true, config: true } } } })
          if (webinar?.certificateTemplate?.config) {
            webinar.certificateTemplate.config = normalizeTemplateConfig(webinar.certificateTemplate.config)
          }
        }
        return { ...c, course, bootcamp, webinar }
      })
    )

    res.json({ success: true, data })
  } catch (err) { next(err) }
})

