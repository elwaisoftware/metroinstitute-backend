import { Resend } from 'resend'
import { logger } from './logger'

// Inisialisasi Resend API dengan kunci dari .env
// Jika belum ada RESEND_API_KEY, ini akan undefined tapi tidak akan error sampai kita mengirim email
const resend = new Resend(process.env.RESEND_API_KEY)

interface EmailOptions {
  to: string
  subject: string
  html: string
  text?: string
}

export async function sendEmail({ to, subject, html, text }: EmailOptions) {
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Metro Institute <no-reply@metroinstitute.site>',
      to: [to],
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ''),
    })

    if (error) {
      logger.error(`Resend API Error for ${to}:`, error)
      return
    }

    logger.info(`Email sent via Resend to ${to} (ID: ${data?.id})`)
  } catch (err) {
    logger.error('Failed to send email via Resend', { to, subject, error: err })
  }
}
