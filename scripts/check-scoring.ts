/**
 * Masar — T4 تحقق ذاتي: درجة الملاءمة + مؤشر الموثوقية
 * تشغيل: bun scripts/check-scoring.ts  (من جذر المشروع)
 * يطبع «SCORING CHECK PASSED» عند نجاح كل الفحوص، ويخرج برمز 1 عند أي فشل.
 * كل التواريخ محقونة (NOW ثابت) — الحتمية الكاملة قابلة للإعادة.
 */
import { computeFitScore, computeReliability } from "../src/lib/core/scoring";
import type { FitWeightOverrides, OpportunityForScoring } from "../src/lib/core/scoring";
import type {
  FitFactorResult,
  FitScoreResult,
  ProfileFieldValue,
  ProfileSnapshot,
  ReliabilityInput,
  ReliabilityResult,
} from "../src/lib/core/types";

const MS_DAY = 86_400_000;
const NOW = new Date("2026-06-01T00:00:00.000Z");
const isoAfter = (days: number): string => new Date(NOW.getTime() + days * MS_DAY).toISOString();

// ————— بناة المدخلات —————

interface ProfileSpec {
  sectors?: string[] | null;
  stage?: string | null;
  ask?: number | null;
  askType?: string | null;
  languages?: string[] | null;
  requiredDocs?: string[] | null;
  documents?: Array<{ docType: string; status: "available" | "missing" | "expired" }>;
}

function makeProfile(o: ProfileSpec = {}): ProfileSnapshot {
  const fields: ProfileFieldValue[] = [];
  const add = (field: ProfileFieldValue["field"], value: unknown): void => {
    if (value !== null && value !== undefined) fields.push({ field, value, source: "manual" });
  };
  add("company.sectors", "sectors" in o ? o.sectors : ["agritech"]);
  add("company.stage", "stage" in o ? o.stage : "early_revenue");
  add("company.askAmountUSD", "ask" in o ? o.ask : 100000);
  add("company.askType", "askType" in o ? o.askType : "non_equity");
  add("company.languages", "languages" in o ? o.languages : ["ar"]);
  add("company.requiredDocs", "requiredDocs" in o ? o.requiredDocs : ["pitch_deck", "business_plan"]);
  return { fields, founders: [], documents: o.documents ?? [] };
}

function makeOpp(o: Partial<OpportunityForScoring> = {}): OpportunityForScoring {
  return {
    sectors: o.sectors ?? ["agritech"],
    stageMin: "stageMin" in o ? o.stageMin : "idea",
    stageMax: "stageMax" in o ? o.stageMax : "scaling",
    amountMin: "amountMin" in o ? o.amountMin : null,
    amountMax: "amountMax" in o ? o.amountMax : null,
    fundingType: "fundingType" in o ? o.fundingType : null,
    geoPriority: o.geoPriority ?? false,
    languages: o.languages ?? ["ar"],
    requiresDocs: o.requiresDocs ?? [],
    deadline: "deadline" in o ? o.deadline : null,
  };
}

function factor(res: FitScoreResult | null, key: string): FitFactorResult {
  if (!res) throw new Error("نتيجة null غير متوقعة");
  const f = res.factors.find((x) => x.key === key);
  if (!f) throw new Error(`العامل ${key} غير موجود`);
  return f;
}

function signal(res: ReliabilityResult, key: string): { key: string; labelAr: string; weight: number; score: number; detail: string } {
  const s = res.signals.find((x) => x.key === key);
  if (!s) throw new Error(`الإشارة ${key} غير موجودة`);
  return s;
}

// ————— عدّاد الفحوص —————

let passed = 0;
let failed = 0;

function ok(cond: boolean, label: string, extra?: unknown): void {
  if (cond) {
    passed += 1;
    console.log(`  ✔ ${label}`);
  } else {
    failed += 1;
    const line = `  ✘ ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`;
    console.log(line);
  }
}

function eq(actual: unknown, expected: unknown, label: string): void {
  ok(actual === expected, `${label} [متوقع ${JSON.stringify(expected)} / فعلي ${JSON.stringify(actual)}]`);
}

function contains(haystack: string, needle: string, label: string): void {
  ok(haystack.includes(needle), `${label} [التفسير: ${haystack}]`);
}

function caseHeader(name: string): void {
  console.log(`\n■ ${name}`);
}

