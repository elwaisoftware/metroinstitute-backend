import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'
import { grantXp } from '../utils/xp'
import { updateBadge } from '../utils/badge'

export const challengeRouter = Router()
challengeRouter.use(authenticate)

const COOLDOWN_HOURS = 24  // retry cooldown if failed
const PASSING_SCORE  = 70  // % minimum to pass

/**
 * Helper: Ambil daftar bidang dan kelas aktif mentee beserta progres belajarnya.
 */
async function getMenteeEnrolledClasses(userId: string) {
  const [bootcampEnrollments, courseEnrollments] = await Promise.all([
    prisma.bootcampEnrollment.findMany({
      where: { userId, isActive: true },
      include: { bootcamp: { select: { id: true, title: true, field: true, level: true, challengeConfig: true } } },
    }),
    prisma.courseEnrollment.findMany({
      where: { userId, isActive: true, accessUntil: { gt: new Date() } },
      include: { course: { select: { id: true, title: true, field: true, level: true, challengeConfig: true } } },
    }),
  ])

  const fieldSet = new Set<string>()
  const purchasedClasses: Array<{
    id: string
    title: string
    type: 'BOOTCAMP' | 'MINI_COURSE'
    field: string
    level: string
    challengeConfig: Array<{ challengeId: string; unlockAtProgress: number }>
    progressPct: number
  }> = []

  for (const be of bootcampEnrollments) {
    if (!be.bootcamp) continue
    const f = be.bootcamp.field
    if (f) fieldSet.add(f)

    const totalSessions = await prisma.bootcampSession.count({
      where: { chapter: { bootcampId: be.bootcamp.id } }
    })
    const completedSessions = totalSessions > 0 ? await prisma.sessionProgress.count({
      where: {
        userId,
        bootcampSession: { chapter: { bootcampId: be.bootcamp.id } },
        isCompleted: true
      }
    }) : 0
    const progressPct = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0

    const rawConfig = be.bootcamp.challengeConfig
    const challengeConfig = Array.isArray(rawConfig) ? (rawConfig as any) : []

    purchasedClasses.push({
      id: be.bootcamp.id,
      title: be.bootcamp.title,
      type: 'BOOTCAMP',
      field: f,
      level: be.bootcamp.level,
      challengeConfig,
      progressPct
    })
  }

  for (const ce of courseEnrollments) {
    if (!ce.course) continue
    const f = ce.course.field
    if (f) fieldSet.add(f)

    const totalSessions = await prisma.courseSession.count({
      where: { chapter: { courseId: ce.course.id } }
    })
    const completedSessions = totalSessions > 0 ? await prisma.sessionProgress.count({
      where: {
        userId,
        courseSession: { chapter: { courseId: ce.course.id } },
        isCompleted: true
      }
    }) : 0
    const progressPct = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0

    const rawConfig = ce.course.challengeConfig
    const challengeConfig = Array.isArray(rawConfig) ? (rawConfig as any) : []

    purchasedClasses.push({
      id: ce.course.id,
      title: ce.course.title,
      type: 'MINI_COURSE',
      field: f,
      level: ce.course.level,
      challengeConfig,
      progressPct
    })
  }

  return {
    accessibleFields: Array.from(fieldSet),
    purchasedClasses,
  }
}

