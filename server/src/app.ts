import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'
import { z } from 'zod'

import { type AuthRequest, requireAuth, signToken } from './auth.js'
import { createDatabase, type SyncDatabase } from './database.js'

type RealtimePublisher = (boardId: number, event: string, payload: unknown) => void

const credentialsSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(100),
})
const boardSchema = z.object({ name: z.string().trim().min(2).max(80) })
const cardSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).default(''),
  status: z.enum(['todo', 'progress', 'done']).default('todo'),
})
const cardUpdateSchema = cardSchema.partial().refine((value) => Object.keys(value).length > 0)

function parseId(value: string | string[]): number {
  if (Array.isArray(value)) throw new Error('Invalid resource id')
  const id = Number(value)
  if (!Number.isInteger(id) || id < 1) throw new Error('Invalid resource id')
  return id
}

function membership(db: SyncDatabase, boardId: number, userId: number) {
  return db.prepare('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?').get(boardId, userId) as { role: string } | undefined
}

export function createApp(
  db = createDatabase(),
  publish: RealtimePublisher = () => undefined,
) {
  const app = express()
  app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }))
  app.use(express.json({ limit: '200kb' }))

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'syncboard' }))

  app.post('/api/auth/register', (req, res) => {
    const parsed = credentialsSchema.extend({ name: z.string().trim().min(2).max(60) }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message })
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(parsed.data.email)
    if (exists) return res.status(409).json({ error: 'An account already exists for this email.' })
    const result = db.prepare('INSERT INTO users(name, email, password_hash) VALUES (?, ?, ?)')
      .run(parsed.data.name, parsed.data.email, bcrypt.hashSync(parsed.data.password, 12))
    const user = { id: Number(result.lastInsertRowid), name: parsed.data.name, email: parsed.data.email }
    return res.status(201).json({ token: signToken(user), user })
  })

  app.post('/api/auth/login', (req, res) => {
    const parsed = credentialsSchema.omit({ name: true }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' })
    const row = db.prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?').get(parsed.data.email) as { id: number; name: string; email: string; password_hash: string } | undefined
    if (!row || !bcrypt.compareSync(parsed.data.password, row.password_hash)) return res.status(401).json({ error: 'Email or password is incorrect.' })
    const user = { id: row.id, name: row.name, email: row.email }
    return res.json({ token: signToken(user), user })
  })

  app.use('/api', requireAuth)

  app.get('/api/boards', (req: AuthRequest, res) => {
    const boards = db.prepare(`
      SELECT b.id, b.name, b.created_at, bm.role,
             (SELECT COUNT(*) FROM cards c WHERE c.board_id = b.id) AS card_count
      FROM boards b JOIN board_members bm ON bm.board_id = b.id
      WHERE bm.user_id = ? ORDER BY b.created_at DESC
    `).all(req.user!.id)
    res.json(boards)
  })

  app.post('/api/boards', (req: AuthRequest, res) => {
    const parsed = boardSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message })
    const create = db.transaction(() => {
      const boardResult = db.prepare('INSERT INTO boards(name, owner_id) VALUES (?, ?)').run(parsed.data.name, req.user!.id)
      const boardId = Number(boardResult.lastInsertRowid)
      db.prepare("INSERT INTO board_members(board_id, user_id, role) VALUES (?, ?, 'owner')").run(boardId, req.user!.id)
      db.prepare('INSERT INTO activities(board_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(boardId, req.user!.id, 'board.created', `Created ${parsed.data.name}`)
      return boardId
    })
    const boardId = create()
    res.status(201).json({ id: boardId, name: parsed.data.name, role: 'owner', card_count: 0 })
  })

  app.get('/api/boards/:boardId', (req: AuthRequest, res) => {
    const boardId = parseId(req.params.boardId)
    const access = membership(db, boardId, req.user!.id)
    if (!access) return res.status(403).json({ error: 'You do not have access to this board.' })
    const board = db.prepare('SELECT id, name, created_at FROM boards WHERE id = ?').get(boardId)
    if (!board) return res.status(404).json({ error: 'Board not found.' })
    const cards = db.prepare('SELECT * FROM cards WHERE board_id = ? ORDER BY status, position, id').all(boardId)
    const activities = db.prepare(`SELECT a.*, u.name AS user_name FROM activities a JOIN users u ON u.id = a.user_id WHERE a.board_id = ? ORDER BY a.id DESC LIMIT 20`).all(boardId)
    res.json({ ...board as object, role: access.role, cards, activities })
  })

  app.post('/api/boards/:boardId/cards', (req: AuthRequest, res) => {
    const boardId = parseId(req.params.boardId)
    const access = membership(db, boardId, req.user!.id)
    if (!access || access.role === 'viewer') return res.status(403).json({ error: 'Editor access is required.' })
    const parsed = cardSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message })
    const result = db.prepare('INSERT INTO cards(board_id, title, description, status, position) VALUES (?, ?, ?, ?, ?)')
      .run(boardId, parsed.data.title, parsed.data.description, parsed.data.status, Date.now())
    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(result.lastInsertRowid)
    db.prepare('INSERT INTO activities(board_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(boardId, req.user!.id, 'card.created', `Added ${parsed.data.title}`)
    publish(boardId, 'card:created', card)
    res.status(201).json(card)
  })

  app.patch('/api/cards/:cardId', (req: AuthRequest, res) => {
    const cardId = parseId(req.params.cardId)
    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId) as { id: number; board_id: number; title: string; description: string; status: string } | undefined
    if (!card) return res.status(404).json({ error: 'Card not found.' })
    const access = membership(db, card.board_id, req.user!.id)
    if (!access || access.role === 'viewer') return res.status(403).json({ error: 'Editor access is required.' })
    const parsed = cardUpdateSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message })
    const next = { ...card, ...parsed.data }
    db.prepare("UPDATE cards SET title = ?, description = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(next.title, next.description, next.status, cardId)
    const updated = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId)
    db.prepare('INSERT INTO activities(board_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(card.board_id, req.user!.id, 'card.updated', `Updated ${next.title}`)
    publish(card.board_id, 'card:updated', updated)
    res.json(updated)
  })

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unexpected server error'
    res.status(message === 'Invalid resource id' ? 400 : 500).json({ error: message })
  })

  return app
}