// ————— الحالة 1: تطابق تام = 100 —————
caseHeader("الحالة 1 — تطابق تام في كل العوامل → 100");
{
  const p = makeProfile();
  const o = makeOpp({
    stageMin: "early_revenue",
    stageMax: "early_revenue",
    amountMin: 50000,
    amountMax: 250000,
    fundingType: "non_equity",
    geoPriority: true,
    requiresDocs: ["pitch_deck", "business_plan"],
    deadline: isoAfter(40),
  });
  const r = computeFitScore(p, o, NOW);
  ok(r !== null, "computeFitScore يعيد نتيجة");
  if (r) {
    eq(r.total, 100, "المجموع 100");
    eq(factor(r, "sector").score, 25, "قطاع 25");
    eq(factor(r, "stage").score, 20, "مرحلة 20 (تطابق أحادي)");
    eq(factor(r, "funding").score, 20, "تمويل 20");
    eq(factor(r, "geoPriority").score, 10, "أولوية جغرافية 10");
    eq(factor(r, "documents").score, 10, "مستندات 10");
    eq(factor(r, "time").score, 10, "وقت 10");
    eq(factor(r, "language").score, 5, "لغة 5");
  }
}

// ————— الحالة 2: عامل القطاع —————
caseHeader("الحالة 2 — عامل القطاع (تقاطع ÷ اتحاد × 25)");
{
  const partial = computeFitScore(makeProfile({ sectors: ["agritech", "fintech"] }), makeOpp({ sectors: ["fintech", "healthtech"] }), NOW);
  eq(factor(partial, "sector").score, 8.33, "تقاطع 1/3 → 8.33");

  const missing = computeFitScore(makeProfile({ sectors: null }), makeOpp(), NOW);
  eq(factor(missing, "sector").score, 0, "قطاعات الملف غير مذكورة → 0");
  contains(factor(missing, "sector").detail, "غير مذكورة", "تفسير الغياب");

  const noOppSectors = computeFitScore(makeProfile(), makeOpp({ sectors: [] }), NOW);
  eq(factor(noOppSectors, "sector").score, 0, "قطاعات فرصة فارغة → 0 (لا تقاطع)");

  const full = computeFitScore(makeProfile({ sectors: ["agritech", "ai"] }), makeOpp({ sectors: ["ai", "agritech", "water"] }), NOW);
  eq(factor(full, "sector").score, 16.67, "تقاطع 2/3 → 16.67");
}

// ————— الحالة 3: عامل المرحلة —————
caseHeader("الحالة 3 — عامل المرحلة (قرب وسط المدى × 20)");
{
  const fullRange = (stage: string | null) => factor(computeFitScore(makeProfile({ stage }), makeOpp(), NOW), "stage");
  eq(fullRange("prototype").score, 15, "مدى كامل: نموذج أولي → 15");
  eq(fullRange("early_revenue").score, 15, "مدى كامل: إيرادات أولية → 15");
  eq(fullRange("idea").score, 5, "مدى كامل: فكرة (طرف المدى) → 5");
  eq(fullRange("scaling").score, 5, "مدى كامل: توسّع (طرف المدى) → 5");

  const single = computeFitScore(makeProfile(), makeOpp({ stageMin: "early_revenue", stageMax: "early_revenue" }), NOW);
  eq(factor(single, "stage").score, 20, "مدى أحادي ومطابق → 20");

  const outSingle = computeFitScore(makeProfile({ stage: "scaling" }), makeOpp({ stageMin: "early_revenue", stageMax: "early_revenue" }), NOW);
  eq(factor(outSingle, "stage").score, 0, "خارج مدى أحادي → 0");
  contains(factor(outSingle, "stage").detail, "خارج مدى البرنامج", "تفسير الخارج عن المدى");

  const noStage = computeFitScore(makeProfile({ stage: null }), makeOpp(), NOW);
  eq(factor(noStage, "stage").score, 0, "مرحلة غير مذكورة → 0");
  contains(factor(noStage, "stage").detail, "غير مذكورة", "تفسير غياب المرحلة");

  const openTop = (stage: string) => factor(computeFitScore(makeProfile({ stage }), makeOpp({ stageMin: "early_revenue", stageMax: null }), NOW), "stage");
  eq(openTop("early_revenue").score, 10, "طرف أعلى مفتوح: إيرادات أولية → 10");
  eq(openTop("scaling").score, 10, "طرف أعلى مفتوح: توسّع → 10");
  eq(openTop("prototype").score, 0, "طرف أعلى مفتوح: نموذج أولي خارج المدى → 0");

  const openBottom = (stage: string) => factor(computeFitScore(makeProfile({ stage }), makeOpp({ stageMin: null, stageMax: "prototype" }), NOW), "stage");
  eq(openBottom("idea").score, 10, "طرف أدنى مفتوح: فكرة → 10");
  eq(openBottom("prototype").score, 10, "طرف أدنى مفتوح: نموذج أولي → 10");

  const unknownStage = computeFitScore(makeProfile({ stage: "growth" }), makeOpp(), NOW);
  eq(factor(unknownStage, "stage").score, 0, "قيمة خارج سلم المراحل → 0");
  contains(factor(unknownStage, "stage").detail, "خارج سلم المراحل", "تفسير قيمة غير معروفة");
}

