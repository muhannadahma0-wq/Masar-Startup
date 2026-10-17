/**
 * Masar — T10: تحويل شروط Prisma إلى RuleCondition + مساعدات التغييرات والنسخ
 * =============================================================================
 * الملكية: ملف T10 حصرًا (خريطة §4 من العقد).
 *
 * الصادرات:
 *  1) loadRuleConditions(oppId) — العقد §5 حرفيًّا: شروط فرصة من القاعدة
 *     (valueJson يُحلل JSON، وevidence → { url, quote, verifiedAt: ISO }).
 *     قيمة valueJson غير القابلة للتحليل → null (مبدأ «null بدل التخمين»).
 *  2) reliabilityForOpp(opp, conditions) — حساب حيّ لمؤشر الموثوقية عبر
 *     computeReliability (T4) من حقول الفرصة + شروطها الإلزامية (تُستعمله
 *     قائمة الفرص وتفاصيلها — «محسوبة live»).
 *  3) مساعدات نقية للتغييرات (تُستعملها POST .../update ويتحقق منها check-opp):
 *     buildOppDiff / classifyChange / mandatoryConditionsChanged /
 *     summarizeDiffAr / summarizeConditionsAr — كلها حتمية بلا DB/شبكة.
 *
 * قرارات تفسيرية موثّقة:
 *  - «الشرط الإلزامي بدليل» في مؤشر الموثوقية = evidence موجود وبه url وquote
 *    غير فارغين (verifiedAt مطلوب في مخطط Evidence أصلًا).
 *  - ترتيب الشروط: بترتيب id تصاعديًّا (cuid رتيب زمنيًّا تقريبًا — ترتيب
 *    الإنشاء) لضمان خرج مستقر.
 *  - مصنّف التغيير الجوهري (§11 + نص المهمة): deadline / الشروط الإلزامية /
 *    المبلغ (amountMin أو amountMax أو currency أو fundingType — كلها من
 *    عائلة «المبلغ ونوع التمويل») / requiresDocs / status. الباقي غير جوهري.
 *  - تغيّر «الشروط الإلزامية» يُقاس بتوقيع مضغوط (field/op/value/scope/
 *    ambiguous) للشروط الإلزامية فقط — تحرير شرط غير إلزامي لا يعدّل
 *    الإلزامية فلا يستحق إشعارًا (لكنه يُسجَّل في النسخة كغير جوهري).
 *  - أولوية changeCategory عند تعدد الفئات: deadline > conditions > amount >
 *    documents > status > other (الموعد الأثر مباشرة على المتقدمين).
 */

import { prisma, parseJsonField, ApiErrorClass } from "@/lib/server/api";
import { computeReliability } from "@/lib/core/scoring";
import type {
  ChangeType,
  ConditionOp,
  OpportunityChange,
  ProfileFieldKey,
  ReliabilityInput,
  ReliabilityResult,
  RuleCondition,
  RuleEvidence,
} from "@/lib/core/types";

// ————————————————————————————————————————————————
// 1) loadRuleConditions (عقد §5)
// ————————————————————————————————————————————————

/** صف Condition من Prisma مع أدلته (الشكل الذي يعيده include: { evidence: true }). */
interface ConditionRow {
  id: string;
  field: string;
  op: string;
  valueJson: string;
  mandatory: boolean;
  ambiguous: boolean;
  scope: string;
  sourceWording: string | null;
  evidence: { url: string; quote: string; verifiedAt: Date } | null;
}

/**
 * يحوّل شروط فرصة (Prisma) إلى RuleCondition للمحرك الحتمي.
 * valueJson يُحلل JSON (فاشل التحليل → null)، وevidence يتحول إلى
 * { url, quote, verifiedAt: ISO }.
 */
