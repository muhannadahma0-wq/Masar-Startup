# Release Checklist

- [ ] `DATABASE_URL` resolves to the intended PostgreSQL database; confirm backups and migrations before real user data.
- [ ] `npm run typecheck`, `npm run lint`, `npm run test:smoke`, and `npm run build` pass in a clean environment.
- [ ] Render build/deploy and `/api/v1/health` are successful for the active commit.
- [ ] Add `OPENAI_API_KEY` in Render's secret manager if enabling live model calls; verify that the selected model IDs are enabled for the account.
- [ ] Confirm live agent review is reported as unavailable when credentials are absent; never substitute generated demo findings.
- [ ] Test Arabic/RTL and English/LTR on landing, auth, pitch review, readiness, matching, quick check, what-if, corrections, opportunities, and notifications.
- [ ] Exercise all three eligibility outcomes and missing, weak, stale, and valid official-source evidence.
- [ ] Configure durable private deck storage, file access authorization, retention/deletion, malware scanning, and restore tests before production uploads. Render's ordinary local filesystem is not durable across instance replacement.
- [ ] Verify opportunities against their current official sources before publication; demo entries remain visibly illustrative.
- [ ] Run auth/IDOR, upload type/size, rate-limit, and API permission tests before inviting outside users.