// ── GET /challenges ────────────────────────────────────────
// Returns challenges. For mentee: only for fields matching purchased classes.
// For admin: all challenges with pagination support.
challengeRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { field, level, search, type, page, limit } = req.query as Record<string, string>
    const userId = req.user!.id
    const isAdmin = req.user?.role === 'SUPER_ADMIN'

    // ── Super Admin Flow ──────────────────────────────────
    if (isAdmin) {
      const where: Record<string, unknown> = {}
      if (field) where.field = field
      if (level) where.level = level
      if (type)  where.type  = type
      if (search) where.title = { contains: String(search), mode: 'insensitive' }

      if (page !== undefined || limit !== undefined) {
        const pageNum = Math.max(1, parseInt(page || '1', 10) || 1)
        const limitNum = Math.max(1, parseInt(limit || '10', 10) || 10)
        const skip = (pageNum - 1) * limitNum

        const [total, challenges] = await Promise.all([
          prisma.challenge.count({ where }),
          prisma.challenge.findMany({
            where,
            orderBy: [{ field: 'asc' }, { level: 'asc' }, { createdAt: 'desc' }],
            skip,
            take: limitNum,
            include: {
              _count: { select: { attempts: true } },
            },
          }),
        ])

        const items = challenges.map((ch) => ({
          ...ch,
          maxScore: ch.xpReward,
        }))

        return res.json({
          success: true,
          data: {
            items,
            pagination: {
              total,
              totalPages: Math.ceil(total / limitNum) || 1,
              page: pageNum,
              limit: limitNum,
            },
          },
        })
      }

      const challenges = await prisma.challenge.findMany({
        where,
        orderBy: [{ field: 'asc' }, { level: 'asc' }, { createdAt: 'desc' }],
        include: {
          _count: { select: { attempts: true } },
        },
      })
      const items = challenges.map((ch) => ({
        ...ch,
        maxScore: ch.xpReward,
      }))
      return res.json({ success: true, data: items })
    }

    // ── Mentee Flow: Berdasarkan Kelas yang Dibeli & Terbuka Bertahap ──
    const { accessibleFields, purchasedClasses } = await getMenteeEnrolledClasses(userId)

    if (accessibleFields.length === 0 || purchasedClasses.length === 0) {
      return res.json({
        success: true,
        hasAccess: false,
        message: 'Challenge Bank hanya dapat diakses setelah membeli Bootcamp atau Mini Course.',
        enrolledFields: [],
        purchasedClasses: [],
        data: [],
      })
    }

    // Map: challengeId -> { unlockAtProgress, classTitle, classProgress, isLocked }
    const classChallengeMap = new Map<string, { unlockAtProgress: number; classTitle: string; classProgress: number; isLocked: boolean }>()
    const targetChallengeIds: string[] = []
    let hasExplicitConfig = false

    for (const cls of purchasedClasses) {
      if (cls.challengeConfig && cls.challengeConfig.length > 0) {
        hasExplicitConfig = true
        for (const cfg of cls.challengeConfig) {
          if (!cfg.challengeId) continue
          const unlockAt = cfg.unlockAtProgress ?? 0
          const isLocked = cls.progressPct < unlockAt
          const existing = classChallengeMap.get(cfg.challengeId)
          if (!existing || (existing.isLocked && !isLocked)) {
            classChallengeMap.set(cfg.challengeId, {
              unlockAtProgress: unlockAt,
              classTitle: cls.title,
              classProgress: cls.progressPct,
              isLocked,
            })
          }
          if (!targetChallengeIds.includes(cfg.challengeId)) {
            targetChallengeIds.push(cfg.challengeId)
          }
        }
      }
    }

    let challenges: any[] = []

    if (hasExplicitConfig && targetChallengeIds.length > 0) {
      const where: Record<string, unknown> = {
        id: { in: targetChallengeIds },
        isActive: true,
      }
      if (field) where.field = field
      if (level) where.level = level
      if (type)  where.type  = type
      if (search) where.title = { contains: String(search), mode: 'insensitive' }

      challenges = await prisma.challenge.findMany({
        where,
        orderBy: [{ field: 'asc' }, { level: 'asc' }, { createdAt: 'desc' }],
        select: {
          id: true, title: true, description: true, type: true,
          field: true, level: true, xpReward: true, tags: true,
          timeLimitSec: true,
        },
      })
    } else {
      // Fallback: Jika admin belum memilihkan spesifik challenge untuk kelas ini,
      // tampilkan challenge yang sesuai dengan bidang dan level kelas yang dibeli mentee
      const classLevels = purchasedClasses.map((c) => c.level)
      const where: Record<string, unknown> = {
        isActive: true,
        field: field && accessibleFields.includes(field) ? field : { in: accessibleFields },
        level: level ? level : { in: classLevels },
      }
      if (type)  where.type   = type
      if (search) where.title  = { contains: String(search), mode: 'insensitive' }

      challenges = await prisma.challenge.findMany({
        where,
        orderBy: [{ field: 'asc' }, { level: 'asc' }, { createdAt: 'desc' }],
        select: {
          id: true, title: true, description: true, type: true,
          field: true, level: true, xpReward: true, tags: true,
          timeLimitSec: true,
        },
      })

      // Auto-unlock bertahap (0%, 25%, 50%, 75%...)
      challenges.forEach((ch, idx) => {
        const matchingClass = purchasedClasses.find((c) => c.field === ch.field) || purchasedClasses[0]
        const autoUnlockAt = Math.min(100, Math.floor((idx / Math.max(1, challenges.length)) * 100))
        const isLocked = (matchingClass?.progressPct ?? 0) < autoUnlockAt
        classChallengeMap.set(ch.id, {
          unlockAtProgress: autoUnlockAt,
          classTitle: matchingClass?.title || 'Kelas Terdaftar',
          classProgress: matchingClass?.progressPct ?? 0,
          isLocked,
        })
      })
    }

    // User attempts per challenge
    const attempts = await prisma.challengeAttempt.findMany({
      where: { userId, challengeId: { in: challenges.map((c) => c.id) } },
      orderBy: { submittedAt: 'desc' },
    })

    const attemptsByChallenge = new Map<string, typeof attempts>()
    for (const a of attempts) {
      const list = attemptsByChallenge.get(a.challengeId) || []
      list.push(a)
      attemptsByChallenge.set(a.challengeId, list)
    }

    const enriched = challenges.map((ch) => {
      const chAttempts = attemptsByChallenge.get(ch.id) || []
      const hasPassed = chAttempts.some((a) => a.isCorrect === true)
      const latest = chAttempts[0]
      const classInfo = classChallengeMap.get(ch.id)

      let cooldownUntil: Date | null = null
      let cooldownHoursLeft: number | undefined

      if (!hasPassed && latest && !latest.isCorrect && latest.canRetryAt) {
        if (latest.canRetryAt > new Date()) {
          cooldownUntil = latest.canRetryAt
          cooldownHoursLeft = Math.ceil((latest.canRetryAt.getTime() - Date.now()) / (1000 * 60 * 60))
        }
      }

      return {
        ...ch,
        isCompleted: hasPassed,
        xpClaimed: hasPassed,
        cooldownHoursLeft,
        cooldownUntil,
        isLocked: classInfo ? classInfo.isLocked : false,
        unlockAtProgress: classInfo?.unlockAtProgress ?? 0,
        linkedClassName: classInfo?.classTitle,
        currentClassProgress: classInfo?.classProgress ?? 0,
      }
    })

    res.json({
      success: true,
      hasAccess: true,
      enrolledFields: accessibleFields,
      purchasedClasses,
      data: enriched,
    })
  } catch (err) { next(err) }
})

