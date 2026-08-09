# SyncBoard Collaborative Workspace

SyncBoard is a real-time TypeScript workspace for teams to organize projects on shared Kanban boards. It combines JWT authentication, role-aware board membership, SQLite persistence, audit activity, and Socket.IO updates with a responsive React client.

## Highlights

- Register and sign in with securely hashed passwords
- Create workspaces and seed a practical three-column board
- Add cards and move them between `Todo`, `In Progress`, and `Done`
- Receive real-time updates from other connected sessions
- Persist users, boards, cards, memberships, and audit activity in SQLite
- Validate API payloads with Zod and protect board routes with membership checks
- API integration tests and production TypeScript builds

## Run locally

### API

```bash
cd server
npm install
npm run dev
```

### Client

```bash
cd client
npm install
npm run dev
```

Open `http://localhost:5173` and create an account.

## Quality checks

```bash
cd server
npm test
npm run build

cd ../client
npm run lint
npm run build
```

## Tech stack

TypeScript, Node.js, Express, Socket.IO, SQLite, JWT, bcrypt, Zod, React 19, Vite, Vitest, Supertest, Docker.

