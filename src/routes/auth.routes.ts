import { Router, Request, Response, NextFunction } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { createError } from '../middleware/errorHandler'
import { authenticate, AuthRequest } from '../middleware/auth.middleware'
import { sendEmail } from '../utils/email'
import crypto from 'crypto'

export const authRouter = Router()

// ── Helper: generate tokens ────────────────────────────────
function generateAccessToken(user: { id: string; email: string; role: string; name: string }) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m' }
  )
}

function generateRefreshToken(userId: string) {
  return jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  })
}

function setRefreshCookie(res: Response, token: string) {
  res.cookie('metro_refresh', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  })
}

// ── POST /auth/register ────────────────────────────────────
authRouter.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      name: z.string().min(2).max(80),
      email: z.string().email(),
      phone: z.string().min(10).regex(/^(08|62|\+62)/),
      password: z.string().min(8)
        .regex(/[A-Z]/, 'Harus ada huruf besar')
        .regex(/[a-z]/, 'Harus ada huruf kecil')
        .regex(/[0-9]/, 'Harus ada angka'),
    })
    const data = schema.parse(req.body)

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: data.email }, { phone: data.phone }] },
    })
    if (existing) throw createError(409, 'Email atau nomor WhatsApp sudah terdaftar')

    const passwordHash = await bcrypt.hash(data.password, 12)
    const user = await prisma.user.create({
      data: { ...data, passwordHash, password: undefined } as unknown as Parameters<typeof prisma.user.create>[0]['data'],
    })

    // Send verification email
    const verifyToken = crypto.randomBytes(32).toString('hex')
    await prisma.emailVerifyToken.create({
      data: {
        userId: user.id,
        token: verifyToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })
    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verifyToken}`
    await sendEmail({
      to: user.email,
      subject: '✅ Verifikasi Email Metro Institute',
      html: `
        <h2>Hei, ${user.name}! 👋</h2>
        <p>Klik tombol di bawah untuk verifikasi emailmu:</p>
        <a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#018556;color:white;border-radius:8px;text-decoration:none;font-weight:bold">
          Verifikasi Email
        </a>
        <p>Link berlaku 24 jam. Jika kamu tidak mendaftar, abaikan email ini.</p>
      `,
    })

    res.status(201).json({ success: true, message: 'Registrasi berhasil. Cek email untuk verifikasi.' })
  } catch (err) { next(err) }
})

// ── POST /auth/login ───────────────────────────────────────
authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    })
    const { email, password } = schema.parse(req.body)

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !user.passwordHash) throw createError(401, 'Email atau password salah')
    if (user.isSuspended) throw createError(403, 'Akun ini telah disuspend')

    const isValid = await bcrypt.compare(password, user.passwordHash)
    if (!isValid) throw createError(401, 'Email atau password salah')

    // Update streak
    await updateStreak(user.id)

    const accessToken = generateAccessToken(user)
    const refreshToken = generateRefreshToken(user.id)

    await prisma.userSession.create({
      data: {
        userId: user.id,
        refreshToken,
        deviceInfo: req.get('user-agent')?.slice(0, 200),
        ipAddress: req.ip,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    setRefreshCookie(res, refreshToken)

    const { passwordHash: _, ...safeUser } = user

    res.json({
      success: true,
      data: {
        accessToken,
        user: safeUser,
      },
    })
  } catch (err) { next(err) }
})

// ── POST /auth/refresh ─────────────────────────────────────
authRouter.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = req.cookies?.metro_refresh
    if (!refreshToken) throw createError(401, 'Refresh token tidak ada')

    let payload: { id: string }
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as { id: string }
    } catch {
      throw createError(401, 'Refresh token tidak valid')
    }

    const session = await prisma.userSession.findFirst({
      where: { refreshToken, isRevoked: false, expiresAt: { gt: new Date() } },
      include: { user: true },
    })
    if (!session) throw createError(401, 'Sesi tidak valid')
    if (session.user.isSuspended) throw createError(403, 'Akun disuspend')

    const accessToken = generateAccessToken(session.user)
    res.json({ success: true, data: { accessToken } })
  } catch (err) { next(err) }
})

// ── POST /auth/logout ──────────────────────────────────────
authRouter.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = req.cookies?.metro_refresh
    if (refreshToken) {
      await prisma.userSession.updateMany({
        where: { refreshToken },
        data: { isRevoked: true },
      })
    }
    res.clearCookie('metro_refresh')
    res.json({ success: true, message: 'Berhasil logout' })
  } catch (err) { next(err) }
})

// ── GET /auth/verify-email ─────────────────────────────────
authRouter.get('/verify-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = z.string().min(1).parse(req.query.token)

    const record = await prisma.emailVerifyToken.findUnique({ where: { token } })
    if (!record || record.expiresAt < new Date()) {
      throw createError(400, 'Link verifikasi tidak valid atau sudah kedaluwarsa')
    }

    await prisma.user.update({ where: { id: record.userId }, data: { isEmailVerified: true } })
    await prisma.emailVerifyToken.delete({ where: { token } })

    res.json({ success: true, message: 'Email berhasil diverifikasi' })
  } catch (err) { next(err) }
})

// ── POST /auth/resend-verify ───────────────────────────────
authRouter.post('/resend-verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body)
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || user.isEmailVerified) {
      return res.json({ success: true, message: 'Jika email terdaftar, link verifikasi akan dikirim' })
    }

    await prisma.emailVerifyToken.deleteMany({ where: { userId: user.id } })
    const token = crypto.randomBytes(32).toString('hex')
    await prisma.emailVerifyToken.create({
      data: { userId: user.id, token, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    })

    const url = `${process.env.FRONTEND_URL}/verify-email?token=${token}`
    await sendEmail({
      to: email,
      subject: '✅ Verifikasi Email Metro Institute',
      html: `<a href="${url}">Klik di sini untuk verifikasi email</a>`,
    })

    res.json({ success: true, message: 'Link verifikasi baru telah dikirim' })
  } catch (err) { next(err) }
})

// ── POST /auth/forgot-password ─────────────────────────────
authRouter.post('/forgot-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body)
    const user = await prisma.user.findUnique({ where: { email } })

    // Always respond same to prevent email enumeration
    if (user) {
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } })
      const token = crypto.randomBytes(32).toString('hex')
      await prisma.passwordResetToken.create({
        data: { userId: user.id, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      })
      const url = `${process.env.FRONTEND_URL}/reset-password?token=${token}`
      await sendEmail({
        to: email,
        subject: '🔐 Reset Password Metro Institute',
        html: `
          <h2>Reset Password</h2>
          <p>Klik tombol berikut untuk mereset password akun Metro Institute kamu:</p>
          <a href="${url}" style="display:inline-block;padding:12px 24px;background:#018556;color:white;border-radius:8px;text-decoration:none">Reset Password</a>
          <p>Link berlaku 1 jam. Jika kamu tidak meminta reset password, abaikan email ini.</p>
        `,
      })
    }

    res.json({ success: true, message: 'Jika email terdaftar, instruksi reset password telah dikirim' })
  } catch (err) { next(err) }
})

// ── POST /auth/reset-password ──────────────────────────────
authRouter.post('/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      token: z.string().min(1),
      password: z.string().min(8).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/),
    })
    const { token, password } = schema.parse(req.body)

    const record = await prisma.passwordResetToken.findUnique({ where: { token } })
    if (!record || record.expiresAt < new Date()) {
      throw createError(400, 'Link reset password tidak valid atau sudah kedaluwarsa')
    }

    const passwordHash = await bcrypt.hash(password, 12)
    await prisma.user.update({ where: { id: record.userId }, data: { passwordHash } })
    await prisma.passwordResetToken.delete({ where: { token } })
    // Revoke all sessions
    await prisma.userSession.updateMany({ where: { userId: record.userId }, data: { isRevoked: true } })

    res.json({ success: true, message: 'Password berhasil direset. Silakan login kembali.' })
  } catch (err) { next(err) }
})

// ── GET /auth/google ───────────────────────────────────────
authRouter.get('/google', (_req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
  })
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

// ── GET /auth/google/callback ──────────────────────────────
authRouter.get('/google/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.query
    if (!code) throw createError(400, 'Authorization code tidak ada')

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
        grant_type: 'authorization_code',
      }),
    })
    const tokens = await tokenRes.json()

    // Get user info
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const profile = await profileRes.json()

    if (!profile.email) throw createError(400, 'Tidak bisa mendapatkan email dari Google')

    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId: profile.id }, { email: profile.email }] },
    })

    if (!user) {
      user = await prisma.user.create({
        data: {
          name: profile.name,
          email: profile.email,
          googleId: profile.id,
          photoUrl: profile.picture,
          isEmailVerified: true,
        },
      })
    } else if (!user.googleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId: profile.id, photoUrl: user.photoUrl || profile.picture, isEmailVerified: true },
      })
    }

    if (user.isSuspended) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=suspended`)
    }

    await updateStreak(user.id)

    const accessToken = generateAccessToken(user)
    const refreshToken = generateRefreshToken(user.id)

    await prisma.userSession.create({
      data: {
        userId: user.id,
        refreshToken,
        deviceInfo: req.get('user-agent')?.slice(0, 200),
        ipAddress: req.ip,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    setRefreshCookie(res, refreshToken)

    const frontendUrl = process.env.FRONTEND_URL!
    const redirectUrl = user.skillTestDone
      ? `${frontendUrl}/mentee/basecamp?token=${accessToken}`
      : `${frontendUrl}/skill-test?token=${accessToken}`

    res.redirect(redirectUrl)
  } catch (err) { next(err) }
})