// ————— الحالة 4: عامل التمويل —————
caseHeader("الحالة 4 — عامل التمويل (نطاق المبلغ + توافق النوع)");
{
  const inRange = computeFitScore(makeProfile(), makeOpp({ amountMin: 50000, amountMax: 250000 }), NOW);
  eq(factor(inRange, "funding").score, 20, "داخل النطاق → 20");
  contains(factor(inRange, "funding").detail, "داخل نطاق البرنامج", "تفسير داخل النطاق");

  const near = computeFitScore(makeProfile({ ask: 45000 }), makeOpp({ amountMin: 50000, amountMax: null }), NOW);
  eq(factor(near, "funding").score, 12, "انحراف ≤25% عن الحد الأدنى → 12");

  const far = computeFitScore(makeProfile({ ask: 20000 }), makeOpp({ amountMin: 50000, amountMax: null }), NOW);
  eq(factor(far, "funding").score, 6, "انحراف >25% → 6");

  const nearMax = computeFitScore(makeProfile({ ask: 260000 }), makeOpp({ amountMin: null, amountMax: 250000 }), NOW);
  eq(factor(nearMax, "funding").score, 12, "انحراف ≤25% عن الحد الأعلى → 12");

  const farMax = computeFitScore(makeProfile({ ask: 500000 }), makeOpp({ amountMin: 50000, amountMax: 250000 }), NOW);
  eq(factor(farMax, "funding").score, 6, "انحراف >25% عن الحد الأعلى → 6");

  const noAsk = computeFitScore(makeProfile({ ask: null }), makeOpp({ amountMin: 50000, amountMax: 250000 }), NOW);
  eq(factor(noAsk, "funding").score, 0, "مبلغ غير مذكور → 0");
  contains(factor(noAsk, "funding").detail, "المبلغ المطلوب غير مذكور", "تفسير غياب المبلغ");

  const conflict = computeFitScore(makeProfile({ askType: "equity" }), makeOpp({ amountMin: 50000, amountMax: 250000, fundingType: "non_equity" }), NOW);
  eq(factor(conflict, "funding").score, 12, "تعارض equity/non_equity داخل النطاق → 20−8=12");
  contains(factor(conflict, "funding").detail, "تعارض نوع التمويل", "تفسير التعارض");

  const openRange = computeFitScore(makeProfile(), makeOpp({ amountMin: null, amountMax: null }), NOW);
  eq(factor(openRange, "funding").score, 20, "نطاق مفتوح → 20");

  const anyType = computeFitScore(makeProfile({ askType: "any" }), makeOpp({ amountMin: 50000, amountMax: 250000, fundingType: "equity" }), NOW);
  eq(factor(anyType, "funding").score, 20, "الملف any → بلا خصم");

  const conflictNoAsk = computeFitScore(makeProfile({ ask: null, askType: "equity" }), makeOpp({ amountMin: 50000, amountMax: 250000, fundingType: "non_equity" }), NOW);
  eq(factor(conflictNoAsk, "funding").score, 0, "تعارض مع مبلغ غائب → 0 (بلا سالب)");

  const convertible = computeFitScore(makeProfile({ askType: "non_equity" }), makeOpp({ fundingType: "convertible" }), NOW);
  eq(factor(convertible, "funding").score, 20, "convertible لا تتعارض مع non_equity");
}

// ————— الحالة 5: الأولوية الجغرافية —————
caseHeader("الحالة 5 — الأولوية الجغرافية");
{
  const on = computeFitScore(makeProfile(), makeOpp({ geoPriority: true }), NOW);
  eq(factor(on, "geoPriority").score, 10, "geoPriority=true → 10");
  const off = computeFitScore(makeProfile(), makeOpp({ geoPriority: false }), NOW);
  eq(factor(off, "geoPriority").score, 0, "geoPriority=false → 0");
}

