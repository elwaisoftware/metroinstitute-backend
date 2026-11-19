import cron from 'node-cron'
import { prisma } from './prisma'
import { WhatsAppService } from '../services/whatsapp.service'
import { sendPushToUser } from '../services/fcm.service'
import { sendEmail } from './email'
import { logger } from './logger'

function formatTimeWIB(date: Date): string {
  return date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  })
}

function formatDateWIB(date: Date): string {
  return date.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  })
}

function buildReminderEmailHtml(params: {
  menteeName: string
  menteeEmail: string
  categoryLabel: string
  programTitle: string
  sessionTitle: string
  dateText: string
  timeText: string
  timingLabel: string
  actionUrl: string
}) {
  return `
    <div style="font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 28px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; color: #0f172a;">
      <div style="margin-bottom: 18px;">
        <span style="display: inline-block; padding: 4px 10px; border-radius: 6px; background: #f0fdf4; color: #018556; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;">
          ${params.categoryLabel} • Pengingat Jadwal
        </span>
      </div>

      <h2 style="margin: 0 0 10px 0; font-size: 18px; font-weight: 700; color: #0f172a;">
        Halo, ${params.menteeName}!
      </h2>

      <p style="margin: 0 0 18px 0; font-size: 13.5px; color: #475569; line-height: 1.6;">
        Sesi live <strong>${params.programTitle}</strong> akan dimulai <strong>${params.timingLabel}</strong>. Pastikan Anda hadir tepat waktu.
      </p>

      <div style="padding: 16px; border-radius: 12px; background: #f8fafc; border: 1px solid #e2e8f0; margin-bottom: 18px; font-size: 13px; color: #334155; line-height: 1.6;">
        <div><strong>Sesi:</strong> ${params.sessionTitle}</div>
        <div style="margin-top: 4px;"><strong>Hari, Tanggal:</strong> ${params.dateText}</div>
        <div style="margin-top: 4px;"><strong>Waktu:</strong> ${params.timeText} WIB</div>
        <div style="margin-top: 4px;"><strong>Platform:</strong> Google Meet</div>
      </div>

      <div style="padding: 12px 14px; border-radius: 10px; background: #fffbeb; border: 1px solid #fde68a; margin-bottom: 22px; font-size: 12.5px; color: #92400e; line-height: 1.5;">
        <strong>Penting (Auto-Presensi):</strong> Pastikan Anda masuk ke Google Meet menggunakan akun Gmail terdaftar Anda (<strong>${params.menteeEmail}</strong>) agar kehadiran tercatat otomatis.
      </div>

      <div style="margin-bottom: 20px;">
        <a href="${params.actionUrl}" style="display: inline-block; padding: 11px 22px; border-radius: 8px; background: #018556; color: #ffffff; text-decoration: none; font-size: 13.5px; font-weight: 700;">
          Buka Ruang Sesi di Metro Institute
        </a>
      </div>

      <p style="margin: 0; font-size: 12px; color: #94a3b8;">
        Email ini dikirim secara otomatis oleh sistem pengingat jadwal Metro Institute.
      </p>
    </div>
  `
}

async function hasSentReminder(userId: string, reminderKey: string): Promise<boolean> {
  const existing = await prisma.notification.findFirst({
    where: {
      userId,
      type: 'LIVE_REMINDER',
      data: {
        path: ['reminderKey'],
        equals: reminderKey,
      },
    },
    select: { id: true },
  })
  return Boolean(existing)
}

async function dispatchLiveReminder(params: {
  userId: string
  userName: string
  userEmail: string
  reminderKey: string
  notifTitle: string
  notifBody: string
  emailSubject: string
  emailHtml: string
  extraData: Record<string, string>
}) {
  const alreadySent = await hasSentReminder(params.userId, params.reminderKey)
  if (alreadySent) return false

  // 1. In-App Notification (Tampil di Aplikasi Mobile & Web)
  await prisma.notification.create({
    data: {
      userId: params.userId,
      type: 'LIVE_REMINDER',
      title: params.notifTitle,
      body: params.notifBody,
      data: {
        reminderKey: params.reminderKey,
        ...params.extraData,
      },
    },
  })

  // 2. Push Notification ke Aplikasi Mobile (FCM)
  await sendPushToUser(params.userId, params.notifTitle, params.notifBody, {
    type: 'LIVE_REMINDER',
    ...params.extraData,
  })

  // 3. Email Otomatis untuk Pengguna Web / Mentee
  if (params.userEmail) {
    await sendEmail({
      to: params.userEmail,
      subject: params.emailSubject,
      html: params.emailHtml,
    })
  }

  return true
}

