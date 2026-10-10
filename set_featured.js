const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  await prisma.bootcamp.updateMany({ data: { isFeatured: true } });
  console.log('Updated bootcamps to be featured!');
}
main().finally(() => prisma.$disconnect());
