import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authenticate, optionalAuth, AuthRequest } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'

export const webinarRouter = Router()

// ── GET /webinars ───────────────────────────────────────────
webinarRouter.get('/', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { search, field, status } = req.query as Record<string, string>
    const userId = req.user?.id
    const now = new Date()

    const where: any = { isPublished: true }

    if (field && field !== 'ALL') {
      where.field = field
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { speakerName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (status === 'UPCOMING') {
      where.scheduledAt = { gte: now }
    } else if (status === 'PAST') {
      where.scheduledAt = { lt: now }
    }

    const webinars = await prisma.webinar.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      include: {
        _count: { select: { registrations: true } },
        registrations: userId ? { where: { userId } } : false,
      },
    })

    const items = webinars.map((w: any) => ({
      ...w,
      endedAt: w.endedAt || (w.isEnded ? w.updatedAt : null),
      isRegistered: userId ? (w.registrations?.length > 0) : false,
      registrations: undefined,
      meetingUrl: (userId && w.registrations?.length > 0) ? w.meetingUrl : null,
    }))

    res.json({ success: true, data: items })
  } catch (err) { next(err) }
})

// ── GET /webinars/my ────────────────────────────────────────
webinarRouter.get('/my/registered', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id
    const registrations = await prisma.webinarRegistration.findMany({
      where: { userId },
      include: {
        webinar: true,
      },
      orderBy: { webinar: { scheduledAt: 'asc' } },
    })

    res.json({
      success: true,
      data: registrations.map((r) => ({
        ...r.webinar,
        registeredAt: r.registeredAt,
        attended: r.attended,
        isRegistered: true,
      })),
    })
  } catch (err) { next(err) }
})

// ── GET /webinars/:id ───────────────────────────────────────
webinarRouter.get('/:id', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as Record<string, string>
    const userId = req.user?.id

    const webinar = await prisma.webinar.findUnique({
      where: { id },
      include: {
        _count: { select: { registrations: true } },
        registrations: userId ? { where: { userId } } : false,
      },
    })

    if (!webinar) throw createError(404, 'Webinar tidak ditemukan')

    const isRegistered = userId ? ((webinar.registrations as any)?.length > 0) : false
    const formatAbsoluteUrl = (url?: string | null) => {
      if (!url) return null
      const trimmed = url.trim()
      return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    }

    const scheduledTime = new Date(webinar.scheduledAt).getTime()
    const bufferBeforeMs = 30 * 60 * 1000 // 30 menit sebelum sesi
    const openTimeMs = scheduledTime - bufferBeforeMs
    const nowMs = Date.now()

    // Selesai jika Admin menandai selesai (isEnded = true) atau melewati 24 jam
    const isEnded = Boolean(webinar.isEnded) || (nowMs > scheduledTime + 24 * 60 * 60 * 1000)
    const isUpcoming = !isEnded && nowMs < openTimeMs
    const isLiveWindow = !isEnded && nowMs >= openTimeMs

    // Link meeting aktif selama sesi live (tidak akan mati mendadak jika molor)
    const canAccessMeeting = isRegistered && isLiveWindow

    const effectiveEndedAt = webinar.endedAt || (isEnded ? webinar.updatedAt : null)

    res.json({
      success: true,
      data: {
        ...webinar,
        endedAt: effectiveEndedAt,
        isRegistered,
        registrations: undefined,
        meetingUrl: canAccessMeeting ? formatAbsoluteUrl(webinar.meetingUrl) : null,
        recordingUrl: formatAbsoluteUrl(webinar.recordingUrl),
        liveStatus: isEnded ? 'ENDED' : isLiveWindow ? 'LIVE' : 'UPCOMING',
        openTime: new Date(openTimeMs).toISOString(),
      },
    })
  } catch (err) { next(err) }
})

// ── POST /webinars/:id/register ─────────────────────────────
webinarRouter.post('/:id/register', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: webinarId } = req.params as Record<string, string>
    const userId = req.user!.id

    const webinar = await prisma.webinar.findUnique({
      where: { id: webinarId },
      include: { _count: { select: { registrations: true } } },
    })

    if (!webinar) throw createError(404, 'Webinar tidak ditemukan')
    if (!webinar.isPublished) throw createError(400, 'Webinar belum dipublikasikan')

    // Check quota
    if (webinar.quota && webinar._count.registrations >= webinar.quota) {
      throw createError(400, 'Kuota peserta untuk webinar ini sudah penuh')
    }

    // Check if already registered
    const existing = await prisma.webinarRegistration.findUnique({
      where: { userId_webinarId: { userId, webinarId } },
    })

    if (existing) {
      return res.json({ success: true, message: 'Anda sudah terdaftar di webinar ini', data: existing })
    }

    const registration = await prisma.webinarRegistration.create({
      data: { userId, webinarId },
    })

    // In-app notification
    await prisma.notification.create({
      data: {
        userId,
        title: 'Berhasil Mendaftar Webinar 🎟️',
        body: `Anda berhasil mendaftar webinar "${webinar.title}". Sampai jumpa di sesi live!`,
        type: 'SYSTEM_BROADCAST',
      },
    })

    res.json({
      success: true,
      message: 'Pendaftaran webinar berhasil!',
      data: registration,
    })
  } catch (err) { next(err) }
})
