const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await prisma.transaction.updateMany({
    where: { status: 'PENDING', createdAt: { lt: twentyFourHoursAgo } },
    data: { status: 'CANCELLED' }
  });
  console.log('Updated:', result.count);
}
main().catch(console.error).finally(() => prisma.$disconnect());