// ————— الحالة 6: فجوة المستندات —————
caseHeader("الحالة 6 — فجوة المستندات (المتوفر ÷ المطلوب × 10، المنتهي نصف قيمة)");
{
  const partial = computeFitScore(makeProfile({ requiredDocs: ["pitch_deck"] }), makeOpp({ requiresDocs: ["pitch_deck", "founder_id"] }), NOW);
  eq(factor(partial, "documents").score, 5, "متوفر 1 من 2 → 5");

  const withTracker = computeFitScore(
    makeProfile({ requiredDocs: ["pitch_deck"], documents: [{ docType: "founder_id", status: "available" }] }),
    makeOpp({ requiresDocs: ["pitch_deck", "founder_id"] }),
    NOW,
  );
  eq(factor(withTracker, "documents").score, 10, "متوفر عبر متتبع المستندات (available) → 10");

  const expired = computeFitScore(
    makeProfile({ requiredDocs: null, documents: [{ docType: "founder_id", status: "expired" }] }),
    makeOpp({ requiresDocs: ["pitch_deck", "founder_id"] }),
    NOW,
  );
  eq(factor(expired, "documents").score, 2.5, "منتهي واحد من 2 → 0.5/2×10 = 2.5");
  contains(factor(expired, "documents").detail, "الناقص", "تفسير النقص");

  const none = computeFitScore(makeProfile({ requiredDocs: null }), makeOpp({ requiresDocs: ["tax_record"] }), NOW);
  eq(factor(none, "documents").score, 0, "لا متوفر → 0");

  const noRequired = computeFitScore(makeProfile(), makeOpp({ requiresDocs: [] }), NOW);
  eq(factor(noRequired, "documents").score, 10, "لا مستندات مطلوبة → 10 (لا فجوة)");
  contains(factor(noRequired, "documents").detail, "لا مستندات مطلوبة", "تفسير غياب المطلوبات");

  const declaredBeatsExpired = computeFitScore(
    makeProfile({ requiredDocs: ["pitch_deck", "founder_id"], documents: [{ docType: "founder_id", status: "expired" }] }),
    makeOpp({ requiresDocs: ["pitch_deck", "founder_id"] }),
    NOW,
  );
  eq(factor(declaredBeatsExpired, "documents").score, 10, "المعلن في الملف يُحسب كاملًا حتى لو انتهى في المتتبع (قاعدة الاتحاد)");
}

// ————— الحالة 7: عامل الوقت —————
caseHeader("الحالة 7 — الوقت (الأيام المتبقية مقابل 30 افتراضيًّا)");
{
  const plenty = computeFitScore(makeProfile(), makeOpp({ deadline: isoAfter(40) }), NOW);
  eq(factor(plenty, "time").score, 10, "40 يومًا → 10");

  const exact30 = computeFitScore(makeProfile(), makeOpp({ deadline: isoAfter(30) }), NOW);
  eq(factor(exact30, "time").score, 10, "30 يومًا بالضبط → 10 (الحد الأعلى)");

  const half = computeFitScore(makeProfile(), makeOpp({ deadline: isoAfter(15) }), NOW);
  eq(factor(half, "time").score, 5, "15 يومًا → 5");

  const oneHour = computeFitScore(makeProfile(), makeOpp({ deadline: isoAfter(1 / 24) }), NOW);
  eq(factor(oneHour, "time").score, 0.01, "ساعة واحدة → 0.01");
  contains(factor(oneHour, "time").detail, "اليوم", "تفسير الموعد الوشيك");

  const noDeadline = computeFitScore(makeProfile(), makeOpp({ deadline: null }), NOW);
  eq(factor(noDeadline, "time").score, 6, "بلا موعد → 6");
  contains(factor(noDeadline, "time").detail, "بلا موعد نهائي معلن", "تفسير غياب الموعد");

  const passed = computeFitScore(makeProfile(), makeOpp({ deadline: isoAfter(-5) }), NOW);
  eq(factor(passed, "time").score, 0, "موعد فائت → 0");
  contains(factor(passed, "time").detail, "فائت", "تفسير الموعد الفائت");

  const invalid = computeFitScore(makeProfile(), makeOpp({ deadline: "not-a-date" }), NOW);
  eq(factor(invalid, "time").score, 6, "موعد غير صالح → 6 (كبلا موعد)");
  contains(factor(invalid, "time").detail, "غير صالح", "تفسير الموعد غير الصالح");
}

// ————— الحالة 8: عامل اللغة —————
caseHeader("الحالة 8 — اللغة");
{
  const match = computeFitScore(makeProfile({ languages: ["ar"] }), makeOpp({ languages: ["ar", "en"] }), NOW);
  eq(factor(match, "language").score, 5, "تقاطع موجب → 5");

  const mismatch = computeFitScore(makeProfile({ languages: ["en"] }), makeOpp({ languages: ["ar"] }), NOW);
  eq(factor(mismatch, "language").score, 0, "لا تقاطع → 0");
  contains(factor(mismatch, "language").detail, "لغة التقديم غير متوفرة لدى الفريق", "تفسير عدم توفر اللغة");

  const missingLangs = computeFitScore(makeProfile({ languages: null }), makeOpp({ languages: ["ar"] }), NOW);
  eq(factor(missingLangs, "language").score, 0, "لغات الفريق غير مذكورة → 0");
  contains(factor(missingLangs, "language").detail, "غير مذكورة", "تفسير غياب لغات الفريق");

  const noOppLangs = computeFitScore(makeProfile(), makeOpp({ languages: [] }), NOW);
  eq(factor(noOppLangs, "language").score, 5, "لا لغة تقديم محددة للفرصة → 5 (بلا عقوبة)");
  contains(factor(noOppLangs, "language").detail, "لا لغة تقديم محددة", "تفسير غياب لغات الفرصة");
}

