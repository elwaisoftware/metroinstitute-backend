import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getMessaging, Message } from 'firebase-admin/messaging'
import path from 'path'
import fs from 'fs'
import { prisma } from '../utils/prisma'

const serviceAccountPath = path.resolve(__dirname, '../../serviceAccountKey.json')

let isFirebaseInitialized = false

if (fs.existsSync(serviceAccountPath)) {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'))
    if (!getApps().length) {
      initializeApp({
        credential: cert(serviceAccount),
      })
      isFirebaseInitialized = true
      console.log('✅ Firebase Admin SDK initialized successfully.')
    } else {
      isFirebaseInitialized = true
    }
  } catch (err) {
    console.error('❌ Failed to initialize Firebase Admin SDK:', err)
  }
} else {
  console.warn('⚠️ serviceAccountKey.json not found. Push notifications will be disabled.')
}

/**
 * Send push notification directly to a specific FCM device token.
 */
export async function sendPushNotification(
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  if (!isFirebaseInitialized || !fcmToken) return null

  try {
    const message: Message = {
      notification: {
        title,
        body,
      },
      data: data || {},
      token: fcmToken,
    }

    const response = await getMessaging().send(message)
    return response
  } catch (err: any) {
    console.error('❌ Error sending FCM notification:', err.message || err)
    return null
  }
}

/**
 * Send push notification to a user by their user ID.
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true },
    })

    if (!user || !user.fcmToken) return null

    return await sendPushNotification(user.fcmToken, title, body, data)
  } catch (err) {
    console.error(`❌ Failed to send push to user ${userId}:`, err)
    return null
  }
}
