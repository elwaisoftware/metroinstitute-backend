import { prisma } from './prisma'

export async function updateStreak(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastActivityAt: true, currentStreak: true, longestStreak: true },
  })
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
      // Consecutive day (hari berturut-turut)
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
      // Streak broken (terlewat lebih dari 1 hari)
      await prisma.user.update({ where: { id: userId }, data: { currentStreak: 1, lastActivityAt: now } })
    }
  } else {
    // First activity
    await prisma.user.update({ where: { id: userId }, data: { currentStreak: 1, lastActivityAt: now } })
  }
}
