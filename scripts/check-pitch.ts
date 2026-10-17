/**
 * Masar — T8 التحقق الذاتي: المعايير التسعة + الفجوات + الادعاءات والتعارض
 * تشغيل: bun scripts/check-pitch.ts  (من /home/z/my-project)
 */
import { evaluateReadiness, CRITERIA } from "../src/lib/pitch/criteria";
import { buildGapReport } from "../src/lib/pitch/gap";
import { extractClaims, detectContradictions } from "../src/lib/pitch/claims";
import type { Slide, ExtractedField, EligibilityResult } from "../src/lib/core/types";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

// ————— عرض زراعة ذكية عربي من 12 شريحة —————
const slides: Slide[] = [
  { index: 1, title: "مسار الزراعة الذكية", text: "شركة مسار للزراعة الذكية\nنظام ري ذكي للمزارع الصغيرة" },
  { index: 2, title: "المشكلة", text: "المزارعون في فلسطين يستهلكون 60% من المياه في ري تقليدي\nهدر كبير في المياه والوقت" },
  { index: 3, title: "العميل المستهدف", text: "المزارع الصغير مالك 1-10 دونمات\nالتعاونيات الزراعية" },
  { index: 4, title: "الحل", text: "منصة مسار: مستشعرات رطوبة تربة + تطبيق جوال\nتوفير مياه تلقائي حسب نوع المحصول" },
  { index: 5, title: "السوق", text: "حجم السوق TAM: 1.2 مليار دولار\nالسوق المتاح SAM: 300 مليون\nSOM: 15 مليون" },
  { index: 6, title: "نموذج العمل", text: "اشتراك شهري 12 دولار للمزرعة\nإيرادات متكررة + بيع المعدات" },
  { index: 7, title: "الجرّب", text: "500 مستخدم نشط\nنمو 40% شهريًا\nإيرادات شهرية 6000 دولار" },
  { index: 8, title: "الفريق", text: "فريق من 5 أعضاء\nالمؤسِسة سارة — مهندسة زراعية\nالمؤسس أحمد — مطور برمجيات" },
  { index: 9, title: "المنافسة", text: "منافسون: أنظمة ري تقليدية\nتمييزنا: أرخص 30% ومناسب للمزارع الصغيرة" },
  { index: 10, title: "الخطة", text: "توسع لدول الجوار خلال 18 شهرًا" },
  { index: 11, title: "الطلب", text: "نطلب تمويلًا بقيمة 500 ألف دولار\nمقابل حصة 10%" },
  { index: 12, title: "الخاتمة", text: "شكرًا لكم\nمسار — ري أذكى، محصول أوفر" },
];

const fields: ExtractedField[] = [
  { key: "company.askAmountUSD", value: 500000, page: 11, quote: "نطلب تمويلًا بقيمة 500 ألف دولار", confidence: 0.9, status: "confirmed" },
  { key: "company.tractionUsers", value: 500, page: 7, quote: "500 مستخدم نشط", confidence: 0.85, status: "confirmed" },
];

console.log("[1] المعايير التسعة");
check("عدد المعايير 9", CRITERIA.length === 9);
const report = evaluateReadiness(slides, fields);
check("توليد تقرير بتسعة معايير", report.criteria.length === 9);
const byKey = new Map(report.criteria.map((c) => [c.key, c]));
check("السوق strong مع أرقام", byKey.get("market")?.level === "strong", JSON.stringify(byKey.get("market")));
check("الطلب strong مع مبلغ", byKey.get("ask_clarity")?.level === "strong");
check("الجرّب strong (500 مستخدم ونمو)", byKey.get("traction")?.level === "strong");
check("المشكلة لديها دليل بشرائح", (byKey.get("problem")?.slides.length ?? 0) >= 1);
check("الحل ليس missing", (byKey.get("solution")?.level ?? "missing") !== "missing");
check("الملخص العام نص عربي غير فارغ", report.overallSummaryAr.length > 5);
check("كل معيار له evidenceAr", report.criteria.every((c) => c.evidenceAr.length > 0));

console.log("[2] معيار غائب → missing");
const slidesNoComp = slides.map((s) => (s.index === 9 ? { ...s, title: "المزيد", text: "خططنا المستقبلية" } : s));
const report2 = evaluateReadiness(slidesNoComp, fields);
const comp2 = report2.criteria.find((c) => c.key === "competition");
check("المنافسة بعد حذفها → missing/weak", comp2?.level === "missing" || comp2?.level === "weak", JSON.stringify(comp2?.level));

