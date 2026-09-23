import { Router, Response, NextFunction } from 'express'
import { prisma } from '../utils/prisma'
import { authenticate, AuthRequest } from '../middleware/auth.middleware'

export const leaderboardRouter = Router()

// Public leaderboard
leaderboardRouter.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { period = 'all-time', field, limit = 50 } = req.query
    const userId = req.user!.id

    let dateFilter: Date | undefined
    if (period === 'monthly') {
      dateFilter = new Date()
      dateFilter.setDate(1)
      dateFilter.setHours(0, 0, 0, 0)
    } else if (period === 'weekly') {
      dateFilter = new Date()
      dateFilter.setDate(dateFilter.getDate() - dateFilter.getDay())
      dateFilter.setHours(0, 0, 0, 0)
    }

    let entries: Array<{ userId: string; totalXp: number }>

    if (period === 'all-time') {
      // Use totalXp from users directly
      const users = await prisma.user.findMany({
        where: {
          role: 'MENTEE',
          isSuspended: false,
          ...(field ? { selectedField: field as any } : {}),
        },
        orderBy: { totalXp: 'desc' },
        take: Number(limit),
        select: {
          id: true, name: true, photoUrl: true, totalXp: true,
          badgeLevel: true, selectedField: true, currentStreak: true,
        },
      })
      const enriched = users.map((u, i) => ({ rank: i + 1, userId: u.id, ...u }))

      // My rank
      let myRank = enriched.find((e) => e.userId === userId)
      if (!myRank) {
        const myData = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, photoUrl: true, totalXp: true, badgeLevel: true, selectedField: true, currentStreak: true },
        })
        if (myData) {
          const rank = await prisma.user.count({
            where: { role: 'MENTEE', totalXp: { gt: myData.totalXp } },
          })
          myRank = { rank: rank + 1, userId: myData.id, ...myData }
        }
      }

      return res.json({ success: true, data: { entries: enriched, myRank } })
    }

    // Period-based: aggregate XP logs
    const xpAggregates = await prisma.xpLog.groupBy({
      by: ['userId'],
      where: {
        createdAt: { gte: dateFilter },
        user: {
          role: 'MENTEE',
          isSuspended: false,
          ...(field ? { selectedField: field as any } : {}),
        },
      },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: Number(limit),
    })

    const userIds = xpAggregates.map((a) => a.userId)
    const usersMap = new Map(
      (await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, photoUrl: true, badgeLevel: true, selectedField: true, currentStreak: true },
      })).map((u) => [u.id, u])
    )

    const enriched = xpAggregates.map((agg, i) => {
      const u = usersMap.get(agg.userId)!
      return {
        rank: i + 1, userId: agg.userId, name: u.name, photoUrl: u.photoUrl,
        totalXp: agg._sum.amount || 0, badgeLevel: u.badgeLevel,
        selectedField: u.selectedField, currentStreak: u.currentStreak,
      }
    })

    res.json({ success: true, data: { entries: enriched } })
  } catch (err) { next(err) }
})
