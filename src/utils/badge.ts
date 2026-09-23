import { prisma } from './prisma'
import { BadgeLevel } from '@prisma/client'
import { logger } from './logger'

/**
 * Check if user's badge level should be upgraded based on XP.
 * Reads thresholds from badge_configs — never hardcoded.
 */
export async function updateBadge(userId: string): Promise<BadgeLevel | null> {
  try {
    const [user, configs] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { totalXp: true, badgeLevel: true } }),
      prisma.badgeConfig.findMany({ orderBy: { minXp: 'desc' } }),
    ])
    if (!user) return null

    // Find highest badge the user qualifies for
    const newBadge = configs.find((c) => user.totalXp >= c.minXp)?.level
    if (!newBadge || newBadge === user.badgeLevel) return null

    await prisma.user.update({ where: { id: userId }, data: { badgeLevel: newBadge } })

    // Send notification
    await prisma.notification.create({
      data: {
        userId,
        type: 'BADGE_UPGRADE',
        title: '🏅 Badge Baru!',
        body: `Selamat! Kamu telah mencapai badge ${newBadge.replace(/_/g, ' ')}.`,
        data: { badgeLevel: newBadge },
      },
    })

    return newBadge
  } catch (err) {
    logger.error('Failed to update badge', { userId, error: err })
    return null
  }
}
