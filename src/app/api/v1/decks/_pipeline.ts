/**
 * Masar — T12: خط معالجة العرض المشترك ومساعداته
 * =====================================================
 * يشترك بين POST /api/v1/decks (الرفع) و POST …/versions/[v]/retry
 * (إعادة المعالجة)، ويوفّر مساعدات الملكية (IDOR) والتحليل الدفاعي
 * وبناء فروق المقارنة لـ GET …/compare.
 *
 * مبادئ ملزِمة (AGENT_CONTRACT §10):
 *  - المعالجة متزامنة داخل الطلب بمهلة إجمالية (PROCESS_BUDGET_MS)؛ تجاوزها
 *    يُختم النسخة PARTIAL برسالة عربية (لا 500 أبدًا — كل فشل مُغلَّف).
 *  - نص الشرائح بيانات لا تعليمات: كشف الحقن (T5) تبليغ فقط في statusMessage
 *    ثم تُستكمل المعالجة.
 *  - كل حقل مستخرج يمرّ Citation Guard (داخل extractDeckFields — T6)؛ الساقط
 *    يُعلَّم dropped مع droppedReason ويبقى ظاهرًا للمؤسس للتفسير.
 *  - «لا يدخل الملف أي حقل قبل confirm-profile» — هذا الملف لا يكتب fieldsJson
 *    إطلاقًا (الدمج في مسار confirm-profile وحده).
 *  - التناقضات (detectContradictions) دالة حتمية نقية — تُحسب عند القراءة
 *    (GET النسخة) بدل تخزينها، احترامًا لتعليق مخطط Prisma (claimsJson: Claim[]).
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Deck, DeckVersion, StartupProfile } from "@prisma/client";
import { ApiErrorClass, parseJsonField, prisma } from "@/lib/server/api";
import { detectPromptInjection } from "@/lib/core/guards";
import { extractDeckFields } from "@/lib/ai/extract";
import { runPitchReviewAgents } from "@/lib/ai/agent-orchestrator";
import type { PitchAgentReview } from "@/lib/ai/agent-types";
import { extractClaims } from "@/lib/pitch/claims";
import { evaluateReadiness } from "@/lib/pitch/criteria";
import { buildGapReport } from "@/lib/pitch/gap";
import { buildMatchesForProfile, loadProfileSnapshot } from "@/lib/server/matches";
import type { MatchEntry } from "@/lib/server/matches";
import { PROFILE_FIELD_KEYS } from "@/lib/core/types";
import type {
  ClaimItem,
  CriterionResult,
  ExtractedField,
  GapReport,
  ProfileSnapshot,
  ReadinessReport,
  Slide,
} from "@/lib/core/types";

/** مهلة المعالجة الإجمالية داخل الطلب (أطول من مهلة النموذج 60 ثانية بهامش). */
export const PROCESS_BUDGET_MS = 120_000;

/** تنبيه الحقن الحرفي (§10: النص بيانات — يستمر المعالجة). */
export const INJECTION_NOTE_AR = "يحتوي النص أنماط تعليمات مشبوهة — عومل بوصفه بيانات";

// ————— التخزين المحلي (storage/decks) —————

/** مجلد تخزين ملفات العروض الأصلية (البديل المحلي لـ S3 — §2). */
export function decksStorageDir(): string {
  // Resolve a configurable absolute path for containers/persistent volumes.
  // Local development defaults to ./storage/decks; hosted ephemeral storage is not durable.
  const configured = process.env.MASAR_STORAGE_DIR?.trim();
  return path.resolve(configured || path.join(process.cwd(), "storage", "decks"));
}

/** مسار ملف نسخة العرض: storage/decks/{deckVersionId}.{pdf|pptx}. */
export function deckStoragePath(versionId: string, fileType: string): string {
  // النوع كما خُزّن (pdf | pptx)؛ أي قيمة شاذة تُطهَّر إلى «bin» لتفادي مسارات خادعة
  const safeType = /^(pdf|pptx)$/.test(fileType) ? fileType : "bin";
  return path.join(decksStorageDir(), `${versionId}.${safeType}`);
}

/** حفظ الملف الأصلي (ينشئ المجلد تكراريًّا احتياطًا). */
export async function saveDeckFile(versionId: string, fileType: string, buf: Buffer): Promise<void> {
  await mkdir(decksStorageDir(), { recursive: true });
  await writeFile(deckStoragePath(versionId, fileType), buf);
}

