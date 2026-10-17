import { prisma } from '../utils/prisma'
import { logger } from '../utils/logger'
import { grantXp } from '../utils/xp'

// ── Threshold: minimum persentase durasi untuk dianggap HADIR ──────────
const ATTENDANCE_THRESHOLD_PCT = 0.80 // 80%

export interface GoogleMeetParticipant {
  email: string
  displayName: string
  durationMinutes: number // total menit aktif di Meet
  joinTime?: string       // ISO string
  leaveTime?: string      // ISO string
}

/**
 * Sinkronisasi progres sesi mentee dan auto-unlock sertifikat jika sudah 100%.
 */
export async function syncBootcampSessionProgressAndCertificate(
  userId: string,
  sessionId: string,
  bootcampId: string,
  isCompleted: boolean
) {
  try {
    // 1. Upsert session progress
    await prisma.sessionProgress.upsert({
      where: { userId_bootcampSessionId: { userId, bootcampSessionId: sessionId } },
      create: {
        userId,
        bootcampSessionId: sessionId,
        isCompleted,
        completedAt: isCompleted ? new Date() : undefined,
      },
      update: {
        isCompleted,
        completedAt: isCompleted ? new Date() : undefined,
      },
    })

    // 2. Hitung ulang progres bootcamp
    const allBootcampSessions = await prisma.bootcampSession.findMany({
      where: { chapter: { bootcampId } },
      select: { id: true },
    })

    if (allBootcampSessions.length === 0) return

    const completedCount = await prisma.sessionProgress.count({
      where: {
        userId,
        bootcampSessionId: { in: allBootcampSessions.map((s) => s.id) },
        isCompleted: true,
      },
    })

    const progress = Math.round((completedCount / allBootcampSessions.length) * 100)

    await prisma.bootcampEnrollment.update({
      where: { userId_bootcampId: { userId, bootcampId } },
      data: { progress },
    })

    // 3. Auto-terbitkan sertifikat jika progres mencapai 100%
    if (progress === 100) {
      const existingCert = await prisma.certificate.findFirst({
        where: { userId, bootcampId },
      })

      if (!existingCert) {
        const credentialId = `METRO-BOOT-${Date.now().toString(36).toUpperCase()}`
        await prisma.certificate.create({
          data: {
            userId,
            bootcampId,
            productType: 'BOOTCAMP',
            credentialId,
          },
        })

        await prisma.notification.create({
          data: {
            userId,
            type: 'BADGE_UPGRADE',
            title: '🎓 Selamat! Sertifikat Bootcamp Diterbitkan',
            body: 'Kamu telah menyelesaikan 100% seluruh sesi pembelajaran! E-Sertifikatmu siap diunduh.',
            data: { credentialId, bootcampId },
          },
        }).catch(() => {})
      }
    }
  } catch (err) {
    logger.error('syncBootcampSessionProgressAndCertificate failed', { userId, sessionId, bootcampId, error: err })
  }
}

/**
 * Proses data kehadiran dari Google Meet API/Webhook setelah sesi selesai.
 * Mencocokkan email peserta ke database, menghitung threshold 80%,
 * dan menyimpan hasil ke tabel live_attendances.
 */
