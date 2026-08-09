import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'

const secret = process.env.JWT_SECRET ?? 'development-only-change-me'

export type AuthUser = { id: number; name: string; email: string }
export type AuthRequest = Request & { user?: AuthUser }

export function signToken(user: AuthUser): string {
  return jwt.sign(user, secret, { expiresIn: '8h', issuer: 'syncboard' })
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, secret, { issuer: 'syncboard' }) as AuthUser
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) {
    res.status(401).json({ error: 'Authentication is required.' })
    return
  }
  try {
    req.user = verifyToken(token)
    next()
  } catch {
    res.status(401).json({ error: 'The access token is invalid or expired.' })
  }
}

