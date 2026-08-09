import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from './app.js'
import { createDatabase, type SyncDatabase } from './database.js'

describe('SyncBoard API', () => {
  let db: SyncDatabase
  beforeEach(() => { db = createDatabase(':memory:') })
  afterEach(() => db.close())

  async function register() {
    return request(createApp(db)).post('/api/auth/register').send({ name: 'Bhavya', email: 'bhavya@example.com', password: 'secure-pass-123' })
  }

  it('registers a user and returns a token', async () => {
    const response = await register()
    expect(response.status).toBe(201)
    expect(response.body.token).toBeTruthy()
    expect(response.body.user.email).toBe('bhavya@example.com')
  })

  it('creates a board and card for an authenticated user', async () => {
    const auth = await register()
    const token = auth.body.token
    const board = await request(createApp(db)).post('/api/boards').set('Authorization', `Bearer ${token}`).send({ name: 'Launch plan' })
    expect(board.status).toBe(201)
    const card = await request(createApp(db)).post(`/api/boards/${board.body.id}/cards`).set('Authorization', `Bearer ${token}`).send({ title: 'Ship the MVP', status: 'todo' })
    expect(card.status).toBe(201)
    expect(card.body.title).toBe('Ship the MVP')
  })

  it('protects board routes', async () => {
    const response = await request(createApp(db)).get('/api/boards')
    expect(response.status).toBe(401)
  })
})

