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

  // ── Bootcamp Seed ──────────────────────────────────────────────
  const bootcamp = await prisma.bootcamp.upsert({
    where: { id: 'bootcamp-season-2' },
    update: {},
    create: {
      id: 'bootcamp-season-2',
      title: 'Metro Institute Bootcamp Season 2',
      shortDescription: 'Program intensif 3 bulan untuk menguasai skill digital dari nol hingga siap kerja.',
      description: 'Program intensif 3 bulan untuk menguasai skill digital dari nol hingga siap kerja. Dibimbing langsung oleh mentor berpengalaman dengan kurikulum yang terstruktur dan project-based learning. Kamu akan mengerjakan proyek nyata yang bisa langsung masuk portfolio.',
      field: Field.FRONTEND,
      level: Level.BEGINNER,
      price: 299000,
      thumbnailUrl: null,
      quota: 50,
      totalDuration: 72 * 3600,  // 72 jam
      tags: ['Frontend', 'React', 'Next.js', 'Portfolio'],
      outcomes: [
        'Menguasai HTML, CSS, dan JavaScript modern',
        'Membangun aplikasi React dan Next.js',
        'Memahami konsep TypeScript',
        'Membuat portfolio proyek nyata',
        'Siap melamar kerja sebagai frontend developer',
      ],
      batchStatus: 'OPEN',
      registrationDeadline: new Date('2026-10-14T23:59:59Z'),
      batchStartDate: new Date('2026-10-20T00:00:00Z'),
      batchEndDate: new Date('2027-01-20T23:59:59Z'),
      mentorName: 'Andika Pratama',
      mentorBio: 'Senior Frontend Engineer dengan 7 tahun pengalaman di startup tech. Ex-Tokopedia.',
      isPublished: true,
      enrollmentCount: 12,
    }
  })

  // Bootcamp chapters & sessions
  const bootcampChapter1 = await prisma.bootcampChapter.upsert({
    where: { id: 'bc-ch1' },
    update: {},
    create: {
      id: 'bc-ch1',
      bootcampId: bootcamp.id,
      title: 'Orientasi & Perkenalan',
      orderIndex: 1,
    }
  })

  await prisma.bootcampSession.upsert({
    where: { id: 'bc-s1' },
    update: {},
    create: {
      id: 'bc-s1',
      chapterId: bootcampChapter1.id,
      title: 'Selamat Datang di Metro Institute Season 2',
      type: SessionType.VIDEO,
      videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4',
      videoDuration: 480,
      isFreePreview: true,
      orderIndex: 1,
      xpReward: 5,
    }
  })

  await prisma.bootcampSession.upsert({
    where: { id: 'bc-s2' },
    update: {},
    create: {
      id: 'bc-s2',
      chapterId: bootcampChapter1.id,
      title: 'Sesi Live Perdana — Kick-Off Bootcamp',
      type: SessionType.LIVE,
      liveUrl: 'https://zoom.us/j/example',
      liveScheduledAt: new Date('2026-10-20T09:00:00Z'),
      attendanceWindowMin: 30,
      orderIndex: 2,
      xpReward: 20,
    }
  })

  const bootcampChapter2 = await prisma.bootcampChapter.upsert({
    where: { id: 'bc-ch2' },
    update: {},
    create: {
      id: 'bc-ch2',
      bootcampId: bootcamp.id,
      title: 'Fondasi Digital Skills',
      orderIndex: 2,
    }
  })

  await prisma.bootcampSession.upsert({
    where: { id: 'bc-s3' },
    update: {},
    create: {
      id: 'bc-s3',
      chapterId: bootcampChapter2.id,
      title: 'Cara Belajar Efektif di Era Digital',
      type: SessionType.VIDEO,
      videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4',
      videoDuration: 720,
      orderIndex: 1,
      xpReward: 5,
    }
  })

  await prisma.bootcampSession.upsert({
    where: { id: 'bc-s4' },
    update: {},
    create: {
      id: 'bc-s4',
      chapterId: bootcampChapter2.id,
      title: 'Project: Buat Learning Plan Pribadimu',
      type: SessionType.ASSIGNMENT,
      assignmentDescription: 'Buat dokumen learning plan berisi: target skill yang ingin dikuasai, timeline belajar 3 bulan, dan sumber belajar yang akan digunakan. Format: PDF atau Notion link.',
      assignmentDeadline: new Date('2026-10-27T23:59:59Z'),
      orderIndex: 2,
      xpReward: 15,
    }
  })
  console.log('✅ Bootcamp seeded')

  // ── Mini Course Seed ───────────────────────────────────────────
  const courses = [
    {
      id: 'course-uiux-101',
      title: 'UI/UX Design Fundamentals',
      shortDescription: 'Pelajari dasar-dasar desain UI/UX dari nol dengan Figma.',
      description: 'Kursus komprehensif untuk pemula yang ingin berkarir di bidang UI/UX Design. Mulai dari teori dasar, user research, wireframing, hingga membuat prototype interaktif di Figma.',
      field: Field.UI_UX,
      level: Level.BEGINNER,
      price: 149000,
      accessDays: 90,
      tags: ['figma', 'ui', 'ux', 'design', 'beginner'],
      sessions: [
        { title: 'Pengenalan UI/UX Design', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 600, isFree: true },
        { title: 'Prinsip Dasar Desain Visual', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 900 },
        { title: 'Mengenal User Research', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 750 },
        { title: 'Membuat Wireframe di Figma', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 1200 },
        { title: 'Color Theory & Typography', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 840 },
        { title: 'Project: Desain Landing Page', isAssignment: true, deadline: 30 },
      ]
    },
    {
      id: 'course-fe-101',
      title: 'Frontend Web Development Starter',
      shortDescription: 'Kuasai HTML, CSS, dan JavaScript dasar untuk web modern.',
      description: 'Mulai perjalanan sebagai Frontend Developer dengan mempelajari HTML semantik, CSS modern (Flexbox & Grid), JavaScript ES6+, dan membangun project nyata dari awal.',
      field: Field.FRONTEND,
      level: Level.BEGINNER,
      price: 149000,
      accessDays: 90,
      tags: ['html', 'css', 'javascript', 'frontend', 'beginner'],
      sessions: [
        { title: 'HTML Semantik & Struktur Halaman', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 720, isFree: true },
        { title: 'CSS Dasar & Selector', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 960 },
        { title: 'Flexbox & CSS Grid', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 1080 },
        { title: 'JavaScript: Variabel, Fungsi & DOM', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 1200 },
        { title: 'Responsive Design & Media Queries', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 840 },
        { title: 'Project: Buat Landing Page Responsif', isAssignment: true, deadline: 30 },
      ]
    },
    {
      id: 'course-be-101',
      title: 'Backend Development dengan Node.js',
      shortDescription: 'Bangun REST API profesional menggunakan Node.js dan Express.',
      description: 'Kursus backend development untuk pemula yang ingin membangun server-side application. Belajar Node.js, Express, REST API design, dan integrasi database PostgreSQL.',
      field: Field.BACKEND,
      level: Level.BEGINNER,
      price: 179000,
      accessDays: 90,
      tags: ['nodejs', 'express', 'api', 'backend', 'postgresql'],
      sessions: [
        { title: 'Pengenalan Node.js & NPM', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 660, isFree: true },
        { title: 'Express.js: Route & Middleware', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 1020 },
        { title: 'REST API Design Principles', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 900 },
        { title: 'Koneksi ke PostgreSQL dengan Prisma', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 1200 },
        { title: 'Autentikasi dengan JWT', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 960 },
        { title: 'Project: Buat REST API Todo App', isAssignment: true, deadline: 30 },
      ]
    },
    {
      id: 'course-mobile-101',
      title: 'Flutter Mobile Development Pemula',
      shortDescription: 'Buat aplikasi Android & iOS pertamamu dengan Flutter.',
      description: 'Pelajari Flutter dari dasar: Dart language, widget system, state management, hingga deploy ke Play Store. Cocok untuk pemula yang ingin membangun mobile app cross-platform.',
      field: Field.MOBILE,
      level: Level.BEGINNER,
      price: 179000,
      accessDays: 90,
      tags: ['flutter', 'dart', 'mobile', 'android', 'ios'],
      sessions: [
        { title: 'Pengenalan Flutter & Dart', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 720, isFree: true },
        { title: 'Widget Dasar Flutter', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 1080 },
        { title: 'Layout & Navigation', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 960 },
        { title: 'State Management dengan Provider', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 1200 },
        { title: 'HTTP Request & API Integration', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 900 },
        { title: 'Project: Buat App Cuaca Sederhana', isAssignment: true, deadline: 30 },
      ]
    },
    {
      id: 'course-uiux-201',
      title: 'Advanced Figma & Design System',
      shortDescription: 'Bangun design system profesional dan komponen Figma yang reusable.',
      description: 'Untuk desainer yang sudah familiar dengan Figma. Pelajari cara membangun design system yang scalable, auto layout tingkat lanjut, component variants, dan dokumentasi design.',
      field: Field.UI_UX,
      level: Level.INTERMEDIATE,
      price: 229000,
      accessDays: 120,
      tags: ['figma', 'design-system', 'advanced', 'component', 'ui'],
      sessions: [
        { title: 'Design Token & Variable Figma', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 840, isFree: true },
        { title: 'Component Variants & Interaction', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 1200 },
        { title: 'Auto Layout Tingkat Lanjut', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 960 },
        { title: 'Membangun UI Kit yang Scalable', videoUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', duration: 1320 },
        { title: 'Project: Buat Design System Lengkap', isAssignment: true, deadline: 45 },
      ]
    },
  ]

  for (const courseData of courses) {
    const { sessions, ...courseInfo } = courseData
    const course = await prisma.miniCourse.upsert({
      where: { id: courseInfo.id },
      update: {},
      create: {
        ...courseInfo,
        isPublished: true,
        rating: Number((3.8 + Math.random() * 1.2).toFixed(1)),
        reviewCount: Math.floor(Math.random() * 50) + 10,
        enrollmentCount: Math.floor(Math.random() * 100) + 20,
        totalDuration: sessions.reduce((acc, s) => acc + (s.duration || 0), 0),
      }
    })

    const chapter = await prisma.courseChapter.upsert({
      where: { id: `${courseInfo.id}-ch1` },
      update: {},
      create: {
        id: `${courseInfo.id}-ch1`,
        courseId: course.id,
        title: 'Materi Utama',
        orderIndex: 1,
      }
    })

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i]
      await prisma.courseSession.upsert({
        where: { id: `${courseInfo.id}-s${i + 1}` },
        update: {},
        create: {
          id: `${courseInfo.id}-s${i + 1}`,
          chapterId: chapter.id,
          title: s.title,
          type: s.isAssignment ? SessionType.ASSIGNMENT : SessionType.VIDEO,
          videoUrl: s.videoUrl,
          videoDuration: s.duration,
          isFreePreview: s.isFree || false,
          orderIndex: i + 1,
          xpReward: s.isAssignment ? 15 : 5,
          assignmentDescription: s.isAssignment ? `Kerjakan project sesuai instruksi. Kumpulkan dalam format PDF atau link GitHub.` : null,
          assignmentDeadline: s.isAssignment && s.deadline
            ? new Date(Date.now() + s.deadline * 24 * 60 * 60 * 1000)
            : null,
        }
      })
    }
  }
  console.log('✅ Mini Courses seeded')

  // ── Challenge Bank Seed ────────────────────────────────────────
  const challenges = [
    {
      id: 'ch-uiux-b1',
      title: 'Prinsip Gestalt dalam Desain',
      description: 'Manakah prinsip Gestalt yang menjelaskan bahwa mata manusia cenderung melihat elemen-elemen yang berdekatan sebagai satu kelompok?',
      type: ChallengeType.QUIZ,
      field: Field.UI_UX,
      level: Level.BEGINNER,
      xpReward: 10,
      options: [
        { id: 'a', text: 'Similarity', isCorrect: false, explanation: 'Similarity adalah kecenderungan melihat elemen yang mirip sebagai satu kelompok.' },
        { id: 'b', text: 'Proximity', isCorrect: true, explanation: 'Proximity (kedekatan) adalah prinsip yang menyatakan elemen yang berdekatan dianggap satu kelompok.' },
        { id: 'c', text: 'Continuity', isCorrect: false, explanation: 'Continuity adalah kecenderungan mata mengikuti garis atau pola.' },
        { id: 'd', text: 'Closure', isCorrect: false, explanation: 'Closure adalah kecenderungan otak melengkapi bentuk yang tidak sempurna.' },
      ],
    },
    {
      id: 'ch-uiux-b2',
      title: 'Perbedaan UI dan UX',
      description: 'Seorang desainer fokus pada bagaimana pengguna berinteraksi dan merasakan produk secara keseluruhan. Ini termasuk riset pengguna, user journey, dan usability testing. Peran apa yang lebih tepat?',
      type: ChallengeType.QUIZ,
      field: Field.UI_UX,
      level: Level.BEGINNER,
      xpReward: 10,
      options: [
        { id: 'a', text: 'UI Designer', isCorrect: false, explanation: 'UI Designer fokus pada tampilan visual: warna, tipografi, komponen.' },
        { id: 'b', text: 'Graphic Designer', isCorrect: false, explanation: 'Graphic Designer fokus pada visual branding dan komunikasi visual.' },
        { id: 'c', text: 'UX Designer', isCorrect: true, explanation: 'UX Designer fokus pada pengalaman pengguna secara holistik: riset, alur, dan usability.' },
        { id: 'd', text: 'Product Manager', isCorrect: false, explanation: 'Product Manager fokus pada strategi produk dan roadmap.' },
      ],
    },
    {
      id: 'ch-fe-b1',
      title: 'CSS Flexbox Direction',
      description: 'Properti CSS apa yang digunakan untuk mengubah arah utama flex container dari horizontal (baris) menjadi vertikal (kolom)?',
      type: ChallengeType.QUIZ,
      field: Field.FRONTEND,
      level: Level.BEGINNER,
      xpReward: 10,
      options: [
        { id: 'a', text: 'flex-wrap: wrap', isCorrect: false, explanation: 'flex-wrap mengatur apakah item melanjutkan ke baris baru.' },
        { id: 'b', text: 'flex-direction: column', isCorrect: true, explanation: 'flex-direction: column mengubah sumbu utama menjadi vertikal.' },
        { id: 'c', text: 'align-items: column', isCorrect: false, explanation: 'align-items bukan properti arah, ini untuk alignment di sumbu silang.' },
        { id: 'd', text: 'justify-content: column', isCorrect: false, explanation: 'justify-content bukan properti arah, ini untuk distribusi di sumbu utama.' },
      ],
    },
    {
      id: 'ch-fe-b2',
      title: 'HTML Semantic Element',
      description: 'Elemen HTML mana yang paling tepat untuk menampung konten navigasi utama sebuah website?',
      type: ChallengeType.QUIZ,
      field: Field.FRONTEND,
      level: Level.BEGINNER,
      xpReward: 10,
      options: [
        { id: 'a', text: '<div class="nav">', isCorrect: false, explanation: 'div adalah elemen non-semantik, tidak memberikan makna pada konten.' },
        { id: 'b', text: '<header>', isCorrect: false, explanation: 'header berisi bagian atas halaman, bukan khusus untuk navigasi.' },
        { id: 'c', text: '<nav>', isCorrect: true, explanation: '<nav> adalah elemen semantik khusus untuk konten navigasi.' },
        { id: 'd', text: '<menu>', isCorrect: false, explanation: '<menu> adalah elemen usang dan tidak direkomendasikan untuk navigasi utama.' },
      ],
    },
    {
      id: 'ch-be-b1',
      title: 'HTTP Method yang Tepat',
      description: 'Kamu ingin membuat endpoint API untuk memperbarui sebagian data (partial update) sebuah profil pengguna. HTTP method apa yang paling tepat?',
      type: ChallengeType.QUIZ,
      field: Field.BACKEND,
      level: Level.BEGINNER,
      xpReward: 10,
      options: [
        { id: 'a', text: 'POST', isCorrect: false, explanation: 'POST biasanya untuk membuat resource baru.' },
        { id: 'b', text: 'PUT', isCorrect: false, explanation: 'PUT untuk mengganti keseluruhan resource (full update).' },
        { id: 'c', text: 'PATCH', isCorrect: true, explanation: 'PATCH untuk memperbarui sebagian field dari resource yang sudah ada.' },
        { id: 'd', text: 'DELETE', isCorrect: false, explanation: 'DELETE untuk menghapus resource.' },
      ],
    },
    {
      id: 'ch-be-b2',
      title: 'HTTP Status Code',
      description: 'API kamu menerima request dengan data yang tidak valid (misalnya format email salah). Status code HTTP apa yang paling tepat dikembalikan?',
      type: ChallengeType.QUIZ,
      field: Field.BACKEND,
      level: Level.BEGINNER,
      xpReward: 10,
      options: [
        { id: 'a', text: '200 OK', isCorrect: false, explanation: '200 menandakan request berhasil.' },
        { id: 'b', text: '401 Unauthorized', isCorrect: false, explanation: '401 untuk request yang memerlukan autentikasi.' },
        { id: 'c', text: '500 Internal Server Error', isCorrect: false, explanation: '500 untuk error di sisi server.' },
        { id: 'd', text: '400 Bad Request', isCorrect: true, explanation: '400 menandakan request dari client tidak valid/salah format.' },
      ],
    },
    {
      id: 'ch-mobile-b1',
      title: 'Widget Flutter: Stateless vs Stateful',
      description: 'Kamu membangun widget tombol yang berubah warna setiap kali diklik. Widget Flutter apa yang paling tepat digunakan?',
      type: ChallengeType.QUIZ,
      field: Field.MOBILE,
      level: Level.BEGINNER,
      xpReward: 10,
      options: [
        { id: 'a', text: 'StatelessWidget', isCorrect: false, explanation: 'StatelessWidget tidak dapat menyimpan atau mengubah state internal.' },
        { id: 'b', text: 'StatefulWidget', isCorrect: true, explanation: 'StatefulWidget memiliki State object yang dapat berubah dan memicu rebuild.' },
        { id: 'c', text: 'InheritedWidget', isCorrect: false, explanation: 'InheritedWidget untuk berbagi data ke widget di bawahnya, bukan untuk state lokal.' },
        { id: 'd', text: 'Container Widget', isCorrect: false, explanation: 'Container adalah layout widget, bukan tipe widget berdasarkan state.' },
      ],
    },
    {
      id: 'ch-uiux-i1',
      title: 'Contrast Ratio Accessibility',
      description: 'Menurut standar WCAG 2.1 level AA, berapakah minimum contrast ratio yang diperlukan antara teks normal dan background-nya?',
      type: ChallengeType.QUIZ,
      field: Field.UI_UX,
      level: Level.INTERMEDIATE,
      xpReward: 25,
      options: [
        { id: 'a', text: '3:1', isCorrect: false, explanation: '3:1 adalah minimum untuk teks besar (18pt+) di WCAG AA.' },
        { id: 'b', text: '4.5:1', isCorrect: true, explanation: 'WCAG 2.1 level AA mensyaratkan contrast ratio minimal 4.5:1 untuk teks normal.' },
        { id: 'c', text: '7:1', isCorrect: false, explanation: '7:1 adalah standar WCAG AAA (level yang lebih ketat).' },
        { id: 'd', text: '2:1', isCorrect: false, explanation: '2:1 di bawah standar minimum accessibility.' },
      ],
    },
    {
      id: 'ch-fe-i1',
      title: 'React: Memo & Re-render',
      description: 'Komponen React anak akan re-render setiap kali komponen induk re-render, bahkan jika props tidak berubah. Cara apa yang paling tepat untuk mencegah ini?',
      type: ChallengeType.QUIZ,
      field: Field.FRONTEND,
      level: Level.INTERMEDIATE,
      xpReward: 25,
      options: [
        { id: 'a', text: 'useEffect dengan dependency array kosong', isCorrect: false, explanation: 'useEffect untuk side effects, bukan untuk mencegah re-render.' },
        { id: 'b', text: 'React.memo()', isCorrect: true, explanation: 'React.memo() membungkus komponen dan mencegah re-render jika props tidak berubah.' },
        { id: 'c', text: 'useState', isCorrect: false, explanation: 'useState untuk mengelola state lokal, bukan optimasi re-render.' },
        { id: 'd', text: 'useRef', isCorrect: false, explanation: 'useRef untuk menyimpan referensi tanpa trigger re-render, bukan untuk mencegah re-render anak.' },
      ],
    },
    {
      id: 'ch-be-i1',
      title: 'Database Indexing',
      description: 'Di tabel users dengan 1 juta baris, kamu sering menjalankan query: SELECT * FROM users WHERE email = ?. Optimasi apa yang paling tepat?',
      type: ChallengeType.QUIZ,
      field: Field.BACKEND,
      level: Level.INTERMEDIATE,
      xpReward: 25,
      options: [
        { id: 'a', text: 'Tambahkan INDEX pada kolom email', isCorrect: true, explanation: 'Index pada kolom yang sering di-query WHERE akan drastis mempercepat lookup.' },
        { id: 'b', text: 'Gunakan SELECT email, id bukan SELECT *', isCorrect: false, explanation: 'Ini optimasi minor, tapi bukan solusi utama untuk performa query filtering.' },
        { id: 'c', text: 'Pindahkan ke Redis', isCorrect: false, explanation: 'Redis untuk caching, bukan solusi indexing database.' },
        { id: 'd', text: 'Tambahkan lebih banyak RAM ke server', isCorrect: false, explanation: 'Ini solusi infrastruktur, bukan optimasi query.' },
      ],
    },
  ]

  for (const ch of challenges) {
    await prisma.challenge.upsert({
      where: { id: ch.id },
      update: {},
      create: ch,
    })
  }
  console.log(`✅ ${challenges.length} Challenges seeded`)

  // ── Homepage Config ────────────────────────────────────────────
  const homepageConfigs = [
    { key: 'HERO_TITLE', value: 'BUILD SKILLS. BUILD PORTFOLIO. BUILD YOUR CAREER.' },
    { key: 'HERO_SUBTITLE', value: 'Platform digital skills terlengkap untuk UI/UX, Frontend, Backend, dan Mobile Development.' },
    { key: 'EBOOK_TITLE', value: 'Roadmap UI/UX Design dari Nol — 2026 Edition' },
    { key: 'EBOOK_URL', value: 'https://drive.google.com/example-ebook' },
    { key: 'DISCORD_LINK', value: 'https://discord.gg/metroinstitute' },
  ]
  for (const cfg of homepageConfigs) {
    await prisma.homepageConfig.upsert({
      where: { key: cfg.key },
      update: { value: cfg.value },
      create: cfg,
    })
  }
  console.log('✅ Homepage Config seeded')

  // ── Certificate Config ─────────────────────────────────────────
  await prisma.certificateConfig.upsert({
    where: { productType: 'BOOTCAMP' },
    update: {},
    create: {
      productType: 'BOOTCAMP',
      minProgressPct: 100,
      minAssignScore: 70,
      minAttendancePct: 80,
      minXp: 200,
    }
  })
  await prisma.certificateConfig.upsert({
    where: { productType: 'MINI_COURSE' },
    update: {},
    create: {
      productType: 'MINI_COURSE',
      minProgressPct: 100,
      minAssignScore: 70,
      minXp: 0,
    }
  })
  console.log('✅ Certificate Config seeded')

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
