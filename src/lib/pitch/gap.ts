/**
 * Masar — T8: تقرير الفجوات (حتمي)
 * ---------------------------------------------------------------------------
 * buildGapReport(profile, matches, readiness) → GapReport
 * - missingProfileFields: حقول الملف الغائبة (null/غير موجودة) بترتيب أهمية
 *   (الجغرافيا والقانونية أولًا — هي التي تحسم الأحكام).
 * - missingCriteria: معايير الجاهزية بمستوى missing أو weak.
 * - perOpportunity: لكل فرصة: الحكم + فجوات عربية من أسباب المحرك + مستندات ناقصة.
 * - notesAr: ملاحظات عامة قابلة للفعل.
 *
 * مبادئ: حتمية كاملة، لا استثناءً، لا تخمين — من نتائج المحرك الجاهزة فقط.
 */
import type {
  EligibilityResult,
  GapReport,
  ProfileSnapshot,
  ReadinessReport,
} from "@/lib/core/types";
import { PROFILE_FIELD_KEYS } from "@/lib/core/types";
import type { ProfileFieldKey } from "@/lib/core/types";

// ترتيب الأهمية عند العرض (الجغرافيا والقانونية أولًا)
const FIELD_PRIORITY: ProfileFieldKey[] = [
  "founder.region",
  "company.registrationCountry",
  "company.legalStatus",
  "company.sectors",
  "company.stage",
  "company.askAmountUSD",
  "company.languages",
  "company.teamSize",
  "company.monthlyRevenueUSD",
  "company.tractionUsers",
  "company.ageMonths",
  "company.womenLed",
  "company.requiredDocs",
  "company.askType",
  "company.name",
  "founder.nationality",
  "founder.hasBankAccount",
  "founder.paymentMethods",
];

const FIELD_LABEL_EN: Record<string, string> = {
  "founder.region": "Founder region",
  "company.registrationCountry": "Company registration country",
  "company.legalStatus": "Legal status",
  "company.sectors": "Company sectors",
  "company.stage": "Company stage",
  "company.askAmountUSD": "Requested funding amount",
  "company.languages": "Team languages",
  "company.teamSize": "Team size",
  "company.monthlyRevenueUSD": "Monthly revenue",
  "company.tractionUsers": "Users / customers",
  "company.ageMonths": "Company age (months)",
  "company.womenLed": "Women-led status",
  "company.requiredDocs": "Available documents",
  "company.askType": "Funding type",
  "company.name": "Company name",
  "founder.nationality": "Founder nationality",
  "founder.hasBankAccount": "Bank account",
  "founder.paymentMethods": "Payment methods",
};

const DOC_LABEL_EN: Record<string, string> = {
  registration_cert: "company registration certificate",
  pitch_deck: "pitch deck",
  financial_statements: "financial statements",
  founder_id: "founder ID",
  business_plan: "business plan",
  tax_record: "tax record",
  bank_letter: "bank letter",
  prototype_demo: "prototype demo",
  letters_of_support: "letters of support",
};

const FIELD_LABEL_AR: Record<string, string> = {
  "founder.region": "إقامة المؤسس",
  "company.registrationCountry": "بلد تسجيل الشركة",
  "company.legalStatus": "الوضع القانوني",
  "company.sectors": "قطاعات الشركة",
  "company.stage": "مرحلة الشركة",
  "company.askAmountUSD": "المبلغ التمويلي المطلوب",
  "company.languages": "لغات الفريق",
  "company.teamSize": "حجم الفريق",
  "company.monthlyRevenueUSD": "الإيراد الشهري",
  "company.tractionUsers": "عدد المستخدمين/العملاء",
  "company.ageMonths": "عمر الشركة بالأشهر",
  "company.womenLed": "قيادة نسائية",
  "company.requiredDocs": "المستندات المتوفرة",
  "company.askType": "نوع التمويل المطلوب",
  "company.name": "اسم الشركة",
  "founder.nationality": "جنسية المؤسس",
  "founder.hasBankAccount": "حساب مصرفي",
  "founder.paymentMethods": "طرق استلام التمويل",
};

