import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const read = async (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const [pkgText, schema, nextConfig, gitignore, envExample, orchestrator, engine] = await Promise.all([
  read("package.json"), read("prisma/schema.prisma"), read("next.config.ts"), read(".gitignore"),
  read(".env.example"), read("src/lib/ai/agent-orchestrator.ts"), read("src/lib/core/engine.ts"),
]);
const pkg = JSON.parse(pkgText);
assert.equal(schema.match(/provider\s*=\s*"postgresql"/)?.length, 1, "Prisma datasource must use PostgreSQL");
assert.ok(pkg.scripts?.build?.includes("next build"), "Build script must run Next.js build");
assert.ok(pkg.scripts?.["start:render"]?.includes("prisma db push"), "Render startup must initialize the schema");
assert.ok(!/ignoreBuildErrors\s*:\s*true/.test(nextConfig), "TypeScript build errors must not be ignored");
assert.match(gitignore, /^\.env\.\*$/m, "Environment files must be ignored");
assert.match(gitignore, /^db\/\*.db$/m, "Local database files must be ignored");
assert.match(gitignore, /^storage\/decks\/\*$/m, "Uploaded pitch decks must be ignored");
assert.match(envExample, /^OPENAI_API_KEY=$/m, "Example environment file must not contain a real key");
const roles = (orchestrator.match(/^  \{ id: /gm) ?? []).length;
assert.equal(roles, 20, `Expected 20 specialist roles, found ${roles}`);
assert.match(engine, /summaryEn:\s*buildSummaryEn/, "Deterministic eligibility must expose English result summaries");
console.log("Release configuration smoke checks passed (dependency build still needs npm install).");
