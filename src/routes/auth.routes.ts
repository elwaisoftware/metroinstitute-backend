import { Router, Request, Response, NextFunction } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { createError } from '../middleware/errorHandler'
import { authenticate, AuthRequest } from '../middleware/auth.middleware'
import { sendEmail } from '../utils/email'
import { WhatsAppService } from '../services/whatsapp.service'
import crypto from 'crypto'

export const authRouter = Router()

// ── Helper: generate tokens ────────────────────────────────
function generateAccessToken(user: { id: string; email: string; role: string; name: string }) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_ACCESS_SECRET as string,
    { expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || '15m') as any }
  )
}

function generateRefreshToken(userId: string) {
  return jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET as string, {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '30d') as any,
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
      password: z.string()
        .min(8, 'Password minimal 8 karakter, mengandung huruf kapital, huruf kecil, dan angka')
        .regex(/[A-Z]/, 'Password minimal 8 karakter, mengandung huruf kapital, huruf kecil, dan angka')
        .regex(/[a-z]/, 'Password minimal 8 karakter, mengandung huruf kapital, huruf kecil, dan angka')
        .regex(/[0-9]/, 'Password minimal 8 karakter, mengandung huruf kapital, huruf kecil, dan angka'),
    })
    const data = schema.parse(req.body)

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: data.email }, { phone: data.phone }] },
    })
    
    if (existing) {
      if (existing.isEmailVerified) {
        throw createError(409, 'Email atau nomor WhatsApp sudah terdaftar')
      } else {
        // Hapus data lama yang belum terverifikasi agar bisa ditimpa
        await prisma.user.deleteMany({
          where: {
            OR: [{ email: data.email }, { phone: data.phone }],
            isEmailVerified: false
          }
        })
      }
    }

    const passwordHash = await bcrypt.hash(data.password, 12)
    const user = await prisma.user.create({
      data: { ...data, passwordHash, password: undefined } as unknown as Parameters<typeof prisma.user.create>[0]['data'],
    })

    // Kirim OTP verifikasi email (6-digit)
    const verifyOtp = Math.floor(100000 + Math.random() * 900000).toString()
    await prisma.otpCode.deleteMany({ where: { userId: user.id, purpose: 'EMAIL_VERIFICATION' } })
    await prisma.otpCode.create({
      data: {
        userId: user.id,
        code: verifyOtp,
        purpose: 'EMAIL_VERIFICATION',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })
    sendEmail({
      to: user.email,
      subject: '✅ Kode OTP Verifikasi Email - Metro Institute',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 20px; background-color: #ffffff; color: #333333;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="font-size: 24px; font-weight: 700; color: #111827; margin: 0;">Metro Institute</h1>
          </div>
          <div style="background-color: #fafafa; border: 1px solid #eaeaea; border-radius: 12px; padding: 40px 32px; text-align: center;">
            <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin-top: 0; margin-bottom: 16px;">Verifikasi Email Kamu</h2>
            <p style="font-size: 16px; line-height: 24px; color: #4b5563; margin-top: 0; margin-bottom: 32px;">
              Halo <strong>${user.name}</strong>,<br>
              Gunakan kode OTP berikut untuk menyelesaikan proses pendaftaran.
            </p>
            <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px 20px 20px 32px; margin-bottom: 32px; display: inline-block;">
              <span style="font-size: 32px; font-weight: 700; letter-spacing: 12px; color: #059669;">${verifyOtp}</span>
            </div>
            <p style="font-size: 14px; color: #6b7280; margin: 0;">
              Kode ini berlaku selama 24 jam.<br>
              Jika kamu tidak merasa mendaftar di Metro Institute, silakan abaikan email ini.
            </p>
          </div>
          <div style="text-align: center; margin-top: 32px;">
            <p style="font-size: 12px; color: #9ca3af; margin: 0;">
              &copy; ${new Date().getFullYear()} Metro Institute. All rights reserved.
            </p>
          </div>
        </div>
      `,
    }).catch(e => console.error('Background email failed:', e))

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
    if (!user || !user.passwordHash) throw createError(401, 'Username atau Password Salah')
    if (user.isSuspended) throw createError(403, 'Akun ini telah disuspend')

    const isValid = await bcrypt.compare(password, user.passwordHash)
    if (!isValid) throw createError(401, 'Username atau Password Salah')

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

// ── POST /auth/verify-email ────────────────────────────────
authRouter.post('/verify-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, code } = z.object({ email: z.string().email(), code: z.string().length(6) }).parse(req.body)

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) throw createError(404, 'User tidak ditemukan')

    const record = await prisma.otpCode.findFirst({
      where: { userId: user.id, code, purpose: 'EMAIL_VERIFICATION', expiresAt: { gt: new Date() } }
    })
    if (!record) throw createError(400, 'Kode OTP salah atau sudah kedaluwarsa')

    await prisma.user.update({ where: { id: user.id }, data: { isEmailVerified: true } })
    await prisma.otpCode.deleteMany({ where: { userId: user.id, purpose: 'EMAIL_VERIFICATION' } })

    res.json({ success: true, message: 'Email berhasil diverifikasi' })
  } catch (err) { next(err) }
})

// ── POST /auth/resend-verify ───────────────────────────────
authRouter.post('/resend-verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body)
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || user.isEmailVerified) {
      return res.json({ success: true, message: 'Jika email terdaftar, kode OTP verifikasi akan dikirim' })
    }

    const newOtp = Math.floor(100000 + Math.random() * 900000).toString()
    await prisma.otpCode.deleteMany({ where: { userId: user.id, purpose: 'EMAIL_VERIFICATION' } })
    await prisma.otpCode.create({
      data: { userId: user.id, code: newOtp, purpose: 'EMAIL_VERIFICATION', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    })

    sendEmail({
      to: email,
      subject: '✅ Kode OTP Verifikasi Email - Metro Institute',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 20px; background-color: #ffffff; color: #333333;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="font-size: 24px; font-weight: 700; color: #111827; margin: 0;">Metro Institute</h1>
          </div>
          <div style="background-color: #fafafa; border: 1px solid #eaeaea; border-radius: 12px; padding: 40px 32px; text-align: center;">
            <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin-top: 0; margin-bottom: 16px;">Verifikasi Email Kamu</h2>
            <p style="font-size: 16px; line-height: 24px; color: #4b5563; margin-top: 0; margin-bottom: 32px;">
              Halo <strong>${user.name}</strong>,<br>
              Gunakan kode OTP berikut untuk memverifikasi email kamu.
            </p>
            <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px 20px 20px 32px; margin-bottom: 32px; display: inline-block;">
              <span style="font-size: 32px; font-weight: 700; letter-spacing: 12px; color: #059669;">${newOtp}</span>
            </div>
            <p style="font-size: 14px; color: #6b7280; margin: 0;">
              Kode ini berlaku selama 24 jam.<br>
              Jika kamu tidak meminta kode verifikasi ini, silakan abaikan email ini.
            </p>
          </div>
          <div style="text-align: center; margin-top: 32px;">
            <p style="font-size: 12px; color: #9ca3af; margin: 0;">
              &copy; ${new Date().getFullYear()} Metro Institute. All rights reserved.
            </p>
          </div>
        </div>
      `,
    }).catch(e => console.error('Background email failed:', e))

    res.json({ success: true, message: 'Kode OTP verifikasi baru telah dikirim' })
  } catch (err) { next(err) }
})

