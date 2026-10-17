/**
 * Masar — محرك الأهلية الحتمي (T3)
 * ---------------------------------------------------------------------------
 * قلب المنصة: يقيّم شروط الفرص ضد ملف المؤسس ويُصدر حكمًا ثلاثي القيم
 * (ELIGIBLE / NOT_ELIGIBLE / UNCERTAIN) مع تفسير عربي وأدلة لكل شرط.
 *
 * مبادئ ملزِمة (AGENT_CONTRACT §7 + الخطة):
 *  - نقاء تام: لا قاعدة بيانات، لا شبكة، لا نموذج لغوي. الاستيراد من ./types وzod فقط.
 *  - الحتمية: نفس (profile, conditions, now) ⇒ نفس النتيجة حرفيًّا. `now` قابل للحقن.
 *  - «null بدل التخمين»: القيمة الفارغة/الغائبة → UNRESOLVED بسبب MISSING_PROFILE_DATA
 *    ولا تُعامل false أبدًا — حتى مع neq وexists (غياب البيانات ليس رفضًا مؤكدًا).
 *  - الرفض المؤكد أولوية: شرط إلزامي NOT_SATISFIED مع دليل ok → NOT_ELIGIBLE فورًا
 *    حتى مع شروط أخرى غير محسومة.
 *  - الشرط الإلزامي بلا دليل (أو بدليل ضعيف/قديم) لا يسمح أبدًا بـ ELIGIBLE.
 *  - الشروط غير الإلزامية لا تمنع الأهلية أبدًا (تُذكر في الملخص فقط).
 *  - المحرك لا يرمي استثناءً أبدًا؛ أي خلل يتحول إلى نتيجة UNRESOLVED قابلة للعرض.
 *
 * قرارات تفسيرية موثّقة (حالات لم تُحسم حرفيًّا في العقد — مثبّتة هنا):
 *  1) «in» على قيمة مصفوفية (مثل company.sectors) = تقاطع غير فارغ بين مصفوفة الملف
 *     وقائمة الشرط (يتوافق مع «تقاطع/اتحاد» في درجة الملاءمة T4)؛ «not_in» = تقاطع فارغ.
 *  2) «eq» على مصفوفتين = تساوي مجموعات (بلا اعتبار للترتيب).
 *  3) تعارض الأنواع (مثل gte على قيمة نصية أو قيمة شرط غير رقمية) → UNRESOLVED بسبب
 *     MISSING_PROFILE_DATA مع تفصيل التعارض في suggestedAction — لا استثناء ولا تخمين.
 *  4) «exists» على قيمة غائبة/فارغة → UNRESOLVED (تطبيقًا للقاعدة الذهبية «null لا
 *     يُعامل false»)؛ فغياب القيمة في الملف دعوة لإكمال الملف لا رفض مؤكد.
 *  5) verifiedAt غير قابل للقراءة → الدليل stale (تعذّر إثبات الحداثة).
 *  6) أولوية حالات الدليل: missing ← weak ← stale ← ok.
 *  7) غياب شروط إلزامية كليًّا → ELIGIBLE (لا شيء إلزاميًّا يمنع) مع بيان ذلك في الملخص.
 *  8) حالة الدليل لا تغيّر حالة الشرط (SATISFIED/NOT_SATISFIED/UNRESOLVED) بل تقيّد
 *     الحكم النهائي فقط.
 */

import { z } from "zod";
import {
  CONDITION_OPS,
  COUNTRY_KEYS,
  DOC_TYPE_KEYS,
  LEGAL_STATUS_VALUES,
  REGION_VALUES,
  SECTOR_KEYS,
  STAGE_KEYS,
} from "./types";
import type {
  ConditionOp,
  ConditionResult,
  ConditionStatus,
  EligibilityResult,
  EvidenceState,
  Judgment,
  ProfileFieldKey,
  ProfileFieldValue,
  ProfileSnapshot,
  RuleCondition,
  RuleEvidence,
  UnresolvedReason,
} from "./types";

// ————— ثوابت عامة —————

const AR_NONE = "غير مذكور";
const AR_SEPARATOR = "، ";
const DAY_MS = 86_400_000;
const STALE_AFTER_DAYS = 180;

// ————— خرائط التسمية العربية (toArabicLabel) —————

const REGION_LABELS: Record<(typeof REGION_VALUES)[number], string> = {
  west_bank: "الضفة الغربية",
  gaza: "قطاع غزة",
  east_jerusalem: "القدس الشرقية",
  inside_48: "الداخل الفلسطيني",
  diaspora: "الشتات",
};

const STAGE_LABELS: Record<(typeof STAGE_KEYS)[number], string> = {
  idea: "فكرة",
  prototype: "نموذج أولي",
  early_revenue: "إيرادات أولية",
  scaling: "توسّع",
};

const LEGAL_STATUS_LABELS: Record<(typeof LEGAL_STATUS_VALUES)[number], string> = {
  not_registered: "غير مسجلة",
  registered_local: "مسجلة محليًّا",
  registered_foreign: "مسجلة في الخارج",
};

const SECTOR_LABELS: Record<(typeof SECTOR_KEYS)[number], string> = {
  agritech: "تقنية زراعية",
  fintech: "تقنية مالية",
  healthtech: "تقنية صحية",
  edtech: "تقنية تعليمية",
  cleantech: "تقنية بيئية",
  iot: "إنترنت الأشياء",
  ecommerce: "تجارة إلكترونية",
  logistics: "لوجستيات",
  tourism: "سياحة",
  food: "غذاء",
  manufacturing: "تصنيع",
  software: "برمجيات",
  ai: "ذكاء اصطناعي",
  water: "مياه",
  energy: "طاقة",
  social: "أثر اجتماعي",
  media: "إعلام",
  other: "قطاع آخر",
};