// ————— الحالة 9: بنية النتيجة والمجموع —————
caseHeader("الحالة 9 — بنية FitScoreResult (سبعة عوامل، حدود، تقريب)");
{
  const r = computeFitScore(
    makeProfile({ sectors: ["agritech", "fintech"], ask: 45000, requiredDocs: ["pitch_deck"] }),
    makeOpp({ sectors: ["fintech", "healthtech"], amountMin: 50000, requiresDocs: ["pitch_deck", "founder_id"], deadline: isoAfter(15) }),
    NOW,
  );
  ok(r !== null, "نتيجة غير null");
  if (r) {
    eq(r.factors.length, 7, "سبعة عوامل");
    const order = ["sector", "stage", "funding", "geoPriority", "documents", "time", "language"];
    eq(r.factors.map((f) => f.key).join(","), order.join(","), "ترتيب العوامل كما في الخطة");
    const sum = r.factors.reduce((a, f) => a + f.score, 0);
    ok(Math.abs(r.total - sum) <= 0.5, "المجموع = مجموع العوامل بعد التقريب", { total: r.total, sum });
    ok(Number.isInteger(r.total) && r.total >= 0 && r.total <= 100, "المجموع عدد صحيح ضمن 0..100");
    for (const f of r.factors) {
      ok(f.score >= 0 && f.score <= f.weight, `عامل ${f.key}: 0 ≤ score ≤ weight`);
      ok(typeof f.labelAr === "string" && f.labelAr.length > 0, `عامل ${f.key}: تسمية عربية`);
      ok(typeof f.detail === "string" && f.detail.trim().length > 0, `عامل ${f.key}: تفسير عربي غير فارغ`);
    }
    const expectedWeights: Record<string, number> = { sector: 25, stage: 20, funding: 20, geoPriority: 10, documents: 10, time: 10, language: 5 };
    for (const f of r.factors) eq(f.weight, expectedWeights[f.key], `وزن ${f.key} الافتراضي`);
  }
}

// ————— الحالة 10: الأوزان المعدلة (E5) —————
caseHeader("الحالة 10 — weightOverrides (تجربة E5)");
{
  const perfect = makeOpp({
    stageMin: "early_revenue",
    stageMax: "early_revenue",
    amountMin: 50000,
    amountMax: 250000,
    fundingType: "non_equity",
    geoPriority: true,
    requiresDocs: ["pitch_deck", "business_plan"],
    deadline: isoAfter(40),
  });

  const noTime = computeFitScore(makeProfile(), perfect, NOW, { time: 0 });
  if (noTime) {
    eq(factor(noTime, "time").weight, 0, "وزن الوقت 0 عند التجاوز");
    eq(factor(noTime, "time").score, 0, "درجة الوقت 0");
    eq(noTime.total, 90, "المجموع 90 بعد إسقاط عامل الوقت");
  }

  const noDeadlineHeavy = computeFitScore(makeProfile(), makeOpp({ deadline: null }), NOW, { time: 20 });
  eq(factor(noDeadlineHeavy, "time").score, 12, "بلا موعد بوزن 20 → 12 (نسبة 0.6)");

  const nearHeavy = computeFitScore(makeProfile({ ask: 45000 }), makeOpp({ amountMin: 50000 }), NOW, { funding: 40 });
  eq(factor(nearHeavy, "funding").score, 24, "انحراف ≤25% بوزن 40 → 24 (نسبة 0.6)");

  const conflictHeavy = computeFitScore(makeProfile({ askType: "equity" }), makeOpp({ amountMin: 50000, amountMax: 250000, fundingType: "non_equity" }), NOW, { funding: 40 });
  eq(factor(conflictHeavy, "funding").score, 24, "تعارض بوزن 40 → 40−16 = 24 (خصم متناسب)");

  const negative = computeFitScore(makeProfile(), makeOpp(), NOW, { sector: -5 });
  eq(factor(negative, "sector").weight, 0, "وزن سالب يُعامل 0");

  const partialOverride: FitWeightOverrides = { sector: 10 };
  const lightSector = computeFitScore(makeProfile(), perfect, NOW, partialOverride);
  eq(factor(lightSector, "sector").score, 10, "الوزن المنقوص يُطبق (قطاع 10)");
  eq(lightSector ? lightSector.total : -1, 85, "المجموع 85 مع قطاع 10");

  // قلب الترتيب بين فرصتين بتغيير الأوزان (جوهر E5)
  const p = makeProfile({ stage: null, ask: null, requiredDocs: null });
  const oppA = makeOpp({ sectors: ["agritech"], deadline: isoAfter(-1) }); // قطاع قوي/وقت فائت
  const oppB = makeOpp({ sectors: ["fintech"], deadline: isoAfter(40) }); // قطاع ضعيف/وقت كافٍ
  const a = computeFitScore(p, oppA, NOW);
  const b = computeFitScore(p, oppB, NOW);
  ok(a !== null && b !== null && a.total > b.total, "بالأوزان الافتراضية: الفرصة A أعلى", { a: a?.total, b: b?.total });
  const a2 = computeFitScore(p, oppA, NOW, { sector: 0, time: 20 });
  const b2 = computeFitScore(p, oppB, NOW, { sector: 0, time: 20 });
  ok(a2 !== null && b2 !== null && b2.total > a2.total, "بعد رفع وزن الوقت وإسقاط القطاع: B أعلى (انقلاب الترتيب)", { a: a2?.total, b: b2?.total });
}

