const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.bootcamp.update({
    where: { id: 'cmuzebgl3000164pz3yatz9kv' },
    data: { registrationDeadline: new Date('2026-10-09') } // past date
  });
  console.log(result);
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