const DOC_TYPE_LABELS: Record<(typeof DOC_TYPE_KEYS)[number], string> = {
  registration_cert: "شهادة تسجيل الشركة",
  pitch_deck: "عرض تقديمي (Pitch Deck)",
  financial_statements: "قوائم مالية",
  founder_id: "هوية المؤسس",
  business_plan: "خطة عمل",
  tax_record: "سجل ضريبي",
  bank_letter: "خطاب بنكي",
  prototype_demo: "عرض النموذج الأولي",
  letters_of_support: "خطابات دعم",
};

const COUNTRY_LABELS: Record<(typeof COUNTRY_KEYS)[number] | "none", string> = {
  ps: "فلسطين",
  jo: "الأردن",
  eg: "مصر",
  ae: "الإمارات",
  sa: "السعودية",
  qa: "قطر",
  kw: "الكويت",
  tr: "تركيا",
  us: "الولايات المتحدة",
  gb: "المملكة المتحدة",
  de: "ألمانيا",
  fr: "فرنسا",
  sg: "سنغافورة",
  other: "دولة أخرى",
  none: "بلا تسجيل",
};

const LANGUAGE_LABELS: Record<"ar" | "en", string> = {
  ar: "العربية",
  en: "الإنجليزية",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank_transfer: "تحويل بنكي",
  paypal: "PayPal",
  wise: "Wise",
  other: "طريقة أخرى",
};

const ASK_TYPE_LABELS: Record<"equity" | "non_equity" | "any", string> = {
  equity: "تمويل بملكية (أسهم)",
  non_equity: "تمويل بلا ملكية",
  any: "أي نوع من التمويل",
};

/** أسماء حقول الملف بالعربية (لكل مفاتيح PROFILE_FIELD_KEYS — إلزامية التغطية). */
const FIELD_LABELS: Record<ProfileFieldKey, string> = {
  "company.name": "اسم الشركة",
  "company.sectors": "قطاعات الشركة",
  "company.stage": "مرحلة الشركة",
  "company.registrationCountry": "دولة تسجيل الشركة",
  "company.legalStatus": "الوضع القانوني للشركة",
  "company.ageMonths": "عمر الشركة (بالأشهر)",
  "company.teamSize": "حجم الفريق (عدد الأفراد)",
  "company.womenLed": "قيادة نسائية للشركة",
  "company.monthlyRevenueUSD": "الإيراد الشهري بالدولار",
  "company.tractionUsers": "عدد المستخدمين/العملاء",
  "company.askAmountUSD": "المبلغ المطلوب بالدولار",
  "company.askType": "نوع التمويل المطلوب",
  "company.languages": "لغات الفريق",
  "company.requiredDocs": "المستندات المتوفرة",
  "founder.region": "إقامة المؤسس",
  "founder.nationality": "جنسية المؤسس",
  "founder.hasBankAccount": "وجود حساب بنكي للمؤسس",
  "founder.paymentMethods": "طرق استلام التمويل",
};

/** خريطة كل حقل ملف → خريطة قيمه المعرَّفة (للتسمية العربية). */
const FIELD_VALUE_LABELERS: Record<string, Record<string, string>> = {
  "founder.region": REGION_LABELS,
  "founder.nationality": COUNTRY_LABELS,
  "company.stage": STAGE_LABELS,
  "company.legalStatus": LEGAL_STATUS_LABELS,
  "company.sectors": SECTOR_LABELS,
  "company.registrationCountry": COUNTRY_LABELS,
  "company.requiredDocs": DOC_TYPE_LABELS,
  "company.languages": LANGUAGE_LABELS,
  "founder.paymentMethods": PAYMENT_METHOD_LABELS,
  "company.askType": ASK_TYPE_LABELS,
};

/** اختصارات أسماء الفئات إن مُرِّر اسم الفئة بدل مفتاح الحقل. */
const CATEGORY_SHORTCUTS: Record<string, Record<string, string>> = {
  region: REGION_LABELS,
  regions: REGION_LABELS,
  stage: STAGE_LABELS,
  stages: STAGE_LABELS,
  sector: SECTOR_LABELS,
  sectors: SECTOR_LABELS,
  legalStatus: LEGAL_STATUS_LABELS,
  legal_status: LEGAL_STATUS_LABELS,
  doc: DOC_TYPE_LABELS,
  docs: DOC_TYPE_LABELS,
  docType: DOC_TYPE_LABELS,
  docTypes: DOC_TYPE_LABELS,
  country: COUNTRY_LABELS,
  countries: COUNTRY_LABELS,
  language: LANGUAGE_LABELS,
  languages: LANGUAGE_LABELS,
  paymentMethod: PAYMENT_METHOD_LABELS,
  paymentMethods: PAYMENT_METHOD_LABELS,
  askType: ASK_TYPE_LABELS,
};

/** قيم فريدة عبر كل الخرائط (للبحث عند جهل مفتاح الحقل) — القيم المتضاربة تُهمل. */
const GLOBAL_LABELS: Record<string, string> = (() => {
  const maps = [
    REGION_LABELS,
    STAGE_LABELS,
    LEGAL_STATUS_LABELS,
    SECTOR_LABELS,
    DOC_TYPE_LABELS,
    COUNTRY_LABELS,
    LANGUAGE_LABELS,
    PAYMENT_METHOD_LABELS,
    ASK_TYPE_LABELS,
  ];
  const counts = new Map<string, number>();
  const merged: Record<string, string> = {};
  for (const map of maps) {
    for (const [k, v] of Object.entries(map)) {
      counts.set(k, (counts.get(k) ?? 0) + 1);
      merged[k] = v;
    }
  }
  const out: Record<string, string> = {};
  for (const [k, n] of counts) {
    if (n === 1 && k in merged) out[k] = merged[k];
  }
  return out;
})();