// ————— الحالة 11: null للمدخل غير الصالح بنيويًّا —————
caseHeader("الحالة 11 — null (مدخل غير صالح) vs نتيجة كاملة");
{
  const bad = computeFitScore({ fields: "not-an-array" } as unknown as ProfileSnapshot, makeOpp(), NOW);
  eq(bad, null, "ملف بلا مصفوفة fields → null");
  const noOpp = computeFitScore(makeProfile(), null as unknown as OpportunityForScoring, NOW);
  eq(noOpp, null, "فرصة غائبة → null");
  const valid = computeFitScore(makeProfile({ sectors: null, stage: null, ask: null, languages: null, requiredDocs: null }), makeOpp(), NOW);
  ok(valid !== null, "ملف شبه فارغ (قيميًّا) → نتيجة بأصفار لا null");
  if (valid) eq(valid.total, 16, "شبه الفارغ: مستندات 10 (لا مطلوبات) + وقت 6 (بلا موعد) = 16");
}

// ————— الحالة 12: موثوقية عالية كاملة —————
caseHeader("الحالة 12 — موثوقية كاملة → 100 high");
{
  const r = computeReliability(
    { sourceType: "official", verifiedAt: isoAfter(-10), mandatoryConditionCount: 4, mandatoryWithEvidenceCount: 4, linkCheckState: "ok" },
    NOW,
  );
  eq(r.total, 100, "المجموع 100");
  eq(r.level, "high", "المستوى high");
  eq(r.warningAr, undefined, "لا تحذير للمستوى العالي");
  eq(r.signals.length, 4, "أربع إشارات");
  eq(signal(r, "source").score, 40, "مصدر رسمي → 40");
  eq(signal(r, "freshness").score, 25, "تحقق قبل 10 أيام → 25");
  eq(signal(r, "evidence").score, 25, "4/4 أدلة → 25");
  eq(signal(r, "link").score, 10, "رابط سليم → 10");
}

// ————— الحالة 13: موثوقية متوسطة —————
caseHeader("الحالة 13 — موثوقية متوسطة (وسيط + أدلة جزئية + فشل واحد)");
{
  const r = computeReliability(
    { sourceType: "trusted_aggregator", verifiedAt: isoAfter(-10), mandatoryConditionCount: 4, mandatoryWithEvidenceCount: 2, linkCheckState: "fail_once" },
    NOW,
  );
  eq(r.total, 63, "20+25+12.5+5 = 62.5 → 63");
  eq(r.level, "medium", "المستوى medium");
  eq(r.warningAr, undefined, "لا تحذير للمتوسط");
}

// ————— الحالة 14: موثوقية منخفضة + تحذير —————
caseHeader("الحالة 14 — موثوقية منخفضة → 0 low مع تحذير");
{
  const r = computeReliability(
    { sourceType: "other", verifiedAt: null, mandatoryConditionCount: 3, mandatoryWithEvidenceCount: 0, linkCheckState: "fail_twice" },
    NOW,
  );
  eq(r.total, 0, "المجموع 0");
  eq(r.level, "low", "المستوى low");
  eq(r.warningAr, "مصدر قديم أو ضعيف الأدلة — تحقق قبل الاعتماد", "نص التحذير حرفيًّا");
}

