# TKSR Learning — AI-focused LMS (MVP)

A complete, working Learning Management System for an AI academy: admins run the
academy, trainers deliver programs and grade real work, and students learn through
modules and assignments — with **AI assistance that never crosses the line** (the tutor
refuses to do graded homework, and AI evaluations are only suggestions until a human
releases the grade).

Everything runs against a **real relational database** with **real authentication,
role-based authorization, audited actions and seeded demo data**.

---

## Quick start

Requirements: **Node.js ≥ 24** and **npm ≥ 10** (uses the built-in `node:sqlite` driver — no native build step).

```bash
npm install          # install dependencies
npm run setup        # run migrations + seed the demo database
npm run dev          # start API (5175) + web app (5174) together
```

Open **http://localhost:5174** and sign in with a demo account:

| Role    | Account              | Password    | Notes                                   |
| ------- | -------------------- | ----------- | --------------------------------------- |
| Admin   | `admin@tksr.demo`    | `Admin@123` | Users, programs, cohorts, audit log     |
| Trainer | `rahul@tksr.demo`    | `Trainer@123` | Assigned program, grading queue       |
| Trainer | `priya@tksr.demo`    | `Trainer@123` | Second trainer                        |
| Student | `aarav@tksr.demo`    | `Student@123` | Enrolled, mid-progress (31%)          |
| Student | `diya@tksr.demo`     | `Student@123` | Enrolled                                |
| Student | `rohan@tksr.demo`    | `Student@123` | Enrolled                                |
| Student | `sneha@tksr.demo`    | `Student@123` | Enrolled                                |
| Student | `vikram@tksr.demo`   | `Student@123` | Enrolled                                |

The login page also has one-click buttons for the admin/trainer/student demo accounts.

---

## Commands

| Command              | What it does                                                       |
| -------------------- | ------------------------------------------------------------------ |
| `npm run dev`        | API + Vite dev server with hot reload (recommended)                |
| `npm run dev:server` | API only (port **5175**, `tsx watch`)                              |
| `npm run dev:client` | Web app only (port **5174**, proxies `/api` → 5175)                |
| `npm run db:migrate` | Apply SQL migrations                                               |
| `npm run db:seed`    | Seed demo data (idempotent; `npm run db:seed -- --reset` wipes + reseeds) |
| `npm run setup`      | Migrate + seed in one step                                         |
| `npm run typecheck`  | `vue-tsc` for the frontend + `tsc` for the server (strict)         |
| `npm test`           | Vitest integration/unit suite (in-memory DB per file)              |
| `npm run build`      | Typecheck + build client (`dist/`) + build server (`dist-server/`) |
| `npm start`          | Run the production build (serves API **and** the built SPA)        |

---

## What's included

### Platform
- **Auth**: email/password login, bcrypt-hashed passwords, JWT bearer tokens (12h), session restored from token, disabled accounts rejected server-side.
- **RBAC**: `admin`, `trainer`, `student` — enforced in middleware *and* re-checked per route (students only see their own data, trainers only their assigned programs/students).
- **Programs → cohorts → enrollments**: admin creates programs, assigns trainers, creates cohorts and enrolls students (or unenrolls/removes).
- **Curriculum**: modules → lessons with markdown content, positions, per-module and per-program progress.
- **Assignments**: instructions, max marks, due dates, **rubric items**, draft → publish/unpublish lifecycle.
- **Submissions**: text, URL and file attachment (validated extension/MIME/size, UUID filenames, authorized download endpoint), late flag, attempts, resubmission allowed **until graded**.
- **Grading**: the only way a grade appears is a trainer/admin explicitly releasing it (`POST /api/submissions/:id/grade`), with score bound-checking and feedback; re-grading supported.
- **Progress**: per-lesson completion, per-module/per-program percentages, next-lesson pointer, overall student progress.
- **Dashboards**: composed server-side per role (student: continue-learning, pending assignments, recent grades; trainer: programs, students, pending submissions; admin: user/program/enrollment/submission stats + activity).
- **Notifications**: created for enrollment, new assignments, released grades; unread badge polled by the top bar.
- **Audit log**: important actions recorded (login, CRUD on users/programs/content, submissions, evaluations, grades) and browsable by admins with filters.
- **Pagination** on every list endpoint, plus loading/empty/error states across the UI.

### The two AI features (behind a provider abstraction)
1. **AI Learning Tutor** (`/app/tutor`) — chat with conversation history. The system prompt
   requires it to give hints/explanations/quiz questions but **refuse to complete graded
   assignments**, and the refusal path is covered by tests.
2. **AI Assignment Evaluation Assistant** (grading screen) — analyzes a submission and
   returns *suggested score + strengths + weaknesses + suggested feedback*. Nothing is
   auto-published: the trainer edits/accepts the score and clicks **Release grade**. The
   evaluation row records `accepted` vs `edited` based on the score comparison.

**AI configuration** — `server/src/services/ai/provider.ts` exposes an `AIProvider` interface with two implementations:

