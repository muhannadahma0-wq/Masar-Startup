/**
 * Masar — التحقق الذاتي لمحرك الأهلية الحتمي (T3)
 * ---------------------------------------------------------------------------
 * التشغيل من جذر المشروع: bun scripts/check-engine.ts
 * يغطي: الحكم الثلاثي، أولوية الرفض المؤكد، غياب الدليل، الغموض، الدليل القديم/
 * الضعيف، قاعدة «null لا يُعامل false»، المؤسسون المتعددون (any/all)،
 * جميع المعاملات التسعة (eq/neq/in/not_in/gte/lte/between/contains/exists)،
 * تعارض الأنواع، الشروط غير الإلزامية، عوائق التنفيذ، التسمية العربية،
 * الفحص السريع، الحتمية، والحد الفاصل 180 يومًا.
 * النجاح الكامل يطبع «ENGINE CHECK PASSED».
 */

import {
  QuickCheckAnswers,
  evaluateCondition,
  evaluateEligibility,
  quickProfileFromAnswers,
  toArabicLabel,
} from "../src/lib/core/engine";
import type {
  EligibilityResult,
  ProfileFieldKey,
  ProfileFieldValue,
  ProfileSnapshot,
  RuleCondition,
  RuleEvidence,
} from "../src/lib/core/types";

// ————— أدوات الفحص —————

const NOW = new Date("2026-01-15T00:00:00.000Z");
const DAY_MS = 86_400_000;

const daysAgo = (n: number): string => new Date(NOW.getTime() - n * DAY_MS).toISOString();

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    const line = `  ✗ ${name}${detail ? ` — ${detail}` : ""}`;
    failures.push(line);
    console.log(line);
  }
}

function section(title: string): void {
  console.log(`\n— ${title}`);
}

function ev(days: number, url = "https://example.org/program", quote = "الشرط كما ورد في صفحة الجهة"): RuleEvidence {
  return { url, quote, verifiedAt: daysAgo(days) };
}

let seq = 0;
interface CondInit {
  field: ProfileFieldKey;
  op: RuleCondition["op"];
  value?: unknown;
  mandatory?: boolean;
  ambiguous?: boolean;
  scope?: "any" | "all";
  sourceWording?: string;
  evidence?: RuleEvidence | null;
}
function cond(p: CondInit): RuleCondition {
  seq++;
  return {
    id: `c${seq}`,
    field: p.field,
    op: p.op,
    value: p.value ?? null,
    mandatory: p.mandatory ?? true,
    ambiguous: p.ambiguous ?? false,
    scope: p.scope ?? "any",
    sourceWording: p.sourceWording ?? null,
    evidence: p.evidence ?? null,
  };
}

function f(field: ProfileFieldKey, value: unknown): ProfileFieldValue {
  return { field, value, source: "manual" };
}

function profile(fields: ProfileFieldValue[], founders?: ProfileSnapshot["founders"]): ProfileSnapshot {
  return { fields, founders: founders ?? [], documents: [] };
}

function baseProfile(): ProfileSnapshot {
  return profile([
    f("company.name", "الزراعة الذكية"),
    f("founder.region", "west_bank"),
    f("company.sectors", ["agritech", "iot"]),
    f("company.stage", "prototype"),
    f("company.legalStatus", "registered_local"),
    f("company.registrationCountry", "ps"),
    f("company.ageMonths", 14),
    f("company.teamSize", 4),
    f("company.womenLed", true),
    f("company.askAmountUSD", 20000),
    f("company.languages", ["ar", "en"]),
    f("company.requiredDocs", ["pitch_deck", "business_plan"]),
  ]);
}

// ————— A. الحكم الثلاثي الكامل —————

section("A. الحكم الثلاثي الكامل (ELIGIBLE / NOT_ELIGIBLE / UNCERTAIN)");

