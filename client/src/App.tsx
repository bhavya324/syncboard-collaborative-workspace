import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { io, Socket } from 'socket.io-client'

type Auth = { token: string; user: { id: number; name: string; email: string } }
type BoardSummary = { id: number; name: string; role: string; card_count: number }
type Card = { id: number; board_id: number; title: string; description: string; status: 'todo' | 'progress' | 'done' }
type Board = { id: number; name: string; role: string; cards: Card[]; activities: { id: number; details: string; user_name: string; created_at: string }[] }

const columns = [
  { key: 'todo', label: 'Todo' },
  { key: 'progress', label: 'In progress' },
  { key: 'done', label: 'Done' },
] as const

export default function App() {
  const [auth, setAuth] = useState<Auth | null>(() => JSON.parse(localStorage.getItem('syncboard-auth') ?? 'null'))
  const [boards, setBoards] = useState<BoardSummary[]>([])
  const [board, setBoard] = useState<Board | null>(null)
  const [error, setError] = useState('')
  const socket = useMemo<Socket | null>(() => auth ? io('http://localhost:4000', { auth: { token: auth.token } }) : null, [auth])

  const api = useCallback(async (path: string, options: RequestInit = {}) => {
    const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}), ...options.headers } })
    const payload = response.status === 204 ? null : await response.json()
    if (!response.ok) throw new Error(payload?.error ?? 'Request failed')
    return payload
  }, [auth])

  const loadBoards = useCallback(async () => { if (auth) setBoards(await api('/boards')) }, [api, auth])
  const openBoard = useCallback(async (id: number) => { setBoard(await api(`/boards/${id}`)) }, [api])
  const activeBoardId = board?.id

  useEffect(() => { loadBoards().catch((e) => setError(e.message)) }, [loadBoards])
  useEffect(() => {
    if (!socket || !activeBoardId) return
    socket.emit('board:join', activeBoardId)
    const refresh = () => openBoard(activeBoardId).catch(() => undefined)
    socket.on('card:created', refresh); socket.on('card:updated', refresh)
    return () => { socket.emit('board:leave', activeBoardId); socket.off('card:created', refresh); socket.off('card:updated', refresh) }
  }, [socket, activeBoardId, openBoard])

  const authenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('')
    const data = Object.fromEntries(new FormData(event.currentTarget))
    try {
      const next = await fetch(`/api/auth/${data.mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(async (r) => { const p = await r.json(); if (!r.ok) throw new Error(p.error); return p })
      localStorage.setItem('syncboard-auth', JSON.stringify(next)); setAuth(next)
    } catch (e) { setError((e as Error).message) }
  }

  const createBoard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const name = String(new FormData(form).get('name'))
    const created = await api('/boards', { method: 'POST', body: JSON.stringify({ name }) }); form.reset(); await loadBoards(); await openBoard(created.id)
  }

  const createCard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!board) return
    const form = event.currentTarget; const title = String(new FormData(form).get('title'))
    await api(`/boards/${board.id}/cards`, { method: 'POST', body: JSON.stringify({ title, status: 'todo' }) }); form.reset(); await openBoard(board.id)
  }

  const move = async (card: Card, status: Card['status']) => { await api(`/cards/${card.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); if (board) await openBoard(board.id) }
  const logout = () => { localStorage.removeItem('syncboard-auth'); socket?.disconnect(); setAuth(null); setBoard(null); setBoards([]) }

  if (!auth) return <AuthScreen onSubmit={authenticate} error={error} />

  return <main className="app-shell">
    <aside className="sidebar">
      <div><span className="mark">S</span><h1>SyncBoard</h1></div>
      <form onSubmit={createBoard} className="new-board"><input name="name" placeholder="New workspace" required minLength={2}/><button>+</button></form>
      <nav>{boards.map((item) => <button key={item.id} className={board?.id === item.id ? 'active' : ''} onClick={() => openBoard(item.id)}><span>{item.name}</span><small>{item.card_count}</small></button>)}</nav>
      <footer><span>{auth.user.name}</span><button onClick={logout}>Log out</button></footer>
    </aside>
    <section className="workspace">
      {board ? <>
        <header><div><span className="eyebrow">Shared workspace</span><h2>{board.name}</h2></div><span className="live">Live</span></header>
        <form onSubmit={createCard} className="quick-add"><input name="title" placeholder="Add a task to Todo" required minLength={2}/><button>Add task</button></form>
        <div className="board-grid">{columns.map((column) => <section className="column" key={column.key}><div className="column-title"><h3>{column.label}</h3><span>{board.cards.filter((card) => card.status === column.key).length}</span></div>{board.cards.filter((card) => card.status === column.key).map((card) => <article className="card" key={card.id}><strong>{card.title}</strong>{card.description && <p>{card.description}</p>}<select aria-label={`Move ${card.title}`} value={card.status} onChange={(e) => move(card, e.target.value as Card['status'])}>{columns.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></article>)}</section>)}</div>
      </> : <div className="welcome"><span className="mark large">S</span><h2>Choose a workspace</h2><p>Create a board or select one from the sidebar to start collaborating.</p></div>}
    </section>
  </main>
}

function AuthScreen({ onSubmit, error }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; error: string }) {
  const [mode, setMode] = useState<'register' | 'login'>('register')
  return <main className="auth-shell"><section className="auth-card"><span className="mark large">S</span><span className="eyebrow">Real-time teamwork</span><h1>Build together.</h1><p>Plan projects, move work forward, and see changes as they happen.</p><form onSubmit={onSubmit}><input type="hidden" name="mode" value={mode}/>{mode === 'register' && <input name="name" placeholder="Your name" required/>}<input type="email" name="email" placeholder="Email address" required/><input type="password" name="password" placeholder="Password (8+ characters)" minLength={8} required/>{error && <div className="error">{error}</div>}<button>{mode === 'register' ? 'Create account' : 'Sign in'}</button></form><button className="text-button" onClick={() => setMode(mode === 'register' ? 'login' : 'register')}>{mode === 'register' ? 'Already have an account? Sign in' : 'New to SyncBoard? Create an account'}</button></section></main>
}