// ————— الحالة 15: حدود الحداثة —————
caseHeader("الحالة 15 — حداثة التحقق (الحدود 30/180 والتناقص الخطي)");
{
  const freshAt = (verifiedAt: string | null) =>
    signal(
      computeReliability(
        { sourceType: "official", verifiedAt, mandatoryConditionCount: 0, mandatoryWithEvidenceCount: 0, linkCheckState: "ok" },
        NOW,
      ),
      "freshness",
    ).score;
  eq(freshAt(isoAfter(-29)), 25, "29 يومًا → 25");
  eq(freshAt(isoAfter(-30)), 25, "30 يومًا بالضبط → 25");
  eq(freshAt(isoAfter(-36)), 24, "36 يومًا → 24 (تناقص خطي)");
  eq(freshAt(isoAfter(-105)), 12.5, "105 أيام → 12.5");
  eq(freshAt(isoAfter(-179)), 0.17, "179 يومًا → 0.17");
  eq(freshAt(isoAfter(-180)), 0, "180 يومًا → 0");
  eq(freshAt(isoAfter(-400)), 0, "400 يوم → 0");
  eq(freshAt(null), 0, "بلا verifiedAt → 0");
  const future = computeReliability(
    { sourceType: "official", verifiedAt: isoAfter(10), mandatoryConditionCount: 0, mandatoryWithEvidenceCount: 0, linkCheckState: "ok" },
    NOW,
  );
  eq(signal(future, "freshness").score, 25, "تاريخ مستقبلي يُعامل حديثًا");
  const bad = computeReliability(
    { sourceType: "official", verifiedAt: "not-a-date", mandatoryConditionCount: 0, mandatoryWithEvidenceCount: 0, linkCheckState: "ok" },
    NOW,
  );
  eq(signal(bad, "freshness").score, 0, "تاريخ غير صالح → 0");
  ok(signal(bad, "freshness").detail.includes("غير صالح"), "تفسير التاريخ غير الصالح");
}

// ————— الحالة 16: تغطية الأدلة —————
caseHeader("الحالة 16 — تغطية الأدلة (المقام 0 → كاملة)");
{
  const noMandatory = computeReliability(
    { sourceType: "official", verifiedAt: isoAfter(-5), mandatoryConditionCount: 0, mandatoryWithEvidenceCount: 0, linkCheckState: "ok" },
    NOW,
  );
  eq(signal(noMandatory, "evidence").score, 25, "لا شروط إلزامية → 25");
  ok(signal(noMandatory, "evidence").detail.includes("لا شروط إلزامية"), "تفسير «لا شروط إلزامية»");

  const partial = computeReliability(
    { sourceType: "official", verifiedAt: isoAfter(-5), mandatoryConditionCount: 8, mandatoryWithEvidenceCount: 6, linkCheckState: "ok" },
    NOW,
  );
  eq(signal(partial, "evidence").score, 18.75, "6/8 → 18.75");

  const negative = computeReliability(
    { sourceType: "official", verifiedAt: isoAfter(-5), mandatoryConditionCount: -3, mandatoryWithEvidenceCount: 0, linkCheckState: "ok" },
    NOW,
  );
  eq(signal(negative, "evidence").score, 25, "مقام سالب/غير صالح → يُعامل كلا شروط");
}

// ————— الحالة 17: حدود المستويات الثلاثة —————
caseHeader("الحالة 17 — حدود المستويات (80/79 و50/49 والتقريب)");
{
  const r80 = computeReliability(
    { sourceType: "official", verifiedAt: isoAfter(-10), mandatoryConditionCount: 5, mandatoryWithEvidenceCount: 1, linkCheckState: "ok" },
    NOW,
  );
  eq(r80.total, 80, "المجموع 80");
  eq(r80.level, "high", "80 → high");

  const r79 = computeReliability(
    { sourceType: "official", verifiedAt: isoAfter(-36), mandatoryConditionCount: 5, mandatoryWithEvidenceCount: 1, linkCheckState: "ok" },
    NOW,
  );
  eq(r79.total, 79, "المجموع 79");
  eq(r79.level, "medium", "79 → medium");

  const r50 = computeReliability(
    { sourceType: "trusted_aggregator", verifiedAt: null, mandatoryConditionCount: 5, mandatoryWithEvidenceCount: 4, linkCheckState: "ok" },
    NOW,
  );
  eq(r50.total, 50, "المجموع 50");
  eq(r50.level, "medium", "50 → medium");

  const r49 = computeReliability(
    { sourceType: "trusted_aggregator", verifiedAt: isoAfter(-126), mandatoryConditionCount: 5, mandatoryWithEvidenceCount: 3, linkCheckState: "fail_once" },
    NOW,
  );
  eq(r49.total, 49, "المجموع 49");
  eq(r49.level, "low", "49 → low");
  eq(r49.warningAr, "مصدر قديم أو ضعيف الأدلة — تحقق قبل الاعتماد", "تحذير low");

  const r495 = computeReliability(
    { sourceType: "trusted_aggregator", verifiedAt: isoAfter(-33), mandatoryConditionCount: 5, mandatoryWithEvidenceCount: 1, linkCheckState: "fail_twice" },
    NOW,
  );
  eq(r495.total, 50, "المجموع الخام 49.5 يقرَّب إلى 50");
  eq(r495.level, "medium", "بعد التقريب → medium");
}

