import axios from 'axios';
import { logger } from '../utils/logger';

/**
 * ─────────────────────────────────────────────────────────────
 * PROFESSIONAL WHATSAPP SERVICE
 * ─────────────────────────────────────────────────────────────
 * Menangani pengiriman pesan WhatsApp untuk OTP dan Broadcast Event.
 * Saat ini disiapkan kerangka untuk API eksternal (contoh: Fonnte/Wablas).
 */
export class WhatsAppService {
  private static API_URL = process.env.WA_API_URL || 'https://api.fonnte.com/send';
  private static API_KEY = process.env.FONNTE_API_KEY || process.env.WA_API_KEY || '';

  /**
   * Mengirimkan 6 digit OTP ke nomor user
   */
  public static async sendOTP(phone: string, otpCode: string): Promise<boolean> {
    if (!this.API_KEY) {
      logger.warn(`[WA_SIMULATION] OTP ${otpCode} dikirim ke ${phone}`);
      return true; // Return true in dev if API key is missing
    }

    try {
      const message = `*Metro Institute*\n\nKode OTP Anda adalah: *${otpCode}*\nJangan berikan kode ini kepada siapapun.\nKode berlaku selama 10 menit.`;
      await axios.post(
        this.API_URL,
        { target: phone, message },
        { headers: { Authorization: this.API_KEY } }
      );
      return true;
    } catch (error) {
      logger.error('Gagal mengirim WhatsApp OTP', error);
      return false;
    }
  }

  /**
   * Mengirimkan pesan broadcast event ke banyak nomor sekaligus
   */
  public static async sendBroadcast(phones: string[], message: string): Promise<boolean> {
    if (!this.API_KEY) {
      logger.warn(`[WA_SIMULATION] Broadcast dikirim ke ${phones.length} nomor: ${message}`);
      return true;
    }

    try {
      // Fonnte accepts comma-separated targets
      const target = phones.join(',');
      await axios.post(
        this.API_URL,
        { target, message },
        { headers: { Authorization: this.API_KEY } }
      );
      return true;
    } catch (error) {
      logger.error('Gagal mengirim WhatsApp Broadcast', error);
      return false;
    }
  }
}
