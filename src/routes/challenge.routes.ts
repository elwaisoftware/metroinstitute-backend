import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authenticate, AuthRequest } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'
import { grantXp } from '../utils/xp'
import { updateBadge } from '../utils/badge'

export const challengeRouter = Router()
challengeRouter.use(authenticate)

const COOLDOWN_HOURS = 24  // retry cooldown if failed
const PASSING_SCORE  = 70  // % minimum to pass

// ── GET /challenges ────────────────────────────────────────
// Returns all active challenges enriched with user's attempt status
challengeRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { field, level, search, type } = req.query as Record<string, string>
    const userId = req.user!.id

    const where: Record<string, unknown> = {}
    const isAdmin = req.user?.role === 'SUPER_ADMIN'
    if (!isAdmin) {
      where.isActive = true
    }
    if (field) where.field = field
    if (level)  where.level  = level
    if (type)   where.type   = type
    if (search) where.title  = { contains: String(search), mode: 'insensitive' }

    const challenges = await prisma.challenge.findMany({
      where,
      orderBy: [{ field: 'asc' }, { level: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true, title: true, description: true, type: true,
        field: true, level: true, xpReward: true, tags: true,
        timeLimitSec: true,
      },
    })

    // Latest attempt per challenge for this user
    const attempts = await prisma.challengeAttempt.findMany({
      where: { userId, challengeId: { in: challenges.map((c) => c.id) } },
      orderBy: { submittedAt: 'desc' },
    })

    const latestAttemptMap = new Map<string, typeof attempts[number]>()
    for (const a of attempts) {
      if (!latestAttemptMap.has(a.challengeId)) {
        latestAttemptMap.set(a.challengeId, a)
      }
    }

    const enriched = challenges.map((ch) => {
      const latest = latestAttemptMap.get(ch.id)
      const isCompleted = !!latest?.isCorrect
      let cooldownUntil: Date | null = null
      let cooldownHoursLeft: number | undefined

      if (latest && !latest.isCorrect && latest.canRetryAt) {
        if (latest.canRetryAt > new Date()) {
          cooldownUntil = latest.canRetryAt
          cooldownHoursLeft = Math.ceil((latest.canRetryAt.getTime() - Date.now()) / (1000 * 60 * 60))
        }
      }

      return { ...ch, isCompleted, cooldownHoursLeft, cooldownUntil }
    })

    res.json({ success: true, data: enriched })
  } catch (err) { next(err) }
})

// ── GET /challenges/:id ────────────────────────────────────
// Returns challenge detail with options stripped of isCorrect
challengeRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id
    const challenge = await prisma.challenge.findUnique({
      where: { id: (req.params as Record<string, string>).id, isActive: true },
    })
    if (!challenge) throw createError(404, 'Challenge tidak ditemukan')

    // Check if on cooldown
    const lastAttempt = await prisma.challengeAttempt.findFirst({
      where: { userId, challengeId: challenge.id },
      orderBy: { submittedAt: 'desc' },
    })

    if (lastAttempt?.canRetryAt && lastAttempt.canRetryAt > new Date()) {
      const hoursLeft = Math.ceil((lastAttempt.canRetryAt.getTime() - Date.now()) / (1000 * 60 * 60))
      throw createError(429, `Challenge masih dalam cooldown. Coba lagi dalam ${hoursLeft} jam.`)
    }

    // Build questions from options JSON — strip isCorrect before sending
    let parsedOptions = challenge.options;
    if (typeof parsedOptions === 'string') {
      try {
        parsedOptions = JSON.parse(parsedOptions);
      } catch (e) {
        parsedOptions = [];
      }
    }
    const storedQuestions = Array.isArray(parsedOptions) ? parsedOptions : [];
    let questions: any[] = []
    
    if (storedQuestions.length > 0 && typeof storedQuestions[0] === 'object' && storedQuestions[0] !== null && 'question' in (storedQuestions[0] as any)) {
      // Multi-question format
      questions = storedQuestions.map((q: any) => ({
        id: q.id || challenge.id,
        question: q.question,
        imageUrl: q.imageUrl,
        options: (q.options || []).map((o: any) => ({ id: o.id, text: o.text }))
      }))
    } else if (storedQuestions.length > 0) {
      // Single-question format
      questions = [{
        id: challenge.id,
        question: challenge.description,
        options: storedQuestions.map((o: any) => ({ id: o.id, text: o.text }))
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
        passingScore: 70, // or however it's configured
        questions
      }
    })
  } catch (err) { next(err) }
})

// ── POST /challenges/:id/submit ────────────────────────────
challengeRouter.post('/:id/submit', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id
    const challengeId = (req.params as Record<string, string>).id
    const { answers } = req.body // { questionId: optionId }

    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId, isActive: true },
    })
    if (!challenge) throw createError(404, 'Challenge tidak ditemukan')

    // ── IF QUIZ ──────────────────────────────────────────────────────────
    if (challenge.type === 'QUIZ') {
      let parsedOptions = challenge.options;
      if (typeof parsedOptions === 'string') {
        try { parsedOptions = JSON.parse(parsedOptions); } catch (e) { parsedOptions = []; }
      }
      const storedQuestions = (parsedOptions as Array<any> | null) ?? []
      let totalQuestions = 0
      let correctCount = 0

      if (storedQuestions.length > 0 && 'question' in storedQuestions[0]) {
        // Multi-question format
        totalQuestions = storedQuestions.length
        storedQuestions.forEach(q => {
          const correctOpt = (q.options || []).find((o: any) => o.isCorrect)
          if (correctOpt && req.body.answers && req.body.answers[q.id || challenge.id] === correctOpt.id) {
            correctCount++
          }
        })
      } else if (storedQuestions.length > 0) {
        // Single-question format
        totalQuestions = 1
        const correctOpt = storedQuestions.find((o: any) => o.isCorrect)
        if (correctOpt && req.body.answers && req.body.answers[challenge.id] === correctOpt.id) {
          correctCount++
        }
      }

      const score = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0
      const PASSING_SCORE = 70
      const passed = score >= PASSING_SCORE

      const COOLDOWN_HOURS = 24
      const canRetryAt = !passed
        ? new Date(Date.now() + COOLDOWN_HOURS * 60 * 60 * 1000)
        : undefined

      const attempt = await prisma.challengeAttempt.create({
        data: {
          userId,
          challengeId,
          isCorrect: passed,
          answer: JSON.stringify(req.body.answers || {}),
          canRetryAt: canRetryAt ?? null,
          xpAwarded: passed ? challenge.xpReward : 0,
        },
      })

      let xpEarned = 0
      if (passed) {
        xpEarned = await grantXp(userId, 'CHALLENGE_QUIZ_CORRECT', `Challenge: ${challenge.title}`, challenge.xpReward)
        await updateBadge(userId)
      }

      return res.json({
        success: true,
        data: { score, passed, correct: correctCount, totalQuestions, xpEarned, attemptId: attempt.id, type: 'QUIZ' },
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
        data: { passed: null, xpEarned: 0, attemptId: attempt.id, type: 'PROJECT' },
      })
    }
  } catch (err) { next(err) }
})
