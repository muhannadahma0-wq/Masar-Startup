# Masar Startup — release candidate notes

## Integration completed in this workspace

- Unified the application around Next.js App Router, TypeScript/Node route handlers and Prisma with PostgreSQL.
- Changed the pitch-review workflow to LangGraph.js: twenty specialist tasks, bounded concurrent execution, reducer-based result merge and a final synthesis node.
- Set configurable reviewer/synthesis model IDs and time/concurrency limits. Live analysis requires a valid server-side provider API key and models enabled for the account.
- Added bilingual English equivalents for deterministic eligibility summaries/reasons, readiness evidence and gaps, what-if/quick-check results, slide-review messages and tracker notifications. Preserved official source text rather than silently translating source records.
- Removed stale build-error suppression, added a standalone asset-copy step, Docker Compose and a Render Blueprint.
- Changed Prisma to PostgreSQL and removed local SQLite data, local `.env`, tool-result logs and example users' deck files from the release package.
- Guarded demo seeding so it requires explicit opt-in and refuses production/non-PostgreSQL databases.
- Fixed profile payload validation to accept primitive arrays, then added atomic founder-list persistence with exactly one primary founder; synced primary founder fields used by matching.
- Added PII redaction to specialist-agent slide payloads before provider calls, preserving citation checks against the original slides.
- Fixed missing readiness type import and language propagation in deck review sections; excluded the legacy Socket.IO example from app TypeScript checking.
- Documented release checklist, architecture, and a new Arabic audit report distinguishing implemented, statically checked, and outstanding work.

## Validation performed

- TypeScript/TSX parser: 143 files parsed; 0 syntax diagnostics.
- `node scripts/verify-release.mjs`: passed.
- `node --test tests/*.test.mjs`: 8/8 static release smoke tests passed.
- `node --check` for release scripts and package JSON parse: passed.
- YAML parsing for `render.yaml` and `docker-compose.yml`: passed.
- `git diff --check`: passed.
- Release-package content checks on the previous archive: no `.env`, local DB dump or user pitch deck files included; a refreshed archive is being assembled to include the latest audit fixes.

## Not yet validated

The package registry lookup failed (`EAI_AGAIN`) during dependency installation. Consequently the attempted `npm run typecheck` could not resolve project packages/types, and `npm run build` stopped because Prisma is not installed. ESLint, Prisma Client generation/validation and a complete production build remain unverified. Run these on a machine/CI runner with registry access before accepting production traffic. The initial typecheck also exposed and prompted fixes for missing readiness types and missing language props; remaining type errors are not reliable until dependencies are installed. The Render Blueprint is included, but this release candidate has not been pushed to the old GitHub repository or deployed as the new Next.js application. The existing Render services belong to an earlier Express/Python scaffold.

## Operational gates

- Configure `OPENAI_API_KEY` as a server-only secret; never put it in browser-visible variables or repository files.
- Confirm the configured model IDs are enabled for the API account.
- Use private durable object storage and a retention/deletion policy before accepting sensitive pitch decks on a hosted service.
- Review migrations/backups and access-control tests before production; the current Render startup uses `prisma db push` as first-deploy setup.
- Replace fictional demo opportunity records with human-reviewed official-source records before presenting the catalogue as live.