const condsEligible: RuleCondition[] = [
  cond({ field: "founder.region", op: "in", value: ["west_bank", "gaza"], evidence: ev(10) }),
  cond({ field: "company.ageMonths", op: "gte", value: 12, evidence: ev(10) }),
  cond({ field: "company.askAmountUSD", op: "between", value: [10000, 50000], evidence: ev(10) }),
];
const rEligible = evaluateEligibility(baseProfile(), condsEligible, NOW);
check("A1: ELIGIBLE كامل الأدلة — كل إلزامي مستوفى بدليل ok", rEligible.judgment === "ELIGIBLE");
check("A1: لا أسباب رفض ولا أسباب تعليق", rEligible.blockingReasons.length === 0 && rEligible.uncertainReasons.length === 0);
check(
  "A1: العدادات صحيحة (3/0/0)",
  rEligible.satisfiedCount === 3 && rEligible.notSatisfiedCount === 0 && rEligible.unresolvedCount === 0
);
check("A1: الملخص جملة عربية تذكر «مؤهل»", rEligible.summary.includes("مؤهل") && rEligible.summary.length > 10);
check(
  "A1: expected حرفيًّا «إقامة المؤسس ضمن: الضفة الغربية، قطاع غزة»",
  rEligible.conditions[0].expected === "إقامة المؤسس ضمن: الضفة الغربية، قطاع غزة"
);
check("A1: actual حرفيًّا «الضفة الغربية»", rEligible.conditions[0].actual === "الضفة الغربية");
check(
  "A1: between متوقع «المبلغ المطلوب بالدولار بين 10,000 و50,000»",
  rEligible.conditions[2].expected === "المبلغ المطلوب بالدولار بين 10,000 و50,000"
);
check("A1: الدليل يُمرَّر في النتيجة (url)", (rEligible.conditions[0].evidence?.url ?? "") === "https://example.org/program");

const condsRejected: RuleCondition[] = [
  ...condsEligible,
  cond({ field: "company.legalStatus", op: "eq", value: "registered_foreign", evidence: ev(5) }),
  cond({ field: "company.monthlyRevenueUSD", op: "gte", value: 500, evidence: ev(5) }),
];
const rRejected = evaluateEligibility(baseProfile(), condsRejected, NOW);
check("A2: NOT_ELIGIBLE — رفض مؤكد بدليل ok أولويةً حتى مع شرط غير محسوم", rRejected.judgment === "NOT_ELIGIBLE");
check("A2: سبب رفض عربي واحد مع القيمتين العربية والفعلية", rRejected.blockingReasons.length === 1 && rRejected.blockingReasons[0].includes("مسجلة في الخارج") && rRejected.blockingReasons[0].includes("مسجلة محليًّا"));
check(
  "A2: العدادات (3/1/1) — الإيراد الغائب UNRESOLVED لا يعامل false",
  rRejected.satisfiedCount === 3 && rRejected.notSatisfiedCount === 1 && rRejected.unresolvedCount === 1
);
check("A2: الملخص يذكر «غير مؤهل» و«رفض مؤكد»", rRejected.summary.includes("غير مؤهل") && rRejected.summary.includes("رفض مؤكد"));

const condsUncertain: RuleCondition[] = [
  cond({ field: "founder.region", op: "in", value: ["west_bank", "gaza"] }),
  cond({ field: "company.ageMonths", op: "gte", value: 12, evidence: ev(10) }),
];
const rUncertain = evaluateEligibility(baseProfile(), condsUncertain, NOW);
check("A3: UNCERTAIN — شرط إلزامي مستوفى لكن بلا دليل", rUncertain.judgment === "UNCERTAIN");
check("A3: السبب يذكر غياب الدليل", rUncertain.uncertainReasons.length === 1 && rUncertain.uncertainReasons[0].includes("بلا دليل"));
check("A3: لا أسباب رفض", rUncertain.blockingReasons.length === 0);

// رفض غير مؤكد (غير مستوفى لكن بلا دليل) → UNCERTAIN وليس NOT_ELIGIBLE
const rUnconfirmedRej = evaluateEligibility(
  baseProfile(),
  [cond({ field: "company.legalStatus", op: "eq", value: "registered_foreign" })],
  NOW
);
check("A4: رفض بلا دليل لا يُؤكد — الحكم UNCERTAIN", rUnconfirmedRej.judgment === "UNCERTAIN");
check("A4: blockingReasons فارغة للرفض غير المؤكد", rUnconfirmedRej.blockingReasons.length === 0);
check("A4: السبب يوضح أن الرفض غير مؤكد", rUnconfirmedRej.uncertainReasons[0].includes("لا يُؤكد الرفض"));

// ————— B. الغموض —————

section("B. الغموض في نص الجهة (ambiguous)");

