# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Start here: AGENTS.md

This repo has a detailed `AGENTS.md` (Korean) that governs how to work here — communication language, doc-reading order, scope discipline, and safety rules. Read it before starting any non-trivial task; the summary below does not repeat its contents.

Key points from `AGENTS.md`:
- Report and explain to the user in Korean.
- Announce scope and approach briefly before starting work.
- Treat questions/explanations/reviews as read-only; only edit files when the user asks for a change.
- Don't refactor, rename, or restructure beyond the requested scope.
- Before implementing, check `git status` and treat any existing uncommitted changes as the user's own — never revert or overwrite them.
- When creating a new `apps/*` or `packages/*` workspace, add an `AGENTS.override.md` for it in the same change (required docs, responsibility boundaries, prohibitions, verification steps, ≤80 lines).
- Never commit, push, change branches, or deploy unless explicitly asked. Never use `git reset --hard` or destructive cleanup.

## Documentation map

Docs are layered and read selectively by task type — do not read entire trees speculatively:

- `docs/index.md` — index of planning (`docs/planning/`) and architecture (`docs/architecture/`) specs. Read only when you need product behavior, screen behavior, or design-decision background.
- `docs/development/index.md` — index of **development guidelines**, scoped per workspace. Read only the guideline doc(s) relevant to the code you're touching:
  - `docs/development/common.md` — always read for any implementation/review/refactor. Covers monorepo boundaries, naming, TypeScript config, import ordering, generated-code rules, env/secrets/logging, testing strategy, and a list of forbidden patterns.
  - `docs/development/api.md` — `apps/api` (NestJS module structure, DTO/validation, response mapping, error contract, OpenAPI, auth/security).
  - `docs/development/web.md` — `apps/web` (Next.js App Router structure, TanStack Query usage, forms, Lexical/Markdown, i18n).
  - `docs/development/worker.md` — `apps/worker` (Outbox handler structure, idempotency, shutdown handling).
  - `docs/development/database.md` — `packages/database`, Prisma (schema/migration rules, transactions, query conventions).
  - Combine docs when a change spans boundaries (e.g. API + Prisma → read `api.md` + `database.md`).
- Each `apps/*` and `packages/*` has its own `AGENTS.override.md` with required-reading order and a short responsibility/prohibition/verification checklist for that workspace — check it before working inside that path.
- `DESIGN.md` + `docs/planning/005. 디자인 시스템 명세서.md` — UI visual direction and design tokens; read when changing UI structure, styling, or components.

## Commands

Package manager: **pnpm** (`packageManager: pnpm@11.11.0`), Node **24.x**, orchestrated with **Turborepo**.

Root-level (run from repo root; most fan out via Turbo to all workspaces):

```bash
pnpm dev                    # turbo run dev --parallel (all apps)
pnpm lint                   # root eslint + turbo run lint
pnpm lint:fix
pnpm format                 # prettier --write .
pnpm format:check
pnpm typecheck               # regenerates Prisma client, then turbo run typecheck
pnpm test                   # scripts/*.test.mjs (node:test) + db:generate + turbo run test
pnpm test:coverage
pnpm test:integration        # turbo run test:integration --concurrency=1 (needs Postgres)
pnpm test:e2e                # db:generate, runs DB test migration, then apps/web Playwright
pnpm build                  # db:generate then turbo run build
pnpm api:contract:generate   # regenerate OpenAPI (apps/api) + Orval client (packages/api-client)
pnpm api:contract:check      # fails if committed OpenAPI/Orval output is stale
pnpm observability:smoke     # scripts/check-external-observability.mjs
pnpm db:generate / db:validate / db:format
pnpm db:migrate:dev / db:migrate:deploy
```

Scope work with pnpm's `--filter`, e.g. `pnpm --filter @rivet/api test`, `pnpm --filter @rivet/web dev`.

Per-workspace commands (run inside the workspace dir, or via `--filter`):

| Workspace | Test runner | Run one test |
| --- | --- | --- |
| `apps/api`, `apps/worker` | Jest (`*.spec.ts` unit, `test/*.e2e-spec.ts` / `test/*.integration-spec.ts` for integration) | `NODE_OPTIONS=--experimental-vm-modules jest --config jest.config.cjs path/to/file.spec.ts`; integration uses `jest.integration.config.cjs` and `--runInBand` |
| `apps/web` | Vitest (`*.test.ts(x)`), Playwright (`e2e/*.spec.ts`) | `vitest run path/to/file.test.tsx`; `playwright test path/to/file.spec.ts` |
| `packages/database` | Jest against real Postgres (`test/*.integration-spec.ts`) | same Jest pattern as api/worker; requires `DATABASE_URL` |
| `packages/api-client` | Vitest | `vitest run path/to/file.test.ts` |
| `packages/event-contracts` | `node:test` (compiles first) | `node --test test/some.test.cjs` |
| `packages/config` | `node:test` | — |

Local Postgres integration tests use the `DATABASE_URL` from root `.env.test.local` (gitignored). The `public` schema of the local `rivet` database is test-only — resetting/migrating/mutating it is fine; never touch other databases or schemas.

Individual workspace `dev`/`build`/`start` ports: web `3000` (`WEB_PORT`), API `4000` (`API_PORT`); see `.env.example` for the full list of required env vars (`DATABASE_URL`, HMAC keys, Resend/PostHog/Slack config, `FILE_STORAGE_ROOT`, etc).

