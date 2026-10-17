/**
 * Masar — T11: بناء المطابقات للملف الحالي (src/lib/server/matches.ts)
 * ---------------------------------------------------------------------------
 * مسؤوليات الملف:
 *  1) تحويل صف StartupProfile (fieldsJson محلول + founders + documents) إلى
 *     ProfileSnapshot الجاهز للمحرك (T3).
 *  2) تحميل الفرص status=PUBLISHED فقط (وأرشيف لا يظهر — §6) وتقييم كل فرصة:
 *     loadRuleConditions (T10 — استيراد حصرًا، لا تحويل موازٍ هنا) ← evaluateEligibility
 *     ← computeFitScore **فقط** إن كان الحكم ELIGIBLE/UNCERTAIN (عقد §8) ←
 *     computeReliability لكل فرصة (لا تعتمد على الملف).
 *  3) الفرصة المُعادة نسخة compact: id/title/orgName/type/amounts/sectors/
 *     geography/deadline/verifiedAt/applicationUrl/currentVersion.
 *  4) الترتيب (rankMatches): NOT_ELIGIBLE أخيرًا دائمًا؛ ضمن الباقي الملاءمة
 *     تنازليًّا ثم الاسم ثم المعرف — كسر تعادل حتمي ⇒ نفس المدخلات نفس الترتيب.
 *  5) «ماذا لو» (buildMatchesForWhatIf): نسخة معدّلة **في الذاكرة فقط** تبدأ من
 *     الحقول الحالية وتستبدل ما جاء في المدخلات (بالمصدر "manual" الوهمي «ماذا لو»)
 *     مع founderOverrides إن جاءت — لا يُكتب شيء في القاعدة ولا في سجل التدقيق.
 *
 * الحتمية: كل الدوال تقبل `now` قابلًا للحقن (المسارات تمرر undefined ⇒ وقت
 * الطلب)؛ نفس (snapshot, الفرص, now) ⇒ نفس المطابقات والدرجات والترتيب حرفيًّا.
 * القراءة فقط: لا create/update/delete في أي جدول هنا، ولا audit.
 */
import type {
  CompanyDocument,
  Founder,
  Opportunity,
  StartupProfile,
} from "@prisma/client";
import { ApiErrorClass, parseJsonField, prisma } from "./api";
// شروط الفرصة كـ RuleCondition — ملكية T10 (عقد §5)، نستوردها ولا نعيد كتابتها:
import { loadRuleConditions } from "./conditions";
import { evaluateEligibility } from "@/lib/core/engine";
import { computeFitScore, computeReliability } from "@/lib/core/scoring";
import type { OpportunityForScoring } from "@/lib/core/scoring";
import type {
  ConditionResult,
  ConditionStatus,
  EligibilityResult,
  EvidenceState,
  FitFactorResult,
  FitScoreResult,
  Judgment,
  ProfileFieldKey,
  ProfileFieldValue,
  ProfileSnapshot,
  ReliabilityInput,
  ReliabilityResult,
  RuleCondition,
} from "@/lib/core/types";

// ————— عقد §5: التوقيع حرفيًّا — opportunity: any (البنية الفعلية CompactOpportunity) —————

/** نسخة الفرصة المُعادة للمطابقات (compact) — لا وصف طويل ولا شروط خام. */
export interface CompactOpportunity {
  id: string;
  title: string;
  orgName: string;
  type: string;
  amounts: { min: number | null; max: number | null; currency: string };
  sectors: string[];
  geography: string;
  deadline: string | null;
  verifiedAt: string | null;
  applicationUrl: string | null;
  currentVersion: number;
}

/** ناتج المطابقة لفرصة واحدة (عقد §5 — opportunity: any عمدًا). */
export interface MatchEntry {
  // «any» مضطر عقدًا (§5) — البنية الفعلية موثقة أعلاه في CompactOpportunity.
  opportunity: any;
  eligibility: EligibilityResult;
  fit: FitScoreResult | null; // null لـ NOT_ELIGIBLE (مسؤولية المستدعي — §8)
  reliability: ReliabilityResult;
}

// ————— مدخلات «ماذا لو» (مطابقة شكل WhatIfInput من schemas دون استيراده) —————

export interface WhatIfFieldOverride {
  field: string;
  value?: unknown;
}

