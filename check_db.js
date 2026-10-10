const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const bootcamps = await prisma.bootcamp.findMany({
    select: {
      id: true,
      title: true,
      batchStatus: true,
      registrationStartDate: true,
      registrationDeadline: true,
      batchStartDate: true,
    }
  });
  console.log(bootcamps);
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
