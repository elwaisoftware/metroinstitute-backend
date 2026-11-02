import { PrismaClient, BadgeLevel, XpSource, Field, Level, SessionType, ChallengeType } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting seed...')

  // ── Admin Account ─────────────────────────────────────────────
  const adminExists = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } })
  if (!adminExists) {
    await prisma.user.create({
      data: {
        name: 'Metro Institute',
        email: 'adminmetroinstitute@gmail.com',
        passwordHash: await bcrypt.hash('metinnih1', 12),
        role: 'SUPER_ADMIN',
        isEmailVerified: true,
        phone: '082000000001',
        badgeLevel: null,
      }
    })
    console.log('✅ Super Admin created')
  }

  // ── XP Config ─────────────────────────────────────────────────
  const xpConfigs = [
    { source: XpSource.SKILL_TEST_COMPLETE, amount: 50 },
    { source: XpSource.PROFILE_PHOTO_UPLOAD, amount: 20 },
    { source: XpSource.VIDEO_COMPLETE, amount: 5 },
    { source: XpSource.LIVE_ATTEND, amount: 20 },
    { source: XpSource.CHALLENGE_QUIZ_CORRECT, amount: 10 },
    { source: XpSource.ASSIGNMENT_ON_TIME, amount: 15 },
    { source: XpSource.ASSIGNMENT_GRADED, amount: 50 },
    { source: XpSource.STREAK_7, amount: 50 },
    { source: XpSource.STREAK_30, amount: 200 },
    { source: XpSource.STREAK_100, amount: 1000 },
    { source: XpSource.MANUAL_GRANT, amount: 0 },
  ]
  for (const cfg of xpConfigs) {
    await prisma.xpConfig.upsert({
      where: { source: cfg.source },
      update: { amount: cfg.amount },
      create: cfg,
    })
  }
  console.log('✅ XP Configs seeded')

  // ── Badge Config ───────────────────────────────────────────────
  const badgeConfigs = [
    { level: BadgeLevel.METRO_ROOKIE, minXp: 0 },
    { level: BadgeLevel.METRO_EXPLORER, minXp: 500 },
    { level: BadgeLevel.METRO_ACHIEVER, minXp: 2000 },
    { level: BadgeLevel.METRO_EXPERT, minXp: 5000 },
    { level: BadgeLevel.METRO_MASTER, minXp: 10000 },
  ]
  for (const cfg of badgeConfigs) {
    await prisma.badgeConfig.upsert({
      where: { level: cfg.level },
      update: { minXp: cfg.minXp },
      create: cfg,
    })
  }
  console.log('✅ Badge Configs seeded')

  // ── Skill Test Questions ───────────────────────────────────────
  const questions = [
    {
      question: 'Kamu sedang membuat aplikasi mobile. Kamu lebih tertarik mengerjakan bagian mana?',
      options: [
        { id: 'a', text: 'Menulis kode native untuk iOS atau Android', field: 'MOBILE' },
        { id: 'b', text: 'Membangun API dan sistem autentikasi', field: 'BACKEND' },
        { id: 'c', text: 'Mendesain tampilan dan animasi yang menarik', field: 'UI_UX' },
        { id: 'd', text: 'Membuat logika interaksi dan komponen UI', field: 'FRONTEND' },
      ],
      weights: { UI_UX: 4, FRONTEND: 3, BACKEND: 2, MOBILE: 5 },
    },
    {
      question: 'Ketika melihat sebuah website, hal pertama yang kamu perhatikan adalah?',
      options: [
        { id: 'a', text: 'Estetika visual dan konsistensi desain', field: 'UI_UX' },
        { id: 'b', text: 'Apakah ada versi mobile-nya', field: 'MOBILE' },
        { id: 'c', text: 'Keamanan dan struktur data', field: 'BACKEND' },
        { id: 'd', text: 'Kecepatan loading dan responsivitas', field: 'FRONTEND' },
      ],
      weights: { UI_UX: 4, FRONTEND: 3, BACKEND: 2, MOBILE: 1 },
    },
    {
      question: 'Kamu lebih suka pekerjaan yang melibatkan:',
      options: [
        { id: 'a', text: 'Flutter, Kotlin, atau Swift', field: 'MOBILE' },
        { id: 'b', text: 'HTML, CSS, JavaScript, dan framework React/Vue', field: 'FRONTEND' },
        { id: 'c', text: 'Database, REST API, dan arsitektur sistem', field: 'BACKEND' },
        { id: 'd', text: 'Riset pengguna, wireframe, dan prototype Figma', field: 'UI_UX' },
      ],
      weights: { UI_UX: 4, FRONTEND: 4, BACKEND: 4, MOBILE: 4 },
    },
    {
      question: 'Jika kamu harus menjelaskan cara kerja tombol \"Login\" di sebuah aplikasi, kamu akan fokus ke:',
      options: [
        { id: 'a', text: 'Bagaimana tombol itu terlihat dan terasa saat diklik', field: 'UI_UX' },
        { id: 'b', text: 'Bagaimana server memvalidasi email & password', field: 'BACKEND' },
        { id: 'c', text: 'Bagaimana fungsinya di Android vs iOS', field: 'MOBILE' },
        { id: 'd', text: 'Bagaimana DOM bereaksi dan state berubah', field: 'FRONTEND' },
      ],
      weights: { UI_UX: 3, FRONTEND: 3, BACKEND: 4, MOBILE: 2 },
    },
    {
      question: 'Skill apa yang paling ingin kamu kuasai dalam 6 bulan ke depan?',
      options: [
        { id: 'a', text: 'React, TypeScript, dan Next.js', field: 'FRONTEND' },
        { id: 'b', text: 'Figma, design system, dan user research', field: 'UI_UX' },
        { id: 'c', text: 'Flutter dan deployment ke Play Store/App Store', field: 'MOBILE' },
        { id: 'd', text: 'Node.js, PostgreSQL, dan sistem microservice', field: 'BACKEND' },
      ],
      weights: { UI_UX: 4, FRONTEND: 4, BACKEND: 4, MOBILE: 4 },
    },
    {
      question: 'Dalam sebuah tim, kamu paling nyaman berperan sebagai:',
      options: [
        { id: 'a', text: 'Orang yang memastikan aplikasi berjalan mulus di semua HP', field: 'MOBILE' },
        { id: 'b', text: 'Orang yang memastikan produk mudah dan enak dipakai', field: 'UI_UX' },
        { id: 'c', text: 'Orang yang mewujudkan desain menjadi kode yang hidup', field: 'FRONTEND' },
        { id: 'd', text: 'Orang yang memastikan sistem berjalan cepat dan aman', field: 'BACKEND' },
      ],
      weights: { UI_UX: 4, FRONTEND: 3, BACKEND: 3, MOBILE: 3 },
    },
    {
      question: 'Kamu menemukan bug di aplikasi: form data tidak tersimpan. Apa yang pertama kamu cek?',
      options: [
        { id: 'a', text: 'Apakah endpoint API dan validasi data sudah benar', field: 'BACKEND' },
        { id: 'b', text: 'Apakah event handler dan state management sudah benar', field: 'FRONTEND' },
        { id: 'c', text: 'Apakah ada perbedaan perilaku di Android vs iOS', field: 'MOBILE' },
        { id: 'd', text: 'Apakah tampilan form sudah jelas dan intuitif', field: 'UI_UX' },
      ],
      weights: { UI_UX: 1, FRONTEND: 3, BACKEND: 4, MOBILE: 2 },
    },
    {
      question: 'Proyek impianmu adalah:',
      options: [
        { id: 'a', text: 'Membangun website yang sangat interaktif dan performant', field: 'FRONTEND' },
        { id: 'b', text: 'Membuat aplikasi mobile yang diinstall jutaan pengguna', field: 'MOBILE' },
        { id: 'c', text: 'Membuat design system yang dipakai ratusan developer', field: 'UI_UX' },
        { id: 'd', text: 'Membangun backend yang bisa menangani jutaan request per hari', field: 'BACKEND' },
      ],
      weights: { UI_UX: 4, FRONTEND: 3, BACKEND: 4, MOBILE: 4 },
    },
    {
      question: 'Kamu lebih enjoy saat:',
      options: [
        { id: 'a', text: 'Melihat desain yang indah dan konsisten di setiap piksel', field: 'UI_UX' },
        { id: 'b', text: 'API yang kamu buat dipakai oleh banyak developer lain', field: 'BACKEND' },
        { id: 'c', text: 'Kode yang kamu tulis menghasilkan animasi yang smooth', field: 'FRONTEND' },
        { id: 'd', text: 'Aplikasi yang kamu buat berjalan mulus di semua perangkat', field: 'MOBILE' },
      ],
      weights: { UI_UX: 4, FRONTEND: 3, BACKEND: 3, MOBILE: 4 },
    },
    {
      question: 'Tools yang paling sering kamu gunakan atau ingin pelajari adalah:',
      options: [
        { id: 'a', text: 'Postman, DBeaver, atau terminal database', field: 'BACKEND' },
        { id: 'b', text: 'Figma, Miro, atau Adobe XD', field: 'UI_UX' },
        { id: 'c', text: 'VS Code dengan ekstensi React/Vue', field: 'FRONTEND' },
        { id: 'd', text: 'Android Studio atau Xcode', field: 'MOBILE' },
      ],
      weights: { UI_UX: 4, FRONTEND: 3, BACKEND: 4, MOBILE: 4 },
    },
    {
      question: 'Kamu paling tertarik membaca tentang:',
      options: [
        { id: 'a', text: 'Web performance, CSS tricks, dan framework terbaru', field: 'FRONTEND' },
        { id: 'b', text: 'Platform-specific API, gesture recognition, dan sensor HP', field: 'MOBILE' },
        { id: 'c', text: 'Database indexing, caching strategy, dan sistem distributed', field: 'BACKEND' },
        { id: 'd', text: 'Psikologi pengguna, accessibility, dan color theory', field: 'UI_UX' },
      ],
      weights: { UI_UX: 4, FRONTEND: 3, BACKEND: 4, MOBILE: 4 },
    },
    {
      question: 'Kata mana yang paling mendeskripsikan cara kerjamu?',
      options: [
        { id: 'a', text: 'Sistematis — membangun fondasi yang kuat dan scalable', field: 'BACKEND' },
        { id: 'b', text: 'Kreatif-teknis — menerjemahkan desain ke kode', field: 'FRONTEND' },
        { id: 'c', text: 'Empatik — selalu memikirkan perasaan pengguna', field: 'UI_UX' },
        { id: 'd', text: 'Portable — memastikan pengalaman terbaik di genggaman tangan', field: 'MOBILE' },
      ],
      weights: { UI_UX: 4, FRONTEND: 3, BACKEND: 4, MOBILE: 4 },
    },
  ]

  await prisma.skillTestQuestion.deleteMany()
  for (let i = 0; i < questions.length; i++) {
    await prisma.skillTestQuestion.create({
      data: {
        ...questions[i],
        orderIndex: i + 1,
        isActive: true,
      }
    })
  }
  console.log(`✅ ${questions.length} Skill Test Questions seeded`)

  console.log('\n🎉 Seed completed successfully!')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

