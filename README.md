# Masar Startup — مسار للشركات الناشئة

**من فكرة إلى مشروع جاهز للنمو والتمويل.**

Masar Startup is a bilingual Arabic/English startup workspace built with **Next.js App Router, React, TypeScript, Node.js route handlers, Prisma and PostgreSQL**. It combines pitch-deck analysis, evidence-aware improvement suggestions, a startup profile, deterministic eligibility decisions, opportunity matching, document preparation and application tracking.

> **Release status:** this repository contains the release candidate and deployment configuration. It has not been fully typechecked or production-built in this environment because the npm package registry connection timed out. Run the verification steps below before using real founder data or marking the deployment production-ready.

## Stack and architecture

- **Web UI + Node API:** one Next.js 16 App Router application (`src/app/**`). API endpoints live under `src/app/api/v1/**`; there is no separate Express service to deploy.
- **Database:** PostgreSQL through Prisma (`prisma/schema.prisma`). `DATABASE_URL` must be a PostgreSQL connection string.
- **Pitch review:** LangGraph.js (`StateGraph` + `Send`) runs twenty task-specialist model calls in bounded parallel fan-out, merges typed results, and then invokes a synthesis node. These are specialist tasks—not twenty separately trained neural networks.
- **Model configuration:** reviewer calls use `OPENAI_AGENT_MODEL` (default `gpt-6.1-sol`); synthesis uses `OPENAI_SYNTHESIS_MODEL` (default `gpt-6-astra`). Both are configurable for accounts/model availability. Live analysis requires a valid server-side `OPENAI_API_KEY` and supported model access. Never put provider keys in client-side variables such as `NEXT_PUBLIC_*`.
- **Eligibility:** a deterministic, auditable rules engine returns `ELIGIBLE`, `NOT_ELIGIBLE` or `UNCERTAIN`; LLM output never overrides mandatory eligibility criteria.
- **Parallelism and budgets:** `MASAR_AGENT_CONCURRENCY` (1–12, default 8), `MASAR_AGENT_TIMEOUT_MS`, and `MASAR_SYNTHESIS_TIMEOUT_MS` bound concurrent calls and prevent unlimited fan-out.

## Local development

Requires Node.js 20.9 or newer and PostgreSQL 15+.

1. Install packages and create your environment file:

   ```bash
   npm install
   cp .env.example .env
   ```

   On Windows PowerShell use `Copy-Item .env.example .env`.

2. Set `DATABASE_URL` in `.env` to a PostgreSQL URL, then generate Prisma Client and initialize the schema:

   ```bash
   npx prisma generate
   npx prisma db push
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

   Open `http://localhost:3000`.

### Local Docker Compose

The Compose stack provisions PostgreSQL and runs the app in a container. It binds to localhost only by default:

```bash
cp .env.example .env
docker compose up --build
```

Set `POSTGRES_PASSWORD` to a unique local password and configure `OPENAI_API_KEY` only if you want to exercise live provider calls. The app’s container runs `prisma db push` at startup; for a production database use a reviewed migration workflow instead.

### Safe demo seed

The seed script deletes/rebuilds demo rows. It is disabled unless explicitly opted into and will reject production or non-PostgreSQL URLs. Use a **throwaway local database only**:

```bash
ALLOW_DEMO_SEED=true npm run seed:demo
```

All bundled funding-program examples and `demo.masar.example` source links are fictional demonstration data. They are not current offers and must not be presented as verified funding opportunities.

## Environment variables

See [`.env.example`](.env.example). Important values:

- `DATABASE_URL` — PostgreSQL URL.
- `OPENAI_API_KEY` — private server-side provider secret.
- `MASAR_LLM_PROVIDER` — `auto`, `openai`, or an existing supported provider setting.
- `OPENAI_AGENT_MODEL`, `OPENAI_SYNTHESIS_MODEL` — model identifiers valid for the connected API account.
- `MASAR_AGENT_CONCURRENCY`, `MASAR_AGENT_TIMEOUT_MS`, `MASAR_SYNTHESIS_TIMEOUT_MS` — resource/time budgets.
- `MASAR_STORAGE_DIR` — local deck storage directory. A hosted platform’s ephemeral filesystem is **not** durable file storage; use a private object-storage provider or a properly secured persistent disk before accepting sensitive production decks.

## Deploy on Render

The [`render.yaml`](render.yaml) Blueprint describes one Next.js full-stack web service and PostgreSQL database. In Render, create a new Blueprint deployment from this GitHub repository and branch. Add `OPENAI_API_KEY` as a secret when prompted; never commit `.env` or a key. Build and health-check status must be successful before sharing the site.

The Blueprint uses free plans as a prototype-oriented starting point. Confirm current limits and database retention/expiration in Render before using it for production. Free or ephemeral storage should not be relied on to retain uploaded decks.

## Checks before release

```bash
npm run typecheck
npm run lint
npm run build
```

Then verify:

- Signup/login and object-level permissions.
- Database initialization and migration/rollback strategy.
- Arabic RTL and English LTR across landing, forms, readiness, pitch reports, eligibility, matching, tracking, and server error messages.
- Eligibility test fixtures, including missing/weak/stale source evidence and all three judgments.
- Upload bounds, MIME/extension checks, private access, deletion/retention, and malicious-file handling.
- AI provider disabled/key invalid/model unavailable/timeouts; the system must say the agent review was unavailable rather than fabricate findings.
- Source review/verification before marking an opportunity published.

## Data safety and limitations

Never commit `.env`, Postgres dumps, `.db`/SQLite files, private pitch decks, user exports or service logs. The repository ignore rules exclude these paths, and a clean release archive excludes local user documents. AI findings are draft recommendations requiring founder review; they are not legal/investment advice, they do not predict funding success, and they never silently overwrite a startup profile. Formal eligibility remains deterministic and evidence-linked.
