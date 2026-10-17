/**
 * Masar — T4: درجة الملاءمة (100 نقطة) + مؤشر موثوقية الفرصة (100 نقطة)
 * -----------------------------------------------------------------------------
 * ملف حتمي صرف: لا قاعدة بيانات، لا شبكة، لا Next — الاستيراد الوحيد من ./types.
 * كل التواريخ تُحقن عبر المعامل now (قابل للحقن) لضمان الحتمية الكاملة في الفحص.
 *
 * عقد §5 + §8 من AGENT_CONTRACT:
 *  - computeFitScore(profile, opp, now?, weightOverrides?) → FitScoreResult | null
 *    * يُستدعى فقط لفرص ELIGIBLE/UNCERTAIN (الحكم مسؤولية المستدعي — T3/T11).
 *    * null تُعاد فقط لمدخل غير صالح بنيويًّا (profile بلا مصفوفة fields أو opp غائب)؛
 *      غياب قيمةٍ ما في الملف لا يعني null بل صفرًا مع تفسير «غير مذكور».
 *  - computeReliability(input, now?) → ReliabilityResult
 *
 * أوزان الملاءمة (حرفيًّا من الخطة): قطاع 25، مرحلة 20، نوع/مبلغ التمويل 20،
 * أولوية جغرافية 10، فجوة مستندات 10، وقت 10، لغة 5 — وweightOverrides لتجربة E5.
 *
 * قرارات تفسيرية موثّقة (غيابٌ في نص المهمة أو صياغة تحتاج قياسًا):
 *  1) المرحلة تُقاس كأشرطة عرضها 1 على سلم المراحل (idea=0 … scaling=3):
 *     موضع الشركة = مؤشر+0.5، ومدى البرنامج = [lo, hi+1]، فتكون
 *     الدرجة = الوزن×(1 − المسافة إلى وسط المدى ÷ نصف المدى) لمن هو داخل المدى،
 *     وهذا يحقق نص الخطة «كلما اقتربت من وسطه ارتفعت الدرجة» ويحفظ التمييز بين
 *     «داخل المدى» (دائمًا > 0) و«خارج المدى» (0 مع تفسير). التطابق التام مع مدى
 *     أحادي المرحلة = الوزن كاملًا.
 *  2) القيم 12 و6 وخصم 8 في عامل التمويل، و6 في عامل الوقت، نسبٌ من الوزن الافتراضي
 *     (0.6 و0.3 و0.4 و0.6) — تُحافظ على الأرقام الحرفية عند الأوزان الافتراضية
 *     وتبقى متسقة عند تغيير الأوزان في E5 (score تبقى ضمن 0..weight).
 *  3) غياب قيد الجهة (لغات فرصة فارغة / بلا مستندات مطلوبة / بلا نطاق مبلغ)
 *     = لا عقوبة (الوزن كامل) بتفسير صريح، أسوةً بقاعدة «المقام 0 → 25 كاملة»
 *     في مؤشر الموثوقية. غياب بيانات الملف = 0 مع «غير مذكور».
 *  4) المستند المطلوب الموجود في company.requiredDocs أو في documents بحالة
 *     available يُحسب كاملًا؛ والذي يظهر في documents بحالة expired فقط نصف قيمة.
 */

import { STAGE_KEYS } from "./types";
import type {
  FitFactorResult,
  FitScoreResult,
  ProfileFieldKey,
  ProfileSnapshot,
  ReliabilityInput,
  ReliabilityLevel,
  ReliabilityResult,
} from "./types";

// ————— العقد العام —————

export interface OpportunityForScoring {
  sectors: string[];
  stageMin?: string | null;
  stageMax?: string | null;
  amountMin?: number | null;
  amountMax?: number | null;
  fundingType?: string | null;
  geoPriority: boolean;
  languages: string[];
  requiresDocs: string[];
  deadline?: string | null;
}

export type FitFactorKey = FitFactorResult["key"];

/** تجربة E5: تغيير أوزان الملاءمة وإعادة الحساب (الغائب يستخدم الافتراضي). */
export type FitWeightOverrides = Partial<Record<FitFactorKey, number>>;

export const DEFAULT_FIT_WEIGHTS: Record<FitFactorKey, number> = {
  sector: 25,
  stage: 20,
  funding: 20,
  geoPriority: 10,
  documents: 10,
  time: 10,
  language: 5,
};