// ── GET /challenges/:id ────────────────────────────────────
// Returns challenge detail. Checks enrollment for mentee, lock status, and strips isCorrect.
challengeRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id
    const isAdmin = req.user?.role === 'SUPER_ADMIN'
    const challengeId = (req.params as Record<string, string>).id

    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId, ...(isAdmin ? {} : { isActive: true }) },
    })
    if (!challenge) throw createError(404, 'Challenge tidak ditemukan')

    // If not admin, check if mentee is enrolled and progress is sufficient
    if (!isAdmin) {
      const { accessibleFields, purchasedClasses } = await getMenteeEnrolledClasses(userId)
      if (!accessibleFields.includes(challenge.field)) {
        throw createError(403, `Tantangan ini hanya dapat diakses setelah membeli Bootcamp atau Mini Course di bidang ${challenge.field}.`)
      }

      // Check whether this challenge is locked by progress
      let isLocked = false
      let lockReason = ''
      for (const cls of purchasedClasses) {
        if (cls.challengeConfig && cls.challengeConfig.length > 0) {
          const cfg = cls.challengeConfig.find((c: any) => c.challengeId === challenge.id)
          if (cfg) {
            const unlockAt = cfg.unlockAtProgress ?? 0
            if (cls.progressPct < unlockAt) {
              isLocked = true
              lockReason = `Tantangan ini terkunci. Selesaikan materi ${cls.title} hingga ${unlockAt}% untuk membukanya (progres saat ini: ${cls.progressPct}%).`
            } else {
              isLocked = false
              break
            }
          }
        }
      }
      if (isLocked) {
        throw createError(403, lockReason)
      }
    }

    // Check attempts & cooldown
    const attempts = await prisma.challengeAttempt.findMany({
      where: { userId, challengeId: challenge.id },
      orderBy: { submittedAt: 'desc' },
    })
    const hasPassed = attempts.some((a) => a.isCorrect === true)
    const lastAttempt = attempts[0]

    // Cooldown only applies if user has NOT passed before and attempt is on cooldown
    if (!hasPassed && lastAttempt?.canRetryAt && lastAttempt.canRetryAt > new Date()) {
      const hoursLeft = Math.ceil((lastAttempt.canRetryAt.getTime() - Date.now()) / (1000 * 60 * 60))
      throw createError(429, `Challenge masih dalam cooldown. Coba lagi dalam ${hoursLeft} jam.`)
    }

    // Build questions from options JSON
    let parsedOptions = challenge.options
    if (typeof parsedOptions === 'string') {
      try { parsedOptions = JSON.parse(parsedOptions) } catch (e) { parsedOptions = [] }
    }
    const storedQuestions = Array.isArray(parsedOptions) ? parsedOptions : []
    let questions: any[] = []

    if (storedQuestions.length > 0 && typeof storedQuestions[0] === 'object' && storedQuestions[0] !== null && 'question' in (storedQuestions[0] as any)) {
      // Multi-question format
      questions = storedQuestions.map((q: any) => ({
        id: q.id || challenge.id,
        question: q.question,
        imageUrl: q.imageUrl,
        options: (q.options || []).map((o: any) => isAdmin ? o : { id: o.id, text: o.text }),
      }))
    } else if (storedQuestions.length > 0) {
      // Single-question format
      questions = [{
        id: challenge.id,
        question: challenge.description,
        options: storedQuestions.map((o: any) => isAdmin ? o : { id: o.id, text: o.text }),
      }]
    }

    res.json({
      success: true,
      data: {
        id: challenge.id,
        title: challenge.title,
        description: challenge.description,
        type: challenge.type,
        field: challenge.field,
        level: challenge.level,
        xpReward: challenge.xpReward,
        maxScore: challenge.xpReward,
        timeLimitSec: challenge.timeLimitSec,
        passingScore: PASSING_SCORE,
        isCompleted: hasPassed,
        xpClaimed: hasPassed,
        questions,
        options: isAdmin ? storedQuestions : undefined,
      },
    })
  } catch (err) { next(err) }
})

