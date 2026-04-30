/**
 * Firebase Admin SDK init for the API server.
 *
 * Local dev can use GOOGLE_APPLICATION_CREDENTIALS pointing to a service
 * account JSON file. Hosted environments like Vercel should use either
 * FIREBASE_SERVICE_ACCOUNT_KEY (raw JSON or base64 JSON) or the split
 * FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY vars.
 */

import {
  initializeApp,
  applicationDefault,
  cert,
  getApps,
  type ServiceAccount,
} from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

function serviceAccountFromJson(raw: string): ServiceAccount {
  const trimmed = raw.trim()
  const json = trimmed.startsWith('{')
    ? trimmed
    : Buffer.from(trimmed, 'base64').toString('utf8')
  const parsed = JSON.parse(json) as {
    project_id?: string
    client_email?: string
    private_key?: string
    projectId?: string
    clientEmail?: string
    privateKey?: string
  }

  return {
    projectId: parsed.projectId ?? parsed.project_id,
    clientEmail: parsed.clientEmail ?? parsed.client_email,
    privateKey: (parsed.privateKey ?? parsed.private_key)?.replace(/\\n/g, '\n'),
  }
}

function serviceAccountFromEnv(): ServiceAccount | null {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      return serviceAccountFromJson(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[firebase-admin] Ignoring invalid FIREBASE_SERVICE_ACCOUNT_KEY: ${message}`)
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.VITE_FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')

  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey }
  }

  return null
}

if (getApps().length === 0) {
  const serviceAccount = serviceAccountFromEnv()
  if (serviceAccount) {
    initializeApp({
      credential: cert(serviceAccount),
    })
  } else {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.warn(
        '[firebase-admin] No Firebase Admin credentials found. Set FIREBASE_SERVICE_ACCOUNT_KEY ' +
          'or GOOGLE_APPLICATION_CREDENTIALS. Auth-protected endpoints will fail.',
      )
    }
    initializeApp({
      credential: applicationDefault(),
    })
  }
}

export const adminAuth = getAuth()
export const adminDb = getFirestore()
