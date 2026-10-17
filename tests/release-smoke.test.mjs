import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Prisma source is PostgreSQL, not a local SQLite database", async () => {
  const schema = await read("prisma/schema.prisma");
  assert.match(schema, /provider\s*=\s*"postgresql"/);
  assert.doesNotMatch(schema, /provider\s*=\s*"sqlite"/);
});

test("agent workflow defines exactly twenty specialist roles", async () => {
  const source = await read("src/lib/ai/agent-orchestrator.ts");
  assert.equal((source.match(/^  \{ id: /gm) ?? []).length, 20);
  assert.match(source, /StateGraph\(PitchReviewGraphState\)/);
  assert.match(source, /new Send\("review"/);
  assert.match(source, /maxConcurrency:\s*AGENT_CONCURRENCY/);
  assert.match(source, /synthesisResponse/);
  const pkg = JSON.parse(await read("package.json"));
  assert.ok(pkg.dependencies["@langchain/langgraph"], "LangGraph.js must be a production dependency");
});

test("AI credentials are blank in the example environment", async () => {
  const env = await read(".env.example");
  assert.match(env, /^OPENAI_API_KEY=$/m);
});

test("standalone Next.js startup and deployment health check are configured", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const render = await read("render.yaml");
  assert.match(pkg.scripts.build, /next build/);
  assert.match(pkg.scripts["start:render"], /prisma db push/);
  assert.match(render, /healthCheckPath:\s*\/api\/v1\/health/);
});

test("eligibility exposes a separate deterministic English explanation", async () => {
  const engine = await read("src/lib/core/engine.ts");
  assert.match(engine, /function buildSummaryEn/);
  assert.match(engine, /blockingReasonsEn: blockingReasonsEn\(results\)/);
  assert.match(engine, /uncertainReasonsEn: uncertainReasonsEn\(results\)/);
});

test("profile API accepts primitive arrays and founder-row updates atomically", async () => {
  const schemas = await read("src/lib/schemas/index.ts");
  const profileRoute = await read("src/app/api/v1/profile/route.ts");
  const profileView = await read("src/components/views/ProfileView.tsx");
  assert.match(schemas, /const ProfileValueSchema = z\.union\(\[/);
  assert.match(schemas, /z\.array\(z\.union\(\[z\.string\(\), z\.number\(\), z\.boolean\(\)\]\)\)/);
  assert.match(schemas, /Exactly one primary founder is required/);
  assert.match(profileRoute, /await tx\.founder\.deleteMany/);
  assert.match(profileRoute, /await tx\.founder\.createMany/);
  assert.match(profileView, /payload\.founders\s*=\s*draft\.founders\.map/);
});

test("pitch reviewer redacts personal identifiers before provider calls", async () => {
  const orchestrator = await read("src/lib/ai/agent-orchestrator.ts");
  assert.match(orchestrator, /const guards = await loadGuards\(\)/);
  assert.match(orchestrator, /title:\s*guards\.redactPii\(s\.title/);
  assert.match(orchestrator, /text:\s*guards\.redactPii\(s\.text/);
  assert.match(orchestrator, /guards\.citationCheck\(slides, slideIndex, quoteCandidate\)/);
});

test("readiness report translations have their shared type and explicit language inputs", async () => {
  const criteria = await read("src/lib/pitch/criteria.ts");
  const deckView = await read("src/components/views/DeckView.tsx");
  assert.match(criteria, /ReadinessLevel,\s*ReadinessReport/);
  assert.match(deckView, /function ReadinessCriteriaSection[\s\S]*?lang:\s*"ar"\s*\|\s*"en"/);
  assert.match(deckView, /function GapSection[\s\S]*?lang:\s*"ar"\s*\|\s*"en"/);
  assert.match(deckView, /function CompareResultView[\s\S]*?lang:\s*"ar"\s*\|\s*"en"/);
});