/** رقم النسخة من مسار URL — رقم موجب فقط (لا «all» ولا نص). */
export function parseVersionParam(v: string): number {
  if (!/^[1-9]\d*$/.test(v)) {
    throw new ApiErrorClass("BAD_VERSION", "رقم النسخة غير صالح — رقم موجب فقط", 400);
  }
  return parseInt(v, 10);
}

// ————— الملكية (IDOR: كل استعلام مقيّد بمالك المورد) —————

export async function getOwnedDeck(profileId: string, deckId: string): Promise<Deck | null> {
  if (!deckId) return null;
  return prisma.deck.findFirst({ where: { id: deckId, profileId } });
}

export async function getOwnedVersion(
  profileId: string,
  deckId: string,
  versionNumber: number,
): Promise<{ deck: Deck; version: DeckVersion } | null> {
  const deck = await getOwnedDeck(profileId, deckId);
  if (!deck) return null;
  const version = await prisma.deckVersion.findFirst({
    where: { deckId: deck.id, versionNumber },
  });
  return version ? { deck, version } : null;
}

/** أحدث عرض للملف (تُرفع عليه النسخ الجديدة) أو null. */
export async function latestDeckForProfile(profileId: string): Promise<Deck | null> {
  return prisma.deck.findFirst({
    where: { profileId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

// ————— تلميحات الاستخراج: الحقول الناقصة في الملف (أولوية للنموذج) —————

export function profileHintsFrom(profile: StartupProfile): string[] {
  const raw = parseJsonField<Array<{ field?: string; value?: unknown }>>(profile.fieldsJson, []);
  const present = new Set<string>();
  if (Array.isArray(raw)) {
    for (const f of raw) {
      if (!f || typeof f.field !== "string") continue;
      const v = f.value;
      const isEmpty =
        v === null ||
        v === undefined ||
        (typeof v === "string" && v.trim() === "") ||
        (Array.isArray(v) && v.length === 0);
      if (!isEmpty) present.add(f.field);
    }
  }
  return (PROFILE_FIELD_KEYS as readonly string[]).filter((k) => !present.has(k)).slice(0, 12);
}

// ————— تحليل دفاعي لحقول JSON المخزنة كنص —————

export function parseSlides(raw: string): Slide[] {
  const parsed = parseJsonField<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (s): s is Slide =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as { index?: unknown }).index === "number" &&
      typeof (s as { title?: unknown }).title === "string" &&
      typeof (s as { text?: unknown }).text === "string",
  );
}

export function parseExtraction(raw: string): ExtractedField[] {
  const parsed = parseJsonField<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (f): f is ExtractedField =>
      typeof f === "object" &&
      f !== null &&
      typeof (f as { key?: unknown }).key === "string" &&
      typeof (f as { page?: unknown }).page === "number" &&
      typeof (f as { quote?: unknown }).quote === "string",
  );
}

export function parseClaims(raw: string): ClaimItem[] {
  const parsed = parseJsonField<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (c): c is ClaimItem =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as { id?: unknown }).id === "string" &&
      typeof (c as { type?: unknown }).type === "string" &&
      typeof (c as { value?: unknown }).value === "number",
  );
}

export function parseReadiness(raw: string): ReadinessReport | null {
  const parsed = parseJsonField<unknown>(raw, {});
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { criteria?: unknown }).criteria)
  ) {
    return parsed as ReadinessReport;
  }
  return null;
}

export function parseGapReport(raw: string): GapReport | null {
  const parsed = parseJsonField<unknown>(raw, {});
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { perOpportunity?: unknown }).perOpportunity) &&
    Array.isArray((parsed as { notesAr?: unknown }).notesAr)
  ) {
    return parsed as GapReport;
  }
  return null;
}

// ————— خط المعالجة —————

export interface DeckAnalysis {
  status: "READY" | "PARTIAL" | "FAILED_EXTRACTION";
  statusMessage: string | null;
  slides: Slide[];
  fields: ExtractedField[];
  claims: ClaimItem[];
  readiness: ReadinessReport | null;
  gapReport: GapReport | null;
  agentReview: PitchAgentReview | null;
  provider: string;
  fileType: string;
}