const condAmbiguous = cond({
  field: "founder.region",
  op: "in",
  value: ["west_bank", "east_jerusalem"],
  ambiguous: true,
  sourceWording: "متقدمو القدس والشتات والمناطق المجاورة",
  evidence: ev(10),
});
const rAmb = evaluateCondition(baseProfile(), condAmbiguous, NOW);
check("B1: غامض → UNRESOLVED بسبب AMBIGUOUS_WORDING", rAmb.status === "UNRESOLVED" && rAmb.unresolvedReason === "AMBIGUOUS_WORDING");
check("B1: الإجراء المقترح يوصي بمراسلة الجهة", (rAmb.suggestedAction ?? "").includes("مراسلة الجهة"));
check("B1: عبارة الجهة معروضة في النتيجة", rAmb.sourceWording === "متقدمو القدس والشتات والمناطق المجاورة");
const rAmb2 = evaluateEligibility(baseProfile(), [condAmbiguous], NOW);
check("B1: الحكم UNCERTAIN بسبب الغموض والسبب يذكر «غموض»", rAmb2.judgment === "UNCERTAIN" && rAmb2.uncertainReasons[0].includes("غموض"));
check("B1: عبارة الجهة تظهر داخل سبب UNCERTAIN", rAmb2.uncertainReasons[0].includes("متقدمو القدس والشتات"));

// ————— C. الدليل: قديم / ضعيف / حد 180 يومًا —————

section("C. حالات الدليل (stale / weak / حد 180 يومًا)");

const rStale = evaluateCondition(baseProfile(), cond({ field: "company.ageMonths", op: "gte", value: 12, evidence: ev(200) }), NOW);
check("C1: دليل أقدم من 180 يومًا → stale والشرط يبقى SATISFIED", rStale.evidenceState === "stale" && rStale.status === "SATISFIED");
const rStale2 = evaluateEligibility(baseProfile(), [cond({ field: "company.ageMonths", op: "gte", value: 12, evidence: ev(200) })], NOW);
check("C1: دليل قديم يقيّد الحكم إلى UNCERTAIN والسبب يذكر 180", rStale2.judgment === "UNCERTAIN" && rStale2.uncertainReasons[0].includes("180"));

const rBoundary = evaluateCondition(baseProfile(), cond({ field: "company.ageMonths", op: "gte", value: 12, evidence: ev(180) }), NOW);
check("C2: عند 180 يومًا بالضبط الدليل ok (الأقدمية شرط >180)", rBoundary.evidenceState === "ok");
const rBoundary2 = evaluateCondition(baseProfile(), cond({ field: "company.ageMonths", op: "gte", value: 12, evidence: ev(181) }), NOW);
check("C2: عند 181 يومًا → stale", rBoundary2.evidenceState === "stale");

const rWeakNoQuote = evaluateCondition(
  baseProfile(),
  cond({ field: "company.ageMonths", op: "gte", value: 12, evidence: { url: "https://example.org/x", quote: "", verifiedAt: daysAgo(10) } }),
  NOW
);
check("C3: دليل بلا اقتباس → weak", rWeakNoQuote.evidenceState === "weak");
const rWeakNoUrl = evaluateCondition(
  baseProfile(),
  cond({ field: "company.ageMonths", op: "gte", value: 12, evidence: { url: "", quote: "نص", verifiedAt: daysAgo(10) } }),
  NOW
);
check("C3: دليل بلا رابط → weak", rWeakNoUrl.evidenceState === "weak");
const rWeakJudgment = evaluateEligibility(
  baseProfile(),
  [cond({ field: "company.ageMonths", op: "gte", value: 12, evidence: { url: "https://example.org/x", quote: "", verifiedAt: daysAgo(10) } })],
  NOW
);
check("C3: دليل ضعيف يقيّد الحكم إلى UNCERTAIN", rWeakJudgment.judgment === "UNCERTAIN" && rWeakJudgment.uncertainReasons[0].includes("ضعيف"));

// ————— D. null لا يُعامل false أبدًا —————

section("D. القيمة الغائبة (null) → UNRESOLVED دائمًا");