// ————— الحالة 18: سلامة الرابط —————
caseHeader("الحالة 18 — سلامة الرابط (ok/fail_once/fail_twice)");
{
  const states: Array<["ok" | "fail_once" | "fail_twice", number]> = [["ok", 10], ["fail_once", 5], ["fail_twice", 0]];
  for (const [state, expected] of states) {
    const r = computeReliability(
      { sourceType: "official", verifiedAt: isoAfter(-3), mandatoryConditionCount: 0, mandatoryWithEvidenceCount: 0, linkCheckState: state },
      NOW,
    );
    eq(signal(r, "link").score, expected, `${state} → ${expected}`);
  }
  const unknown = computeReliability(
    { sourceType: "official", verifiedAt: isoAfter(-3), mandatoryConditionCount: 0, mandatoryWithEvidenceCount: 0, linkCheckState: "weird" as unknown as ReliabilityInput["linkCheckState"] },
    NOW,
  );
  eq(signal(unknown, "link").score, 0, "حالة غير معروفة → 0");
}

// ————— الحالة 19: الحتمية —————
caseHeader("الحالة 19 — الحتمية (نفس المدخلات + now محقون → نفس المخرجات)");
{
  const p = makeProfile({ sectors: ["agritech", "ai"], ask: 90000, askType: "equity" });
  const o = makeOpp({ sectors: ["ai", "fintech"], amountMin: 50000, amountMax: 120000, fundingType: "non_equity", requiresDocs: ["pitch_deck"], deadline: isoAfter(22) });
  const r1 = computeFitScore(p, o, NOW);
  const r2 = computeFitScore(p, o, NOW);
  eq(JSON.stringify(r1), JSON.stringify(r2), "تكرار الاستدعاء متطابق");

  const i: ReliabilityInput = { sourceType: "trusted_aggregator", verifiedAt: isoAfter(-44), mandatoryConditionCount: 6, mandatoryWithEvidenceCount: 2, linkCheckState: "fail_once" };
  const s1 = computeReliability(i, NOW);
  const s2 = computeReliability(i, NOW);
  eq(JSON.stringify(s1), JSON.stringify(s2), "تكرار الموثوقية متطابق");

  // المسار الافتراضي (بلا now) لا يرمي وتبقى نتيجته ضمن الحدود
  const defaultNow = computeFitScore(makeProfile(), makeOpp({ deadline: null }), undefined);
  ok(defaultNow !== null && defaultNow.total >= 0 && defaultNow.total <= 100, "المسار الافتراضي بلا now يعمل");
  const defaultRel = computeReliability({ sourceType: "official", verifiedAt: null, mandatoryConditionCount: 1, mandatoryWithEvidenceCount: 0, linkCheckState: "ok" });
  ok(defaultRel.total >= 0 && defaultRel.total <= 100, "الموثوقية بلا now تعمل");
}

// ————— الحالة 20: عامل الوقت تحت أوزان معدلة —————
caseHeader("الحالة 20 — تناسب عامل الوقت مع الأوزان");
{
  const fifteen = computeFitScore(makeProfile(), makeOpp({ deadline: isoAfter(15) }), NOW, { time: 30 });
  eq(factor(fifteen, "time").score, 15, "15 يومًا بوزن 30 → 15 (نسبة 0.5)");
  const plenty = computeFitScore(makeProfile(), makeOpp({ deadline: isoAfter(60) }), NOW, { time: 30 });
  eq(factor(plenty, "time").score, 30, "وقت كافٍ بوزن 30 → 30");
}

// ————— الخلاصة —————
console.log("");
const total = passed + failed;
if (failed > 0) {
  console.log(`فشل ${failed} من ${total} فحصًا.`);
  process.exit(1);
}
console.log(`نجحت جميع الفحوص: ${passed}/${total}.`);
console.log("SCORING CHECK PASSED");