export interface AnalysisContext {
  profileId: string;
  userId: string;
  deckVersionId: string;
  hints: string[];
  fileType: string;
  /** ختم زمني مطلق: بعده تُختصر المراحل المتبقية وتُعلَّم النسخة PARTIAL. */
  deadlineAt: number;
}

/** ناتج فشل كلي برسالة عربية مفهومة (ليس 500 أبدًا). */
export function failedAnalysis(fileType: string, messageAr: string, slides: Slide[] = []): DeckAnalysis {
  return {
    status: "FAILED_EXTRACTION",
    statusMessage: messageAr,
    slides,
    fields: [],
    claims: [],
    readiness: null,
    gapReport: null,
    agentReview: null,
    provider: "none",
    fileType,
  };
}

/**
 * تحليل كامل لشرائح مستخرجة: حقن → استخراج منظم (Citation Guard داخل T6)
 * → ادعاءات → جاهزية → فجوات. كل خطوة معزولة الفشل (لا استثناء يفلت).
 */
export async function analyzeSlides(slides: Slide[], ctx: AnalysisContext): Promise<DeckAnalysis> {
  const safeSlides = Array.isArray(slides)
    ? slides.filter((s) => typeof s === "object" && s !== null && typeof s.text === "string")
    : [];
  const nonEmpty = safeSlides.filter((s) => s.text.trim().length > 0);

  // (1) لا نص إطلاقًا → فشل كلي برسالة مفهومة
  if (nonEmpty.length === 0) {
    return failedAnalysis(
      ctx.fileType,
      "لم يُستخرج أي نص من الشرائح — قد يكون الملف صورًا ممسوحة ضوئيًا بلا طبقة نصية",
      safeSlides,
    );
  }

  const problems: string[] = []; // أسباب PARTIAL
  const notes: string[] = []; // تنبيهات لا تغيّر الحالة (الحقن)

  // (2) شرائح بلا نص جزئيًا → PARTIAL برسالة
  if (nonEmpty.length < safeSlides.length) {
    problems.push(
      `تعذّر استخراج النص من ${safeSlides.length - nonEmpty.length} شريحة من أصل ${safeSlides.length}`,
    );
  }

  // (3) كشف الحقن — النص بيانات: تبليغ فقط ثم استمرار (§10)
  try {
    const injection = detectPromptInjection(
      safeSlides.map((s) => `${s.title}\n${s.text}`).join("\n"),
    );
    if (injection.suspicious) notes.push(INJECTION_NOTE_AR);
  } catch {
    // الحارس نفسه لا يعطّل المعالجة أبدًا
  }

  // (4) الاستخراج المنظم: T6 + Citation Guard — الحقول الساقطة تبقى dropped مع سببها
  let fields: ExtractedField[] = [];
  let provider = "none";
  try {
    const res = await extractDeckFields(safeSlides, ctx.hints, {
      deckVersionId: ctx.deckVersionId,
      userId: ctx.userId,
    });
    fields = res.fields;
    provider = res.provider;
  } catch {
    problems.push("فشل الاستخراج المنظم للحقول — أعد المحاولة عبر إعادة المعالجة");
  }

  // (5) الادعاءات الرقمية (التناقضات تُحسب عند القراءة — دالة حتمية نقية)
  const claims = extractClaims(safeSlides);

  // (6) الجاهزية (9 معايير حتمية)
  const readiness = evaluateReadiness(safeSlides, fields);

  // (7) مراجعة مساعدة مستقلة: 20 مهمة متخصصة متوازية ثم عقدة synthesis.
  // تظل الأهلية حتمية بالكامل، ولا تُكتب أي نتيجة إلى ملف الشركة تلقائيًا.
  let agentReview: PitchAgentReview | null = null;
  if (Date.now() < ctx.deadlineAt - 4_000) {
    try {
      agentReview = await runPitchReviewAgents(safeSlides, { deckVersionId: ctx.deckVersionId, userId: ctx.userId }, ctx.deadlineAt);
    } catch {
      // فشل المراجعة متعددة المهام لا يعطل الاستخراج أو الأهلية.
      agentReview = null;
    }
  }

  // (8) تقرير الفجوات — أفضل 8 مطابقات فقط للملف الحالي، ضمن المهلة
  let gapReport: GapReport | null = null;
  if (Date.now() < ctx.deadlineAt) {
    try {
      const snapshot = await loadProfileSnapshot(ctx.profileId);
      if (snapshot) {
        const matches = await buildMatchesForProfile(ctx.profileId);
        gapReport = await gapReportFromMatches(snapshot, matches.slice(0, 8), readiness);
      }
    } catch {
      problems.push("تعذّر توليد تقرير الفجوات — أعد المحاولة عبر إعادة المعالجة");
    }
  } else {
    problems.push("انتهت مهلة المعالجة قبل اكتمال تقرير الفجوات");
  }

  const status: DeckAnalysis["status"] = problems.length > 0 ? "PARTIAL" : "READY";
  const messageParts = [...problems, ...notes];
  return {
    status,
    statusMessage: messageParts.length > 0 ? messageParts.join("؛ ") : null,
    slides: safeSlides,
    fields,
    claims,
    readiness,
    gapReport,
    agentReview,
    provider,
    fileType: ctx.fileType,
  };
}