const rNull = evaluateCondition(baseProfile(), cond({ field: "company.monthlyRevenueUSD", op: "gte", value: 100, evidence: ev(10) }), NOW);
check("D1: null مع gte → UNRESOLVED/MISSING_PROFILE_DATA وليس NOT_SATISFIED", rNull.status === "UNRESOLVED" && rNull.unresolvedReason === "MISSING_PROFILE_DATA");
check("D1: actual = «غير مذكور»", rNull.actual === "غير مذكور");
check("D1: إجراء مقترح لإكمال الملف", (rNull.suggestedAction ?? "").includes("أكمل حقل"));
const rNullJudge = evaluateEligibility(baseProfile(), [cond({ field: "company.monthlyRevenueUSD", op: "gte", value: 100, evidence: ev(10) })], NOW);
check("D1: نقص الملف وحده لا يرفض — الحكم UNCERTAIN", rNullJudge.judgment === "UNCERTAIN" && rNullJudge.blockingReasons.length === 0);

const rNullNeq = evaluateCondition(baseProfile(), cond({ field: "company.monthlyRevenueUSD", op: "neq", value: 100, evidence: ev(10) }), NOW);
check("D2: null مع neq → UNRESOLVED أيضًا (لا تخمين بالعكس)", rNullNeq.status === "UNRESOLVED" && rNullNeq.unresolvedReason === "MISSING_PROFILE_DATA");
const rNullExists = evaluateCondition(baseProfile(), cond({ field: "company.tractionUsers", op: "exists", evidence: ev(10) }), NOW);
check("D3: exists على قيمة غائبة → UNRESOLVED/MISSING_PROFILE_DATA", rNullExists.status === "UNRESOLVED" && rNullExists.unresolvedReason === "MISSING_PROFILE_DATA");

// ————— E. المؤسسون المتعددون (any / all) —————

section("E. المؤسسون المتعددون (scope any / all)");

const twoFounders: ProfileSnapshot["founders"] = [
  { name: "سارة", region: "west_bank", nationality: null, isPrimary: true },
  { name: "عمر", region: "diaspora", nationality: null, isPrimary: false },
];
const profTwo = profile([], twoFounders);

const rAnyOk = evaluateCondition(profTwo, cond({ field: "founder.region", op: "in", value: ["gaza", "west_bank"], scope: "any" }), NOW);
check("E1: any — يكفي مؤسس واحد مستوفٍ → SATISFIED", rAnyOk.status === "SATISFIED");
check("E1: expected بصياغة «أحد المؤسسين»", rAnyOk.expected.includes("أحد المؤسسين"));
check("E1: actual تجمع قيم المؤسسين «الضفة الغربية، الشتات»", rAnyOk.actual === "الضفة الغربية، الشتات");

const rAllFail = evaluateCondition(profTwo, cond({ field: "founder.region", op: "in", value: ["gaza"], scope: "all" }), NOW);
check("E2: all — مؤسس واحد خارج القائمة → NOT_SATISFIED", rAllFail.status === "NOT_SATISFIED");
check("E2: expected بصياغة «جميع المؤسسين»", rAllFail.expected.includes("جميع المؤسسين"));

const rAllOk = evaluateCondition(profTwo, cond({ field: "founder.region", op: "in", value: ["west_bank", "diaspora"], scope: "all" }), NOW);
check("E3: all — جميع المؤسسين داخل القائمة → SATISFIED", rAllOk.status === "SATISFIED");

const mixedFounders: ProfileSnapshot["founders"] = [
  { name: "سارة", region: "west_bank", nationality: null, isPrimary: true },
  { name: null, region: null, nationality: null, isPrimary: false },
];
const rAllNull = evaluateCondition(profile([], mixedFounders), cond({ field: "founder.region", op: "in", value: ["west_bank"], scope: "all" }), NOW);
check("E4: all مع مؤسس بلا منطقة → UNRESOLVED/MISSING_PROFILE_DATA", rAllNull.status === "UNRESOLVED" && rAllNull.unresolvedReason === "MISSING_PROFILE_DATA");
const rAnyNull = evaluateCondition(profile([], mixedFounders), cond({ field: "founder.region", op: "in", value: ["west_bank"], scope: "any" }), NOW);
check("E4: any مع مؤسس مستوفٍ رغم غياب الآخر → SATISFIED", rAnyNull.status === "SATISFIED");

const rFallback = evaluateCondition(
  profile([f("founder.region", "gaza")]),
  cond({ field: "founder.region", op: "in", value: ["gaza", "west_bank"] }),
  NOW
);
check("E5: لا مؤسسين → القراءة من fields (fallback)", rFallback.status === "SATISFIED" && rFallback.expected.startsWith("إقامة المؤسس"));

// ————— F. المعاملات الرقمية —————

section("F. المعاملات الرقمية (gte / lte / between)");

