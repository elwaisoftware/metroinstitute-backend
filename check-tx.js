
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.transaction.findMany({ orderBy: { createdAt: 'desc' }, take: 1 }).then(txs => {
  console.log(txs);
  return prisma.bootcampEnrollment.findMany({ orderBy: { createdAt: 'desc' }, take: 1 });
}).then(en => {
  console.log('Enrollment:', en);
  prisma.$disconnect();
});

