# Masar AI and Agent Workflow

## Model boundary

Masar calls hosted foundation models through a server-only adapter. It does not train a new deep-learning model or ship model weights. The current default model IDs are configurable environment values: `gpt-6.1-sol` for specialist review calls and `gpt-6-astra` for synthesis. Use model IDs enabled for the connected API account; if provider access is unavailable, the workflow reports that the live review did not run instead of inventing findings.

## Twenty specialist roles

1. Pitch story and structure
2. Problem and solution
3. Target customers
4. Value proposition and differentiation
5. Market size and assumptions
6. Competition and alternatives
7. Business model
8. Go-to-market
9. Traction and validation
10. Financial plan
11. Unit economics
12. Team and governance
13. Product and technology
14. Roadmap and milestones
15. Risks and regulation
16. Impact and outcomes
17. Claims and evidence auditor
18. Copy and clarity editor
19. Visual and accessibility review (limited to visual evidence actually available)
20. Application readiness

These are task-specialist agent calls, not twenty independently trained neural networks. Each call receives bounded, untrusted slide text; instructions inside the deck are treated as data, and models are told never to invent figures, sources, claims, or eligibility outcomes.

## Execution graph

1. Validate and extract the uploaded PDF/PPTX into slide-indexed text.
2. Dispatch twenty independent specialist tasks using LangGraph.js `StateGraph` and `Send` fan-out, bounded with `maxConcurrency` (`MASAR_AGENT_CONCURRENCY`, default 8, maximum 12).
3. Each task has an explicit timeout and returns a validated, size-limited result; failed tasks are marked `error` or `unavailable`.
4. Run a synthesis model over the completed tasks when the processing deadline permits.
5. Filter source quotations through the citation guard. Only verified verbatim excerpts are marked as supported.
6. Persist the report per deck version and render both Arabic and English summaries. The founder must review edits; profile data is never silently overwritten.

This is a fan-out / merge / synthesis workflow implemented in the existing Node backend. It uses real concurrent provider requests but does not require a separate Python microservice or a second API deployment.

## Model responsibilities and hard limits

- The language model analyzes unstructured pitch content and proposes edits.
- `src/lib/core/engine.ts` remains the sole authority for deterministic three-state eligibility (`ELIGIBLE`, `NOT_ELIGIBLE`, `UNCERTAIN`).
- `src/lib/core/scoring.ts` separately computes opportunity fit and source reliability.
- Missing inputs remain missing; neither the model nor the UI fabricates market statistics, citations, or a funding-success probability.
- Agent calls are capped by concurrency and time budgets, and the whole deck pipeline may run partially if its deadline is reached.
- Model credentials are server-side only. Never expose them as `NEXT_PUBLIC_*` values.

## Evaluation needed before launch

Create a human-labelled deck set and assess JSON validity, factual consistency, unsupported-claim rate, citation exact-match rate, reviewer agreement, completion latency, timeout/error handling, and the difference between human and deterministic eligibility labels. Do not use model self-scores as proof of quality.
