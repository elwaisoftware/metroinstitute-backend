import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authenticate, optionalAuth, AuthRequest } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'
import { getMenteeWebinarAttendance } from '../services/attendance.service'
import { grantXp } from '../utils/xp'
import { updateBadge } from '../utils/badge'
import { updateStreak } from '../utils/streak'

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

    const computeWebinarStatus = (w: any) => {
      if (w.isEnded) return 'COMPLETED'
      if (!w.isPublished) return 'DRAFT'
      const scheduledTime = new Date(w.scheduledAt).getTime()
      const closeTime = scheduledTime - 2 * 60 * 60 * 1000
      const isFull = Boolean(w.quota && (w._count?.registrations ?? 0) >= w.quota)
      if (Date.now() >= closeTime || isFull) return 'CLOSED'
      return 'OPEN'
    }

    const items = webinars.map((w: any) => {
      const scheduledTime = new Date(w.scheduledAt).getTime()
      const isRegistrationClosed = Boolean(w.isEnded || Date.now() >= (scheduledTime - 2 * 60 * 60 * 1000))
      return {
        ...w,
        status: computeWebinarStatus(w),
        isRegistrationClosed,
        endedAt: w.endedAt || (w.isEnded ? w.updatedAt : null),
        isRegistered: userId ? (w.registrations?.length > 0) : false,
        registrations: undefined,
        meetingUrl: (userId && w.registrations?.length > 0) ? w.meetingUrl : null,
      }
    })

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
        attendanceStatus: r.attendanceStatus,
        durationMinutes: r.durationMinutes,
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

    let attendance = null
    if (userId && isRegistered) {
      attendance = await getMenteeWebinarAttendance(id, userId)
    }

    const registrationDeadlineMs = scheduledTime - 2 * 60 * 60 * 1000
    const isRegistrationClosed = Boolean(isEnded || nowMs >= registrationDeadlineMs)
    const computeWebinarStatus = (w: any) => {
      if (isEnded) return 'COMPLETED'
      if (!w.isPublished) return 'DRAFT'
      const isFull = Boolean(w.quota && (w._count?.registrations ?? 0) >= w.quota)
      if (isRegistrationClosed || isFull) return 'CLOSED'
      return 'OPEN'
    }

    res.json({
      success: true,
      data: {
        ...webinar,
        status: computeWebinarStatus(webinar),
        isRegistrationClosed,
        registrationDeadline: new Date(registrationDeadlineMs).toISOString(),
        endedAt: effectiveEndedAt,
        isRegistered,
        registrations: undefined,
        attendance,
        meetingUrl: canAccessMeeting ? formatAbsoluteUrl(webinar.meetingUrl) : null,
        recordingUrl: formatAbsoluteUrl(webinar.recordingUrl),
        liveStatus: isEnded ? 'ENDED' : isLiveWindow ? 'LIVE' : 'UPCOMING',
        openTime: new Date(openTimeMs).toISOString(),
      },
    })
  } catch (err) { next(err) }
})

// ── GET /webinars/:id/my-attendance ─────────────────────────
webinarRouter.get('/:id/my-attendance', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as Record<string, string>
    const userId = req.user!.id
    const attendance = await getMenteeWebinarAttendance(id, userId)
    if (!attendance) throw createError(404, 'Webinar tidak ditemukan')
    res.json({ success: true, data: attendance })
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
    if (webinar.isEnded) throw createError(400, 'Webinar telah selesai')

    const scheduledTime = new Date(webinar.scheduledAt).getTime()
    const registrationDeadline = scheduledTime - 2 * 60 * 60 * 1000 // H-2 jam
    if (Date.now() >= registrationDeadline) {
      throw createError(400, 'Pendaftaran ditutup karena telah mencapai batas waktu H-2 jam sebelum acara')
    }

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

// ── POST /webinars/:id/attend ─────────────────────────────
webinarRouter.post('/:id/attend', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: webinarId } = req.params as Record<string, string>
    const userId = req.user!.id
    const { feedback } = req.body

    const reg = await prisma.webinarRegistration.findUnique({
      where: { userId_webinarId: { userId, webinarId } },
    })
    if (!reg) throw createError(403, 'Anda belum terdaftar di webinar ini')

    const updated = await prisma.webinarRegistration.update({
      where: { id: reg.id },
      data: {
        attended: true,
        attendanceStatus: 'PRESENT',
        joinTime: reg.joinTime || new Date(),
        adminNotes: feedback ? `Feedback: ${feedback}` : undefined,
      },
    })

    const webinar = await prisma.webinar.findUnique({ where: { id: webinarId } })
    const xp = webinar?.xpReward ?? 25
    await grantXp(userId, 'LIVE_ATTEND', `Hadir Webinar: ${webinar?.title || ''}`, xp)
    await updateBadge(userId)
    await updateStreak(userId)

    res.json({ success: true, message: 'Presensi berhasil dicatat!', data: updated })
  } catch (err) { next(err) }
})