export interface GapMatchInput {
  opp: { id: string; title: string; requiresDocs?: string[] };
  result: EligibilityResult;
}

export function buildGapReport(
  profile: ProfileSnapshot,
  matches: GapMatchInput[],
  readiness: ReadinessReport,
): GapReport {
  const missingProfileFields = computeMissingProfileFields(profile);
  const missingCriteria = computeMissingCriteria(readiness);
  const perOpportunity = (Array.isArray(matches) ? matches : []).map((m) =>
    perOpportunityGap(profile, m),
  );
  const notesAr: string[] = [];

  if (missingProfileFields.length > 0) {
    const top = missingProfileFields.slice(0, 3).map((f) => FIELD_LABEL_AR[f] ?? f).join("، ");
    notesAr.push(`أكمل أبرز الحقول الناقصة في ملف الشركة (${top}) لتحسين دقة الأحكام وتقليل حالات «غير محسوم».`);
  } else {
    notesAr.push("ملف الشركة مكتمل الحقول الأساسية — الأحكام تستند إلى بيانات وافية.");
  }
  if (missingCriteria.length > 0) {
    notesAr.push(`عرضك يحتاج تقوية في: ${missingCriteria.map((c) => criteriaLabelAr(readiness, c)).join("، ")}. استخدم ميزة اقتراح الصياغة لتحسين الشرائح الضعيفة.`);
  }
  const notEligible = perOpportunity.filter((p) => p.judgment === "NOT_ELIGIBLE").length;
  if (notEligible > 0) {
    notesAr.push(`${notEligible} فرصة غير متاحة لك بسبب شروط إلزامية مخالفة — لا تُدرج ضمن خطتك، وراجع أسبابها للتوجه لبدائل مشابهة.`);
  }
  const unresolved = perOpportunity.filter((p) => p.judgment === "UNCERTAIN").length;
  if (unresolved > 0) {
    notesAr.push(`${unresolved} فرصة بحكم «غير محسوم» — سدّ الفجوات المذكورة أو مراسلة الجهات بشأن الصياغات الغامضة قد يحوّلها إلى «مؤهل».`);
  }

  const notesEn: string[] = [];
  if (missingProfileFields.length > 0) {
    const top = missingProfileFields.slice(0, 3).map((f) => FIELD_LABEL_EN[f] ?? f).join(", ");
    notesEn.push(`Complete these key missing company profile fields (${top}) to improve decision accuracy and reduce uncertain outcomes.`);
  } else {
    notesEn.push("The core company profile fields are complete; eligibility decisions can use the available profile data.");
  }
  if (missingCriteria.length > 0) {
    notesEn.push(`Strengthen these pitch areas: ${missingCriteria.map((key) => criteriaLabelEn(readiness, key)).join(", ")}. Use the rewrite suggestions to improve weak slides.`);
  }
  if (notEligible > 0) {
    notesEn.push(`${notEligible} opportunity/opportunities are unavailable because a mandatory requirement is confirmed not to be met. Do not include them in the application plan; consider similar alternatives.`);
  }
  if (unresolved > 0) {
    notesEn.push(`${unresolved} opportunity/opportunities remain uncertain. Fill the listed data gaps or contact the program to clarify ambiguous criteria.`);
  }
  const localizedOpps = perOpportunity.map((item) => ({
    ...item,
    gapsEn: item.gapsAr.map(reasonToEnglish),
    missingDocs: item.missingDocs,
  }));
  return { missingProfileFields, missingCriteria, perOpportunity: localizedOpps, notesAr, notesEn };
}

// ————— الحقول الناقصة —————