const rGteOk = evaluateCondition(baseProfile(), cond({ field: "company.ageMonths", op: "gte", value: 12 }), NOW);
check("F1: gte مستوفى (14 ≥ 12)", rGteOk.status === "SATISFIED");
const rGteNo = evaluateCondition(baseProfile(), cond({ field: "company.ageMonths", op: "gte", value: 36 }), NOW);
check("F1: gte غير مستوفى (14 < 36)", rGteNo.status === "NOT_SATISFIED");
const rLteOk = evaluateCondition(baseProfile(), cond({ field: "company.teamSize", op: "lte", value: 5 }), NOW);
check("F2: lte مستوفى (4 ≤ 5)", rLteOk.status === "SATISFIED");
const rLteNo = evaluateCondition(baseProfile(), cond({ field: "company.teamSize", op: "lte", value: 3 }), NOW);
check("F2: lte غير مستوفى (4 > 3)", rLteNo.status === "NOT_SATISFIED");
const rBetweenOk = evaluateCondition(baseProfile(), cond({ field: "company.askAmountUSD", op: "between", value: [10000, 50000] }), NOW);
check("F3: between مستوفى (20000 داخل [10,000، 50,000])", rBetweenOk.status === "SATISFIED");
const rBetweenNo = evaluateCondition(baseProfile(), cond({ field: "company.askAmountUSD", op: "between", value: [30000, 50000] }), NOW);
check("F3: between غير مستوفى (20000 خارج المدى)", rBetweenNo.status === "NOT_SATISFIED");

// ————— G. تعارض الأنواع — لا استثناء أبدًا —————

section("G. تعارض الأنواع (نص مع مقارنة رقمية…) → UNRESOLVED بلا استثناء");

const rTypeText = evaluateCondition(baseProfile(), cond({ field: "company.stage", op: "gte", value: 12 }), NOW);
check("G1: gte على قيمة نصية → UNRESOLVED مع تفصيل التعارض", rTypeText.status === "UNRESOLVED" && rTypeText.unresolvedReason === "MISSING_PROFILE_DATA" && (rTypeText.suggestedAction ?? "").includes("تعارض أنواع"));
const rTypeValue = evaluateCondition(baseProfile(), cond({ field: "company.ageMonths", op: "gte", value: "12" }), NOW);
check("G2: gte مع قيمة شرط نصية → UNRESOLVED (لا تحويل ضمني)", rTypeValue.status === "UNRESOLVED");
const rTypeIn = evaluateCondition(baseProfile(), cond({ field: "company.ageMonths", op: "in", value: 12 }), NOW);
check("G3: in مع قيمة غير قائمة → UNRESOLVED", rTypeIn.status === "UNRESOLVED");
const rBetweenBad = evaluateCondition(baseProfile(), cond({ field: "company.ageMonths", op: "between", value: "12-36" }), NOW);
check("G4: between بقيمة غير [min,max] → UNRESOLVED", rBetweenBad.status === "UNRESOLVED");
let garbageThrew = false;
try {
  evaluateCondition(baseProfile(), null as unknown as RuleCondition, NOW);
} catch {
  garbageThrew = true;
}
check("G5: شرط قمامة لا يرمي استثناءً", !garbageThrew);

// ————— H. eq / neq / in / not_in —————

section("H. المعاملات المنطقية (eq / neq / in / not_in)");

