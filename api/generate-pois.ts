import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { Request, Response } from 'express'
import type { AuthedRequest } from '../server/middleware/auth.js'
import { generatePOIs } from '../server/routes/poi.js'
import { adminAuth } from '../server/services/firebaseAdmin.js'

export const config = {
  maxDuration: 60,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const header = req.headers.authorization || ''
  const match = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? header[0] : header)
  if (!match) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' })
    return
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1])
    const authedReq = req as unknown as AuthedRequest
    authedReq.uid = decoded.uid
    authedReq.email = decoded.email ?? null
    await generatePOIs(authedReq as Request, res as unknown as Response)
  } catch (err) {
    console.error('[api/generate-pois] verifyIdToken failed:', err)
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