/** خزن نتيجة التحليل في صف DeckVersion (slidesJson نص الشرائح + المشتقات). */
export async function persistAnalysis(versionId: string, analysis: DeckAnalysis): Promise<void> {
  await prisma.deckVersion.update({
    where: { id: versionId },
    data: {
      status: analysis.status,
      statusMessage: analysis.statusMessage,
      slidesJson: JSON.stringify(analysis.slides),
      extractionJson: JSON.stringify(analysis.fields),
      claimsJson: JSON.stringify(analysis.claims),
      readinessJson: JSON.stringify(analysis.readiness ?? {}),
      gapReportJson: JSON.stringify(analysis.gapReport ?? {}),
      agentReviewJson: JSON.stringify(analysis.agentReview ?? {}),
      slideCount: analysis.slides.length,
      pageCount: analysis.fileType === "pdf" ? analysis.slides.length : 0,
    },
  });
}

/** تقرير الفجوات من مطابقات T11 (يتطلب requiresDocs من صف الفرصة — compact لا يحمله). */
async function gapReportFromMatches(
  snapshot: ProfileSnapshot,
  top: MatchEntry[],
  readiness: ReadinessReport,
): Promise<GapReport> {
  const ids = top
    .map((m) => String((m.opportunity as { id?: string } | null)?.id ?? ""))
    .filter((id) => id.length > 0);
  const rows =
    ids.length > 0
      ? await prisma.opportunity.findMany({
          where: { id: { in: ids } },
          select: { id: true, title: true, requiresDocsJson: true },
        })
      : [];
  const docsById = new Map(rows.map((r) => [r.id, parseJsonField<string[]>(r.requiresDocsJson, [])]));
  return buildGapReport(
    snapshot,
    top.map((m) => {
      // «any» مضطر — عقد §5 لمطابقات T11؛ البنية الفعلية CompactOpportunity
      const opp = m.opportunity as { id?: string; title?: string } | null;
      const id = String(opp?.id ?? "");
      return {
        opp: { id, title: String(opp?.title ?? ""), requiresDocs: docsById.get(id) ?? [] },
        result: m.eligibility,
      };
    }),
    readiness,
  );
}

// ————— شكل الملف في الرد (كم_GET /profile — مسار confirm-profile) —————

export interface StoredProfileField {
  field: string;
  value: unknown;
  source: "manual" | "deck";
  deckId?: string;
  deckVersion?: number;
  page?: number;
  quote?: string;
  confirmedAt?: string;
}

export function resolveProfileFields(raw: string): StoredProfileField[] {
  const parsed = parseJsonField<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (f): f is StoredProfileField =>
      typeof f === "object" && f !== null && typeof (f as { field?: unknown }).field === "string",
  );
}

export interface ProfilePayload {
  profile: {
    id: string;
    fields: StoredProfileField[];
    founders: Array<{
      id: string;
      name: string | null;
      region: string | null;
      nationality: string | null;
      isPrimary: boolean;
    }>;
    documents: Array<{
      docType: string;
      status: string;
      source: string | null;
      notes: string | null;
      updatedAt: string;
    }>;
    updatedAt: string;
  };
}

