import { Router, Response, NextFunction, Request } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { optionalAuth, AuthRequest } from '../middleware/auth.middleware'
import { WhatsAppService } from '../services/whatsapp.service'

export const searchRouter = Router()
export const homepageRouter = Router()
export const leadRouter = Router()

// ── GET /search?q=... ──────────────────────────────────────
searchRouter.get('/', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, type } = req.query
    if (!q || String(q).trim().length < 2) {
      return res.json({ success: true, data: { bootcamps: [], courses: [], challenges: [] } })
    }
    const query = String(q).trim()
    const searchFilter = { contains: query, mode: 'insensitive' as const }

    const [bootcamps, courses, challenges] = await Promise.all([
      type === 'course' ? [] : prisma.bootcamp.findMany({
        where: { isPublished: true, OR: [{ title: searchFilter }, { shortDescription: searchFilter }] },
        take: 5, select: { id: true, title: true, field: true, price: true, thumbnailUrl: true, batchStatus: true },
      }),
      type === 'bootcamp' ? [] : prisma.miniCourse.findMany({
        where: { isPublished: true, OR: [{ title: searchFilter }, { shortDescription: searchFilter }] },
        take: 5, select: { id: true, title: true, field: true, price: true, thumbnailUrl: true, rating: true },
      }),
      prisma.challenge.findMany({
        where: { isActive: true, title: searchFilter },
        take: 5, select: { id: true, title: true, field: true, xpReward: true },
      }),
    ])

    res.json({ success: true, data: { bootcamps, courses, challenges } })
  } catch (err) { next(err) }
})

// ── GET /homepage ──────────────────────────────────────────
// Public — used by landing page
homepageRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [configRows, featuredBootcamps, featuredCourses, stats] = await Promise.all([
      prisma.homepageConfig.findMany(),
      prisma.bootcamp.findMany({
        where: { isPublished: true, isFeatured: true },
        take: 4,
        select: {
          id: true, title: true, field: true, price: true,
          thumbnailUrl: true, batchStatus: true, rating: true, mentorName: true, shortDescription: true,
          outcomes: true,
        },
      }),
      prisma.miniCourse.findMany({
        where: { isPublished: true, isFeatured: true },
        take: 6,
        orderBy: { enrollmentCount: 'desc' },
        select: {
          id: true, title: true, field: true, price: true,
          thumbnailUrl: true, rating: true, enrollmentCount: true, shortDescription: true,
          tags: true,
        },
      }),
      Promise.all([
        prisma.user.count({ where: { role: 'MENTEE' } }),
        prisma.certificate.count(),
        prisma.miniCourse.count({ where: { isPublished: true } }),
      ]),
    ])

    // Convert key-value rows to object
    const config = Object.fromEntries(configRows.map((r) => [r.key, r.value]))

    res.json({
      success: true,
      data: {
        config,
        featuredBootcamps,
        featuredCourses,
        stats: {
          totalMentees:      stats[0],
          totalCertificates: stats[1],
          totalCourses:      stats[2],
        },
      },
    })
  } catch (err) { next(err) }
})

// ── POST /leads ────────────────────────────────────────────
// Capture landing page interest before purchase
leadRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, phone, source } = z.object({
      name: z.string().min(2),
      email: z.string().email(),
      phone: z.string().optional(),
      source: z.string().optional(),
    }).parse(req.body)

    await prisma.lead.upsert({
      where: { email },
      create: { name, email, phone, source },
      update: { name, phone },
    })

    if (phone) {
      const configRow = await prisma.homepageConfig.findUnique({
        where: { key: 'ebook_url' }
      })
      const ebookUrl = configRow?.value || 'https://metroinstitute.id/ebook'
      
      const message = `Halo ${name},\n\nTerima kasih telah mengunduh Ebook dari Metro Institute!\n\nBerikut adalah link untuk mengunduh ebook Anda:\n${ebookUrl}\n\nSelamat membaca!`
      
      WhatsAppService.sendBroadcast([phone], message).catch(err => {
        console.error('Failed to send ebook WA to', phone, err)
      })
    }

    res.status(201).json({ success: true, message: 'Terima kasih! Tim kami akan menghubungimu segera.' })
  } catch (err) { next(err) }
})
