import { prisma } from './prisma'
import { XpSource } from '@prisma/client'
import { logger } from './logger'

/**
 * Grant XP to a user from a specific source.
 * Reads amount from xp_configs table — never hardcoded.
 * Returns actual XP granted.
 */
export async function grantXp(userId: string, source: XpSource, note?: string, customAmount?: number): Promise<number> {
  try {
    let amount = customAmount
    if (amount === undefined) {
      const config = await prisma.xpConfig.findUnique({ where: { source } })
      if (!config) return 0
      amount = config.amount
    }

    if (amount <= 0) return 0

    await prisma.$transaction([
      prisma.xpLog.create({ data: { userId, source, amount, note } }),
      prisma.user.update({ where: { id: userId }, data: { totalXp: { increment: amount } } }),
    ])

    return amount
  } catch (err) {
    logger.error('Failed to grant XP', { userId, source, error: err })
    return 0
  }
}