| `AI_PROVIDER` | Behaviour                                                        |
| ------------- | ---------------------------------------------------------------- |
| `auto`        | Use OpenAI when `OPENAI_API_KEY` is set, otherwise fall back to the deterministic mock (default) |
| `openai`      | Require an API key (fails fast if missing)                       |
| `mock`        | Always the offline deterministic provider (used in tests)        |

API keys live only in server env vars (`.env`, see `.env.example`) and are **never** sent to the browser.

---

## Environment

Copy `.env.example` to `.env` and adjust (everything has safe dev defaults except production):

```bash
cp .env.example .env
```

Key variables: `PORT`, `DATABASE_PATH`, `JWT_SECRET` (**required in production**),
`JWT_EXPIRES_IN`, `UPLOAD_DIR`, `MAX_UPLOAD_MB`, `AI_PROVIDER`, `OPENAI_API_KEY`,
`OPENAI_BASE_URL`, `OPENAI_MODEL`, `CORS_ORIGIN`, `CLIENT_DIST`.

---

## Architecture

```
tksr-learning-lms/
├── server/                  # Express 4 + TypeScript (ESM, NodeNext)
│   ├── migrations/          # 001_init.sql — 16 tables + indexes (SQLite, WAL, FKs on)
│   ├── src/
│   │   ├── app.ts           # Route mounting (public routes before global auth)
│   │   ├── index.ts         # Boot: migrate on start, graceful shutdown
│   │   ├── routes/          # auth, users, programs, cohorts, content, assignments,
│   │   │                    # submissions, my, ai, dashboard, misc (health/notifications/audit)
│   │   ├── middleware/      # requireAuth/requireRole, zod validation, error envelope
│   │   ├── services/        # access rules, progress, audit, notifications, AI providers
│   │   ├── db/              # helpers, migrate, seed (idempotent, --reset)
│   │   └── utils/           # camelCase conversion, pagination, http helpers
│   └── tests/               # vitest: auth, rbac, workflow (E2E), ai, progress
├── src/                     # Vue 3 + TypeScript (strict) + Vite 5 + vue-router 4
│   └── lms/
│       ├── api.ts           # fetch wrapper: bearer token, 401 redirect, error envelope
│       ├── session.ts       # reactive auth session (login/logout/restore)
│       ├── router.ts        # routes + auth/role guards
│       ├── components/      # AppLayout/Sidebar/Topbar, StatCard, ProgressBar, …
│       └── views/           # 16 views (login, 3 dashboards, programs, lesson viewer,
│                            # assignments, grading, users, cohorts, audit, tutor, …)
├── dist/                    # Built SPA (served by the server in production)
└── dist-server/             # Built server (npm start)
```

**Data model** (with relationships, timestamps, indexes):
`User ←→ Role`, `Program → Cohort → Enrollment → User(student)`, `Program → Module → Lesson`,
`Program → Assignment → RubricItem`, `Assignment → Submission → Evaluation`, `Progress` (student × lesson),
`AIConversation → AIMessage`, `Notification`, `AuditLog`.

**API conventions**
- All responses are camelCase; lists return `{ data, meta: { page, limit, total, totalPages } }`.
- Errors return `{ error: { message, details? } }` with correct HTTP status codes.
- Public routes (`/api/health`, `/api/auth/login`) are mounted before the global auth middleware; everything else requires a valid, active-user JWT.

**Security notes**
- Server-side authorization on every route (never trusting the client), students scoped to their own rows, trainers scoped to assigned programs.
- bcrypt cost 10; zod validation on every request body/query; file uploads restricted by extension + MIME + size.
- SQL access goes through parameterized queries only.
- Security-relevant actions are written to `audit_logs`.
- The AI tutor's "no homework" rule is enforced in the server-side prompt, not the UI.

---

## Tests

```bash
npm test
```

5 files / 45 tests, each file booting the **real Express app** on a random port with its
own in-memory database:

- `auth.test.ts` — login validation, bad credentials, disabled users, `/auth/me`, token expiry basics.
- `rbac.test.ts` — role matrix across endpoints; students can't read others' data; trainers can't touch unassigned programs.
- `workflow.test.ts` — full chain: admin creates program/trainer/cohort/enrolls → trainer adds modules/lessons/assignment → student learns & submits → trainer grades → progress/notifications/audit asserted.
- `ai.test.ts` — tutor refusal to do graded work, conversation privacy, evaluation range clamping, **grades never auto-published**, accepted/edited evaluation statuses.
- `progress.test.ts` — progress service unit tests (percent math, rewind, per-student isolation, next-lesson, overall progress).

---

## Production

```bash
npm run build        # typecheck + bundle client + compile server
JWT_SECRET=$(openssl rand -hex 32) NODE_ENV=production npm start
```

The server serves the built SPA from `dist/` (SPA fallback) and the API on `PORT`
(default 5175) — a single process, single port.

---

## Scope

Deliberately an MVP: no gamification, leaderboards, certificates, RAG, code sandbox, SSO
or multi-provider AI routing. The AI layer is an interface (`AIProvider`) so a future
provider slots in without touching routes.
