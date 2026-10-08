import cron from 'node-cron';
import { prisma } from './prisma';
import { WhatsAppService } from '../services/whatsapp.service';
import { logger } from './logger';

export const startCronJobs = () => {
  logger.info('Starting cron jobs...');

  // Jalankan setiap hari jam 08:00 pagi (WIB)
  // node-cron pakai format: minute hour day month dayOfWeek
  // Waktu bergantung pada zona waktu server. Pastikan server set ke Asia/Jakarta atau sesuaikan.
  cron.schedule('0 8 * * *', async () => {
    logger.info('[CRON] Running H-1 Live Session Reminders...');
    try {
      // 1. Cari tanggal besok dari jam 00:00 sampai 23:59
      const tomorrowStart = new Date();
      tomorrowStart.setDate(tomorrowStart.getDate() + 1);
      tomorrowStart.setHours(0, 0, 0, 0);

      const tomorrowEnd = new Date(tomorrowStart);
      tomorrowEnd.setHours(23, 59, 59, 999);

      // 2. Temukan semua sesi live besok
      const upcomingSessions = await prisma.bootcampSession.findMany({
        where: {
          type: 'LIVE',
          liveScheduledAt: {
            gte: tomorrowStart,
            lte: tomorrowEnd
          }
        },
        include: {
          chapter: {
            include: {
              bootcamp: true
            }
          }
        }
      });

      if (upcomingSessions.length === 0) {
        logger.info('[CRON] No upcoming live sessions for tomorrow.');
        return;
      }

      // 3. Proses tiap sesi
      for (const session of upcomingSessions) {
        const bootcamp = session.chapter.bootcamp;
        
        // Dapatkan semua mentee yang enroll di bootcamp ini
        const enrollments = await prisma.bootcampEnrollment.findMany({
          where: { bootcampId: bootcamp.id, isActive: true },
          include: {
            user: true
          }
        });

        const phones = enrollments
          .map(e => e.user.phone)
          .filter(p => !!p) as string[];

        if (phones.length === 0) continue;

        // Siapkan pesan
        const platformLink = `${process.env.FRONTEND_URL || 'https://metroinstitute.site'}/mentee/bootcamp/${bootcamp.id}/live/${session.id}`;
        const meetLink = session.liveUrl ? `\nAtau gabung via Meet/Zoom: ${session.liveUrl}` : '';
        const timeFormat = session.liveScheduledAt ? session.liveScheduledAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) : 'Segera';

        const message = `*REMINDER LIVE CLASS BESOK! 🚀*\n\nHalo Mentee,\nBesok akan ada Live Session untuk Bootcamp *${bootcamp.title}*.\n\n*Topik:* ${session.title}\n*Pukul:* ${timeFormat} WIB\n\nSilakan bergabung melalui platform kami:\n🔗 ${platformLink}\n${meetLink}\n\nJangan sampai terlewat ya!\n\n_Salam hangat,_ \n_Metro Institute_`;

        // Kirim broadcast
        await WhatsAppService.sendBroadcast(phones, message);
        logger.info(`[CRON] Sent WA reminder for session ${session.id} to ${phones.length} mentees.`);
      }

    } catch (error) {
      logger.error('[CRON] Failed to send H-1 reminders', error);
    }
  });
};