// ── POST /challenges/:id/submit ────────────────────────────
// Submit answers. Mentee only gets XP on their FIRST passing attempt. Retries are allowed.
challengeRouter.post('/:id/submit', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id
    const isAdmin = req.user?.role === 'SUPER_ADMIN'
    const challengeId = (req.params as Record<string, string>).id

    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId, isActive: true },
    })
    if (!challenge) throw createError(404, 'Challenge tidak ditemukan')

    // Check enrollment and lock for mentee
    if (!isAdmin) {
      const { accessibleFields, purchasedClasses } = await getMenteeEnrolledClasses(userId)
      if (!accessibleFields.includes(challenge.field)) {
        throw createError(403, `Kamu harus membeli Bootcamp atau Mini Course di bidang ${challenge.field} untuk mengerjakan tantangan ini.`)
      }

      let isLocked = false
      let lockReason = ''
      for (const cls of purchasedClasses) {
        if (cls.challengeConfig && cls.challengeConfig.length > 0) {
          const cfg = cls.challengeConfig.find((c: any) => c.challengeId === challenge.id)
          if (cfg) {
            const unlockAt = cfg.unlockAtProgress ?? 0
            if (cls.progressPct < unlockAt) {
              isLocked = true
              lockReason = `Tantangan ini terkunci. Selesaikan materi ${cls.title} hingga ${unlockAt}% untuk membukanya.`
            } else {
              isLocked = false
              break
            }
          }
        }
      }
      if (isLocked) {
        throw createError(403, lockReason)
      }
    }

    // Check if user has already passed previously
    const previousPassedAttempt = await prisma.challengeAttempt.findFirst({
      where: { userId, challengeId, isCorrect: true },
    })
    const isFirstClear = !previousPassedAttempt

    // Check cooldown if user hasn't passed before
    if (!previousPassedAttempt) {
      const lastAttempt = await prisma.challengeAttempt.findFirst({
        where: { userId, challengeId },
        orderBy: { submittedAt: 'desc' },
      })
      if (lastAttempt?.canRetryAt && lastAttempt.canRetryAt > new Date()) {
        const hoursLeft = Math.ceil((lastAttempt.canRetryAt.getTime() - Date.now()) / (1000 * 60 * 60))
        throw createError(429, `Challenge masih dalam cooldown. Coba lagi dalam ${hoursLeft} jam.`)
      }
    }

    // ── IF QUIZ ──────────────────────────────────────────────────────────
    if (challenge.type === 'QUIZ') {
      let parsedOptions = challenge.options
      if (typeof parsedOptions === 'string') {
        try { parsedOptions = JSON.parse(parsedOptions) } catch (e) { parsedOptions = [] }
      }
      const storedQuestions = (parsedOptions as Array<any> | null) ?? []
      let totalQuestions = 0
      let correctCount = 0

      if (storedQuestions.length > 0 && 'question' in storedQuestions[0]) {
        totalQuestions = storedQuestions.length
        storedQuestions.forEach((q) => {
          const correctOpt = (q.options || []).find((o: any) => o.isCorrect)
          if (correctOpt && req.body.answers && req.body.answers[q.id || challenge.id] === correctOpt.id) {
            correctCount++
          }
        })
      } else if (storedQuestions.length > 0) {
        totalQuestions = 1
        const correctOpt = storedQuestions.find((o: any) => o.isCorrect)
        if (correctOpt && req.body.answers && req.body.answers[challenge.id] === correctOpt.id) {
          correctCount++
        }
      }

      const score = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0
      const passed = score >= PASSING_SCORE

      // Cooldown only if failed AND user has never passed before
      const canRetryAt = !passed && isFirstClear
        ? new Date(Date.now() + COOLDOWN_HOURS * 60 * 60 * 1000)
        : null

      // Award XP ONLY if passed AND it's their FIRST TIME passing
      const shouldAwardXp = passed && isFirstClear

      const attempt = await prisma.challengeAttempt.create({
        data: {
          userId,
          challengeId,
          isCorrect: passed,
          answer: JSON.stringify(req.body.answers || {}),
          canRetryAt,
          xpAwarded: shouldAwardXp ? challenge.xpReward : 0,
        },
      })

      let xpEarned = 0
      if (shouldAwardXp) {
        xpEarned = await grantXp(userId, 'CHALLENGE_QUIZ_CORRECT', `Challenge: ${challenge.title}`, challenge.xpReward)
        await updateBadge(userId)
      }

      return res.json({
        success: true,
        data: {
          score,
          passed,
          correct: correctCount,
          totalQuestions,
          xpEarned,
          isFirstClear,
          alreadyAwarded: !isFirstClear && passed,
          attemptId: attempt.id,
          type: 'QUIZ',
        },
      })
    }

    // ── IF PROJECT ───────────────────────────────────────────────────────
    if (challenge.type === 'PROJECT') {
      const { linkUrl, answer } = req.body
      if (!linkUrl && !answer) throw createError(400, 'Tautan atau jawaban harus diisi')

      const attempt = await prisma.challengeAttempt.create({
        data: {
          userId,
          challengeId,
          isCorrect: null, // Pending grading by Admin
          linkUrl: linkUrl || null,
          answer: answer || null,
          xpAwarded: null,
        },
      })

      return res.json({
        success: true,
        data: {
          passed: null,
          xpEarned: 0,
          isFirstClear,
          alreadyAwarded: !isFirstClear,
          attemptId: attempt.id,
          type: 'PROJECT',
        },
      })
    }
  } catch (err) { next(err) }
})

