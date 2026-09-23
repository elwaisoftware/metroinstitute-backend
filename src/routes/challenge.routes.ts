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
    const { field, level } = req.query
    const userId = req.user!.id

    const where: Record<string, unknown> = { isActive: true }
    if (field) where.field = field
    if (level)  where.level  = level

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
      where: { id: req.params.id, isActive: true },
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
    const options = (challenge.options as Array<{
      id: string; text: string; isCorrect: boolean; explanation?: string
    }> | null) ?? []

    // Present as single question (quiz type) — the options JSON IS the question
    // Format: { id, title, type, field, level, xpReward, questions: [{ id, question, options }] }
    const sanitized = {
      id: challenge.id,
      title: challenge.title,
      description: challenge.description,
      type: challenge.type,
      field: challenge.field,
      level: challenge.level,
      xpReward: challenge.xpReward,
      timeLimitSec: challenge.timeLimitSec,
      passingScore: PASSING_SCORE,
      // Expose as a single "question" for uniform quiz UI
      questions: [{
        id: challenge.id,          // use challengeId as questionId for single-question challenges
        question: challenge.title,
        options: options.map(({ id, text }) => ({ id, text })), // strip isCorrect
      }],
    }

    res.json({ success: true, data: sanitized })
  } catch (err) { next(err) }
})

// ── POST /challenges/:id/submit ────────────────────────────
challengeRouter.post('/:id/submit', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id
    const challengeId = req.params.id

    const { answers } = z.object({
      answers: z.record(z.string(), z.string()),
    }).parse(req.body)

    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId, isActive: true },
    })
    if (!challenge) throw createError(404, 'Challenge tidak ditemukan')

    // Cooldown check
    const lastAttempt = await prisma.challengeAttempt.findFirst({
      where: { userId, challengeId },
      orderBy: { submittedAt: 'desc' },
    })
    if (lastAttempt?.canRetryAt && lastAttempt.canRetryAt > new Date()) {
      const h = Math.ceil((lastAttempt.canRetryAt.getTime() - Date.now()) / (1000 * 60 * 60))
      throw createError(429, `Challenge masih dalam cooldown. Coba lagi dalam ${h} jam.`)
    }

    // Evaluate
    const options = (challenge.options as Array<{
      id: string; text: string; isCorrect: boolean
    }> | null) ?? []
    const correctOption = options.find((o) => o.isCorrect)
    const chosen = answers[challengeId]  // key is challengeId for single-question
    const isCorrect = !!correctOption && chosen === correctOption.id

    const score = isCorrect ? 100 : 0
    const passed = score >= PASSING_SCORE

    const canRetryAt = !passed
      ? new Date(Date.now() + COOLDOWN_HOURS * 60 * 60 * 1000)
      : undefined

    const attempt = await prisma.challengeAttempt.create({
      data: {
        userId,
        challengeId,
        isCorrect: passed,
        answer: chosen,
        canRetryAt: canRetryAt ?? null,
        xpAwarded: passed ? challenge.xpReward : 0,
      },
    })

    let xpEarned = 0
    if (passed) {
      xpEarned = await grantXp(
        userId,
        'CHALLENGE_QUIZ_CORRECT',
        `Challenge: ${challenge.title}`,
        challenge.xpReward
      )
      await updateBadge(userId)
    }

    res.json({
      success: true,
      data: {
        score, passed, correct: isCorrect ? 1 : 0, totalQuestions: 1,
        xpEarned, attemptId: attempt.id,
      },
    })
  } catch (err) { next(err) }
})
