import nodemailer from 'nodemailer'
import { logger } from './logger'

const port = Number(process.env.SMTP_PORT) || 587

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: port,
  secure: port === 465, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

interface EmailOptions {
  to: string
  subject: string
  html: string
  text?: string
}

export async function sendEmail({ to, subject, html, text }: EmailOptions) {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ''),
    })
    logger.info(`Email sent to ${to}: ${subject}`)
  } catch (err) {
    logger.error('Failed to send email', { to, subject, error: err })
    // Don't throw — email failure shouldn't break main flow
  }
}