/** حمولة الملف كما يعيدها GET /profile (نفس الشكل — مستنسخة محليًّا لعدم استيراد ملف T14). */
export async function buildProfilePayload(profileId: string): Promise<ProfilePayload> {
  const profile = await prisma.startupProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw new ApiErrorClass("NO_PROFILE", "أنشئ ملف الشركة أولًا", 409);
  const [founders, documents] = await Promise.all([
    prisma.founder.findMany({ where: { profileId }, orderBy: { isPrimary: "desc" } }),
    prisma.companyDocument.findMany({ where: { profileId }, orderBy: { docType: "asc" } }),
  ]);
  return {
    profile: {
      id: profile.id,
      fields: resolveProfileFields(profile.fieldsJson),
      founders: founders.map((f) => ({
        id: f.id,
        name: f.name,
        region: f.region,
        nationality: f.nationality,
        isPrimary: f.isPrimary,
      })),
      documents: documents.map((d) => ({
        docType: d.docType,
        status: d.status,
        source: d.source,
        notes: d.notes,
        updatedAt: d.updatedAt.toISOString(),
      })),
      updatedAt: profile.updatedAt.toISOString(),
    },
  };
}

// ————— مقارنة نسختين (GET /decks/[id]/compare) —————

export interface ExtractionSide {
  value: unknown;
  page: number;
  quote: string;
  status: string;
}

export interface ExtractionChange {
  kind: "extraction";
  change: "added" | "removed" | "changed";
  key: string;
  from?: ExtractionSide;
  to?: ExtractionSide;
}

export interface ReadinessChange {
  kind: "readiness";
  change: "added" | "removed" | "changed";
  criterion: string;
  labelAr: string;
  from?: { level: string; evidenceAr: string };
  to?: { level: string; evidenceAr: string };
}

export interface ClaimSide {
  value: number;
  unit: string | null;
  page: number;
  quote: string;
}

export interface ClaimChange {
  kind: "claim";
  change: "added" | "removed" | "changed";
  claimType: string;
  from?: ClaimSide;
  to?: ClaimSide;
}

export type CompareChange = ExtractionChange | ReadinessChange | ClaimChange;

/** فروق الاستخراج: حقول بقيمة قديمة/جديدة (والإضافات والحذف) — الساقطة خارج المقارنة. */
function extractionChanges(from: ExtractedField[], to: ExtractedField[]): ExtractionChange[] {
  const fromMap = new Map(from.filter((f) => f.status !== "dropped").map((f) => [f.key, f]));
  const toMap = new Map(to.filter((f) => f.status !== "dropped").map((f) => [f.key, f]));
  const keys = [...new Set([...fromMap.keys(), ...toMap.keys()])].sort();
  const out: ExtractionChange[] = [];
  const side = (f: ExtractedField): ExtractionSide => ({
    value: f.value,
    page: f.page,
    quote: f.quote,
    status: f.status,
  });
  for (const key of keys) {
    const a = fromMap.get(key);
    const b = toMap.get(key);
    if (a && b) {
      if (JSON.stringify(a.value) !== JSON.stringify(b.value)) {
        out.push({ kind: "extraction", change: "changed", key, from: side(a), to: side(b) });
      }
    } else if (a) {
      out.push({ kind: "extraction", change: "removed", key, from: side(a) });
    } else if (b) {
      out.push({ kind: "extraction", change: "added", key, to: side(b) });
    }
  }
  return out;
}

/** فروق الجاهزية: معيار بمستوى قديم/جديد. */
function readinessChanges(from: ReadinessReport | null, to: ReadinessReport | null): ReadinessChange[] {
  const fromCriteria = new Map((from?.criteria ?? []).map((c) => [c.key, c]));
  const toCriteria = new Map((to?.criteria ?? []).map((c) => [c.key, c]));
  const keys = [...new Set([...fromCriteria.keys(), ...toCriteria.keys()])].sort();
  const out: ReadinessChange[] = [];
  const side = (c: CriterionResult) => ({ level: c.level, evidenceAr: c.evidenceAr });
  for (const key of keys) {
    const a = fromCriteria.get(key);
    const b = toCriteria.get(key);
    const labelAr = (a ?? b)?.labelAr ?? key;
    if (a && b) {
      if (a.level !== b.level) {
        out.push({ kind: "readiness", change: "changed", criterion: key, labelAr, from: side(a), to: side(b) });
      }
    } else if (a) {
      out.push({ kind: "readiness", change: "removed", criterion: key, labelAr, from: side(a) });
    } else if (b) {
      out.push({ kind: "readiness", change: "added", criterion: key, labelAr, to: side(b) });
    }
  }
  return out;
}