// ── POST / (Admin Create Challenge) ────────────────────────
challengeRouter.post('/', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { title, description, type, field, level, maxScore, xpReward, timeLimitSec, options, tags } = req.body
    if (!title || !description || !type || !field) {
      throw createError(400, 'Judul, deskripsi, tipe, dan bidang wajib diisi')
    }

    const challenge = await prisma.challenge.create({
      data: {
        title,
        description,
        type,
        field,
        level: level || 'BEGINNER',
        xpReward: Number(maxScore || xpReward || 100),
        timeLimitSec: timeLimitSec ? Number(timeLimitSec) : null,
        options: options ?? null,
        tags: Array.isArray(tags) ? tags : [],
        isActive: true,
      },
    })
    res.status(201).json({ success: true, data: challenge })
  } catch (err) { next(err) }
})

// ── PATCH /:id (Admin Update Challenge) ────────────────────
challengeRouter.patch('/:id', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as Record<string, string>
    const { title, description, type, field, level, maxScore, xpReward, timeLimitSec, options, tags, isActive } = req.body

    const updateData: Record<string, any> = {}
    if (title !== undefined) updateData.title = title
    if (description !== undefined) updateData.description = description
    if (type !== undefined) updateData.type = type
    if (field !== undefined) updateData.field = field
    if (level !== undefined) updateData.level = level
    if (maxScore !== undefined || xpReward !== undefined) updateData.xpReward = Number(maxScore || xpReward)
    if (timeLimitSec !== undefined) updateData.timeLimitSec = timeLimitSec ? Number(timeLimitSec) : null
    if (options !== undefined) updateData.options = options
    if (tags !== undefined) updateData.tags = Array.isArray(tags) ? tags : []
    if (isActive !== undefined) updateData.isActive = Boolean(isActive)

    const challenge = await prisma.challenge.update({
      where: { id },
      data: updateData,
    })
    res.json({ success: true, data: challenge })
  } catch (err) { next(err) }
})

// ── DELETE /:id (Admin Delete Challenge) ───────────────────
challengeRouter.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as Record<string, string>
    await prisma.challengeAttempt.deleteMany({ where: { challengeId: id } })
    await prisma.challenge.delete({ where: { id } })
    res.json({ success: true, message: 'Challenge berhasil dihapus' })
  } catch (err) { next(err) }
})