function computeMissingProfileFields(profile: ProfileSnapshot): ProfileFieldKey[] {
  const present = new Set<string>();
  if (profile && Array.isArray(profile.fields)) {
    for (const f of profile.fields) {
      if (!f || typeof f !== "object") continue;
      const v = (f as { value?: unknown }).value;
      const isEmpty =
        v === null ||
        v === undefined ||
        (typeof v === "string" && v.trim() === "") ||
        (Array.isArray(v) && v.length === 0);
      if (!isEmpty) present.add((f as { field: string }).field);
    }
  }
  const missing = PROFILE_FIELD_KEYS.filter((k) => !present.has(k));
  return FIELD_PRIORITY.filter((k) => missing.includes(k));
}

// ————— المعايير الناقصة —————

function computeMissingCriteria(readiness: ReadinessReport): string[] {
  if (!readiness || !Array.isArray(readiness.criteria)) return [];
  return readiness.criteria
    .filter((c) => c && (c.level === "missing" || c.level === "weak"))
    .map((c) => c.key);
}

function criteriaLabelAr(readiness: ReadinessReport, key: string): string {
  const c = readiness.criteria.find((x) => x.key === key);
  return c?.labelAr ?? key;
}

function criteriaLabelEn(readiness: ReadinessReport, key: string): string {
  const c = readiness.criteria.find((x) => x.key === key);
  return c?.labelEn ?? ({
    problem: "Problem and need", customer: "Target customer", solution: "Solution and product",
    market: "Market and size", business_model: "Business model and revenue", traction: "Traction and validation",
    team: "Team", competition: "Competition and differentiation", ask_clarity: "Funding ask clarity",
  } as Record<string, string>)[key] ?? key;
}

/** Convert deterministic engine explanations to English without changing the underlying judgment. */
function reasonToEnglish(reason: string): string {
  let m = reason.match(/^شرط إلزامي موثّق غير مستوفى: (.*)؛ قيمة ملفك: (.*)$/);
  if (m) return `A verified mandatory criterion is not met: ${m[1]}; profile value: ${m[2]}.`;
  m = reason.match(/^شرط إلزامي غير مستوفى لكن بلا دليل موثّق \(لا يُؤكد الرفض\): (.*)؛ قيمة ملفك: (.*)$/);
  if (m) return `A mandatory criterion may not be met, but there is no verified evidence to confirm rejection: ${m[1]}; profile value: ${m[2]}.`;
  m = reason.match(/^شرط إلزامي غير مستوفى ودليله أقدم من 180 يومًا \(لا يُؤكد الرفض\): (.*)؛ قيمة ملفك: (.*)$/);
  if (m) return `The evidence for this mandatory criterion is older than 180 days, so rejection is not confirmed: ${m[1]}; profile value: ${m[2]}.`;
  m = reason.match(/^شرط إلزامي غير مستوفى ودليله بلا اقتباس أو رابط \(لا يُؤكد الرفض\): (.*)؛ قيمة ملفك: (.*)$/);
  if (m) return `This mandatory criterion lacks a source link or quote, so rejection is not confirmed: ${m[1]}; profile value: ${m[2]}.`;
  m = reason.match(/^شرط إلزامي مستوفى لكن بلا دليل موثّق من مصدر الفرصة: (.*)$/);
  if (m) return `This mandatory criterion appears satisfied, but no verified evidence from the opportunity source is available: ${m[1]}.`;
  m = reason.match(/^شرط إلزامي مستوفى لكن دليله أقدم من 180 يومًا: (.*)$/);
  if (m) return `This mandatory criterion appears satisfied, but its evidence is older than 180 days: ${m[1]}.`;
  m = reason.match(/^شرط إلزامي مستوفى لكن دليله بلا اقتباس أو رابط: (.*)$/);
  if (m) return `This mandatory criterion appears satisfied, but its evidence has no link or quote: ${m[1]}.`;
  m = reason.match(/^غموض في نص الجهة: «(.*)» — يُنصح مراسلة الجهة للتأكد$/);
  if (m) return `The program's wording is ambiguous: “${m[1]}”. Contact the program to confirm.`;
  m = reason.match(/^نقص في ملف المؤسس: (.*) — الحالي: (.*)(?:؛ .*)?$/);
  if (m) return `Missing or incomplete founder profile data: ${m[1]}; current value: ${m[2]}.`;
  m = reason.match(/^الشرط: (.*) — حالتك: (.*)$/);
  if (m) return `Criterion: ${m[1]}; your profile: ${m[2]}.`;
  if (reason.startsWith("مستندات ناقصة لهذه الفرصة:")) {
    const names = reason.slice("مستندات ناقصة لهذه الفرصة:".length).trim().split("، ").map((x) => DOC_LABEL_EN[x] ?? x).join(", ");
    return `Missing documents for this opportunity: ${names}.`;
  }
  const simple: Record<string, string> = {
    "تحقق من طريقة صرف المبلغ المتاحة لديك": "Check which payment and disbursement methods are available to you.",
    "شرط إلزامي موثّق غير مستوفى": "A verified mandatory requirement is not met.",
    "سبب غير محدد": "Unspecified reason.",
  };
  return simple[reason] ?? reason;
}