export interface WhatIfFounderOverride {
  name?: string;
  region?: string;
  nationality?: string;
  isPrimary?: boolean;
}

export interface WhatIfOverrides {
  fields?: WhatIfFieldOverride[] | null;
  founderOverrides?: WhatIfFounderOverride[] | null;
}

// ————— الترتيب —————

/**
 * ترتيب المطابقات (§6/T11): NOT_ELIGIBLE أخيرًا؛ ضمن الباقي بالملاءمة تنازليًّا،
 * ثم الاسم (تصاعديًّا) ثم المعرف — كسر تعادل كامل لضمان الحتمية.
 * مستقرة: لا تعدل المصفوفة المدخلة.
 */
export function rankMatches(entries: MatchEntry[]): MatchEntry[] {
  const sorted = [...entries];
  sorted.sort((a, b) => {
    const ra = a.eligibility.judgment === "NOT_ELIGIBLE" ? 1 : 0;
    const rb = b.eligibility.judgment === "NOT_ELIGIBLE" ? 1 : 0;
    if (ra !== rb) return ra - rb; // NOT_ELIGIBLE آخرًا دائمًا
    const fa = a.fit && typeof a.fit.total === "number" ? a.fit.total : -1;
    const fb = b.fit && typeof b.fit.total === "number" ? b.fit.total : -1;
    if (fa !== fb) return fb - fa; // الملاءمة تنازليًّا
    const ta = String((a.opportunity as CompactOpportunity | null)?.title ?? "");
    const tb = String((b.opportunity as CompactOpportunity | null)?.title ?? "");
    if (ta !== tb) return ta < tb ? -1 : 1; // الاسم (كسر تعادل حتمي بلا Intl)
    const ia = String((a.opportunity as CompactOpportunity | null)?.id ?? "");
    const ib = String((b.opportunity as CompactOpportunity | null)?.id ?? "");
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
  return sorted;
}

// ————— تحويلات صفوف Prisma —————

type ProfileRow = StartupProfile & { founders: Founder[]; documents: CompanyDocument[] };

const DOC_STATUSES: readonly string[] = ["available", "missing", "expired"];

/** صف الملف → ProfileSnapshot (fieldsJson محلول + founders + documents). */
function snapshotFromRow(row: ProfileRow): ProfileSnapshot {
  const rawFields = parseJsonField<ProfileFieldValue[]>(row.fieldsJson, []);
  const fields: ProfileFieldValue[] = [];
  if (Array.isArray(rawFields)) {
    for (const f of rawFields) {
      if (f && typeof f.field === "string") fields.push(f as ProfileFieldValue);
    }
  }
  return {
    fields,
    founders: (row.founders ?? []).map((f) => ({
      name: f.name ?? null,
      region: f.region ?? null,
      nationality: f.nationality ?? null,
      isPrimary: f.isPrimary === true,
    })),
    documents: (row.documents ?? []).map((d) => ({
      docType: d.docType,
      status: (DOC_STATUSES.includes(d.status) ? d.status : "missing") as
        "available" | "missing" | "expired", // قيمة غير معروفة → missing (دفاعي)
    })),
  };
}

/** نسخة الفرصة المختصرة المُعادة للمطابقات. */
export function compactOpportunity(opp: Opportunity): CompactOpportunity {
  return {
    id: opp.id,
    title: opp.title,
    orgName: opp.orgName,
    type: opp.type,
    amounts: { min: opp.amountMin ?? null, max: opp.amountMax ?? null, currency: opp.currency },
    sectors: parseJsonField<string[]>(opp.sectorsJson, []),
    geography: opp.geography,
    deadline: opp.deadline ? new Date(opp.deadline).toISOString() : null,
    verifiedAt: opp.verifiedAt ? new Date(opp.verifiedAt).toISOString() : null,
    applicationUrl: opp.applicationUrl ?? null,
    currentVersion: opp.currentVersion,
  };
}

/** حقول الفرصة ذات الصلة بالملاءمة → OpportunityForScoring (T4). */
export function scoringInputFromOpportunity(opp: Opportunity): OpportunityForScoring {
  return {
    sectors: parseJsonField<string[]>(opp.sectorsJson, []),
    stageMin: opp.stageMin ?? null,
    stageMax: opp.stageMax ?? null,
    amountMin: opp.amountMin ?? null,
    amountMax: opp.amountMax ?? null,
    fundingType: opp.fundingType ?? null,
    geoPriority: opp.geoPriority === true,
    languages: parseJsonField<string[]>(opp.languagesJson, ["ar"]),
    requiresDocs: parseJsonField<string[]>(opp.requiresDocsJson, []),
    deadline: opp.deadline ? new Date(opp.deadline).toISOString() : null,
  };
}

// ————— بناء المطابقات —————

/**
 * المطابقات لـ ProfileSnapshot معطى (يستخدمه GET /matches ومسار what-if الداخلي
 * والفحص السريع للزوار): يقيّم كل فرصة PUBLISHED ويعيد القائمة مرتبة (rankMatches).
 * القراءة فقط — لا كتابة في أي جدول ولا سجل تدقيق.
 */
export async function buildMatchesForSnapshot(
  snapshot: ProfileSnapshot,
  now?: Date
): Promise<MatchEntry[]> {
  const opps = await prisma.opportunity.findMany({
    where: { status: "PUBLISHED" }, // المؤسس يرى PUBLISHED فقط (§6) — الأرشيف لا يظهر
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], // قراءة حتمية؛ الترتيب النهائي يفرضه rankMatches
  });
  const entries: MatchEntry[] = [];
  for (const opp of opps) {
    // شروط الفرصة كـ RuleCondition — تحويل T10 حصرًا (استيراد، لا تحويل inline)
    const conditions: RuleCondition[] = await loadRuleConditions(opp.id);
    const eligibility = evaluateEligibility(snapshot, conditions, now);
    // الملاءمة تُحسب فقط للحكم ELIGIBLE/UNCERTAIN (§8) — null لغير ذلك
    const fit: FitScoreResult | null =
      eligibility.judgment === "ELIGIBLE" || eligibility.judgment === "UNCERTAIN"
        ? computeFitScore(snapshot, scoringInputFromOpportunity(opp), now)
        : null;
    // الموثوقية صفة الفرصة (لا تعتمد على الملف): مصدر + حداثة + تغطية أدلة + سلامة الرابط
    const mandatoryCount = conditions.filter((c) => c && c.mandatory === true).length;
    const mandatoryWithEvidence = eligibility.conditions.filter(
      (r) => r.mandatory && r.evidenceState === "ok"
    ).length;
    const reliability = computeReliability(
      {
        sourceType: opp.sourceType as ReliabilityInput["sourceType"],
        verifiedAt: opp.verifiedAt ? new Date(opp.verifiedAt).toISOString() : null,
        mandatoryConditionCount: mandatoryCount,
        mandatoryWithEvidenceCount: mandatoryWithEvidence,
        linkCheckState: opp.linkCheckState as ReliabilityInput["linkCheckState"],
      },
      now
    );
    entries.push({
      opportunity: compactOpportunity(opp),
      eligibility,
      fit,
      reliability,
    });
  }
  return rankMatches(entries);
}

/** تحميل ملف (fieldsJson محلول + founders + documents) كـ ProfileSnapshot. */
export async function loadProfileSnapshot(profileId: string): Promise<ProfileSnapshot | null> {
  const row = await prisma.startupProfile.findUnique({
    where: { id: profileId },
    include: { founders: true, documents: true },
  });
  return row ? snapshotFromRow(row) : null;
}

/**
 * عقد §5 (التوقيع حرفيًّا — now? اختياري للحقن في التحقق الذاتي):
 * يحمّل الملف ← يجري المطابقات على كل فرصة PUBLISHED ← يعيد القائمة مرتبة.
 * يرمي ApiErrorClass(NO_PROFILE) إن لم يوجد الملف.
 */
export async function buildMatchesForProfile(
  profileId: string,
  now?: Date
): Promise<MatchEntry[]> {
  const snapshot = await loadProfileSnapshot(profileId);
  if (!snapshot) {
    throw new ApiErrorClass("NO_PROFILE", "ملف الشركة غير موجود — أنشئ الملف أولًا", 404);
  }
  return buildMatchesForSnapshot(snapshot, now);
}

// ————— «ماذا لو» (في الذاكرة فقط) —————

/**
 * نسخة «ماذا لو» من الملف **في الذاكرة فقط** (لا حفظ):
 * تبدأ من الحقول الحالية وتستبدل ما جاء في overrides.fields — القيمة الدخيلة
 * تأخذ المصدر "manual" الوهمي «ماذا لو» (لا تدخل القاعدة أبدًا) — وfounderOverrides
 * إن جاءت تحل محل المؤسسين الحاليين في النسخة (founder.region يُقرأ من founders
 * أولًا — §7 — لذا تغيير إقامة المؤسس يتم عبر founderOverrides).
 * المستندات تبقى كما هي (تُقرأ من القاعدة للقراءة فقط).
 */
export async function buildWhatIfSnapshot(
  profileId: string,
  overrides: WhatIfOverrides
): Promise<ProfileSnapshot> {
  const row = await prisma.startupProfile.findUnique({
    where: { id: profileId },
    include: { founders: true, documents: true },
  });
  if (!row) {
    throw new ApiErrorClass("NO_PROFILE", "ملف الشركة غير موجود — أنشئ الملف أولًا", 404);
  }

  // حقول حالية، ثم استبدال المدخلات (ترتيب الإدراج محفوظ — Map حتمية)
  const byKey = new Map<string, ProfileFieldValue>();
  const currentFields = parseJsonField<ProfileFieldValue[]>(row.fieldsJson, []);
  if (Array.isArray(currentFields)) {
    for (const f of currentFields) {
      if (f && typeof f.field === "string") byKey.set(f.field, f as ProfileFieldValue);
    }
  }
  const overrideFields = overrides && Array.isArray(overrides.fields) ? overrides.fields : [];
  for (const o of overrideFields) {
    if (!o || typeof o.field !== "string") continue;
    byKey.set(o.field, {
      field: o.field as ProfileFieldKey,
      value: o.value === undefined ? null : o.value, // undefined ⇒ «غير مذكور» لا تخمين
      source: "manual", // المصدر الوهمي «ماذا لو» — نسخة ذاكرة لا تُحفظ
    });
  }

  let founders: ProfileSnapshot["founders"] = (row.founders ?? []).map((f) => ({
    name: f.name ?? null,
    region: f.region ?? null,
    nationality: f.nationality ?? null,
    isPrimary: f.isPrimary === true,
  }));
  const fo = overrides && overrides.founderOverrides;
  if (Array.isArray(fo)) {
    founders = fo.map((o) => ({
      name: o?.name ?? null,
      region: o?.region ?? null,
      nationality: o?.nationality ?? null,
      isPrimary: o?.isPrimary === true,
    }));
  }

  return {
    fields: [...byKey.values()],
    founders,
    documents: (row.documents ?? []).map((d) => ({
      docType: d.docType,
      status: (DOC_STATUSES.includes(d.status) ? d.status : "missing") as
        "available" | "missing" | "expired",
    })),
  };
}

/**
 * «ماذا لو»: مطابقات على النسخة المعدّلة في الذاكرة — **لا يُكتب شيء في القاعدة
 * ولا في سجل التدقيق** (القراءة فقط عبر buildMatchesForSnapshot).
 */
export async function buildMatchesForWhatIf(
  profileId: string,
  overrides: WhatIfOverrides,
  now?: Date
): Promise<MatchEntry[]> {
  const snapshot = await buildWhatIfSnapshot(profileId, overrides);
  return buildMatchesForSnapshot(snapshot, now);
}

// ————— فرق الأحكام (ماذا لو) —————

export interface JudgmentChange {
  opportunityId: string;
  title: string;
  oldJudgment: Judgment;
  newJudgment: Judgment;
}

/**
 * الفرص التي تغيّر حكمها فقط: القديم من الملف الحقيقي (current) والجديد من نسخة
 * «ماذا لو» (whatIf). الترتيب يتبع ترتيب whatIf المرتب — حتمي.
 */
export function diffJudgments(current: MatchEntry[], whatIf: MatchEntry[]): JudgmentChange[] {
  const oldById = new Map<string, Judgment>();
  for (const m of current) {
    oldById.set(String((m.opportunity as CompactOpportunity | null)?.id ?? ""), m.eligibility.judgment);
  }
  const changes: JudgmentChange[] = [];
  for (const m of whatIf) {
    const id = String((m.opportunity as CompactOpportunity | null)?.id ?? "");
    const oldJudgment = oldById.get(id);
    if (oldJudgment && oldJudgment !== m.eligibility.judgment) {
      changes.push({
        opportunityId: id,
        title: String((m.opportunity as CompactOpportunity | null)?.title ?? ""),
        oldJudgment,
        newJudgment: m.eligibility.judgment,
      });
    }
  }
  return changes;
}

// ————— صيغ الرد (compact) —————

/** شرط مختصر للرد: field/op/mandatory/status/evidenceState/expected/actual + الاختياريّات. */
export interface CompactCondition {
  field: string;
  op: string;
  mandatory: boolean;
  status: ConditionStatus;
  evidenceState: EvidenceState;
  expected: string;
  actual: string;
  unresolvedReason?: string;
  sourceWording?: string | null;
  evidence?: { url: string; quote: string; verifiedAt: string } | null;
}

/** شكل عنصر الرد في GET /matches وwhat-if (conditions مختصرة). */
export interface MatchResponse {
  opportunity: CompactOpportunity;
  judgment: Judgment;
  summary: string;
  summaryEn?: string;
  blockingReasons: string[];
  blockingReasonsEn?: string[];
  uncertainReasons: string[];
  uncertainReasonsEn?: string[];
  conditions: CompactCondition[];
  fit: { total: number; factors: FitFactorResult[] } | null;
  reliability: { total: number; level: string; warningAr?: string; warningEn?: string };
}

function compactCondition(r: ConditionResult): CompactCondition {
  const out: CompactCondition = {
    field: r.field,
    op: r.op,
    mandatory: r.mandatory,
    status: r.status,
    evidenceState: r.evidenceState,
    expected: r.expected,
    actual: r.actual,
  };
  if (r.unresolvedReason !== undefined) out.unresolvedReason = r.unresolvedReason;
  if (r.sourceWording !== null && r.sourceWording !== undefined) out.sourceWording = r.sourceWording;
  if (r.evidence) {
    out.evidence = { url: r.evidence.url, quote: r.evidence.quote, verifiedAt: r.evidence.verifiedAt };
  }
  return out;
}

/** MatchEntry → شكل الرد المختصر (نفس الشكل في GET /matches وwhat-if). */
export function toMatchResponse(entry: MatchEntry): MatchResponse {
  return {
    opportunity: entry.opportunity as CompactOpportunity,
    judgment: entry.eligibility.judgment,
    summary: entry.eligibility.summary,
    ...(entry.eligibility.summaryEn ? { summaryEn: entry.eligibility.summaryEn } : {}),
    blockingReasons: entry.eligibility.blockingReasons,
    ...(entry.eligibility.blockingReasonsEn ? { blockingReasonsEn: entry.eligibility.blockingReasonsEn } : {}),
    uncertainReasons: entry.eligibility.uncertainReasons,
    ...(entry.eligibility.uncertainReasonsEn ? { uncertainReasonsEn: entry.eligibility.uncertainReasonsEn } : {}),
    conditions: entry.eligibility.conditions.map(compactCondition),
    fit: entry.fit ? { total: entry.fit.total, factors: entry.fit.factors } : null,
    reliability: {
      total: entry.reliability.total,
      level: entry.reliability.level,
      ...(entry.reliability.warningAr !== undefined ? { warningAr: entry.reliability.warningAr } : {}),
      ...(entry.reliability.warningEn !== undefined ? { warningEn: entry.reliability.warningEn } : {}),
    },
  };
}

/** شكل عنصر الرد في الفحص السريع للزوار (بلا شروط ولا موثوقية). */
export interface QuickMatchResponse {
  opportunity: CompactOpportunity;
  judgment: Judgment;
  summary: string;
  summaryEn?: string;
  uncertainReasons: string[];
  uncertainReasonsEn?: string[];
  fit: { total: number; factors: FitFactorResult[] } | null;
}

export function toQuickMatchResponse(entry: MatchEntry): QuickMatchResponse {
  return {
    opportunity: entry.opportunity as CompactOpportunity,
    judgment: entry.eligibility.judgment,
    summary: entry.eligibility.summary,
    ...(entry.eligibility.summaryEn ? { summaryEn: entry.eligibility.summaryEn } : {}),
    uncertainReasons: entry.eligibility.uncertainReasons,
    ...(entry.eligibility.uncertainReasonsEn ? { uncertainReasonsEn: entry.eligibility.uncertainReasonsEn } : {}),
    fit: entry.fit ? { total: entry.fit.total, factors: entry.fit.factors } : null,
  };
}
