import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import { logger } from './utils/logger'
import { errorHandler } from './middleware/errorHandler'
import { authRouter } from './routes/auth.routes'
import { userRouter } from './routes/user.routes'
import { skillTestRouter } from './routes/skillTest.routes'
import { bootcampRouter } from './routes/bootcamp.routes'
import { courseRouter } from './routes/course.routes'
import { challengeRouter } from './routes/challenge.routes'
import { leaderboardRouter } from './routes/leaderboard.routes'
import { notificationRouter } from './routes/notification.routes'
import { certificateRouter } from './routes/certificate.routes'
import { transactionRouter } from './routes/transaction.routes'
import { wishlistRouter } from './routes/wishlist.routes'
import { searchRouter } from './routes/search.routes'
import { webhookRouter } from './routes/webhook.routes'
import { homepageRouter } from './routes/homepage.routes'
import { leadRouter } from './routes/lead.routes'
import { adminRouter } from './routes/admin.routes'
import { voucherRouter } from './routes/voucher.routes'
import { menteeRouter } from './routes/mentee.routes'

const app = express()
const PORT = process.env.PORT || 5000

// ── Security ───────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false,
}))
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'https://metroinstitute.site',
    'https://www.metroinstitute.site',
    'http://localhost:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// ── Rate Limiting ──────────────────────────────────────────
const globalLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { success: false, message: 'Terlalu banyak request, coba lagi dalam beberapa menit.' },
  standardHeaders: true,
  legacyHeaders: false,
})

const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Terlalu banyak percobaan login, coba lagi dalam 15 menit.' },
})

app.use(globalLimit)

// ── Body Parsing ───────────────────────────────────────────
// Webhook needs raw body BEFORE json parser
import path from 'path'
app.use('/api/v1/webhook', express.raw({ type: 'application/json' }))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(cookieParser())

// ── Static Files ───────────────────────────────────────────
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

// ── Request Logging ────────────────────────────────────────
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip, ua: req.get('user-agent')?.slice(0, 80) })
  next()
})

// ── Health Check ───────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: process.env.NODE_ENV })
})

// ── Routes ─────────────────────────────────────────────────
const PREFIX = '/api/v1'

app.use(`${PREFIX}/auth`, authLimit, authRouter)
app.use(`${PREFIX}/users`, userRouter)
app.use(`${PREFIX}/skill-test`, skillTestRouter)
app.use(`${PREFIX}/bootcamps`, bootcampRouter)
app.use(`${PREFIX}/courses`, courseRouter)
app.use(`${PREFIX}/challenges`, challengeRouter)
app.use(`${PREFIX}/leaderboard`, leaderboardRouter)
app.use(`${PREFIX}/notifications`, notificationRouter)
app.use(`${PREFIX}/certificates`, certificateRouter)
app.use(`${PREFIX}/transactions`, transactionRouter)
app.use(`${PREFIX}/wishlist`, wishlistRouter)
app.use(`${PREFIX}/search`, searchRouter)
app.use(`${PREFIX}/webhook`, webhookRouter)
app.use(`${PREFIX}/homepage`, homepageRouter)
app.use(`${PREFIX}/leads`, leadRouter)
app.use(`${PREFIX}/admin`, adminRouter)
app.use(`${PREFIX}/voucher`, voucherRouter)
app.use(`${PREFIX}/mentee`, menteeRouter)

// ── 404 ────────────────────────────────────────────────────
app.use((req: import('express').Request, res: import('express').Response) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.originalUrl} tidak ditemukan` })
})

// ── Error Handler ──────────────────────────────────────────
app.use(errorHandler)

// ── Start ──────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`Metro Institute Backend berjalan di http://localhost:${PORT}`)
  logger.info(`Environment: ${process.env.NODE_ENV}`)
})

export default app
