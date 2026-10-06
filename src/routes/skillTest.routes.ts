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

    const questionsRaw = await prisma.skillTestQuestion.findMany({
      where: { isActive: true },
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true, question: true, imageUrl: true, orderIndex: true,
        options: true, // options is a JSON field
      },
    })

    // Parse options if it's stored as string or just pass it if it's already an object
    const questions = questionsRaw.map(q => ({
      ...q,
      options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options
    }))

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

    // Load questions
    const questions = await prisma.skillTestQuestion.findMany({
      where: { isActive: true, id: { in: Object.keys(answers) } },
    })

    if (questions.length === 0) throw createError(400, 'Jawaban tidak valid')

    // Score per field
    const fieldScores: Record<string, number> = {}

    for (const q of questions) {
      const chosenOptionId = answers[q.id]
      const optionsArray = (typeof q.options === 'string' ? JSON.parse(q.options) : q.options) as any[]
      const chosenOption = optionsArray.find(o => o.id === chosenOptionId)
      
      const field = chosenOption?.field
      if (field) {
        fieldScores[field] = (fieldScores[field] || 0) + 1
      }
    }

    // Convert to percentages based on max possible score per field
    // Max possible score for a field = number of questions that have an option for that field
    const fieldTotals: Record<string, number> = {}
    for (const q of questions) {
      const optionsArray = (typeof q.options === 'string' ? JSON.parse(q.options) : q.options) as any[]
      // Get unique fields available in this question
      const availableFields = new Set(optionsArray.map(o => o.field).filter(Boolean))
      for (const f of availableFields) {
        fieldTotals[f as string] = (fieldTotals[f as string] || 0) + 1
      }
    }

    const scores: Record<string, number> = {}
    for (const [field, maxScore] of Object.entries(fieldTotals)) {
      const earned = fieldScores[field] || 0
      scores[field] = maxScore > 0 ? Math.round((earned / maxScore) * 100) : 0
    }

    // Check for ties in the top score
    const sortedScores = Object.entries(scores).sort(([, a], [, b]) => b - a)
    const topScore = sortedScores[0]?.[1] || 0
    const topFields = sortedScores.filter(([, score]) => score === topScore).map(([f]) => f)
    
    // Default to the first one for now, but save all ties to skillTestResult
    const topField = topFields[0] || 'FRONTEND'

    // Save result + grant XP
    const xpEarned = await grantXp(userId, 'SKILL_TEST_COMPLETE', 'Skill Test selesai')

    await prisma.user.update({
      where: { id: userId },
      data: {
        skillTestDone: true,
        selectedField: topField as any,
        skillTestResult: scores as any,
      },
    })

    await updateBadge(userId)

    // Save detail answers for analytics - Model not created yet in Prisma schema
    // await prisma.skillTestSubmission.createMany({
    //   data: Object.entries(answers).map(([questionId, optionId]) => ({
    //     userId, questionId, selectedOptionId: optionId,
    //   })),
    //   skipDuplicates: true,
    // })

    res.json({
      success: true,
      data: { scores, topField, xpEarned, recommendation: topField, tiedFields: topFields.length > 1 ? topFields : null },
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

    const xpConfig = await prisma.xpConfig.findUnique({ where: { source: 'SKILL_TEST_COMPLETE' } })

    // Calculate ties if multiple fields have the same top score
    const scores = user.skillTestResult as Record<string, number>
    const sortedScores = Object.entries(scores).sort(([, a], [, b]) => b - a)
    const topScore = sortedScores[0]?.[1] || 0
    const topFields = sortedScores.filter(([, score]) => score === topScore).map(([f]) => f)

    res.json({
      success: true,
      data: {
        scores: user.skillTestResult,
        topField: user.selectedField,
        xpEarned: xpConfig?.amount || 50,
        recommendation: user.selectedField,
        tiedFields: topFields.length > 1 ? topFields : null,
      },
    })
  } catch (err) { next(err) }
})