console.log("[3] تقرير الفجوات");
const profile: import("../src/lib/core/types").ProfileSnapshot = {
  fields: [
    { field: "founder.region", value: "west_bank", source: "manual" as const },
    { field: "company.sectors", value: ["agritech"], source: "manual" as const },
  ],
  founders: [{ region: "west_bank", isPrimary: true }],
  documents: [{ docType: "pitch_deck", status: "available" as const }],
};
const matchResult: EligibilityResult = {
  judgment: "UNCERTAIN",
  summary: "غير محسوم",
  conditions: [
    {
      conditionId: "c1",
      field: "company.registrationCountry",
      op: "in",
      mandatory: true,
      status: "UNRESOLVED",
      evidenceState: "ok",
      expected: "بلد تسجيل الشركة ضمن: فلسطين",
      actual: "غير مذكور",
      unresolvedReason: "MISSING_PROFILE_DATA",
    },
  ],
  satisfiedCount: 1,
  notSatisfiedCount: 0,
  unresolvedCount: 1,
  blockingReasons: [],
  uncertainReasons: ["نقص في بيانات ملفك: بلد تسجيل الشركة"],
  executionNotes: [],
};
const gap = buildGapReport(
  profile,
  [{ opp: { id: "o1", title: "حاضنة انطلاقة", requiresDocs: ["registration_cert", "pitch_deck"] }, result: matchResult }],
  report,
);
check("حقل الوضع القانوني ضمن الناقص", gap.missingProfileFields.includes("company.registrationCountry"));
check("بلد التسجيل ضمن الناقص", gap.missingProfileFields.includes("company.registrationCountry"));
check("الجغرافيا غير ناقصة (موجودة)", !gap.missingProfileFields.includes("founder.region"));
check("فجوة الفرصة تتضمن نقص بيانات", gap.perOpportunity[0]?.gapsAr.some((g) => g.includes("نقص في بيانات")) ?? false);
check("مستند ناقص: registration_cert", gap.perOpportunity[0]?.missingDocs.includes("registration_cert") ?? false);
check("pitch_deck غير ناقص (متوفر)", !(gap.perOpportunity[0]?.missingDocs.includes("pitch_deck") ?? true));
check("ملاحظات عامة غير فارغة", gap.notesAr.length >= 2);

console.log("[4] الادعاءات");
const claims = extractClaims(slides);
check("استخراج TAM", claims.some((c) => c.type === "market_size" && c.unit === "TAM" && c.value === 1_200_000_000), JSON.stringify(claims.filter((c) => c.type === "market_size")));
check("استخراج SAM", claims.some((c) => c.type === "market_size" && c.unit === "SAM" && c.value === 300_000_000));
check("استخراج SOM", claims.some((c) => c.type === "market_size" && c.unit === "SOM" && c.value === 15_000_000));
check("استخراج الطلب 500 ألف", claims.some((c) => c.type === "funding_ask" && c.value === 500_000));
check("استخراج النمو 40%", claims.some((c) => c.type === "growth" && c.value === 40));
check("استخراج المستخدمين 500", claims.some((c) => c.type === "users" && c.value === 500));
check("كل ادعاء له صفحة واقتباس", claims.every((c) => c.page > 0 && c.quote.length > 3));
check("لا ادعاء سنة", !claims.some((c) => c.page === 0));

console.log("[5] التعارضات");
const slidesConflict = slides.map((s) =>
  s.index === 10 ? { ...s, title: "السوق مرة أخرى", text: "حجم السوق TAM يصل إلى 800 مليون دولار" } : s,
);
const claims2 = extractClaims(slidesConflict);
const contradictions = detectContradictions(claims2);
check("كشف قيمتي TAM المختلفتين", contradictions.some((c) => c.ar.includes("حجم السوق (TAM)") && c.ar.includes("33%")), JSON.stringify(contradictions));
check("لا تعارض بالنسخة المتسقة", detectContradictions(claims).length === 0, JSON.stringify(detectContradictions(claims)));

console.log("[6] الحتمية");
const r1 = evaluateReadiness(slides, fields);
const r2 = evaluateReadiness(slides, fields);
check("نفس المدخلات ⇒ نفس المستويات", JSON.stringify(r1.criteria.map((c) => c.level)) === JSON.stringify(r2.criteria.map((c) => c.level)));

console.log(`\nالمجموع: ${pass} فحصًا، الإخفاقات: ${fail}`);
if (fail === 0) {
  console.log("PITCH CHECK PASSED");
  process.exit(0);
} else {
  process.exit(1);
}
