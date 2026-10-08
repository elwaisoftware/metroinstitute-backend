import { Router, Response, NextFunction } from 'express'
import { prisma } from '../utils/prisma'
import { authenticate, AuthRequest } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'

export const menteeRouter = Router()

// ── GET /mentee/bootcamps/:bootcampId/sessions/:sessionId ──
menteeRouter.get('/bootcamps/:bootcampId/sessions/:sessionId', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { bootcampId, sessionId } = req.params as Record<string, string>
    const userId = req.user!.id

    // Check enrollment
    const enrollment = await prisma.bootcampEnrollment.findUnique({
      where: { userId_bootcampId: { userId, bootcampId } }
    })
    if (!enrollment || !enrollment.isActive) {
      throw createError(403, 'Akses ditolak. Anda belum terdaftar di bootcamp ini.')
    }

    const session = await prisma.bootcampSession.findUnique({
      where: { id: sessionId },
      include: {
        assignments: {
          where: { userId },
          take: 1
        }
      }
    })

    if (!session) throw createError(404, 'Sesi tidak ditemukan')

    res.json({ success: true, data: session })
  } catch (err) { next(err) }
})

// ── POST /mentee/bootcamps/:bootcampId/sessions/:sessionId/assignments ──
menteeRouter.post('/bootcamps/:bootcampId/sessions/:sessionId/assignments', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { bootcampId, sessionId } = req.params as Record<string, string>
    const userId = req.user!.id
    const { fileUrl, linkUrl } = req.body

    // Check enrollment
    const enrollment = await prisma.bootcampEnrollment.findUnique({
      where: { userId_bootcampId: { userId, bootcampId } }
    })
    if (!enrollment || !enrollment.isActive) {
      throw createError(403, 'Akses ditolak.')
    }

    // Check if session is a challenge
    const session = await prisma.bootcampSession.findUnique({ where: { id: sessionId } })
    if (!session || session.type !== 'ASSIGNMENT') {
      throw createError(400, 'Sesi ini bukan merupakan tugas/challenge.')
    }

    // Upsert assignment (if they resubmit before graded)
    const existing = await prisma.assignment.findFirst({
      where: { userId, bootcampSessionId: sessionId }
    })

    if (existing && existing.gradedAt) {
      throw createError(400, 'Tugas sudah dinilai, tidak bisa dikumpulkan ulang.')
    }

    let assignment
    if (existing) {
      assignment = await prisma.assignment.update({
        where: { id: existing.id },
        data: { fileUrl, linkUrl, submittedAt: new Date() }
      })
    } else {
      assignment = await prisma.assignment.create({
        data: {
          userId,
          bootcampSessionId: sessionId,
          fileUrl,
          linkUrl
        }
      })
    }

    res.json({ success: true, data: assignment })
  } catch (err) { next(err) }
})