export async function loadRuleConditions(oppId: string): Promise<RuleCondition[]> {
  if (typeof oppId !== "string" || oppId.trim() === "") return [];
  const rows = await prisma.condition.findMany({
    where: { opportunityId: oppId },
    include: { evidence: true },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => conditionRowToRule(row as unknown as ConditionRow));
}

function conditionRowToRule(row: ConditionRow): RuleCondition {
  const evidence: RuleEvidence | null = row.evidence
    ? {
        url: row.evidence.url,
        quote: row.evidence.quote,
        verifiedAt: toIso(row.evidence.verifiedAt),
      }
    : null;
  return {
    id: row.id,
    field: row.field as ProfileFieldKey,
    op: row.op as ConditionOp,
    value: parseJsonField<unknown>(row.valueJson, null),
    mandatory: row.mandatory === true,
    ambiguous: row.ambiguous === true,
    scope: row.scope === "all" ? "all" : "any",
    sourceWording: row.sourceWording ?? null,
    evidence,
  };
}

function toIso(d: Date | string | null | undefined): string {
  if (d instanceof Date) return d.toISOString();
  if (typeof d === "string") return d;
  return new Date(0).toISOString();
}

// ————————————————————————————————————————————————
// 2) reliabilityForOpp — مؤشر الموثوقية الحيّ للفرصة
// ————————————————————————————————————————————————

/** الحقول الداخلة في مؤشر الموثوقية من سجل Opportunity (+ علاقة شروط بأدلتها). */
export interface ReliabilityOppFields {
  sourceType: string;
  verifiedAt: Date | string | null;
  linkCheckState: string;
}

export interface ReliabilityConditionLite {
  mandatory: boolean;
  evidence: { url: string; quote: string } | null;
}

/**
 * computeReliability من حقول الفرصة + شروطها الإلزامية.
 * (الشروط تُمرَّر كما يعيدها Prisma مع include: { evidence: true }.)
 */
export function reliabilityForOpp(
  opp: ReliabilityOppFields,
  conditions: ReliabilityConditionLite[],
  now?: Date
): ReliabilityResult {
  const mandatory = conditions.filter((c) => c.mandatory === true);
  const withEvidence = mandatory.filter((c) => {
    if (!c?.evidence) return false;
    const url = typeof c.evidence.url === "string" ? c.evidence.url.trim() : "";
    const quote = typeof c.evidence.quote === "string" ? c.evidence.quote.trim() : "";
    return url.length > 0 && quote.length > 0;
  }).length;

  const input: ReliabilityInput = {
    sourceType: asSourceType(opp?.sourceType),
    verifiedAt: verifiedAtIso(opp?.verifiedAt),
    mandatoryConditionCount: mandatory.length,
    mandatoryWithEvidenceCount: withEvidence,
    // قيمة مجهولة تمر كما هي — computeReliability يعاملها 0 «غير معروفة» (لا تخمين)
    linkCheckState: (opp?.linkCheckState ?? "") as ReliabilityInput["linkCheckState"],
  };
  return computeReliability(input, now);
}

function asSourceType(v: string): ReliabilityInput["sourceType"] {
  return v === "official" || v === "trusted_aggregator" ? v : "other";
}

function verifiedAtIso(v: Date | string | null): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && v.trim() !== "") return v;
  return null;
}

// ————————————————————————————————————————————————
// 3) مساعدات نقية: diff + تصنيف + تلخيص عربي
// ————————————————————————————————————————————————

/** لقطة الحقول القابلة للتحديث (تقبل كائن Prisma أو كائن patch بعد التطبيق). */
export interface OpportunityScalarSnapshot {
  title: string;
  orgName: string;
  description: string;
  type: string;
  fundingType: string | null;
  amountMin: number | null;
  amountMax: number | null;
  currency: string;
  sectors: string[];
  stageMin: string | null;
  stageMax: string | null;
  geography: string;
  geoPriority: boolean;
  languages: string[];
  applicationUrl: string | null;
  sourceType: string;
  deadline: Date | string | null;
  deadlineTz: string;
  requiresDocs: string[];
}