// ── POST /auth/forgot-password ─────────────────────────────
authRouter.post('/forgot-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body)
    const user = await prisma.user.findUnique({ where: { email } })

    // Always respond same to prevent email enumeration
    if (user) {
      const otp = Math.floor(100000 + Math.random() * 900000).toString()
      await prisma.otpCode.deleteMany({ where: { userId: user.id, purpose: 'PASSWORD_RESET' } })
      await prisma.otpCode.create({
        data: { userId: user.id, code: otp, purpose: 'PASSWORD_RESET', expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      })
      await sendEmail({
        to: email,
        subject: '🔐 Kode OTP Reset Password - Metro Institute',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 20px; background-color: #ffffff; color: #333333;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="font-size: 24px; font-weight: 700; color: #111827; margin: 0;">Metro Institute</h1>
            </div>
            <div style="background-color: #fafafa; border: 1px solid #eaeaea; border-radius: 12px; padding: 40px 32px; text-align: center;">
              <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin-top: 0; margin-bottom: 16px;">Reset Password</h2>
              <p style="font-size: 16px; line-height: 24px; color: #4b5563; margin-top: 0; margin-bottom: 32px;">
                Halo <strong>${user.name}</strong>,<br>
                Gunakan kode OTP berikut untuk mengatur ulang password kamu.
              </p>
              <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px 20px 20px 32px; margin-bottom: 32px; display: inline-block;">
                <span style="font-size: 32px; font-weight: 700; letter-spacing: 12px; color: #059669;">${otp}</span>
              </div>
              <p style="font-size: 14px; color: #6b7280; margin: 0;">
                Kode ini berlaku selama 1 jam.<br>
                Jika kamu tidak meminta reset password, silakan abaikan email ini dan pastikan akun kamu aman.
              </p>
            </div>
            <div style="text-align: center; margin-top: 32px;">
              <p style="font-size: 12px; color: #9ca3af; margin: 0;">
                &copy; ${new Date().getFullYear()} Metro Institute. All rights reserved.
              </p>
            </div>
          </div>
        `,
      })
    }

    res.json({ success: true, message: 'Jika email terdaftar, kode OTP reset password telah dikirim' })
  } catch (err) { next(err) }
})

// ── POST /auth/reset-password ──────────────────────────────
authRouter.post('/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      code: z.string().length(6),
      password: z.string().min(8).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/),
    })
    const { email, code, password } = schema.parse(req.body)

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) throw createError(404, 'User tidak ditemukan')

    const record = await prisma.otpCode.findFirst({
      where: { userId: user.id, code, purpose: 'PASSWORD_RESET', expiresAt: { gt: new Date() } }
    })
    if (!record) throw createError(400, 'Kode OTP salah atau sudah kedaluwarsa')

    const passwordHash = await bcrypt.hash(password, 12)
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } })
    await prisma.otpCode.deleteMany({ where: { userId: user.id, purpose: 'PASSWORD_RESET' } })
    await prisma.userSession.updateMany({ where: { userId: user.id }, data: { isRevoked: true } })

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
    const { code } = req.query as Record<string, string>
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
    const tokens = await tokenRes.json() as any

    // Get user info
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const profile = await profileRes.json() as any

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
    const redirectUrl = `${frontendUrl}/callback?token=${accessToken}`

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


// ── POST /auth/google/mobile (OMNICHANNEL MOBILE OAUTH) ──────
authRouter.post('/google/mobile', async (req, res, next) => {
  try {
    const { idToken } = req.body;
    if (!idToken) throw createError(400, 'ID Token Google wajib dikirim');

    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
    const profile = await googleRes.json() as { email?: string; sub?: string; name?: string; picture?: string };

    if (!googleRes.ok || !profile.email) {
      throw createError(401, 'ID Token Google tidak valid atau kedaluwarsa');
    }

    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId: profile.sub }, { email: profile.email }] },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: profile.email,
          name: profile.name || 'Mentee Baru',
          googleId: profile.sub,
          photoUrl: profile.picture,
          isEmailVerified: true,
        },
      });
    } else if (!user.googleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId: profile.sub, photoUrl: user.photoUrl || profile.picture, isEmailVerified: true },
      });
    }

    if (user.isSuspended) throw createError(403, 'Akun ini telah disuspend');

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user.id);

    await prisma.userSession.upsert({
      where: { refreshToken },
      update: { expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      create: { userId: user.id, refreshToken, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000, 
    });
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, 
    });

    res.json({
      success: true,
      message: 'Login Google Mobile berhasil',
      data: {
        accessToken,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, photoUrl: user.photoUrl },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /auth/request-otp ────────────────────────────────

authRouter.post('/request-otp', async (req, res, next) => {
  try {
    const { phone, purpose } = req.body;
    if (!phone || !purpose) throw createError(400, 'Nomor HP dan purpose wajib diisi');

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) throw createError(404, 'User dengan nomor HP tersebut tidak ditemukan');

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await prisma.otpCode.create({
      data: {
        userId: user.id,
        code: otp,
        purpose: purpose, // 'PASSWORD_RESET' atau 'PHONE_VERIFICATION'
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 menit
      }
    });

    // Kirim via WA API
    await WhatsAppService.sendOTP(phone, otp);

    res.json({ success: true, message: 'OTP berhasil dikirim ke WhatsApp Anda' });
  } catch (err) { next(err) }
});

// ── POST /auth/verify-otp ─────────────────────────────────
authRouter.post('/verify-otp', async (req, res, next) => {
  try {
    const { phone, code, purpose, newPassword } = req.body;
    if (!phone || !code || !purpose) throw createError(400, 'Data tidak lengkap');

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) throw createError(404, 'User tidak ditemukan');

    const validOtp = await prisma.otpCode.findFirst({
      where: { userId: user.id, code, purpose, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' }
    });

    if (!validOtp) throw createError(400, 'OTP salah atau sudah kedaluwarsa');

    // Jika purpose adalah PASSWORD_RESET
    if (purpose === 'PASSWORD_RESET' && newPassword) {
      const hashed = await bcrypt.hash(newPassword, 12);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hashed }
      });
    } else if (purpose === 'PHONE_VERIFICATION') {
      // Implementasi verifikasi nomor
    }

    // Hapus OTP setelah sukses
    await prisma.otpCode.deleteMany({ where: { userId: user.id, purpose } });

    res.json({ success: true, message: 'Verifikasi OTP berhasil' });
  } catch (err) { next(err) }
});
