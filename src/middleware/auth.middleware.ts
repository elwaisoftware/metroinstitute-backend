import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../utils/prisma'
import { createError } from './errorHandler'

export interface AuthRequest extends Request {
  user?: {
    id: string
    email: string
    role: 'MENTEE' | 'SUPER_ADMIN'
    name: string
  }
}

export function authenticate(req: AuthRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return next(createError(401, 'Token autentikasi diperlukan'))
  }

  const token = authHeader.slice(7)
  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as {
      id: string; email: string; role: 'MENTEE' | 'SUPER_ADMIN'; name: string
    }
    req.user = payload
    next()
  } catch {
    next(createError(401, 'Token tidak valid atau sudah kedaluwarsa'))
  }
}

export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return next()

  const token = authHeader.slice(7)
  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as {
      id: string; email: string; role: 'MENTEE' | 'SUPER_ADMIN'; name: string
    }
    req.user = payload
  } catch {}
  next()
}

export function requireAdmin(req: AuthRequest, _res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'SUPER_ADMIN') {
    return next(createError(403, 'Akses ditolak — hanya Super Admin'))
  }
  next()
}

export function requireMentee(req: AuthRequest, _res: Response, next: NextFunction) {
  if (!req.user) return next(createError(401, 'Login diperlukan'))
  next()
}