const DIFF_FIELDS: Array<keyof OpportunityScalarSnapshot> = [
  "title", "orgName", "description", "type", "fundingType",
  "amountMin", "amountMax", "currency", "sectors", "stageMin", "stageMax",
  "geography", "geoPriority", "languages", "applicationUrl", "sourceType",
  "deadline", "deadlineTz", "requiresDocs",
];

/** تمثيل قيمة للفرق: التواريخ ISO والمصفوفات تبقى مصفوفات. */
function diffValue(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  return v;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(diffValue(a)) === JSON.stringify(diffValue(b));
}

/**
 * يبني فرق الحقول (قديم/جديد) بين لقطتين — أساس diffJson للنسخة.
 * لا يشمل الشروط (تُدار بمقالة «conditions» مستقلة في المسار).
 */
export function buildOppDiff(
  before: OpportunityScalarSnapshot,
  after: OpportunityScalarSnapshot
): OpportunityChange[] {
  const diff: OpportunityChange[] = [];
  for (const field of DIFF_FIELDS) {
    const oldV = before[field];
    const newV = after[field];
    if (!deepEqual(oldV, newV)) {
      diff.push({ field, oldValue: diffValue(oldV), newValue: diffValue(newV) });
    }
  }
  return diff;
}

/** فئات الحقول الجوهرية (نص المهمة + §11). */
const SUBSTANTIVE_FIELD_CATEGORY: Record<string, "deadline" | "amount" | "documents" | "status"> = {
  deadline: "deadline",
  amountMin: "amount",
  amountMax: "amount",
  currency: "amount",
  fundingType: "amount", // نوع التمويل من عائلة المبلغ ونوعه
  requiresDocs: "documents",
  status: "status",
};

export type ChangeCategory = "deadline" | "conditions" | "amount" | "documents" | "status" | "other";

export interface ChangeClassification {
  changeType: ChangeType;
  changeCategory: ChangeCategory | null;
}

const CATEGORY_PRIORITY: ChangeCategory[] = ["deadline", "conditions", "amount", "documents", "status", "other"];

/**
 * يصنّف فرقًا إلى جوهري/غير جوهري مع فئة التغيير.
 * - conditions: جوهري فقط إن تغيّرت الشروط الإلزامية (mandatoryConditionsChanged)؛
 *   إن لم يُمرَّر الخيار نفترض التغيّر (موثّق — السلوك المحافظ يستحق إشعارًا).
 * - مصفوفة فارغة → non_substantive بلا فئة.
 */
export function classifyChange(
  diff: OpportunityChange[],
  opts?: { mandatoryConditionsChanged?: boolean }
): ChangeClassification {
  let substantive = false;
  const categories = new Set<ChangeCategory>();
  for (const d of diff) {
    if (d.field === "conditions") {
      categories.add("conditions");
      const mandatoryChanged = opts?.mandatoryConditionsChanged ?? true;
      if (mandatoryChanged) substantive = true;
    } else if (SUBSTANTIVE_FIELD_CATEGORY[d.field]) {
      categories.add(SUBSTANTIVE_FIELD_CATEGORY[d.field]);
      substantive = true;
    } else {
      categories.add("other");
    }
  }
  const changeCategory = CATEGORY_PRIORITY.find((c) => categories.has(c)) ?? null;
  return {
    changeType: substantive ? "substantive" : "non_substantive",
    changeCategory: diff.length === 0 ? null : changeCategory,
  };
}

/** موجز شرط لأغراض مقارنة الإلزامية والتلخيص. */
export interface ConditionBrief {
  field: string;
  op: string;
  value: unknown;
  mandatory: boolean;
  scope: string;
  ambiguous: boolean;
}

function mandatorySignature(list: ConditionBrief[]): string {
  return JSON.stringify(
    list
      .filter((c) => c.mandatory === true)
      .map((c) => ({
        field: c.field,
        op: c.op,
        value: c.value === undefined ? null : c.value,
        scope: c.scope === "all" ? "all" : "any",
        ambiguous: c.ambiguous === true,
      }))
      .map((c) => JSON.stringify(c))
      .sort()
  );
}