// ————— فجوات كل فرصة —————

function perOpportunityGap(profile: ProfileSnapshot, m: GapMatchInput): GapReport["perOpportunity"][number] {
  const result = m.result;
  const gapsAr: string[] = [];

  for (const reason of result.blockingReasons ?? []) gapsAr.push(reason);
  for (const reason of result.uncertainReasons ?? []) gapsAr.push(reason);

  // شروط غير محسومة/غير مستوفاة (غير الإلزامية المفسّرة أعلاه)
  for (const c of result.conditions ?? []) {
    if (c.status === "SATISFIED") continue;
    const expected = c.expected || c.field;
    const actual = c.status === "UNRESOLVED" ? "غير مذكور في ملفك" : c.actual;
    const gap = `الشرط: ${expected} — حالتك: ${actual}`;
    if (!gapsAr.some((g) => g.includes(expected))) {
      gapsAr.push(c.status === "UNRESOLVED" ? `${gap} (سببه: ${unresolvedReasonAr(c.unresolvedReason)})` : gap);
    }
  }

  const missingDocs = missingDocsFor(profile, m.opp.requiresDocs);
  if (missingDocs.length > 0) {
    gapsAr.push(`مستندات ناقصة لهذه الفرصة: ${missingDocs.join("، ")}`);
  }

  return {
    opportunityId: m.opp.id,
    title: m.opp.title,
    judgment: result.judgment,
    gapsAr: dedupe(gapsAr).slice(0, 12),
    gapsEn: dedupe(gapsAr.map(reasonToEnglish)).slice(0, 12),
    missingDocs,
  };
}

function unresolvedReasonAr(reason?: string): string {
  switch (reason) {
    case "MISSING_PROFILE_DATA": return "نقص في بيانات ملفك";
    case "AMBIGUOUS_WORDING": return "غموض في نص الجهة";
    case "NO_EVIDENCE": return "الشرط بلا دليل موثّق";
    case "STALE_EVIDENCE": return "دليل قديم";
    case "WEAK_EVIDENCE": return "دليل ضعيف";
    default: return "غير محسوم";
  }
}

function missingDocsFor(profile: ProfileSnapshot, requiresDocs?: string[]): string[] {
  if (!Array.isArray(requiresDocs) || requiresDocs.length === 0) return [];
  const available = new Set<string>();
  if (profile && Array.isArray(profile.documents)) {
    for (const d of profile.documents) {
      if (d && d.status === "available" && typeof d.docType === "string") available.add(d.docType);
    }
  }
  return requiresDocs.filter((t) => !available.has(t));
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter((s) => {
    if (!s || seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}
