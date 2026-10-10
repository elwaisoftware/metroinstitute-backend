const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const bootcamps = await prisma.bootcamp.findMany({
    where: { isPublished: true, isFeatured: true },
    take: 4,
    select: {
      id: true, title: true, field: true, price: true,
      thumbnailUrl: true, batchStatus: true, rating: true, mentorName: true, shortDescription: true,
      outcomes: true,
    },
  });
  console.log(bootcamps);
}
main().finally(() => prisma.$disconnect());