/** هل تغيّرت الشروط الإلزامية بين مجموعتين (مضاف/محذوف/معدّل)؟ */
export function mandatoryConditionsChanged(a: ConditionBrief[], b: ConditionBrief[]): boolean {
  return mandatorySignature(a ?? []) !== mandatorySignature(b ?? []);
}

const DIFF_FIELD_LABELS_AR: Record<string, string> = {
  title: "العنوان",
  orgName: "الجهة",
  description: "الوصف",
  type: "نوع الفرصة",
  fundingType: "نوع التمويل",
  amountMin: "الحد الأدنى للمبلغ",
  amountMax: "الحد الأعلى للمبلغ",
  currency: "العملة",
  sectors: "القطاعات",
  stageMin: "المرحلة الدنيا",
  stageMax: "المرحلة العليا",
  geography: "النطاق الجغرافي",
  geoPriority: "الأولوية الجغرافية",
  languages: "لغات التقديم",
  applicationUrl: "رابط التقديم",
  sourceType: "نوع المصدر",
  deadline: "الموعد النهائي",
  deadlineTz: "المنطقة الزمنية للموعد",
  requiresDocs: "المستندات المطلوبة",
  status: "الحالة",
  conditions: "الشروط",
};

function fmtValAr(v: unknown): string {
  if (v === null || v === undefined) return "بلا قيمة";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.length > 0 ? v.join("، ") : "بلا قيمة";
  if (typeof v === "boolean") return v ? "نعم" : "لا";
  if (typeof v === "string") return v.length > 60 ? v.slice(0, 59) + "…" : v;
  return String(v);
}

/** ملخص عربي موجز للفرق (يدخل في حمولة الإشعار وفي سبب النسخة). */
export function summarizeDiffAr(diff: OpportunityChange[], maxLength = 600): string {
  const parts = diff.map((d) => {
    const label = DIFF_FIELD_LABELS_AR[d.field] ?? d.field;
    return `${label}: ${fmtValAr(d.oldValue)} ← ${fmtValAr(d.newValue)}`;
  });
  let s = parts.join("؛ ");
  if (s.length > maxLength) s = s.slice(0, Math.max(0, maxLength - 1)) + "…";
  return s;
}

/** موجز نصي لمجموعة شروط: «N شروط (M إلزامية): field op (إلزامي)، …». */
export function summarizeConditionsAr(conds: ConditionBrief[], maxLength = 400): string {
  const mandatory = conds.filter((c) => c.mandatory).length;
  const list = conds
    .map((c) => `${c.field} ${c.op}${c.mandatory ? " (إلزامي)" : ""}`)
    .join("، ");
  let s = `${conds.length} شروط (${mandatory} إلزامية)`;
  if (list) s += `: ${list}`;
  if (s.length > maxLength) s = s.slice(0, Math.max(0, maxLength - 1)) + "…";
  return s;
}

/** ملخّص عربي لفرق الشروط بصيغة المهمة: «شروط: قديمة N/جديدة M» مع قائمة موجزة. */
export function conditionsDiffEntry(
  oldConds: ConditionBrief[],
  newConds: ConditionBrief[]
): OpportunityChange {
  return {
    field: "conditions",
    oldValue: summarizeConditionsAr(oldConds),
    newValue: summarizeConditionsAr(newConds),
  };
}

// ————————————————————————————————————————————————
// 4) مساعد تواريخ ISO (تستعمله مسارات الإنشاء/التحديث/المسودة الآلية)
// ————————————————————————————————————————————————

/**
 * يحوّل نصًا إلى تاريخ صالح أو يرمي ApiError 422 (EvidenceSchema.verifiedAt
 * نص حر بلا تحقق ISO — هنا يُتحقق قبل كتابته في Prisma).
 */
export function parseIsoDate(raw: string, labelAr: string): Date {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new ApiErrorClass("VALIDATION", `${labelAr}: تاريخ غير صالح (متوقع ISO)`, 422, { value: raw });
  }
  return d;
}