/**
 * فروق الادعاءات: جديدة/محذوفة/متغيرة القيمة. المطابقة داخل كل مجموعة
 * (type + unit) بترتيب القيمة — حتمية كاملة (نفس النسختين ⇒ نفس الفروق).
 */
function claimsChanges(from: ClaimItem[], to: ClaimItem[]): ClaimChange[] {
  const groups = new Map<string, { from: ClaimItem[]; to: ClaimItem[] }>();
  const groupKey = (c: ClaimItem) => `${c.type}:${(c.unit ?? "").toLowerCase()}`;
  for (const c of from) {
    const k = groupKey(c);
    const g = groups.get(k) ?? { from: [], to: [] };
    g.from.push(c);
    groups.set(k, g);
  }
  for (const c of to) {
    const k = groupKey(c);
    const g = groups.get(k) ?? { from: [], to: [] };
    g.to.push(c);
    groups.set(k, g);
  }
  const out: ClaimChange[] = [];
  const side = (c: ClaimItem): ClaimSide => ({
    value: c.value,
    unit: c.unit ?? null,
    page: c.page,
    quote: c.quote,
  });
  const byValue = (a: ClaimItem, b: ClaimItem) =>
    a.value - b.value || a.page - b.page || (a.quote < b.quote ? -1 : 1);
  for (const [k, g] of [...groups.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const claimType = k.split(":")[0];
    const f = [...g.from].sort(byValue);
    const t = [...g.to].sort(byValue);
    const pairs = Math.min(f.length, t.length);
    for (let i = 0; i < pairs; i++) {
      if (f[i].value !== t[i].value) {
        out.push({ kind: "claim", change: "changed", claimType, from: side(f[i]), to: side(t[i]) });
      }
    }
    for (let i = pairs; i < f.length; i++) {
      out.push({ kind: "claim", change: "removed", claimType, from: side(f[i]) });
    }
    for (let i = pairs; i < t.length; i++) {
      out.push({ kind: "claim", change: "added", claimType, to: side(t[i]) });
    }
  }
  return out;
}

/** كل فروق النسختين (استخراج + جاهزية + ادعاءات) بترتيب ثابت. */
export function buildCompareChanges(fromV: DeckVersion, toV: DeckVersion): CompareChange[] {
  return [
    ...extractionChanges(parseExtraction(fromV.extractionJson), parseExtraction(toV.extractionJson)),
    ...readinessChanges(parseReadiness(fromV.readinessJson), parseReadiness(toV.readinessJson)),
    ...claimsChanges(parseClaims(fromV.claimsJson), parseClaims(toV.claimsJson)),
  ];
}

export interface VersionSummary {
  versionNumber: number;
  status: string;
  statusMessage: string | null;
  fileType: string;
  fileName: string;
  slideCount: number;
  createdAt: string;
  fields: { confirmed: number; pending: number; dropped: number };
  claimsCount: number;
  readinessLevels: Record<string, string>;
}

/** ملخص نسخة للمقارنة (بلا نصوص كاملة). */
export function summarizeVersion(v: DeckVersion): VersionSummary {
  const extraction = parseExtraction(v.extractionJson);
  const claims = parseClaims(v.claimsJson);
  const readiness = parseReadiness(v.readinessJson);
  const readinessLevels: Record<string, string> = {};
  for (const c of readiness?.criteria ?? []) readinessLevels[c.key] = c.level;
  return {
    versionNumber: v.versionNumber,
    status: v.status,
    statusMessage: v.statusMessage,
    fileType: v.fileType,
    fileName: v.fileName,
    slideCount: v.slideCount,
    createdAt: v.createdAt.toISOString(),
    fields: {
      confirmed: extraction.filter((f) => f.status === "confirmed").length,
      pending: extraction.filter((f) => f.status === "pending" || f.status === "rejected").length,
      dropped: extraction.filter((f) => f.status === "dropped").length,
    },
    claimsCount: claims.length,
    readinessLevels,
  };
}

/** حذف ملف نسخة من التخزين (best-effort — عدم وجوده ليس خطأ). */
export async function removeDeckFile(versionId: string, fileType: string): Promise<void> {
  await rm(deckStoragePath(versionId, fileType), { force: true });
}