export async function processGoogleMeetAttendance(
  sessionId: string,
  googleMeetId: string,
  participants: GoogleMeetParticipant[]
) {
  // 1. Ambil data sesi untuk tahu durasi total dan bootcamp-nya
  const session = await prisma.bootcampSession.findUnique({
    where: { id: sessionId },
    include: {
      chapter: {
        select: { bootcampId: true },
      },
    },
  })

  if (!session) {
    throw new Error(`Session ${sessionId} tidak ditemukan`)
  }

  const sessionDurationMinutes = session.videoDuration
    ? Math.ceil(session.videoDuration / 60)
    : 90 // default 90 menit jika tidak dikonfigurasi

  const minDurationMinutes = Math.ceil(sessionDurationMinutes * ATTENDANCE_THRESHOLD_PCT)
  const bootcampId = session.chapter.bootcampId

  // 2. Ambil daftar mentee yang terdaftar di bootcamp ini
  const enrollments = await prisma.bootcampEnrollment.findMany({
    where: { bootcampId, isActive: true },
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  })

  const enrolledEmailMap = new Map(
    enrollments.map((e) => [e.user.email.toLowerCase(), e.user])
  )

  // 3. Proses tiap peserta dari log Google Meet
  const results = {
    hadir: 0,
    gagal: 0,
    tidakTerdaftar: 0,
    detail: [] as Array<{
      email: string
      name: string
      durationMinutes: number
      minRequired: number
      status: 'PRESENT' | 'ABSENT' | 'NOT_ENROLLED'
    }>,
  }

  for (const participant of participants) {
    const email = participant.email.toLowerCase()
    const user = enrolledEmailMap.get(email)

    // Peserta tidak terdaftar di bootcamp ini — lewati
    if (!user) {
      results.tidakTerdaftar++
      results.detail.push({
        email: participant.email,
        name: participant.displayName,
        durationMinutes: participant.durationMinutes,
        minRequired: minDurationMinutes,
        status: 'NOT_ENROLLED',
      })
      continue
    }

    // Tentukan status berdasarkan threshold 80%
    const isPresent = participant.durationMinutes >= minDurationMinutes
    const attendanceStatus = isPresent ? 'PRESENT' : 'ABSENT'

    // Simpan atau update rekaman kehadiran (idempotent upsert)
    await prisma.liveAttendance.upsert({
      where: { sessionId_userId: { sessionId, userId: user.id } },
      create: {
        sessionId,
        userId: user.id,
        status: attendanceStatus,
        durationMinutes: participant.durationMinutes,
        joinTime: participant.joinTime ? new Date(participant.joinTime) : undefined,
        leaveTime: participant.leaveTime ? new Date(participant.leaveTime) : undefined,
        source: 'GOOGLE_MEET_API',
        googleMeetId,
        attendedAt: new Date(),
        markedByAdmin: false,
      },
      update: {
        status: attendanceStatus,
        durationMinutes: participant.durationMinutes,
        joinTime: participant.joinTime ? new Date(participant.joinTime) : undefined,
        leaveTime: participant.leaveTime ? new Date(participant.leaveTime) : undefined,
        googleMeetId,
        attendedAt: new Date(),
      },
    })

    // Sinkronkan ke sessionProgress & progres sertifikat
    await syncBootcampSessionProgressAndCertificate(user.id, sessionId, bootcampId, isPresent)

    // Berikan XP dan notifikasi jika hadir
    if (isPresent) {
      results.hadir++

      // Award XP untuk kehadiran live
      const xpReward = session.xpReward > 0 ? session.xpReward : 50
      await grantXp(user.id, 'LIVE_ATTEND', `Hadir sesi: ${session.title}`, xpReward).catch((err) => {
        logger.warn('XP award gagal untuk kehadiran', { userId: user.id, sessionId, err })
      })

      // Kirim notifikasi konfirmasi ke mentee
      await prisma.notification.create({
        data: {
          userId: user.id,
          type: 'LIVE_REMINDER',
          title: 'Kehadiran Terverifikasi',
          body: `Kehadiranmu di sesi "${session.title}" telah diverifikasi (${participant.durationMinutes} menit). +${xpReward} XP ditambahkan!`,
          data: { sessionId, bootcampId },
        },
      }).catch(() => {})
    } else {
      results.gagal++

      // Kirim notifikasi durasi kurang
      await prisma.notification.create({
        data: {
          userId: user.id,
          type: 'LIVE_REMINDER',
          title: 'Kehadiran Tidak Memenuhi Syarat',
          body: `Kehadiranmu di sesi "${session.title}" hanya ${participant.durationMinutes} menit (minimal ${minDurationMinutes} menit). Hubungi admin jika ada kendala.`,
          data: { sessionId, bootcampId },
        },
      }).catch(() => {})
    }

    results.detail.push({
      email: participant.email,
      name: participant.displayName,
      durationMinutes: participant.durationMinutes,
      minRequired: minDurationMinutes,
      status: attendanceStatus,
    })
  }

  logger.info(`Google Meet attendance processed`, {
    sessionId,
    googleMeetId,
    hadir: results.hadir,
    gagal: results.gagal,
    tidakTerdaftar: results.tidakTerdaftar,
  })

  return {
    sessionId,
    googleMeetId,
    sessionDurationMinutes,
    minDurationMinutes,
    thresholdPct: ATTENDANCE_THRESHOLD_PCT * 100,
    summary: {
      totalParticipants: participants.length,
      hadir: results.hadir,
      gagal: results.gagal,
      tidakTerdaftar: results.tidakTerdaftar,
    },
    detail: results.detail,
  }
}

/**
 * Override manual status presensi oleh Admin (misal: Izin sakit, force majeure, atau input manual)
 */
