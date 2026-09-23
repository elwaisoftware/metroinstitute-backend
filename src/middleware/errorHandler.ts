import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: 'Validasi gagal',
      errors: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    })
  }

  // Prisma unique constraint
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const field = (err.meta?.target as string[])?.join(', ') || 'field'
      return res.status(409).json({
        success: false,
        message: `${field} sudah terdaftar`,
      })
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Data tidak ditemukan' })
    }
  }

  // Known HTTP errors (thrown with { status, message })
  if (err instanceof Error && 'status' in err) {
    const e = err as Error & { status: number }
    return res.status(e.status).json({ success: false, message: e.message })
  }

  // Unknown
  logger.error('Unhandled error', { error: err, path: req.path, method: req.method })
  return res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Terjadi kesalahan server' : String(err),
  })
}

// Helper to create HTTP errors
export function createError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number }
  err.status = status
  return err
}
