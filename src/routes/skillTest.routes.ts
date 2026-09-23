import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authenticate, AuthRequest } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'
import { grantXp } from '../utils/xp'
import { updateBadge } from '../utils/badge'

export const skillTestRouter = Router()
skillTestRouter.use(authenticate)

// ── GET /skill-test/questions ──────────────────────────────
skillTestRouter.get('/questions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user!.role !== 'MENTEE') throw createError(403, 'Hanya untuk mentee')

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { skillTestDone: true },
    })
    // Allow re-take only if not done yet (or admin unlocked)
    // if (user?.skillTestDone) throw createError(403, 'Kamu sudah menyelesaikan skill test')

    const questions = await prisma.skillTestQuestion.findMany({
      where: { isActive: true },
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true, question: true, imageUrl: true, orderIndex: true,
        options: {
          orderBy: { orderIndex: 'asc' },
          select: { id: true, text: true }, // Never expose isCorrect to client
        },
      },
    })

    if (questions.length === 0) throw createError(503, 'Soal skill test belum tersedia')

    res.json({ success: true, data: questions })
  } catch (err) { next(err) }
})

// ── POST /skill-test/submit ────────────────────────────────
skillTestRouter.post('/submit', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id
    const { answers } = z.object({
      answers: z.record(z.string(), z.string()), // { questionId: optionId }
    }).parse(req.body)

    // Check not already done
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { skillTestDone: true } })
    if (user?.skillTestDone) throw createError(409, 'Skill test sudah pernah diselesaikan')

    // Load questions + correct answers
    const questions = await prisma.skillTestQuestion.findMany({
      where: { isActive: true, id: { in: Object.keys(answers) } },
      include: { options: true },
    })

    if (questions.length === 0) throw createError(400, 'Jawaban tidak valid')

    // Score per field
    const fieldScores: Record<string, number> = {}
    let totalQuestions = questions.length

    for (const q of questions) {
      const chosenOptionId = answers[q.id]
      const chosenOption = q.options.find((o) => o.id === chosenOptionId)
      if (chosenOption?.isCorrect) {
        const field = q.field
        fieldScores[field] = (fieldScores[field] || 0) + 1
      }
    }

    // Convert to percentages
    const fieldTotals: Record<string, number> = {}
    for (const q of questions) {
      fieldTotals[q.field] = (fieldTotals[q.field] || 0) + 1
    }

    const scores: Record<string, number> = {}
    for (const [field, count] of Object.entries(fieldTotals)) {
      scores[field] = Math.round(((fieldScores[field] || 0) / count) * 100)
    }

    // Find top field
    const topField = Object.entries(scores).sort(([, a], [, b]) => b - a)[0]?.[0] || 'FRONTEND'

    // Save result + grant XP
    const xpEarned = await grantXp(userId, 'SKILL_TEST_DONE', 'Skill Test selesai')

    await prisma.user.update({
      where: { id: userId },
      data: {
        skillTestDone: true,
        selectedField: topField as any,
        skillTestResult: scores as any,
      },
    })

    await updateBadge(userId)

    // Save detail answers for analytics
    await prisma.skillTestSubmission.createMany({
      data: Object.entries(answers).map(([questionId, optionId]) => ({
        userId, questionId, selectedOptionId: optionId,
      })),
      skipDuplicates: true,
    })

    res.json({
      success: true,
      data: { scores, topField, xpEarned, recommendation: topField },
    })
  } catch (err) { next(err) }
})

// ── GET /skill-test/result ─────────────────────────────────
skillTestRouter.get('/result', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { skillTestDone: true, skillTestResult: true, selectedField: true },
    })
    if (!user?.skillTestDone || !user.skillTestResult) {
      throw createError(404, 'Hasil skill test tidak ditemukan')
    }

    const xpConfig = await prisma.xpConfig.findUnique({ where: { source: 'SKILL_TEST_DONE' } })

    res.json({
      success: true,
      data: {
        scores: user.skillTestResult,
        topField: user.selectedField,
        xpEarned: xpConfig?.amount || 50,
        recommendation: user.selectedField,
      },
    })
  } catch (err) { next(err) }
})