const FACTOR_ORDER: readonly FitFactorKey[] = [
  "sector",
  "stage",
  "funding",
  "geoPriority",
  "documents",
  "time",
  "language",
];

const FACTOR_LABELS_AR: Record<FitFactorKey, string> = {
  sector: "توافق القطاع",
  stage: "قرب المرحلة من مستهدف البرنامج",
  funding: "نوع التمويل ومبلغه",
  geoPriority: "أولوية جغرافية إضافية",
  documents: "حجم فجوة المستندات",
  time: "إمكانية الإنجاز قبل الموعد",
  language: "اللغة ومتطلبات التقديم",
};

const FACTOR_LABELS_EN: Record<FitFactorKey, string> = {
  sector: "Sector fit",
  stage: "Startup stage fit",
  funding: "Funding type and amount",
  geoPriority: "Additional geographic priority",
  documents: "Document readiness",
  time: "Time to prepare before deadline",
  language: "Language and application requirements",
};

function fitDetailEnglish(key: FitFactorKey, score: number, weight: number): string {
  const ratio = weight > 0 ? score / weight : 0;
  switch (key) {
    case "sector":
      return ratio >= 0.99 ? "The startup's declared sectors closely align with the sectors listed for this opportunity."
        : ratio > 0 ? "Some sector overlap was detected between the startup profile and the opportunity. Review the listed sectors."
        : "No sector overlap could be confirmed from the available profile and opportunity data.";
    case "stage":
      return ratio >= 0.99 ? "The recorded startup stage is a close match for the program's target stage range."
        : ratio > 0 ? "The score reflects the recorded stage's position within the program's stage range. Check the official criteria."
        : "The startup stage is missing, unknown, or outside the program's stated range.";
    case "funding":
      return ratio >= 0.99 ? "The requested amount and known funding type align with the opportunity's stated terms."
        : ratio > 0 ? "The requested amount or funding type partially matches the available opportunity terms. Check the details before applying."
        : "The amount or funding type is missing or has a low fit with the available opportunity terms.";
    case "geoPriority":
      return ratio >= 0.99 ? "The opportunity indicates an additional geographic priority. This does not replace mandatory geography eligibility."
        : "No additional geographic-priority bonus is recorded for this opportunity.";
    case "documents":
      return ratio >= 0.99 ? "All required documents listed for this opportunity are recorded as available."
        : ratio > 0 ? "Some required documents appear to be available or partially covered. Review the missing-document list."
        : "Required documents are missing, expired, or not recorded in the profile.";
    case "time":
      return ratio >= 0.99 ? "The available deadline leaves enough time under the default preparation buffer."
        : ratio > 0.59 ? "The deadline is missing or leaves limited preparation time. Confirm the current deadline on the official source."
        : "The deadline leaves little or no preparation time. Confirm the date and timezone on the official source.";
    case "language":
      return ratio >= 0.99 ? "The team's declared languages match the listed application language requirements."
        : "The language match is missing or insufficient in the available profile. Confirm the application language with the program.";
  }
}

function withEnglishFitDetails(factor: FitFactorResult): FitFactorResult {
  return {
    ...factor,
    labelEn: FACTOR_LABELS_EN[factor.key],
    detailEn: fitDetailEnglish(factor.key, factor.score, factor.weight),
  };
}

const STAGE_LABELS_AR: Record<string, string> = {
  idea: "فكرة",
  prototype: "نموذج أولي",
  early_revenue: "إيرادات أولية",
  scaling: "توسّع",
};

const DOC_LABELS_AR: Record<string, string> = {
  registration_cert: "شهادة تسجيل",
  pitch_deck: "عرض تقديمي",
  financial_statements: "قوائم مالية",
  founder_id: "هوية المؤسس",
  business_plan: "خطة عمل",
  tax_record: "سجل ضريبي",
  bank_letter: "خطاب بنكي",
  prototype_demo: "عرض النموذج الأولي",
  letters_of_support: "خطابات دعم",
};

const FUNDING_TYPE_LABELS_AR: Record<string, string> = {
  equity: "بملكية (equity)",
  non_equity: "بلا ملكية (non-equity)",
  any: "أي نوع",
  convertible: "قابل للتحويل (convertible)",
  mixed: "مختلط (mixed)",
};