export const startCronJobs = () => {
  logger.info('Starting automated live reminder cron jobs (App Notification + Email)...')

  const frontendBase = process.env.FRONTEND_URL || 'https://metroinstitute.site'

  // ── 1. CRON H-1 (Setiap Hari Pukul 08:00 Pagi WIB) ─────────────────────────
  cron.schedule('0 8 * * *', async () => {
    logger.info('[CRON] Running H-1 Live Session & Webinar Reminders...')
    try {
      const tomorrowStart = new Date()
      tomorrowStart.setDate(tomorrowStart.getDate() + 1)
      tomorrowStart.setHours(0, 0, 0, 0)

      const tomorrowEnd = new Date(tomorrowStart)
      tomorrowEnd.setHours(23, 59, 59, 999)

      // A. Bootcamp Live Sessions Besok
      const upcomingSessions = await prisma.bootcampSession.findMany({
        where: {
          type: 'LIVE',
          liveScheduledAt: { gte: tomorrowStart, lte: tomorrowEnd },
        },
        include: {
          chapter: { include: { bootcamp: true } },
        },
      })

      for (const session of upcomingSessions) {
        if (!session.liveScheduledAt) continue
        const bootcamp = session.chapter.bootcamp
        const enrollments = await prisma.bootcampEnrollment.findMany({
          where: { bootcampId: bootcamp.id, isActive: true },
          include: { user: true },
        })

        const dateText = formatDateWIB(session.liveScheduledAt)
        const timeText = formatTimeWIB(session.liveScheduledAt)
        const actionUrl = `${frontendBase}/mentee/bootcamp/${bootcamp.id}/session/${session.id}`
        const reminderKey = `H1_BOOTCAMP_SESSION_${session.id}`

        const phones: string[] = []
        for (const e of enrollments) {
          if (e.user.phone) phones.push(e.user.phone)

          const emailHtml = buildReminderEmailHtml({
            menteeName: e.user.name,
            menteeEmail: e.user.email,
            categoryLabel: 'Bootcamp Live',
            programTitle: bootcamp.title,
            sessionTitle: session.title,
            dateText,
            timeText,
            timingLabel: `besok pukul ${timeText} WIB`,
            actionUrl,
          })

          await dispatchLiveReminder({
            userId: e.user.id,
            userName: e.user.name,
            userEmail: e.user.email,
            reminderKey,
            notifTitle: `Pengingat Live Besok: ${session.title}`,
            notifBody: `Sesi live "${session.title}" (${bootcamp.title}) dijadwalkan besok pukul ${timeText} WIB.`,
            emailSubject: `[Pengingat H-1] Live Session Besok: ${session.title} — ${bootcamp.title}`,
            emailHtml,
            extraData: { bootcampId: bootcamp.id, sessionId: session.id },
          })
        }

        if (phones.length > 0) {
          const message = `*REMINDER LIVE CLASS BESOK*\n\nHalo Mentee,\nBesok akan ada Live Session untuk Bootcamp *${bootcamp.title}*.\n\n*Topik:* ${session.title}\n*Pukul:* ${timeText} WIB\n\nSilakan bergabung melalui platform:\n${actionUrl}`
          await WhatsAppService.sendBroadcast(phones, message)
        }
      }

      // B. Webinars / Inspire Talk Besok
      const upcomingWebinars = await prisma.webinar.findMany({
        where: {
          isPublished: true,
          isEnded: false,
          scheduledAt: { gte: tomorrowStart, lte: tomorrowEnd },
        },
        include: {
          registrations: { include: { user: true } },
        },
      })

      for (const webinar of upcomingWebinars) {
        const dateText = formatDateWIB(webinar.scheduledAt)
        const timeText = formatTimeWIB(webinar.scheduledAt)
        const actionUrl = `${frontendBase}/mentee/webinars/${webinar.id}`
        const reminderKey = `H1_WEBINAR_${webinar.id}`

        for (const reg of webinar.registrations) {
          const emailHtml = buildReminderEmailHtml({
            menteeName: reg.user.name,
            menteeEmail: reg.user.email,
            categoryLabel: 'Inspire Talk / Webinar',
            programTitle: webinar.title,
            sessionTitle: webinar.title,
            dateText,
            timeText,
            timingLabel: `besok pukul ${timeText} WIB`,
            actionUrl,
          })

          await dispatchLiveReminder({
            userId: reg.user.id,
            userName: reg.user.name,
            userEmail: reg.user.email,
            reminderKey,
            notifTitle: `Pengingat Webinar Besok: ${webinar.title}`,
            notifBody: `Webinar "${webinar.title}" akan dilaksanakan besok pukul ${timeText} WIB. Ruang sesi dibuka 30 menit sebelum mulai.`,
            emailSubject: `[Pengingat H-1] Webinar Besok: ${webinar.title}`,
            emailHtml,
            extraData: { webinarId: webinar.id },
          })
        }
      }
    } catch (error) {
      logger.error('[CRON] Failed to send H-1 reminders', error)
    }
  })

  // ── 2. CRON H-30 MENIT (Dicek Setiap 5 Menit Saat Ruang Sesi Dibuka) ────────
  cron.schedule('*/5 * * * *', async () => {
    try {
      const now = new Date()
      const windowEnd = new Date(now.getTime() + 35 * 60 * 1000) // Sesi yang mulai dalam 0–35 menit ke depan

      // A. Bootcamp Live Sessions yang akan dimulai <= 35 menit lagi
      const imminentSessions = await prisma.bootcampSession.findMany({
        where: {
          type: 'LIVE',
          liveScheduledAt: { gte: now, lte: windowEnd },
        },
        include: {
          chapter: { include: { bootcamp: true } },
        },
      })

      for (const session of imminentSessions) {
        if (!session.liveScheduledAt) continue
        const bootcamp = session.chapter.bootcamp
        const enrollments = await prisma.bootcampEnrollment.findMany({
          where: { bootcampId: bootcamp.id, isActive: true },
          include: { user: true },
        })

        const dateText = formatDateWIB(session.liveScheduledAt)
        const timeText = formatTimeWIB(session.liveScheduledAt)
        const actionUrl = `${frontendBase}/mentee/bootcamp/${bootcamp.id}/session/${session.id}`
        const reminderKey = `H30M_BOOTCAMP_SESSION_${session.id}`

        for (const e of enrollments) {
          const emailHtml = buildReminderEmailHtml({
            menteeName: e.user.name,
            menteeEmail: e.user.email,
            categoryLabel: 'Bootcamp Live',
            programTitle: bootcamp.title,
            sessionTitle: session.title,
            dateText,
            timeText,
            timingLabel: `dalam 30 menit (pukul ${timeText} WIB)`,
            actionUrl,
          })

          await dispatchLiveReminder({
            userId: e.user.id,
            userName: e.user.name,
            userEmail: e.user.email,
            reminderKey,
            notifTitle: `Sesi Live Segera Dimulai (${timeText} WIB)`,
            notifBody: `Ruang sesi "${session.title}" telah siap. Masuk sekarang menggunakan akun Gmail terdaftar Anda.`,
            emailSubject: `[Segera Mulai] Ruang Sesi Live "${session.title}" Telah Dibuka`,
            emailHtml,
            extraData: { bootcampId: bootcamp.id, sessionId: session.id },
          })
        }
      }

      // B. Webinars yang akan dimulai <= 35 menit lagi (Ruang tunggu H-30 menit resmi dibuka)
      const imminentWebinars = await prisma.webinar.findMany({
        where: {
          isPublished: true,
          isEnded: false,
          scheduledAt: { gte: now, lte: windowEnd },
        },
        include: {
          registrations: { include: { user: true } },
        },
      })

      for (const webinar of imminentWebinars) {
        const dateText = formatDateWIB(webinar.scheduledAt)
        const timeText = formatTimeWIB(webinar.scheduledAt)
        const actionUrl = `${frontendBase}/mentee/webinars/${webinar.id}`
        const reminderKey = `H30M_WEBINAR_${webinar.id}`

        for (const reg of webinar.registrations) {
          const emailHtml = buildReminderEmailHtml({
            menteeName: reg.user.name,
            menteeEmail: reg.user.email,
            categoryLabel: 'Inspire Talk / Webinar',
            programTitle: webinar.title,
            sessionTitle: webinar.title,
            dateText,
            timeText,
            timingLabel: `pukul ${timeText} WIB (Ruang sesi sudah dibuka sekarang)`,
            actionUrl,
          })

          await dispatchLiveReminder({
            userId: reg.user.id,
            userName: reg.user.name,
            userEmail: reg.user.email,
            reminderKey,
            notifTitle: `Ruang Sesi Webinar Telah Dibuka!`,
            notifBody: `Webinar "${webinar.title}" mulai pukul ${timeText} WIB. Anda sudah dapat masuk ke ruang sesi sekarang.`,
            emailSubject: `[Ruang Dibuka] Webinar "${webinar.title}" Mulai Pukul ${timeText} WIB`,
            emailHtml,
            extraData: { webinarId: webinar.id },
          })
        }
      }
    } catch (error) {
      logger.error('[CRON] Failed to send H-30m reminders', error)
    }
  })
}