const rEqEnum = evaluateCondition(baseProfile(), cond({ field: "company.stage", op: "eq", value: "prototype" }), NOW);
check("H1: eq تعداد مستوفى", rEqEnum.status === "SATISFIED" && rEqEnum.expected === "مرحلة الشركة: نموذج أولي");
const rEqBool = evaluateCondition(baseProfile(), cond({ field: "company.womenLed", op: "eq", value: true }), NOW);
check("H2: eq منطقي مستوفى", rEqBool.status === "SATISFIED" && rEqBool.actual === "نعم");
const rEqBoolNo = evaluateCondition(baseProfile(), cond({ field: "company.womenLed", op: "eq", value: false }), NOW);
check("H2: eq منطقي غير مستوفى", rEqBoolNo.status === "NOT_SATISFIED");
const rNeq = evaluateCondition(baseProfile(), cond({ field: "company.stage", op: "neq", value: "idea" }), NOW);
check("H3: neq مستوفى (prototype ≠ idea)", rNeq.status === "SATISFIED" && rNeq.expected.includes("أي قيمة غير فكرة"));
const rInOk = evaluateCondition(baseProfile(), cond({ field: "founder.region", op: "in", value: ["west_bank", "gaza"] }), NOW);
check("H4: in مستوفى لقيمة مفردة", rInOk.status === "SATISFIED");
const rInNo = evaluateCondition(baseProfile(), cond({ field: "founder.region", op: "in", value: ["gaza"] }), NOW);
check("H4: in غير مستوفى", rInNo.status === "NOT_SATISFIED");
const rNotInOk = evaluateCondition(baseProfile(), cond({ field: "founder.region", op: "not_in", value: ["diaspora"] }), NOW);
check("H5: not_in مستوفى", rNotInOk.status === "SATISFIED");
const rNotInNo = evaluateCondition(baseProfile(), cond({ field: "founder.region", op: "not_in", value: ["west_bank"] }), NOW);
check("H5: not_in غير مستوفى", rNotInNo.status === "NOT_SATISFIED");
const rInArrayIntersect = evaluateCondition(baseProfile(), cond({ field: "company.sectors", op: "in", value: ["agritech", "fintech"] }), NOW);
check("H6: in على مصفوفة = تقاطع غير فارغ → SATISFIED", rInArrayIntersect.status === "SATISFIED");
const rInArrayNoIntersect = evaluateCondition(baseProfile(), cond({ field: "company.sectors", op: "in", value: ["fintech"] }), NOW);
check("H6: in على مصفوفة بلا تقاطع → NOT_SATISFIED", rInArrayNoIntersect.status === "NOT_SATISFIED");
const rEqArray = evaluateCondition(baseProfile(), cond({ field: "company.sectors", op: "eq", value: ["iot", "agritech"] }), NOW);
check("H7: eq على مصفوفات = تساوي مجموعات بلا ترتيب → SATISFIED", rEqArray.status === "SATISFIED");

// ————— I. contains و exists —————

section("I. contains (نص/مصفوفة) و exists");

const rContainsArr = evaluateCondition(baseProfile(), cond({ field: "company.sectors", op: "contains", value: "iot" }), NOW);
check("I1: contains على مصفوفة مستوفى", rContainsArr.status === "SATISFIED" && rContainsArr.expected === "قطاعات الشركة يتضمن: إنترنت الأشياء");
const rContainsArrNo = evaluateCondition(baseProfile(), cond({ field: "company.sectors", op: "contains", value: "fintech" }), NOW);
check("I1: contains على مصفوفة غير مستوفى", rContainsArrNo.status === "NOT_SATISFIED");
const rContainsStr = evaluateCondition(baseProfile(), cond({ field: "company.name", op: "contains", value: "الزراعة" }), NOW);
check("I2: contains على نص (جزء من العبارة) مستوفى", rContainsStr.status === "SATISFIED");
const rContainsDocs = evaluateCondition(baseProfile(), cond({ field: "company.requiredDocs", op: "contains", value: "pitch_deck" }), NOW);
check("I3: contains على المستندات مستوفى", rContainsDocs.status === "SATISFIED" && rContainsDocs.actual === "عرض تقديمي (Pitch Deck)، خطة عمل");
const rExistsOk = evaluateCondition(baseProfile(), cond({ field: "company.name", op: "exists" }), NOW);
check("I4: exists على قيمة موجودة → SATISFIED", rExistsOk.status === "SATISFIED");
const rExistsEmptyArr = evaluateCondition(profile([f("company.languages", [])]), cond({ field: "company.languages", op: "exists" }), NOW);
check("I5: exists على مصفوفة فارغة → UNRESOLVED (وفق النوع)", rExistsEmptyArr.status === "UNRESOLVED" && rExistsEmptyArr.unresolvedReason === "MISSING_PROFILE_DATA");

// ————— J. الشروط غير الإلزامية وعوائق التنفيذ —————

section("J. الشروط غير الإلزامية (لا تمنع) وعوائق التنفيذ (لا تغيّر الحكم)");

