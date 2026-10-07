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
        { id: 'a', text: 'Mendesain tampilan dan animasi yang menarik' },
        { id: 'b', text: 'Membuat logika interaksi dan komponen UI' },
        { id: 'c', text: 'Membangun API dan sistem autentikasi' },
        { id: 'd', text: 'Menulis kode native untuk iOS atau Android' },
      ],
      weights: { UI_UX: 4, FRONTEND: 2, BACKEND: 0, MOBILE: 2 },
    },
    {
      question: 'Ketika melihat sebuah website, hal pertama yang kamu perhatikan adalah?',
      options: [
        { id: 'a', text: 'Estetika visual dan konsistensi desain' },
        { id: 'b', text: 'Kecepatan loading dan responsivitas' },
        { id: 'c', text: 'Keamanan dan struktur data' },
        { id: 'd', text: 'Apakah ada versi mobile-nya' },
      ],
      weights: { UI_UX: 4, FRONTEND: 3, BACKEND: 2, MOBILE: 1 },
    },
    {
      question: 'Kamu lebih suka pekerjaan yang melibatkan:',
      options: [
        { id: 'a', text: 'Riset pengguna, wireframe, dan prototype Figma' },
        { id: 'b', text: 'HTML, CSS, JavaScript, dan framework React/Vue' },
        { id: 'c', text: 'Database, REST API, dan arsitektur sistem' },
        { id: 'd', text: 'Flutter, Kotlin, atau Swift' },
      ],
      weights: { UI_UX: 4, FRONTEND: 4, BACKEND: 4, MOBILE: 4 },
    },
    {
      question: 'Jika kamu harus menjelaskan cara kerja tombol "Login" di sebuah aplikasi, kamu akan fokus ke:',
      options: [
        { id: 'a', text: 'Bagaimana tombol itu terlihat dan terasa saat diklik' },
        { id: 'b', text: 'Bagaimana DOM bereaksi dan state berubah' },
        { id: 'c', text: 'Bagaimana server memvalidasi email & password' },
        { id: 'd', text: 'Bagaimana fungsinya di Android vs iOS' },
      ],
      weights: { UI_UX: 3, FRONTEND: 3, BACKEND: 4, MOBILE: 2 },
    },
    {
      question: 'Skill apa yang paling ingin kamu kuasai dalam 6 bulan ke depan?',
      options: [
        { id: 'a', text: 'Figma, design system, dan user research' },
        { id: 'b', text: 'React, TypeScript, dan Next.js' },
        { id: 'c', text: 'Node.js, PostgreSQL, dan sistem microservice' },
        { id: 'd', text: 'Flutter dan deployment ke Play Store/App Store' },
      ],
      weights: { UI_UX: 4, FRONTEND: 4, BACKEND: 4, MOBILE: 4 },
    },
    {
      question: 'Dalam sebuah tim, kamu paling nyaman berperan sebagai:',
      options: [
        { id: 'a', text: 'Orang yang memastikan produk mudah dan enak dipakai' },
        { id: 'b', text: 'Orang yang mewujudkan desain menjadi kode yang hidup' },
        { id: 'c', text: 'Orang yang memastikan sistem berjalan cepat dan aman' },
        { id: 'd', text: 'Orang yang memastikan aplikasi berjalan mulus di semua HP' },
      ],
      weights: { UI_UX: 4, FRONTEND: 3, BACKEND: 3, MOBILE: 3 },
    },
    {
      question: 'Kamu menemukan bug di aplikasi: form data tidak tersimpan. Apa yang pertama kamu cek?',
      options: [
        { id: 'a', text: 'Apakah tampilan form sudah jelas dan intuitif' },
        { id: 'b', text: 'Apakah event handler dan state management sudah benar' },
        { id: 'c', text: 'Apakah endpoint API dan validasi data sudah benar' },
        { id: 'd', text: 'Apakah ada perbedaan perilaku di Android vs iOS' },
      ],
      weights: { UI_UX: 1, FRONTEND: 3, BACKEND: 4, MOBILE: 2 },
    },
    {
      question: 'Proyek impianmu adalah:',
      options: [
        { id: 'a', text: 'Membuat design system yang dipakai ratusan developer' },
        { id: 'b', text: 'Membangun website yang sangat interaktif dan performant' },
        { id: 'c', text: 'Membangun backend yang bisa menangani jutaan request per hari' },
        { id: 'd', text: 'Membuat aplikasi mobile yang diinstall jutaan pengguna' },
      ],
      weights: { UI_UX: 4, FRONTEND: 3, BACKEND: 4, MOBILE: 4 },
    },
    {
      question: 'Kamu lebih enjoy saat:',
      options: [
        { id: 'a', text: 'Melihat desain yang indah dan konsisten di setiap piksel' },
        { id: 'b', text: 'Kode yang kamu tulis menghasilkan animasi yang smooth' },
        { id: 'c', text: 'API yang kamu buat dipakai oleh banyak developer lain' },
        { id: 'd', text: 'Aplikasi yang kamu buat berjalan mulus di semua perangkat' },
      ],
      weights: { UI_UX: 4, FRONTEND: 3, BACKEND: 3, MOBILE: 4 },
    },
    {
      question: 'Tools yang paling sering kamu gunakan atau ingin pelajari adalah:',
      options: [
        { id: 'a', text: 'Figma, Miro, atau Adobe XD' },
        { id: 'b', text: 'VS Code dengan ekstensi React/Vue' },
        { id: 'c', text: 'Postman, DBeaver, atau terminal database' },
        { id: 'd', text: 'Android Studio atau Xcode' },
      ],
      weights: { UI_UX: 4, FRONTEND: 3, BACKEND: 4, MOBILE: 4 },
    },
    {
      question: 'Kamu paling tertarik membaca tentang:',
      options: [
        { id: 'a', text: 'Psikologi pengguna, accessibility, dan color theory' },
        { id: 'b', text: 'Web performance, CSS tricks, dan framework terbaru' },
        { id: 'c', text: 'Database indexing, caching strategy, dan sistem distributed' },
        { id: 'd', text: 'Platform-specific API, gesture recognition, dan sensor HP' },
      ],
      weights: { UI_UX: 4, FRONTEND: 3, BACKEND: 4, MOBILE: 4 },
    },
    {
      question: 'Kata mana yang paling mendeskripsikan cara kerjamu?',
      options: [
        { id: 'a', text: 'Empatik — selalu memikirkan perasaan pengguna' },
        { id: 'b', text: 'Kreatif-teknis — menerjemahkan desain ke kode' },
        { id: 'c', text: 'Sistematis — membangun fondasi yang kuat dan scalable' },
        { id: 'd', text: 'Portable — memastikan pengalaman terbaik di genggaman tangan' },
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