export async function updateAttendanceStatus(
  sessionId: string,
  userId: string,
  data: {
    status: 'PRESENT' | 'ABSENT' | 'EXCUSED' | 'MANUAL'
    adminNotes?: string
    durationMinutes?: number
  }
) {
  const session = await prisma.bootcampSession.findUnique({
    where: { id: sessionId },
    include: {
      chapter: {
        select: { bootcampId: true },
      },
    },
  })

  if (!session) {
    throw new Error('Sesi tidak ditemukan')
  }

  const bootcampId = session.chapter.bootcampId

  const isCompleted = data.status === 'PRESENT' || data.status === 'EXCUSED' || data.status === 'MANUAL'

  // Upsert live attendance record
  const attendance = await prisma.liveAttendance.upsert({
    where: { sessionId_userId: { sessionId, userId } },
    create: {
      sessionId,
      userId,
      status: data.status,
      durationMinutes: data.durationMinutes ?? (isCompleted ? 90 : 0),
      adminNotes: data.adminNotes,
      markedByAdmin: true,
      source: 'MANUAL',
      attendedAt: new Date(),
    },
    update: {
      status: data.status,
      durationMinutes: data.durationMinutes !== undefined ? data.durationMinutes : undefined,
      adminNotes: data.adminNotes,
      markedByAdmin: true,
      source: 'MANUAL',
    },
  })

  // Sinkronkan ke progress & kelayakan sertifikat
  await syncBootcampSessionProgressAndCertificate(userId, sessionId, bootcampId, isCompleted)

  // Kirim notifikasi jika status di-override menjadi EXCUSED atau PRESENT
  if (data.status === 'EXCUSED') {
    await prisma.notification.create({
      data: {
        userId,
        type: 'LIVE_REMINDER',
        title: 'Izin Kehadiran Disetujui',
        body: `Izin kehadiranmu untuk sesi "${session.title}" telah disetujui oleh admin: "${data.adminNotes || 'Disetujui'}"`,
        data: { sessionId, bootcampId },
      },
    }).catch(() => {})
  }

  return attendance
}

/**
 * Mengambil detail rekap kehadiran sesi lengkap untuk Admin
 */
export async function getSessionAttendanceDetails(sessionId: string) {
  const session = await prisma.bootcampSession.findUnique({
    where: { id: sessionId },
    include: {
      chapter: {
        include: {
          bootcamp: {
            select: { id: true, title: true },
          },
        },
      },
      attendances: {
        include: {
          user: {
            select: { id: true, name: true, email: true, photoUrl: true, phone: true },
          },
        },
      },
    },
  })

  if (!session) {
    throw new Error('Sesi tidak ditemukan')
  }

  const bootcampId = session.chapter.bootcamp.id
  const sessionDurationMinutes = session.videoDuration
    ? Math.ceil(session.videoDuration / 60)
    : 90
  const minRequiredMinutes = Math.ceil(sessionDurationMinutes * ATTENDANCE_THRESHOLD_PCT)

  // Ambil semua peserta yang terdaftar di bootcamp ini
  const enrollments = await prisma.bootcampEnrollment.findMany({
    where: { bootcampId, isActive: true },
    include: {
      user: {
        select: { id: true, name: true, email: true, photoUrl: true, phone: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  const attendanceMap = new Map(
    session.attendances.map((a) => [a.userId, a])
  )

  let countPresent = 0
  let countAbsent = 0
  let countExcused = 0

  const attendees = enrollments.map((enrollment) => {
    const user = enrollment.user
    const record = attendanceMap.get(user.id)

    let status: 'PRESENT' | 'ABSENT' | 'EXCUSED' | 'MANUAL' | 'UNRECORDED' = 'UNRECORDED'
    let durationMinutes = 0
    let joinTime: Date | null = null
    let leaveTime: Date | null = null
    let source = 'GOOGLE_MEET_API'
    let markedByAdmin = false
    let adminNotes: string | null = null
    let attendedAt: Date | null = null
    let recordId: string | null = null

    if (record) {
      status = record.status
      durationMinutes = record.durationMinutes
      joinTime = record.joinTime
      leaveTime = record.leaveTime
      source = record.source
      markedByAdmin = record.markedByAdmin
      adminNotes = record.adminNotes
      attendedAt = record.attendedAt
      recordId = record.id
    }

    if (status === 'PRESENT' || status === 'MANUAL') {
      countPresent++
    } else if (status === 'EXCUSED') {
      countExcused++
    } else {
      countAbsent++
    }

    return {
      userId: user.id,
      recordId,
      name: user.name,
      email: user.email,
      photoUrl: user.photoUrl,
      phone: user.phone,
      status,
      durationMinutes,
      minRequiredMinutes,
      joinTime,
      leaveTime,
      source,
      markedByAdmin,
      adminNotes,
      attendedAt,
    }
  })

  const totalEnrolled = enrollments.length
  const attendanceRate = totalEnrolled > 0
    ? Math.round(((countPresent + countExcused) / totalEnrolled) * 100)
    : 0

  return {
    session: {
      id: session.id,
      title: session.title,
      type: session.type,
      liveUrl: session.liveUrl,
      liveScheduledAt: session.liveScheduledAt,
      durationMinutes: sessionDurationMinutes,
      minRequiredMinutes,
      thresholdPct: ATTENDANCE_THRESHOLD_PCT * 100,
      bootcampId,
      bootcampTitle: session.chapter.bootcamp.title,
      chapterTitle: session.chapter.title,
    },
    summary: {
      totalEnrolled,
      countPresent,
      countExcused,
      countAbsent,
      attendanceRate,
    },
    attendees,
  }
}