const condsMixed: RuleCondition[] = [
  cond({ field: "founder.region", op: "in", value: ["west_bank"], evidence: ev(10) }),
  cond({ field: "company.sectors", op: "contains", value: "fintech", mandatory: false, evidence: ev(10) }),
];
const rMixed = evaluateEligibility(baseProfile(), condsMixed, NOW);
check("J1: شرط غير إلزامي غير مستوفى لا يمنع ELIGIBLE", rMixed.judgment === "ELIGIBLE");
check("J1: العداد يظهر NOT_SATISFIED للشرط غير الإلزامي", rMixed.notSatisfiedCount === 1);
check("J1: الملخص يذكر الشرط غير الإلزامي بلا منع", rMixed.summary.includes("غير إلزامي") && rMixed.summary.includes("لا يمنع الأهلية"));

const profExec = profile([
  f("founder.hasBankAccount", false),
  f("founder.paymentMethods", ["paypal"]),
  f("founder.region", "west_bank"),
]);
const rExec = evaluateEligibility(profExec, [cond({ field: "founder.region", op: "in", value: ["west_bank"], evidence: ev(10) })], NOW);
check("J2: hasBankAccount=false → ملاحظة تنفيذ «تحقق من طريقة صرف المبلغ…»", rExec.executionNotes.length === 1 && rExec.executionNotes[0] === "تحقق من طريقة صرف المبلغ المتاحة لديك");
check("J2: الملاحظة لا تغيّر الحكم (يبقى ELIGIBLE)", rExec.judgment === "ELIGIBLE");
const rExec2 = evaluateEligibility(
  profile([f("founder.hasBankAccount", true), f("founder.paymentMethods", [])]),
  [cond({ field: "company.ageMonths", op: "gte", value: 12, evidence: ev(10) })],
  NOW
);
check("J3: paymentMethods فارغة → ملاحظة تنفيذ", rExec2.executionNotes.length === 1);
const rExec3 = evaluateEligibility(
  profile([f("founder.hasBankAccount", true), f("founder.paymentMethods", ["bank_transfer"])]),
  [cond({ field: "company.ageMonths", op: "gte", value: 12, evidence: ev(10) })],
  NOW
);
check("J4: لا عائق → لا ملاحظات تنفيذ", rExec3.executionNotes.length === 0);

const rNoMandatory = evaluateEligibility(
  baseProfile(),
  [cond({ field: "company.sectors", op: "contains", value: "fintech", mandatory: false, evidence: ev(5) })],
  NOW
);
check("J5: لا شروط إلزامية → ELIGIBLE مع بيانها في الملخص", rNoMandatory.judgment === "ELIGIBLE" && rNoMandatory.summary.includes("لا شروط إلزامية"));

// ————— K. toArabicLabel —————

section("K. التسمية العربية (toArabicLabel)");

check("K1: المناطق", toArabicLabel("founder.region", "west_bank") === "الضفة الغربية"
  && toArabicLabel("founder.region", "gaza") === "قطاع غزة"
  && toArabicLabel("founder.region", "east_jerusalem") === "القدس الشرقية"
  && toArabicLabel("founder.region", "inside_48") === "الداخل الفلسطيني"
  && toArabicLabel("founder.region", "diaspora") === "الشتات");
check("K2: المراحل", toArabicLabel("company.stage", "idea") === "فكرة"
  && toArabicLabel("company.stage", "prototype") === "نموذج أولي"
  && toArabicLabel("company.stage", "early_revenue") === "إيرادات أولية"
  && toArabicLabel("company.stage", "scaling") === "توسّع");
check("K3: الوضع القانوني", toArabicLabel("company.legalStatus", "not_registered") === "غير مسجلة"
  && toArabicLabel("company.legalStatus", "registered_local") === "مسجلة محليًّا"
  && toArabicLabel("company.legalStatus", "registered_foreign") === "مسجلة في الخارج");
check("K4: القطاعات والمستندات والدول", toArabicLabel("company.sectors", "agritech") === "تقنية زراعية"
  && toArabicLabel("company.sectors", "fintech") === "تقنية مالية"
  && toArabicLabel("company.requiredDocs", "registration_cert") === "شهادة تسجيل الشركة"
  && toArabicLabel("company.registrationCountry", "ps") === "فلسطين"
  && toArabicLabel("company.registrationCountry", "us") === "الولايات المتحدة");