const LANGUAGE_LABELS_AR: Record<string, string> = {
  ar: "العربية",
  en: "الإنجليزية",
};

// ————— ثوابت الخطة —————

const MS_PER_DAY = 86_400_000;
/** الأيام الافتراضية لسد الفجوات قبل الموعد (الخطة: 30). */
const DEFAULT_GAP_DAYS = 30;

// ————— أدوات عامة صرفة —————

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function clampNum(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function normKey(s: unknown): string {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

/** توحيد قائمة مفاتيح: تقليم، صغيرة، إسقاط الفارغ، وإزالة التكرار. */
function normKeyList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const k = normKey(item);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

function labelOf(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

/** تنسيق مبلغ بالدولار بفواصل آلاف — حتمي بلا اعتماد على Intl. */
function fmtUSD(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  const digits = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${digits}`;
}

function pct(ratio: number): string {
  return `${Math.round(clampNum(ratio, 0, 1) * 100)}%`;
}

// ————— قراءة حقول الملف (ProfileSnapshot) —————

function profileValue(profile: ProfileSnapshot, key: ProfileFieldKey): unknown {
  const fields = Array.isArray(profile?.fields) ? profile.fields : [];
  for (const f of fields) {
    if (f && f.field === key && f.value !== null && f.value !== undefined) return f.value;
  }
  return null;
}

/** قائمة مفاتيح من الملف؛ المصفوفة الفارغة أو غير الصالحة = غير مذكورة (null). */
function profileKeyList(profile: ProfileSnapshot, key: ProfileFieldKey): string[] | null {
  const list = normKeyList(profileValue(profile, key));
  return list.length > 0 ? list : null;
}

function profileStageKey(profile: ProfileSnapshot): string | null {
  const raw = profileValue(profile, "company.stage");
  const k = normKey(raw);
  return k.length > 0 ? k : null;
}

function profileAskAmount(profile: ProfileSnapshot): number | null {
  const v = profileValue(profile, "company.askAmountUSD");
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null; // سالب/غير رقمي = غير صالح → غير مذكور
  return v;
}

function profileAskType(profile: ProfileSnapshot): string | null {
  const k = normKey(profileValue(profile, "company.askType"));
  return k.length > 0 ? k : null;
}

function refDate(now?: Date): Date {
  if (now instanceof Date && !Number.isNaN(now.getTime())) return now;
  return new Date();
}

function effectiveWeights(overrides?: FitWeightOverrides): Record<FitFactorKey, number> {
  const w: Record<FitFactorKey, number> = { ...DEFAULT_FIT_WEIGHTS };
  if (overrides) {
    for (const k of FACTOR_ORDER) {
      const o = overrides[k];
      if (typeof o === "number" && Number.isFinite(o)) w[k] = Math.max(0, o);
    }
  }
  return w;
}

function zeroFactor(key: FitFactorKey, weight: number, detail: string): FitFactorResult {
  return { key, labelAr: FACTOR_LABELS_AR[key], weight, score: 0, detail };
}

// ————— العوامل السبعة —————

/** قطاع 25: تقاطع قطاعات الشركة مع قطاعات الفرصة ÷ الاتحاد. */
function sectorFactor(profile: ProfileSnapshot, opp: OpportunityForScoring, weight: number): FitFactorResult {
  const labelAr = FACTOR_LABELS_AR.sector;
  const prof = profileKeyList(profile, "company.sectors");
  if (!prof) {
    return { key: "sector", labelAr, weight, score: 0, detail: "قطاعات الشركة غير مذكورة في الملف" };
  }
  const oppS = normKeyList(opp.sectors);
  const union = new Set<string>([...prof, ...oppS]);
  const inter = prof.filter((s) => oppS.includes(s));
  const ratio = union.size === 0 ? 0 : inter.length / union.size;
  const score = round2(clampNum(ratio, 0, 1) * weight);

  let detail: string;
  if (oppS.length === 0) {
    detail = `قطاعات الفرصة غير محددة — لا تقاطع مع قطاعات الشركة (${prof.length})`;
  } else if (inter.length === 0) {
    detail = `لا تقاطع بين قطاعات الشركة (${prof.length}) وقطاعات الفرصة (${oppS.length})`;
  } else if (inter.length === union.size) {
    detail = `تطابق تام: كل قطاعات الشركة (${prof.length}) ضمن قطاعات الفرصة`;
  } else {
    detail = `تقاطع ${inter.length} من ${union.size} قطاعًا بين الشركة والفرصة (${pct(ratio)})`;
  }
  return { key: "sector", labelAr, weight, score, detail };
}

function stageIndex(key: string | null | undefined): number | null {
  const k = normKey(key);
  if (!k) return null;
  const i = (STAGE_KEYS as readonly string[]).indexOf(k);
  return i >= 0 ? i : null;
}

/** مرحلة 20: داخل [stageMin..stageMax] بقرب من الوسط؛ خارج المدى أو غير مذكورة → 0. */
function stageFactor(profile: ProfileSnapshot, opp: OpportunityForScoring, weight: number): FitFactorResult {
  const labelAr = FACTOR_LABELS_AR.stage;

  const stageKey = profileStageKey(profile);
  if (!stageKey) {
    return zeroFactor("stage", weight, "مرحلة الشركة غير مذكورة في الملف");
  }
  const s = stageIndex(stageKey);
  if (s === null) {
    return zeroFactor("stage", weight, "مرحلة الشركة غير معروفة (خارج سلم المراحل)");
  }

  // طرف مفتوح = حد السلم المقابل؛ قيمة غير معروفة في الفرصة = الطرف مفتوح.
  let lo = stageIndex(opp.stageMin);
  lo = lo === null ? 0 : lo;
  let hi = stageIndex(opp.stageMax);
  hi = hi === null ? 3 : hi;
  const inverted = lo > hi;
  if (inverted) {
    const t = lo;
    lo = hi;
    hi = t;
  }

  const loLabel = normKey(opp.stageMin) ? labelOf(STAGE_LABELS_AR, normKey(opp.stageMin)) : "مفتوح";
  const hiLabel = normKey(opp.stageMax) ? labelOf(STAGE_LABELS_AR, normKey(opp.stageMax)) : "مفتوح";
  const rangeLabel = `${loLabel} — ${hiLabel}${inverted ? " (مدى معكوس — عولج بالتبديل)" : ""}`;

  if (s < lo || s > hi) {
    return zeroFactor(
      "stage",
      weight,
      `المرحلة (${labelOf(STAGE_LABELS_AR, stageKey)}) خارج مدى البرنامج (${rangeLabel})`,
    );
  }

  // قياس شريطي: المرحلة شريط عرضه 1، ومدى البرنامج [lo, hi+1].
  const p = s + 0.5;
  const m = (lo + hi + 1) / 2;
  const h = (hi + 1 - lo) / 2; // ≥ 0.5 دائمًا في هذا الفرع — لا قسمة على صفر
  const d = Math.abs(p - m);
  const proximity = clampNum(1 - d / h, 0, 1);
  const score = round2(proximity * weight);
  const detail = `المرحلة (${labelOf(STAGE_LABELS_AR, stageKey)}) داخل مدى البرنامج (${rangeLabel}) — القرب من وسط المدى ${pct(proximity)}`;
  return { key: "stage", labelAr, weight, score, detail };
}

/** نوع/مبلغ التمويل 20: موقع المبلغ من النطاق + توافق النوع (تعارض equity/non_equity → خصم 8 عند الوزن 20). */
function fundingFactor(profile: ProfileSnapshot, opp: OpportunityForScoring, weight: number): FitFactorResult {
  const labelAr = FACTOR_LABELS_AR.funding;
  const ask = profileAskAmount(profile);
  const askType = profileAskType(profile);
  const oppType = normKey(opp.fundingType);
  const oppTypeKey = oppType.length > 0 ? oppType : null;

  // حدود النطاق (مدخل غير صالح = طرف مفتوح)، ولو انعكس النطاق نبدّله دفاعيًّا.
  let min = typeof opp.amountMin === "number" && Number.isFinite(opp.amountMin) && opp.amountMin >= 0 ? opp.amountMin : null;
  let max = typeof opp.amountMax === "number" && Number.isFinite(opp.amountMax) && opp.amountMax >= 0 ? opp.amountMax : null;
  if (min !== null && max !== null && min > max) {
    const t = min;
    min = max;
    max = t;
  }

  let amountScore: number;
  let amountDetail: string;
  if (ask === null) {
    amountScore = 0;
    amountDetail = "المبلغ المطلوب غير مذكور في الملف";
  } else if (min === null && max === null) {
    amountScore = weight;
    amountDetail = "البرنامج لا يحدد نطاقًا للمبلغ — درجة كاملة للعامل";
  } else if ((min === null || ask >= min) && (max === null || ask <= max)) {
    amountScore = weight;
    let rangeLabel = "مفتوح";
    if (min !== null && max !== null) rangeLabel = `${fmtUSD(min)} – ${fmtUSD(max)}`;
    else if (min !== null) rangeLabel = `من ${fmtUSD(min)} فأعلى`;
    else if (max !== null) rangeLabel = `حتى ${fmtUSD(max)}`;
    amountDetail = `المبلغ المطلوب (${fmtUSD(ask)}) داخل نطاق البرنامج (${rangeLabel})`;
  } else {
    // خارج النطاق: البعد عن الحد الأقرب مقابل 25% من قيمته.
    let bound = ask; // غير قابل للوصول عمليًّا (النطاق المفتوح عولج أعلاه) — قيمة أمان
    if (min !== null && ask < min) bound = min;
    else if (max !== null && ask > max) bound = max;
    const diff = Math.abs(ask - bound);
    const threshold = 0.25 * bound;
    if (diff <= threshold) {
      amountScore = round2(0.6 * weight); // 12 عند الوزن 20
      amountDetail = `المبلغ المطلوب (${fmtUSD(ask)}) خارج النطاق بانحراف لا يتجاوز 25% من الحد الأقرب (${fmtUSD(bound)})`;
    } else {
      amountScore = round2(0.3 * weight); // 6 عند الوزن 20
      amountDetail = `المبلغ المطلوب (${fmtUSD(ask)}) خارج النطاق بفارق يتجاوز 25% من حده الأقرب (${fmtUSD(bound)})`;
    }
  }

  // توافق النوع: التعارض الوحيد المخصوم هو equity مقابل non_equity صراحةً.
  const conflicting =
    (askType === "equity" && oppTypeKey === "non_equity") ||
    (askType === "non_equity" && oppTypeKey === "equity");
  const deduction = conflicting ? round2(0.4 * weight) : 0; // 8 عند الوزن 20

  let typeDetail: string;
  if (conflicting) {
    typeDetail = `تعارض نوع التمويل: الفريق يطلب ${labelOf(FUNDING_TYPE_LABELS_AR, askType ?? "")} والبرنامج يقدم ${labelOf(FUNDING_TYPE_LABELS_AR, oppTypeKey ?? "")} (خصم ${deduction} نقطة)`;
  } else if (askType === null || oppTypeKey === null) {
    typeDetail = "نوع التمويل غير محدد لدى أحد الطرفين — بلا خصم";
  } else if (askType === "any") {
    typeDetail = "الفريق لا يشترط نوع تمويل معينًا — بلا تعارض";
  } else {
    typeDetail = `نوع التمويل متوافق: طلب الفريق ${labelOf(FUNDING_TYPE_LABELS_AR, askType)} مقابل ${labelOf(FUNDING_TYPE_LABELS_AR, oppTypeKey)} لدى البرنامج`;
  }

  const score = round2(clampNum(amountScore - deduction, 0, weight));
  return { key: "funding", labelAr, weight, score, detail: `${amountDetail}. ${typeDetail}.` };
}

/** أولوية جغرافية 10: علم geoPriority في الفرصة (خارج الشروط الإلزامية). */
function geoPriorityFactor(opp: OpportunityForScoring, weight: number): FitFactorResult {
  const on = opp.geoPriority === true;
  return {
    key: "geoPriority",
    labelAr: FACTOR_LABELS_AR.geoPriority,
    weight,
    score: on ? weight : 0,
    detail: on
      ? "الفرصة تمنح أولوية جغرافية إضافية للفئة المستهدفة (خارج الشروط الإلزامية)"
      : "لا أولوية جغرافية إضافية في هذه الفرصة",
  };
}

/** فجوة مستندات 10: نسبة requiresDocs المتوفرة؛ المنتهية نصف قيمة؛ لا مطلوبات → كامل. */
function documentsFactor(profile: ProfileSnapshot, opp: OpportunityForScoring, weight: number): FitFactorResult {
  const labelAr = FACTOR_LABELS_AR.documents;
  const required = normKeyList(opp.requiresDocs);

  if (required.length === 0) {
    return {
      key: "documents",
      labelAr,
      weight,
      score: weight,
      detail: "لا مستندات مطلوبة لهذه الفرصة — درجة كاملة للعامل",
    };
  }

  const declared = profileKeyList(profile, "company.requiredDocs") ?? [];
  const docsAvail = new Set<string>();
  const docsExpired = new Set<string>();
  const docs = Array.isArray(profile?.documents) ? profile.documents : [];
  for (const d of docs) {
    if (!d) continue;
    const k = normKey(d.docType);
    if (!k) continue;
    if (d.status === "available") docsAvail.add(k);
    else if (d.status === "expired") docsExpired.add(k);
  }
  const available = new Set<string>([...declared, ...docsAvail]);

  let full = 0;
  let half = 0;
  const missing: string[] = [];
  for (const r of required) {
    if (available.has(r)) full += 1;
    else if (docsExpired.has(r)) {
      half += 0.5;
      missing.push(labelOf(DOC_LABELS_AR, r));
    } else {
      missing.push(labelOf(DOC_LABELS_AR, r));
    }
  }
  const ratio = (full + half) / required.length;
  const score = round2(clampNum(ratio, 0, 1) * weight);

  let detail: string;
  if (full === required.length) {
    detail = `جميع المستندات المطلوبة (${required.length}) متوفرة`;
  } else {
    const expiredCount = docsExpired.size > 0 ? [...docsExpired].filter((k) => required.includes(k)).length : 0;
    detail = `المتوفر ${full} من ${required.length} مستندًا مطلوبًا`;
    if (expiredCount > 0) detail += ` (منتهية الصلاحية تُحسب نصف قيمة: ${expiredCount})`;
    if (missing.length > 0) detail += ` — الناقص: ${missing.join("، ")}`;
  }
  return { key: "documents", labelAr, weight, score, detail };
}

/** الوقت 10: الأيام حتى الموعد مقابل 30 يومًا افتراضيًّا لسد الفجوات. */
function timeFactor(opp: OpportunityForScoring, weight: number, now: Date): FitFactorResult {
  const labelAr = FACTOR_LABELS_AR.time;

  let deadlineDate: Date | null = null;
  let invalid = false;
  if (typeof opp.deadline === "string" && opp.deadline.trim() !== "") {
    const d = new Date(opp.deadline);
    if (!Number.isNaN(d.getTime())) deadlineDate = d;
    else invalid = true;
  }

  if (!deadlineDate) {
    // بلا موعد (أو موعد غير صالح): 6 من 10 — أي 0.6 من الوزن.
    return {
      key: "time",
      labelAr,
      weight,
      score: round2(0.6 * weight),
      detail: invalid
        ? "موعد غير صالح — عومل كبلا موعد نهائي معلن"
        : "بلا موعد نهائي معلن",
    };
  }

  const days = (deadlineDate.getTime() - now.getTime()) / MS_PER_DAY;
  if (days < 0) {
    return { key: "time", labelAr, weight, score: 0, detail: "الموعد النهائي فائت" };
  }

  const ratio = clampNum(days / DEFAULT_GAP_DAYS, 0, 1);
  const score = round2(ratio * weight);
  let detail: string;
  if (ratio >= 1) {
    detail = `المتبقي ${DEFAULT_GAP_DAYS} يومًا أو أكثر — وقت كافٍ لسد الفجوات افتراضيًّا`;
  } else if (days < 1) {
    detail = "الموعد ينتهي اليوم — لا وقت لسد الفجوات";
  } else {
    detail = `باقي نحو ${Math.ceil(days)} يومًا حتى الموعد مقابل ${DEFAULT_GAP_DAYS} يومًا افتراضيًّا لسد الفجوات`;
  }
  return { key: "time", labelAr, weight, score, detail };
}

/** اللغة 5: تقاطع لغات الفريق مع لغات التقديم؛ لا لغات معلنة للفرصة → كامل. */
function languageFactor(profile: ProfileSnapshot, opp: OpportunityForScoring, weight: number): FitFactorResult {
  const labelAr = FACTOR_LABELS_AR.language;
  const oppLangs = normKeyList(opp.languages);

  if (oppLangs.length === 0) {
    return {
      key: "language",
      labelAr,
      weight,
      score: weight,
      detail: "لا لغة تقديم محددة للفرصة — درجة كاملة للعامل",
    };
  }

  const profLangs = profileKeyList(profile, "company.languages");
  if (!profLangs) {
    return zeroFactor("language", weight, "لغات الفريق غير مذكورة في الملف");
  }

  const inter = profLangs.filter((l) => oppLangs.includes(l));
  if (inter.length > 0) {
    const names = inter.map((l) => labelOf(LANGUAGE_LABELS_AR, l)).join("، ");
    return {
      key: "language",
      labelAr,
      weight,
      score: weight,
      detail: `لغة التقديم متوفرة لدى الفريق (${names})`,
    };
  }
  return zeroFactor("language", weight, "لغة التقديم غير متوفرة لدى الفريق");
}

// ————— درجة الملاءمة —————

/**
 * درجة الملاءمة 0..100 — تُحسب لفرص ELIGIBLE/UNCERTAIN فقط (الحكم مسؤولية المستدعي).
 * null تُعاد حصرًا لمدخل غير صالح بنيويًّا؛ كل غياب قيمي يُعامل صفرًا مع تفسير عربي.
 */
export function computeFitScore(
  profile: ProfileSnapshot,
  opp: OpportunityForScoring,
  now?: Date,
  weightOverrides?: FitWeightOverrides,
): FitScoreResult | null {
  if (!profile || !Array.isArray(profile.fields) || !opp) return null;

  const refNow = refDate(now);
  const w = effectiveWeights(weightOverrides);

  const factors: FitFactorResult[] = [
    sectorFactor(profile, opp, w.sector),
    stageFactor(profile, opp, w.stage),
    fundingFactor(profile, opp, w.funding),
    geoPriorityFactor(opp, w.geoPriority),
    documentsFactor(profile, opp, w.documents),
    timeFactor(opp, w.time, refNow),
    languageFactor(profile, opp, w.language),
  ].map(withEnglishFitDetails);

  const sum = factors.reduce((acc, f) => acc + f.score, 0);
  const total = clampNum(Math.round(sum), 0, 100);
  return { total, factors };
}

// ————— مؤشر موثوقية الفرصة —————

const RELIABILITY_WARNING_AR = "مصدر قديم أو ضعيف الأدلة — تحقق قبل الاعتماد";
const RELIABILITY_WARNING_EN = "The source is old or has weak supporting evidence. Verify it before relying on this assessment.";

/**
 * مؤشر موثوقية الفرصة 0..100: مصدر رسمي 40، حداثة 25، تغطية أدلة 25، سلامة رابط 10.
 * المستويات: ≥80 high، 50–79 medium، <50 low (مع تحذير عربي للمستوى المنخفض).
 */
export function computeReliability(input: ReliabilityInput, now?: Date): ReliabilityResult {
  const refNow = refDate(now);
  const src = normKey(input?.sourceType);

  // 1) نوع المصدر — 40
  let sourceScore = 0;
  let sourceDetail = "مصدر غير رسمي أو نوع غير معروف";
  if (src === "official") {
    sourceScore = 40;
    sourceDetail = "صفحة الجهة المنظمة مباشرة (official)";
  } else if (src === "trusted_aggregator") {
    sourceScore = 20;
    sourceDetail = "وسيط موثوق / مجمّع فرص (trusted_aggregator)";
  }

  // 2) حداثة آخر تحقق — 25
  let freshScore = 0;
  let freshDetail = "لا تاريخ تحقق للمصدر";
  const verifiedRaw = input?.verifiedAt;
  if (typeof verifiedRaw === "string" && verifiedRaw.trim() !== "") {
    const d = new Date(verifiedRaw);
    if (Number.isNaN(d.getTime())) {
      freshDetail = "تاريخ تحقق غير صالح";
    } else {
      const ageDays = Math.max(0, (refNow.getTime() - d.getTime()) / MS_PER_DAY);
      if (ageDays <= 30) {
        freshScore = 25;
        freshDetail = `آخر تحقق قبل ${Math.round(ageDays)} يومًا (حديث — ${30} يومًا أو أقل)`;
        if (refNow.getTime() < d.getTime()) freshDetail += " — تاريخ مستقبلي اعتُبر حديثًا";
      } else if (ageDays >= 180) {
        freshScore = 0;
        freshDetail = `آخر تحقق قبل ${Math.round(ageDays)} يومًا (قديم — ${180} يومًا أو أكثر)`;
      } else {
        freshScore = round2(25 * (1 - (ageDays - 30) / 150));
        freshDetail = `آخر تحقق قبل ${Math.round(ageDays)} يومًا — يتناقص خطيًّا حتى 0 عند ${180} يومًا`;
      }
    }
  }

  // 3) تغطية الأدلة — 25 (لا شروط إلزامية → التغطية كاملة)
  const denomRaw = input?.mandatoryConditionCount;
  const denom = typeof denomRaw === "number" && Number.isFinite(denomRaw) ? denomRaw : 0;
  const numRaw = input?.mandatoryWithEvidenceCount;
  const num = typeof numRaw === "number" && Number.isFinite(numRaw) ? numRaw : 0;
  let evidenceScore: number;
  let evidenceDetail: string;
  if (denom <= 0) {
    evidenceScore = 25;
    evidenceDetail = "لا شروط إلزامية — تغطية الأدلة كاملة";
  } else {
    const ratio = clampNum(num / denom, 0, 1);
    evidenceScore = round2(ratio * 25);
    evidenceDetail = `أدلة موثقة لـ ${num} من ${denom} شرطًا إلزاميًّا (${pct(ratio)})`;
  }

  // 4) سلامة الرابط — 10
  const link = normKey(input?.linkCheckState);
  let linkScore = 0;
  let linkDetail = "حالة فحص الرابط غير معروفة";
  if (link === "ok") {
    linkScore = 10;
    linkDetail = "فحص الرابط ناجح آخر مرة";
  } else if (link === "fail_once") {
    linkScore = 5;
    linkDetail = "فشل فحص الرابط مرة واحدة";
  } else if (link === "fail_twice") {
    linkScore = 0;
    linkDetail = "فشل فحص الرابط مرتين متتاليتين";
  }

  const signals: ReliabilityResult["signals"] = [
    { key: "source", labelAr: "نوع المصدر", labelEn: "Source type", weight: 40, score: sourceScore, detail: sourceDetail,
      detailEn: src === "official" ? "Direct source from the program organizer." : src === "trusted_aggregator" ? "A trusted aggregator is listed; confirm against the official program source." : "The source is not confirmed as official or its type is unknown." },
    { key: "freshness", labelAr: "حداثة آخر تحقق", labelEn: "Verification freshness", weight: 25, score: freshScore, detail: freshDetail,
      detailEn: !verifiedRaw ? "No verification date is recorded." : freshScore >= 25 ? "The last verification is within the recent 30-day window." : freshScore <= 0 ? "The last verification is invalid or at least 180 days old." : "The verification date is between 30 and 180 days old; freshness points decrease over time." },
    { key: "evidence", labelAr: "تغطية الأدلة", labelEn: "Evidence coverage", weight: 25, score: evidenceScore, detail: evidenceDetail,
      detailEn: denom <= 0 ? "No mandatory criteria are recorded, so evidence coverage is treated as complete." : `Verified evidence is recorded for ${Math.max(0, Math.min(denom, num))} of ${denom} mandatory criteria.` },
    { key: "link", labelAr: "سلامة الرابط", labelEn: "Link health", weight: 10, score: linkScore, detail: linkDetail,
      detailEn: link === "ok" ? "The latest link check succeeded." : link === "fail_once" ? "The latest link check failed once." : link === "fail_twice" ? "The link check failed twice in a row." : "The link-check status is unknown." },
  ];

  const sum = signals.reduce((acc, s) => acc + s.score, 0);
  const total = clampNum(Math.round(sum), 0, 100);

  let level: ReliabilityLevel;
  if (total >= 80) level = "high";
  else if (total >= 50) level = "medium";
  else level = "low";

  const result: ReliabilityResult = { total, level, signals };
  if (level === "low") {
    result.warningAr = RELIABILITY_WARNING_AR;
    result.warningEn = RELIABILITY_WARNING_EN;
  }
  return result;
}