/** الحقول التي تُقرأ من مصفوفة المؤسسين أولًا (قبل fields). */
const FOUNDER_FIELD_PROP: Partial<Record<ProfileFieldKey, "region" | "nationality">> = {
  "founder.region": "region",
  "founder.nationality": "nationality",
};

// ————— أدوات عامة صغيرة —————

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const sign = n < 0 ? "-" : "";
  const [int, frac] = String(Math.abs(n)).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${frac ? `.${frac}` : ""}`;
}

function fieldLabel(field: string): string {
  return (FIELD_LABELS as Record<string, string>)[field] ?? field;
}

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function normScalar(v: unknown): unknown {
  return typeof v === "string" ? v.trim() : v;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function normalizeNow(now?: Date): Date {
  if (now instanceof Date && !Number.isNaN(now.getTime())) return now;
  return new Date();
}

function readField(profile: ProfileSnapshot | null | undefined, key: string): unknown {
  if (!profile || !Array.isArray(profile.fields)) return null;
  const entry = profile.fields.find((f) => f && f.field === key);
  return entry ? entry.value ?? null : null;
}

function safeEvidence(ev: unknown): RuleEvidence | null {
  if (!ev || typeof ev !== "object" || Array.isArray(ev)) return null;
  const e = ev as { url?: unknown; quote?: unknown; verifiedAt?: unknown };
  if (typeof e.url !== "string" || typeof e.quote !== "string" || typeof e.verifiedAt !== "string") {
    return null;
  }
  return { url: e.url, quote: e.quote, verifiedAt: e.verifiedAt };
}

// ————— مخطط الفحص السريع (zod) —————

const regionValueEnum = z.enum(REGION_VALUES as unknown as [string, ...string[]]);
const sectorKeyEnum = z.enum(SECTOR_KEYS as unknown as [string, ...string[]]);
const stageKeyEnum = z.enum(STAGE_KEYS as unknown as [string, ...string[]]);
const legalStatusEnum = z.enum(LEGAL_STATUS_VALUES as unknown as [string, ...string[]]);
const countryKeyEnum = z.enum([...COUNTRY_KEYS, "none"] as unknown as [string, ...string[]]);

/** إجابات الزائر في الفحص السريع (نفس شكل مخطط schemas دون كسر قيد الاستيراد). */
export const QuickCheckAnswers = z.object({
  region: regionValueEnum,
  registrationCountry: countryKeyEnum.optional(),
  legalStatus: legalStatusEnum.optional(),
  sectors: z.array(sectorKeyEnum).min(1).max(4),
  stage: stageKeyEnum,
  askAmountUSD: z.number().nonnegative().optional(),
  languages: z.array(z.enum(["ar", "en"])).min(1).default(["ar"]),
});

export type QuickCheckAnswers = z.infer<typeof QuickCheckAnswers>;

// ————— toArabicLabel —————

/**
 * تسمية عربية لقيمة حقل من الملف/الشرط.
 * - null/غائب → «غير مذكور»، المصفوفات تُجمع بفاصلة عربية.
 * - key = مفتاح الحقل (مثل founder.region) أو اسم فئة (region/stage/…) —
 *   وإن جهل المفتاح نُجرّب القيم الفريدة عالميًّا.
 * - القيم غير المعروفة تُعاد كما هي (حتمية، بلا استثناء).
 */
export function toArabicLabel(key: string, value: unknown): string {
  try {
    if (value === null || value === undefined) return AR_NONE;
    if (Array.isArray(value)) {
      if (value.length === 0) return AR_NONE;
      return value.map((v) => toArabicLabel(key, v)).join(AR_SEPARATOR);
    }
    const map =
      FIELD_VALUE_LABELERS[key] ??
      CATEGORY_SHORTCUTS[key] ??
      (typeof value === "string" ? GLOBAL_LABELS : undefined);
    if (map && typeof value === "string" && Object.prototype.hasOwnProperty.call(map, value)) {
      return map[value];
    }
    if (typeof value === "boolean") return value ? "نعم" : "لا";
    if (typeof value === "number") return formatNumber(value);
    if (typeof value === "string") return value.trim() === "" ? AR_NONE : value;
    return String(value);
  } catch {
    return AR_NONE;
  }
}

// ————— نتيجة المعامل على قيمة واحدة —————

interface Indeterminate {
  kind: "indeterminate";
  reason: UnresolvedReason;
  /** true = تعارض أنواع لا يمكن مقارنته (ليس مجرد غياب قيمة). */
  mismatch: boolean;
}

type EvalOutcome = { kind: "true" } | { kind: "false" } | Indeterminate;

const MISSING_OUTCOME: EvalOutcome = {
  kind: "indeterminate",
  reason: "MISSING_PROFILE_DATA",
  mismatch: false,
};

const MISMATCH_OUTCOME: EvalOutcome = {
  kind: "indeterminate",
  reason: "MISSING_PROFILE_DATA",
  mismatch: true,
};

function strictSameTypeEqual(a: unknown, v: unknown): boolean {
  if (typeof a !== typeof v) return false;
  return a === v;
}

function setEquals(a: unknown[], v: unknown[]): boolean {
  if (a.length !== v.length) return false;
  const used = new Array<boolean>(v.length).fill(false);
  for (const av of a) {
    const n = normScalar(av);
    let matched = false;
    for (let i = 0; i < v.length; i++) {
      if (!used[i] && strictSameTypeEqual(n, normScalar(v[i]))) {
        used[i] = true;
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

function evalEq(a: unknown, value: unknown): EvalOutcome {
  const v = normScalar(value);
  if (Array.isArray(a) && Array.isArray(v)) {
    return setEquals(a, v) ? { kind: "true" } : { kind: "false" };
  }
  if (Array.isArray(a) !== Array.isArray(v)) return MISMATCH_OUTCOME;
  if (typeof a !== typeof v) return MISMATCH_OUTCOME;
  return strictSameTypeEqual(a, v) ? { kind: "true" } : { kind: "false" };
}

function evalIn(a: unknown, value: unknown, negate: boolean): EvalOutcome {
  // (1) قيمة الملف مصفوفة والشرط قيمة مفردة → عضوية القيمة في المصفوفة
  if (Array.isArray(a) && !Array.isArray(value)) {
    const target = normScalar(value);
    let anyCompatible = false;
    let hit = false;
    for (const av of a) {
      const n = normScalar(av);
      if (typeof n === typeof target) {
        anyCompatible = true;
        if (strictSameTypeEqual(n, target)) hit = true;
      }
    }
    if (!anyCompatible) return MISMATCH_OUTCOME;
    const satisfied = negate ? !hit : hit;
    return satisfied ? { kind: "true" } : { kind: "false" };
  }
  // (2) الشرط قائمة قيم
  if (!Array.isArray(value) || value.length === 0) return MISMATCH_OUTCOME;
  const vals = value.map(normScalar);
  if (Array.isArray(a)) {
    // تقاطع غير فارغ (in) / فارغ (not_in) بين مصفوفة الملف والقائمة
    let anyCompatible = false;
    let hit = false;
    for (const av of a) {
      const n = normScalar(av);
      for (const v of vals) {
        if (typeof n === typeof v) {
          anyCompatible = true;
          if (strictSameTypeEqual(n, v)) hit = true;
        }
      }
    }
    if (!anyCompatible) return MISMATCH_OUTCOME;
    const satisfied = negate ? !hit : hit;
    return satisfied ? { kind: "true" } : { kind: "false" };
  }
  // (3) قيمة الملف مفردة → عضوية في القائمة
  let anyCompatible = false;
  let hit = false;
  for (const v of vals) {
    if (typeof a === typeof v) {
      anyCompatible = true;
      if (strictSameTypeEqual(a, v)) hit = true;
    }
  }
  if (!anyCompatible) return MISMATCH_OUTCOME;
  const satisfied = negate ? !hit : hit;
  return satisfied ? { kind: "true" } : { kind: "false" };
}

function evalCompare(a: unknown, value: unknown, op: "gte" | "lte"): EvalOutcome {
  if (!isFiniteNumber(a)) return MISMATCH_OUTCOME;
  const v = normScalar(value);
  if (!isFiniteNumber(v)) return MISMATCH_OUTCOME;
  const satisfied = op === "gte" ? a >= v : a <= v;
  return satisfied ? { kind: "true" } : { kind: "false" };
}

function evalBetween(a: unknown, value: unknown): EvalOutcome {
  if (!isFiniteNumber(a)) return MISMATCH_OUTCOME;
  if (!Array.isArray(value) || value.length < 2) return MISMATCH_OUTCOME;
  const min = normScalar(value[0]);
  const max = normScalar(value[1]);
  if (!isFiniteNumber(min) || !isFiniteNumber(max)) return MISMATCH_OUTCOME;
  const satisfied = a >= min && a <= max;
  return satisfied ? { kind: "true" } : { kind: "false" };
}

function evalContains(a: unknown, value: unknown): EvalOutcome {
  // نص: substring
  if (typeof a === "string") {
    const hay = a; // مُطبَّف مسبقًا في normScalar
    if (typeof value === "string") {
      const needle = value.trim();
      if (needle === "") return MISMATCH_OUTCOME;
      return hay.includes(needle) ? { kind: "true" } : { kind: "false" };
    }
    if (Array.isArray(value)) {
      const needles = value
        .filter((v): v is string => typeof v === "string" && v.trim() !== "")
        .map((v) => v.trim());
      if (needles.length === 0) return MISMATCH_OUTCOME;
      const hit = needles.some((n) => hay.includes(n));
      return hit ? { kind: "true" } : { kind: "false" };
    }
    return MISMATCH_OUTCOME;
  }
  // مصفوفة: عضوية (أو تقاطع إن كانت قيمة الشرط قائمة)
  if (Array.isArray(a)) {
    const items = a.map(normScalar);
    if (Array.isArray(value)) {
      const vals = value.map(normScalar);
      let anyCompatible = false;
      let hit = false;
      for (const item of items) {
        for (const v of vals) {
          if (typeof item === typeof v) {
            anyCompatible = true;
            if (strictSameTypeEqual(item, v)) hit = true;
          }
        }
      }
      if (!anyCompatible) return MISMATCH_OUTCOME;
      return hit ? { kind: "true" } : { kind: "false" };
    }
    const target = normScalar(value);
    if (target === null || target === undefined) return MISMATCH_OUTCOME;
    let anyCompatible = false;
    let hit = false;
    for (const item of items) {
      if (typeof item === typeof target) {
        anyCompatible = true;
        if (strictSameTypeEqual(item, target)) hit = true;
      }
    }
    if (!anyCompatible) return MISMATCH_OUTCOME;
    return hit ? { kind: "true" } : { kind: "false" };
  }
  return MISMATCH_OUTCOME;
}

/**
 * تقييم معامل على قيمة واحدة. القيمة الفارغة → غير محسوم (null لا يُعامل false).
 * لا يرمي استثناءً أبدًا.
 */
function evalScalar(actual: unknown, op: ConditionOp, value: unknown): EvalOutcome {
  // القاعدة الذهبية: غياب القيمة ⇒ UNRESOLVED وليس false — لكل المعاملات.
  if (isBlank(actual)) return MISSING_OUTCOME;
  const a = normScalar(actual);
  switch (op) {
    case "exists":
      return { kind: "true" };
    case "eq":
      return evalEq(a, value);
    case "neq": {
      const r = evalEq(a, value);
      if (r.kind === "true") return { kind: "false" };
      if (r.kind === "false") return { kind: "true" };
      return r;
    }
    case "in":
      return evalIn(a, value, false);
    case "not_in":
      return evalIn(a, value, true);
    case "gte":
      return evalCompare(a, value, "gte");
    case "lte":
      return evalCompare(a, value, "lte");
    case "between":
      return evalBetween(a, value);
    case "contains":
      return evalContains(a, value);
    default:
      return MISMATCH_OUTCOME;
  }
}

/** تقييم معامل على قيم مؤسسين متعددين وفق scope (any/all). */
function evalMulti(
  values: unknown[],
  scope: "any" | "all",
  op: ConditionOp,
  value: unknown
): EvalOutcome {
  const evals = values.map((v) => evalScalar(v, op, value));
  if (scope !== "all") {
    // any: يكفي مؤسس واحد يستوفي
    if (evals.some((e) => e.kind === "true")) return { kind: "true" };
    const indet = evals.find((e) => e.kind === "indeterminate");
    if (indet) return indet;
    return { kind: "false" };
  }
  // all: يلزم جميع المؤسسين
  if (evals.some((e) => e.kind === "false")) return { kind: "false" };
  const indet = evals.find((e) => e.kind === "indeterminate");
  if (indet) return indet;
  return { kind: "true" };
}

// ————— الدليل —————

/** أولوية: missing ← weak (بلا رابط/اقتباس) ← stale (أقدم من 180 يومًا) ← ok. */
function evidenceStateOf(ev: RuleEvidence | null, now: Date): EvidenceState {
  if (!ev) return "missing";
  if (!ev.url.trim() || !ev.quote.trim()) return "weak";
  const t = new Date(ev.verifiedAt).getTime();
  if (Number.isNaN(t)) return "stale"; // تاريخ غير قابل للقراءة → تعذّر إثبات الحداثة
  if ((now.getTime() - t) / DAY_MS > STALE_AFTER_DAYS) return "stale";
  return "ok";
}

// ————— تطبيع الشرط (مدخلات غير موثوقة لا تكسر المحرك) —————

interface SafeCondition {
  id: string;
  field: ProfileFieldKey;
  op: ConditionOp;
  value: unknown;
  mandatory: boolean;
  ambiguous: boolean;
  scope: "any" | "all";
  sourceWording: string | null;
  evidence: RuleEvidence | null;
}

function normalizeCondition(cond: RuleCondition | null | undefined): SafeCondition {
  // نتعامل مع الشرط كبيانات غير موثوقة (قد تكون ناقصة/فاسدة وقت التشغيل) دون كسر الأنواع
  const c = (cond ?? {}) as Record<string, unknown>;
  const rawField = c.field;
  const field =
    typeof rawField === "string" && rawField !== "" ? rawField : "company.name";
  const rawOp = c.op;
  const op =
    typeof rawOp === "string" && (CONDITION_OPS as readonly string[]).includes(rawOp)
      ? (rawOp as ConditionOp)
      : "exists";
  return {
    id: typeof c.id === "string" && c.id !== "" ? c.id : `cond-${field}-${op}`,
    field: field as ProfileFieldKey,
    op,
    value: c.value === undefined ? null : c.value,
    mandatory: c.mandatory === true,
    ambiguous: c.ambiguous === true,
    scope: c.scope === "all" ? "all" : "any",
    sourceWording: typeof c.sourceWording === "string" ? c.sourceWording : null,
    evidence: safeEvidence(c.evidence),
  };
}

// ————— نصوص expected/actual بالعربية —————

function expectedFieldLabel(safe: SafeCondition, profile: ProfileSnapshot | null | undefined): string {
  const base = fieldLabel(safe.field);
  const prop = FOUNDER_FIELD_PROP[safe.field];
  if (!prop) return base;
  const founders = profile && Array.isArray(profile.founders) ? profile.founders : [];
  if (founders.length <= 1) return base;
  const noun = safe.field === "founder.region" ? "إقامة" : "جنسية";
  return safe.scope === "all" ? `${noun} جميع المؤسسين` : `${noun} أحد المؤسسين`;
}

function expectedText(safe: SafeCondition, profile: ProfileSnapshot | null | undefined): string {
  const label = expectedFieldLabel(safe, profile);
  const v = safe.value;
  switch (safe.op) {
    case "eq":
      return `${label}: ${toArabicLabel(safe.field, v)}`;
    case "neq":
      return `${label}: أي قيمة غير ${toArabicLabel(safe.field, v)}`;
    case "in":
      return `${label} ضمن: ${toArabicLabel(safe.field, v)}`;
    case "not_in":
      return `${label} خارج: ${toArabicLabel(safe.field, v)}`;
    case "gte":
      return `${label}: ${toArabicLabel(safe.field, v)} فأكثر`;
    case "lte":
      return `${label}: ${toArabicLabel(safe.field, v)} فأقل`;
    case "between": {
      if (Array.isArray(v) && v.length >= 2) {
        return `${label} بين ${toArabicLabel(safe.field, v[0])} و${toArabicLabel(safe.field, v[1])}`;
      }
      return `${label}: ضمن مدى قيم (min–max)`;
    }
    case "contains":
      return `${label} يتضمن: ${toArabicLabel(safe.field, v)}`;
    case "exists":
      return `${label}: قيمة محددة وغير فارغة`;
    default:
      return `${label}: شرط غير معروف (${safe.op})`;
  }
}

/** قراءة قيم المؤسسين لحقل مؤسسين (region/nationality) — null إن لم تنطبق. */
function founderValues(
  profile: ProfileSnapshot | null | undefined,
  field: ProfileFieldKey
): unknown[] | null {
  const prop = FOUNDER_FIELD_PROP[field];
  if (!prop) return null;
  const founders = profile && Array.isArray(profile.founders) ? profile.founders : [];
  if (founders.length === 0) return null; // لا مؤسسين → ارجع إلى fields
  return founders.map((fnd) => {
    const v = fnd ? fnd[prop] : null;
    return v === undefined ? null : v;
  });
}

function actualText(profile: ProfileSnapshot | null | undefined, field: ProfileFieldKey): string {
  const multi = founderValues(profile, field);
  if (multi) {
    if (multi.length === 0) return AR_NONE;
    return multi.map((v) => toArabicLabel(field, v)).join(AR_SEPARATOR);
  }
  return toArabicLabel(field, readField(profile, field));
}

// ————— evaluateCondition —————

/**
 * تقييم شرط واحد. حتمي نقي، لا استثناءات أبدًا.
 * - ambiguous=true → UNRESOLVED بسبب AMBIGUOUS_WORDING مهما كانت البيانات.
 * - حالة الدليل تُحسب دائمًا وتُقيّد الحكم لاحقًا (لا تغيّر حالة الشرط).
 */
export function evaluateCondition(
  profile: ProfileSnapshot,
  cond: RuleCondition,
  now?: Date
): ConditionResult {
  const at = normalizeNow(now);
  const safe = normalizeCondition(cond);
  const evState = evidenceStateOf(safe.evidence, at);
  const expected = expectedText(safe, profile);
  const actual = actualText(profile, safe.field);
  try {
    let outcome: EvalOutcome;
    if (safe.ambiguous) {
      // الغموض في نص الجهة يسبق كل شيء: لا يمكن الثقة بمعنى الشرط
      outcome = { kind: "indeterminate", reason: "AMBIGUOUS_WORDING", mismatch: false };
    } else {
      const multi = founderValues(profile, safe.field);
      outcome = multi
        ? evalMulti(multi, safe.scope, safe.op, safe.value)
        : evalScalar(readField(profile, safe.field), safe.op, safe.value);
    }

    const status: ConditionStatus =
      outcome.kind === "true" ? "SATISFIED" : outcome.kind === "false" ? "NOT_SATISFIED" : "UNRESOLVED";

    const result: ConditionResult = {
      conditionId: safe.id,
      field: safe.field,
      op: safe.op,
      mandatory: safe.mandatory,
      status,
      evidenceState: evState,
      sourceWording: safe.sourceWording,
      expected,
      actual,
      evidence: safe.evidence,
    };

    if (outcome.kind === "indeterminate") {
      result.unresolvedReason = outcome.reason;
      if (outcome.reason === "AMBIGUOUS_WORDING") {
        result.suggestedAction = "عبارة الجهة غامضة — يُنصح مراسلة الجهة للتأكد";
      } else if (outcome.mismatch) {
        result.suggestedAction =
          `تعارض أنواع بين قيمة الشرط (${safe.op}) وقيمة الملف — لا يمكن المقارنة دون تخمين؛ ` +
          "راجع صيغة الشرط أو صحّح قيمة الملف";
      } else {
        result.suggestedAction = `أكمل حقل «${fieldLabel(safe.field)}» في ملف المؤسس ثم أعد التقييم`;
      }
    }
    return result;
  } catch {
    // المحرك نقي: أي خلل غير متوقع يُترجم إلى نتيجة غير محسومة بدل الاستثناء
    return {
      conditionId: safe.id,
      field: safe.field,
      op: safe.op,
      mandatory: safe.mandatory,
      status: "UNRESOLVED",
      evidenceState: evState,
      sourceWording: safe.sourceWording,
      expected,
      actual,
      unresolvedReason: "MISSING_PROFILE_DATA",
      suggestedAction: "تعذّر تقييم الشرط لسبب غير متوقع — راجع صيغة الشرط وبيانات الملف",
      evidence: safe.evidence,
    };
  }
}

// ————— evaluateEligibility —————

function uncertainReasonText(r: ConditionResult): string {
  if (r.status === "UNRESOLVED") {
    if (r.unresolvedReason === "AMBIGUOUS_WORDING") {
      const wording = r.sourceWording && r.sourceWording.trim() !== "" ? r.sourceWording : r.expected;
      return `غموض في نص الجهة: «${wording}» — يُنصح مراسلة الجهة للتأكد`;
    }
    const action = r.suggestedAction ? `؛ ${r.suggestedAction}` : "";
    return `نقص في ملف المؤسس: ${r.expected} — الحالي: ${r.actual}${action}`;
  }
  if (r.status === "NOT_SATISFIED") {
    switch (r.evidenceState) {
      case "missing":
        return `شرط إلزامي غير مستوفى لكن بلا دليل موثّق (لا يُؤكد الرفض): ${r.expected}؛ قيمة ملفك: ${r.actual}`;
      case "stale":
        return `شرط إلزامي غير مستوفى ودليله أقدم من 180 يومًا (لا يُؤكد الرفض): ${r.expected}؛ قيمة ملفك: ${r.actual}`;
      case "weak":
        return `شرط إلزامي غير مستوفى ودليله بلا اقتباس أو رابط (لا يُؤكد الرفض): ${r.expected}؛ قيمة ملفك: ${r.actual}`;
      default:
        return `شرط إلزامي غير مستوفى: ${r.expected}؛ قيمة ملفك: ${r.actual}`;
    }
  }
  // SATISFIED بأدلة غير كافية
  switch (r.evidenceState) {
    case "missing":
      return `شرط إلزامي مستوفى لكن بلا دليل موثّق من مصدر الفرصة: ${r.expected}`;
    case "stale":
      return `شرط إلزامي مستوفى لكن دليله أقدم من 180 يومًا: ${r.expected}`;
    case "weak":
      return `شرط إلزامي مستوفى لكن دليله ضعيف (بلا اقتباس أو رابط): ${r.expected}`;
    default:
      return `شرط إلزامي مستوفى: ${r.expected}`;
  }
}

function buildExecutionNotes(profile: ProfileSnapshot | null | undefined): string[] {
  const notes: string[] = [];
  const bank = readField(profile, "founder.hasBankAccount");
  const pm = readField(profile, "founder.paymentMethods");
  // عائق تنفيذ فقط — لا يغيّر الحكم أبدًا (§7)
  if (bank === false || (Array.isArray(pm) && pm.length === 0)) {
    notes.push("تحقق من طريقة صرف المبلغ المتاحة لديك");
  }
  return notes;
}

const FIELD_LABELS_EN: Record<ProfileFieldKey, string> = {
  "company.name": "Company name", "company.sectors": "Company sectors", "company.stage": "Company stage",
  "company.registrationCountry": "Registration country", "company.legalStatus": "Legal status",
  "company.ageMonths": "Company age (months)", "company.teamSize": "Team size", "company.womenLed": "Women-led status",
  "company.monthlyRevenueUSD": "Monthly revenue (USD)", "company.tractionUsers": "Users/customers", "company.askAmountUSD": "Funding amount requested (USD)",
  "company.askType": "Funding type sought", "company.languages": "Team languages", "company.requiredDocs": "Available documents",
  "founder.region": "Founder region", "founder.nationality": "Founder nationality", "founder.hasBankAccount": "Founder bank account",
  "founder.paymentMethods": "Available payout methods",
};

function buildSummaryEn(judgment: Judgment, results: ConditionResult[], mandatory: ConditionResult[]): string {
  if (judgment === "NOT_ELIGIBLE") {
    const count = results.filter(r => r.mandatory && r.status === "NOT_SATISFIED" && r.evidenceState === "ok").length;
    return `Verdict: Not eligible — ${count === 1 ? "one mandatory criterion is" : `${count} mandatory criteria are`} not met according to documented evidence. Review the criteria and official source before deciding whether to proceed.`;
  }
  if (judgment === "ELIGIBLE") {
    const pendingOptional = results.filter(r => !r.mandatory && r.status !== "SATISFIED").length;
    const core = mandatory.length === 0 ? "no mandatory criteria are configured" : `all ${mandatory.length} mandatory criteria are satisfied with current documented evidence`;
    return `Verdict: Eligible — ${core}${pendingOptional ? `; ${pendingOptional} optional criterion/criteria remain unmet and do not block eligibility` : ""}. Recheck the official program source before applying.`;
  }
  const unresolved = mandatory.filter(r => !(r.status === "SATISFIED" && r.evidenceState === "ok"));
  const fields = [...new Set(unresolved.map(r => FIELD_LABELS_EN[r.field] ?? "a required profile field"))];
  return `Verdict: Uncertain — eligibility cannot yet be confirmed. Review ${fields.slice(0, 4).join(", ") || "the missing profile data or evidence"} and verify the current official criteria.`;
}

function blockingReasonsEn(results: ConditionResult[]): string[] {
  return results.filter(r => r.mandatory && r.status === "NOT_SATISFIED" && r.evidenceState === "ok")
    .map(r => `A documented mandatory criterion is not met: ${FIELD_LABELS_EN[r.field] ?? "required profile field"}. Review the expected condition and official evidence below.`);
}

function uncertainReasonsEn(results: ConditionResult[]): string[] {
  return results.filter(r => r.mandatory && !(r.status === "SATISFIED" && r.evidenceState === "ok"))
    .map(r => {
      const label = FIELD_LABELS_EN[r.field] ?? "a required profile field";
      if (r.status === "UNRESOLVED") return `Eligibility for ${label} needs confirmation because profile data is missing or the criterion is ambiguous.`;
      if (r.evidenceState === "missing") return `${label} requires a current, documented source or supporting quote.`;
      if (r.evidenceState === "stale") return `The evidence for ${label} is older than the allowed verification period; recheck the official source.`;
      if (r.evidenceState === "weak") return `The evidence for ${label} is incomplete; confirm it against the official source.`;
      return `Review the mandatory criterion for ${label} and supply any missing information or evidence.`;
    });
}

function buildSummary(
  judgment: Judgment,
  results: ConditionResult[],
  mandatory: ConditionResult[],
  blockingReasons: string[],
  uncertainReasons: string[]
): string {
  if (judgment === "NOT_ELIGIBLE") {
    const first = blockingReasons[0] ?? "شرط إلزامي موثّق غير مستوفى";
    const extra = blockingReasons.length > 1 ? ` (ويوجد ${blockingReasons.length - 1} سببًا إضافيًا)` : "";
    return `الحكم: غير مؤهل — رفض مؤكد بدليل موثّق؛ ${first}${extra}.`;
  }
  if (judgment === "ELIGIBLE") {
    const nonMandatoryPending = results.filter((r) => !r.mandatory && r.status !== "SATISFIED").length;
    const core =
      mandatory.length === 0
        ? "لا شروط إلزامية في هذه الفرصة"
        : `جميع الشروط الإلزامية (${mandatory.length}) مستوفاة بأدلة موثّقة`;
    const extra =
      nonMandatoryPending > 0
        ? `، مع ${nonMandatoryPending} شرطًا غير إلزامي غير مستوفى (لا يمنع الأهلية)`
        : "";
    return `الحكم: مؤهل — ${core}${extra}.`;
  }
  const n = uncertainReasons.length;
  const count = n === 1 ? "سبب واحد" : `${n} أسباب`;
  const first = uncertainReasons[0] ?? "سبب غير محدد";
  return `الحكم: غير محسوم — ${count} تمنع الجزم (نقص بيانات أو غموض نص أو نقص/قدم الدليل)؛ أولها: ${first}.`;
}

/**
 * الحكم الثلاثي. ترتيب القرار:
 * 1) أي شرط إلزامي NOT_SATISFIED مع دليل ok → NOT_ELIGIBLE فورًا (الرفض المؤكد أولوية).
 * 2) وإلا إن كانت كل الشروط الإلزامية SATISFIED بأدلة ok → ELIGIBLE.
 * 3) غير ذلك → UNCERTAIN مع سبب مفصّل لكل إلزامي معلّق.
 * الشروط غير الإلزامية لا تمنع الأهلية أبدًا (تُذكر في الملخص فقط).
 */
export function evaluateEligibility(
  profile: ProfileSnapshot,
  conditions: RuleCondition[],
  now?: Date
): EligibilityResult {
  const at = normalizeNow(now);
  const list: RuleCondition[] = Array.isArray(conditions) ? conditions : [];
  const results = list.map((c) => evaluateCondition(profile, c, at));
  const mandatory = results.filter((r) => r.mandatory);

  const confirmedRejections = mandatory.filter(
    (r) => r.status === "NOT_SATISFIED" && r.evidenceState === "ok"
  );
  const allMandatorySatisfiedWithEvidence = mandatory.every(
    (r) => r.status === "SATISFIED" && r.evidenceState === "ok"
  );

  let judgment: Judgment;
  let uncertainReasons: string[] = [];
  if (confirmedRejections.length > 0) {
    judgment = "NOT_ELIGIBLE";
  } else if (allMandatorySatisfiedWithEvidence) {
    judgment = "ELIGIBLE";
  } else {
    judgment = "UNCERTAIN";
    uncertainReasons = mandatory
      .filter((r) => !(r.status === "SATISFIED" && r.evidenceState === "ok"))
      .map((r) => uncertainReasonText(r));
  }

  const blockingReasons = confirmedRejections.map(
    (r) => `شرط إلزامي موثّق غير مستوفى: ${r.expected}؛ قيمة ملفك: ${r.actual}`
  );

  const notes = buildExecutionNotes(profile);
  return {
    judgment,
    summary: buildSummary(judgment, results, mandatory, blockingReasons, uncertainReasons),
    summaryEn: buildSummaryEn(judgment, results, mandatory),
    conditions: results,
    satisfiedCount: results.filter((r) => r.status === "SATISFIED").length,
    notSatisfiedCount: results.filter((r) => r.status === "NOT_SATISFIED").length,
    unresolvedCount: results.filter((r) => r.status === "UNRESOLVED").length,
    blockingReasons,
    blockingReasonsEn: blockingReasonsEn(results),
    uncertainReasons,
    uncertainReasonsEn: uncertainReasonsEn(results),
    executionNotes: notes,
    executionNotesEn: notes.length ? ["Check the payout method available to you before accepting an award."] : [],
  };
}

// ————— quickProfileFromAnswers —————

/**
 * يبني ProfileSnapshot من إجابات الزائر في الفحص السريع:
 * documents فارغة، founders مصفوفة بمؤسس واحد (isPrimary)، والحقول manual.
 * دفاعي بالكامل: لا يرمي استثناءً أبدًا مهما كانت المدخلات.
 */
export function quickProfileFromAnswers(a: QuickCheckAnswers): ProfileSnapshot {
  const src = (a ?? {}) as Partial<QuickCheckAnswers>;
  const fields: ProfileFieldValue[] = [];
  const push = (field: ProfileFieldKey, value: unknown): void => {
    fields.push({ field, value: value === undefined ? null : value, source: "manual" });
  };
  push("founder.region", typeof src.region === "string" ? src.region : null);
  push("company.sectors", Array.isArray(src.sectors) ? src.sectors : null);
  push("company.stage", typeof src.stage === "string" ? src.stage : null);
  push("company.languages", Array.isArray(src.languages) ? src.languages : null);
  push("company.registrationCountry", typeof src.registrationCountry === "string" ? src.registrationCountry : null);
  push("company.legalStatus", typeof src.legalStatus === "string" ? src.legalStatus : null);
  push("company.askAmountUSD", typeof src.askAmountUSD === "number" ? src.askAmountUSD : null);
  return {
    fields,
    founders: [
      {
        name: null,
        region: typeof src.region === "string" ? src.region : null,
        nationality: null,
        isPrimary: true,
      },
    ],
    documents: [],
  };
}