check("K5: المصفوفات تُجمع بفاصلة عربية", toArabicLabel("company.sectors", ["agritech", "fintech"]) === "تقنية زراعية، تقنية مالية");
check("K6: null → «غير مذكور»", toArabicLabel("founder.region", null) === "غير مذكور");
check("K7: منطقية → نعم/لا", toArabicLabel("company.womenLed", true) === "نعم" && toArabicLabel("company.womenLed", false) === "لا");
check("K8: أرقام مفصولة بآلاف", toArabicLabel("company.askAmountUSD", 20000) === "20,000" && toArabicLabel("company.ageMonths", 14) === "14");
check("K9: مفتاح مجهول مع قيمة معروفة (بحث عالمي)", toArabicLabel("x", "west_bank") === "الضفة الغربية");
check("K10: قيمة مجهولة تُعاد كما هي", toArabicLabel("x", "zzz") === "zzz");
check("K11: اللغات وطرق الدفع", toArabicLabel("company.languages", "ar") === "العربية"
  && toArabicLabel("founder.paymentMethods", "bank_transfer") === "تحويل بنكي");

// ————— L. الفحص السريع (quickProfileFromAnswers) —————

section("L. الفحص السريع → ProfileSnapshot");

const parsedAnswers = QuickCheckAnswers.parse({
  region: "west_bank",
  sectors: ["agritech"],
  stage: "prototype",
  askAmountUSD: 15000,
  languages: ["ar", "en"],
});
const quickSnap = quickProfileFromAnswers(parsedAnswers);
check("L1: مؤسس واحد primary بمنطقته", quickSnap.founders.length === 1 && quickSnap.founders[0].region === "west_bank" && quickSnap.founders[0].isPrimary === true);
check("L2: documents فارغة", quickSnap.documents.length === 0);
check("L3: الحقول manual كاملة", quickSnap.fields.length === 7 && quickSnap.fields.every((x) => x.source === "manual"));
const rQuick = evaluateCondition(quickSnap, cond({ field: "company.stage", op: "eq", value: "prototype" }), NOW);
check("L4: تقييم شرط على ملف الفحص السريع يعمل", rQuick.status === "SATISFIED");
const rQuickAmount = evaluateCondition(quickSnap, cond({ field: "company.askAmountUSD", op: "between", value: [10000, 50000] }), NOW);
check("L5: المبلغ من الإجابات يُقيَّم (15,000 داخل المدى)", rQuickAmount.status === "SATISFIED");
const rQuickNull = evaluateCondition(quickSnap, cond({ field: "company.monthlyRevenueUSD", op: "gte", value: 100 }), NOW);
check("L6: الحقول غير المجابة null → UNRESOLVED", rQuickNull.status === "UNRESOLVED" && rQuickNull.actual === "غير مذكور");

const parsedNoLang = QuickCheckAnswers.parse({ region: "gaza", sectors: ["food"], stage: "idea" });
const quickNoLang = quickProfileFromAnswers(parsedNoLang);
check("L7: languages الافتراضية [ar]", JSON.stringify(quickNoLang.fields.find((x) => x.field === "company.languages")?.value) === JSON.stringify(["ar"]));
check(
  "L8: المخطط يرفض منطقة غير معروفة",
  QuickCheckAnswers.safeParse({ region: "mars", sectors: ["agritech"], stage: "idea" }).success === false
);

// ————— M. الحتمية —————

section("M. الحتمية — نفس المدخلات ⇒ نفس المخرجات");

const det1 = evaluateEligibility(baseProfile(), condsRejected, NOW);
const det2 = evaluateEligibility(baseProfile(), JSON.parse(JSON.stringify(condsRejected)) as RuleCondition[], NOW);
check("M1: تكرار التقييم بمدخلات مطابقة يعطي نتيجة متطابقة حرفيًّا", JSON.stringify(det1) === JSON.stringify(det2));
const det3 = evaluateEligibility(baseProfile(), condsEligible, NOW);
const det4 = evaluateEligibility(baseProfile(), condsEligible, NOW);
check("M2: حكم ELIGIBLE قابل للتكرار", JSON.stringify(det3) === JSON.stringify(det4) && det3.judgment === "ELIGIBLE");
check(
  "M3: المجموع الكلي للفحوص أكبر من 15 حالة تغطية",
  passed + failed >= 15
);

// ————— النتيجة النهائية —————

console.log("\n========================================");
console.log(`إجمالي الفحوص: ${passed + failed} — ناجح: ${passed} — فاشل: ${failed}`);
if (failed === 0) {
  console.log("ENGINE CHECK PASSED");
} else {
  console.log("ENGINE CHECK FAILED");
  for (const line of failures) console.log(line);
  process.exit(1);
}
