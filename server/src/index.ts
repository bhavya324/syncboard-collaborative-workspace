import 'dotenv/config'
import { createServer } from 'node:http'
import { Server } from 'socket.io'

import { verifyToken } from './auth.js'
import { createApp } from './app.js'
import { createDatabase } from './database.js'

const port = Number(process.env.PORT ?? 4000)
const db = createDatabase()
const httpServer = createServer()
const io = new Server(httpServer, { cors: { origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] } })
const app = createApp(db, (boardId, event, payload) => io.to(`board:${boardId}`).emit(event, payload))
httpServer.on('request', app)

io.use((socket, next) => {
  try {
    socket.data.user = verifyToken(String(socket.handshake.auth.token ?? ''))
    next()
  } catch {
    next(new Error('Authentication failed'))
  }
})
io.on('connection', (socket) => {
  socket.on('board:join', (boardId: number) => socket.join(`board:${Number(boardId)}`))
  socket.on('board:leave', (boardId: number) => socket.leave(`board:${Number(boardId)}`))
})

httpServer.listen(port, () => console.log(`SyncBoard API listening on http://localhost:${port}`))