## Architecture

Rivet is a Linear-inspired issue/project tracker for small (1–10 person) software teams. Turborepo monorepo, pnpm workspaces (`apps/*`, `packages/*`).

### Apps and their boundaries

| App | Responsibility | Forbidden |
| --- | --- | --- |
| `apps/web` | Next.js 16 App Router UI, user interaction, server-state caching (TanStack Query), optimistic UI, SSE reactions | Using Prisma, importing API internal DTOs, reimplementing server-side permission rules |
| `apps/api` | NestJS (Express) REST + SSE, auth/authz, product rules, transactions, Outbox event publishing | Importing web components, performing long-running async work directly |
| `apps/worker` | NestJS (no HTTP), Outbox consumption, email/notifications, scheduled deletion, retention/file cleanup | Exposing an HTTP product API, importing `apps/api` internals |

Apps **never** import each other's internals — no cross-app relative imports.

### Packages

| Package | Owns |
| --- | --- |
| `packages/database` | Prisma schema (multi-file under `prisma/models/*.prisma`, combined via `prisma.config.ts` pointing at the `prisma/` dir), migrations, generated client (`src/generated/prisma`, gitignored, regenerated via `prisma generate`), a single `src/client.ts` connection entrypoint using `pg` + `@prisma/adapter-pg` |
| `packages/api-client` | Orval-generated types, fetch call functions, and TanStack Query hooks from the API's OpenAPI spec. Generated output is committed to git (reviewed like a contract diff) but never hand-edited — change the source DTOs/OpenAPI/Orval config and regenerate. Auth cookies, CSRF, and common error handling live in one hand-written fetch mutator outside the generated area. |
| `packages/config` | Shared ESLint (flat config, `eslint/base.mjs` / `nest.mjs` / `next.mjs`), Prettier, and TypeScript base configs (`typescript/base.json`, `nest.json`, `next.json`, `node.json`, `library.json`) |

`packages/ui`, `packages/shared`, `packages/domain`, `packages/utils`, and similar generic dumping-ground packages are intentionally **not** created — see the "forbidden structures" list in `docs/development/common.md`. A new shared package is only added once a real second consumer and a stable public boundary exist. `packages/event-contracts` (added when the first Outbox event needed a real producer/consumer pair) publishes only `eventType`, `schemaVersion`, and minimal payload validation shared between `apps/api` (producer) and `apps/worker` (consumer) — no DB models, app services, HTTP DTOs, or PII in payloads.

Dependency direction is one-way:

```
apps/web    ──> packages/api-client, packages/config
apps/api    ──> packages/database, packages/config
apps/worker ──> packages/database, packages/config
```

### Backend layering (apps/api, apps/worker)

Feature-module structure (NestJS official convention), not layered-by-technology:

```
apps/api/src/modules/<feature>/
├── dto/                        # class-validator/class-transformer request DTOs
├── domain/                     # pure validation/state-transition functions (no NestJS/Prisma)
├── <feature>.controller.ts     # HTTP boundary, request DTO, response status only
├── <feature>.module.ts
├── <feature>.service.ts        # use-case orchestration, transactions, Outbox publish
└── <feature>.repository.ts     # only when queries are complex/reused — not a default file
```

Controller → Service → Domain function → (optional) Repository. Services own transaction boundaries; a single transaction covers business data, activity log, and Outbox publish together. Response DTOs are distinct from Prisma models — never expose Prisma models directly; use a `*-response.mapper.ts` pure function only when the `select` shape doesn't already match the response contract.

`apps/worker` reuses the same module style but has no controllers — its `modules/outbox/` separates polling, handler selection, and per-event handlers (`handlers/*.handler.ts`, named for the outcome they produce, not generic `job.handler.ts`). Handlers must be idempotent (safe to reprocess the same event), must not do external calls/long work inside the claim transaction, and must distinguish retryable vs. permanent failures.

### Cross-cutting rules worth knowing up front

- Workspace isolation: every workspace-scoped query requires `workspaceId` or a verified membership context — never fetch by bare `id` and compare workspace afterward.
- Current workspace on the API side comes from the authenticated membership context, never from a client-supplied `workspaceId` in the request body.
- API error contract: stable `code` + safe `message` (+ `fieldErrors`/`requestId` when relevant); the web layer maps `code` → Korean copy, never displays raw server `message` strings.
- No `any`; external input is received as `unknown` and narrowed after validation.
- CommonJS output for `apps/api`, `apps/worker`, `packages/database` (`NodeNext` module resolution); `apps/web` and `packages/api-client` follow their own ESM/framework bundling — don't force one module format repo-wide.
- i18n: `next-intl`, single locale `ko` for now, routes live under `app/[locale]/...` with `localePrefix: 'as-needed'` (no `/ko` prefix on default locale).
- Markdown is the server source of truth for descriptions/comments (not Lexical JSON or rendered HTML); rendering always goes through the shared react-markdown + remark-gfm + rehype-sanitize pipeline — never `rehype-raw` / `dangerouslySetInnerHTML`.
- Logging: structured single-line objects via Pino (`nestjs-pino`), no secrets/tokens/cookies/full request-response bodies; PM2 collects stdout, apps don't manage log files directly.