// ── Helper: Update Streak ──────────────────────────────────
async function updateStreak(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { lastActivityAt: true, currentStreak: true, longestStreak: true } })
  if (!user) return

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  if (user.lastActivityAt) {
    const lastDay = new Date(
      user.lastActivityAt.getFullYear(),
      user.lastActivityAt.getMonth(),
      user.lastActivityAt.getDate(),
    )
    const diffDays = Math.floor((today.getTime() - lastDay.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return // Already counted today
    if (diffDays === 1) {
      // Consecutive day
      const newStreak = user.currentStreak + 1
      const newLongest = Math.max(newStreak, user.longestStreak)
      await prisma.user.update({
        where: { id: userId },
        data: { currentStreak: newStreak, longestStreak: newLongest, lastActivityAt: now },
      })
      // Streak milestone rewards
      if ([7, 30, 100].includes(newStreak)) {
        const xpConfig = await prisma.xpConfig.findUnique({
          where: { source: newStreak === 7 ? 'STREAK_7' : newStreak === 30 ? 'STREAK_30' : 'STREAK_100' },
        })
        if (xpConfig) {
          await prisma.$transaction([
            prisma.xpLog.create({
              data: {
                userId,
                source: newStreak === 7 ? 'STREAK_7' : newStreak === 30 ? 'STREAK_30' : 'STREAK_100',
                amount: xpConfig.amount,
                note: `Streak ${newStreak} hari!`,
              },
            }),
            prisma.user.update({ where: { id: userId }, data: { totalXp: { increment: xpConfig.amount } } }),
          ])
        }
      }
    } else {
      // Streak broken
      await prisma.user.update({ where: { id: userId }, data: { currentStreak: 1, lastActivityAt: now } })
    }
  } else {
    // First activity
    await prisma.user.update({ where: { id: userId }, data: { currentStreak: 1, lastActivityAt: now } })
  }
}

// ── POST /auth/change-password ─────────────────────────────
authRouter.post('/change-password', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = z.object({
      currentPassword: z.string().min(1),
      newPassword:     z.string().min(8)
        .regex(/[A-Z]/, 'Harus ada huruf besar')
        .regex(/[a-z]/, 'Harus ada huruf kecil')
        .regex(/[0-9]/, 'Harus ada angka'),
    }).parse(req.body)

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!user) throw createError(404, 'User tidak ditemukan')

    // If user has a password, verify current one
    if (user.passwordHash) {
      const valid = await bcrypt.compare(currentPassword, user.passwordHash)
      if (!valid) throw createError(400, 'Password saat ini tidak sesuai')
    }

    const hashed = await bcrypt.hash(newPassword, 12)
    await prisma.user.update({
      where: { id: user.id },
      data:  { passwordHash: hashed },
    })

    res.json({ success: true, message: 'Password berhasil diubah' })
  } catch (err) { next(err) }
})
