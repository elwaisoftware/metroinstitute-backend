import { Router, Response, NextFunction } from 'express'
import multer from 'multer'
import { v2 as cloudinary } from 'cloudinary'
import path from 'path'
import fsOriginal from 'fs'
import { prisma } from '../utils/prisma'
import { authenticate, AuthRequest } from '../middleware/auth.middleware'
import { createError } from '../middleware/errorHandler'

export const menteeRouter = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB max
})

// ── POST /mentee/upload (Upload File Tugas: PDF, ZIP, Gambar, Dokumen) ──
menteeRouter.post('/upload', authenticate, upload.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) throw createError(400, 'File tidak ditemukan')

    try {
      const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'metro-institute/mentee-assignments', resource_type: 'auto' },
          (err, resData) => (err ? reject(err) : resolve(resData as { secure_url: string }))
        )
        stream.end(req.file!.buffer)
      })
      if (result?.secure_url) {
        return res.json({
          success: true,
          url: result.secure_url,
          fileName: req.file.originalname,
        })
      }
    } catch (cloudErr) {
      console.warn('Cloudinary assignment upload fallback:', cloudErr)
    }

    const uploadsDir = path.join(process.cwd(), 'uploads')
    if (!fsOriginal.existsSync(uploadsDir)) {
      fsOriginal.mkdirSync(uploadsDir, { recursive: true })
    }
    const safeExt = path.extname(req.file.originalname) || '.pdf'
    const filename = `tugas-${Date.now()}-${Math.random().toString(36).substring(2, 9)}${safeExt}`
    const filepath = path.join(uploadsDir, filename)
    fsOriginal.writeFileSync(filepath, req.file.buffer)

    const host = req.get('host') || 'localhost:5000'
    const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
    const fileUrl = `${protocol}://${host}/uploads/${filename}`

    res.json({
      success: true,
      url: fileUrl,
      fileName: req.file.originalname,
    })
  } catch (err) {
    next(err)
  }
})

// ── GET /mentee/bootcamps/:bootcampId/sessions/:sessionId ──
menteeRouter.get('/bootcamps/:bootcampId/sessions/:sessionId', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { bootcampId, sessionId } = req.params as Record<string, string>
    const userId = req.user!.id

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

    const cleanFileUrl = typeof fileUrl === 'string' && fileUrl.trim() ? fileUrl.trim() : null
    const cleanLinkUrl = typeof linkUrl === 'string' && linkUrl.trim() ? linkUrl.trim() : null

    if (!cleanFileUrl && !cleanLinkUrl) {
      throw createError(400, 'Harap masukkan tautan tugas atau unggah file tugas.')
    }

    // Check enrollment
    const enrollment = await prisma.bootcampEnrollment.findUnique({
      where: { userId_bootcampId: { userId, bootcampId } }
    })
    if (!enrollment || !enrollment.isActive) {
      throw createError(403, 'Akses ditolak.')
    }

    // Check if session exists and is an assignment/challenge
    const session = await prisma.bootcampSession.findUnique({ where: { id: sessionId } })
    if (!session || (session.type !== 'ASSIGNMENT' && session.type !== 'QUIZ')) {
      throw createError(400, 'Sesi ini bukan merupakan sesi tugas/challenge.')
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
        data: {
          fileUrl: cleanFileUrl !== null ? cleanFileUrl : existing.fileUrl,
          linkUrl: cleanLinkUrl !== null ? cleanLinkUrl : existing.linkUrl,
          submittedAt: new Date()
        }
      })
    } else {
      assignment = await prisma.assignment.create({
        data: {
          userId,
          bootcampSessionId: sessionId,
          fileUrl: cleanFileUrl,
          linkUrl: cleanLinkUrl
        }
      })
    }

    res.json({ success: true, data: assignment })
  } catch (err) { next(err) }
})
