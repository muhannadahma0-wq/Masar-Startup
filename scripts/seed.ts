/**
 * Masar — سكربت البذر (T19) — بيانات تجريبية Demo-grade
 * تشغيل محلي فقط: ALLOW_DEMO_SEED=true npm run seed:demo
 * قابل لإعادة التشغيل (idempotent): يحذف ثم ينشئ.
 * ملاحظة نزاهة: أسماء الجهات والبرامج والروابط تخيّلية بالكامل لأغراض العرض،
 * والأدلة صالحة داخليًا (اقتباس/رابط وهمي موحّد النطاق demo.masar.example).
 */
import { createHash } from "crypto";
import { prisma } from "@/lib/server/api";
import { hashPassword } from "@/lib/server/password";
import { evaluateReadiness } from "@/lib/pitch/criteria";
import { extractClaims, detectContradictions } from "@/lib/pitch/claims";
import { buildGapReport } from "@/lib/pitch/gap";
import { evaluateEligibility } from "@/lib/core/engine";
import { computeReliability } from "@/lib/core/scoring";
import type {
  ProfileSnapshot, RuleCondition, Slide, ExtractedField, ProfileFieldKey,
} from "@/lib/core/types";

const DAY = 86400000;
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);

interface EvSpec { url: string; quote: string; daysAgo?: number }
interface CondSpec {
  field: ProfileFieldKey; op: string; value: unknown;
  mandatory?: boolean; ambiguous?: boolean; scope?: "any" | "all";
  sourceWording?: string; evidence?: EvSpec | null;
}
interface OppSpec {
  title: string; orgName: string; description: string;
  type: string; fundingType?: string;
  amountMin?: number; amountMax?: number; currency?: string;
  sectors: string[]; stageMin?: string; stageMax?: string;
  geography: "local" | "regional" | "international"; geoPriority?: boolean;
  languages?: string[];
  url: string; sourceType?: string; deadlineDays: number;
  requiresDocs?: string[];
  conditions: CondSpec[];
  status?: string; // PUBLISHED افتراضيًا
  rejectReason?: string;
}

const DEMO_URL = (slug: string) => `https://demo.masar.example/programs/${slug}`;

function ev(url: string, quote: string, ago = 12): EvSpec {
  return { url, quote, daysAgo: ago };
}

// ————— قوالب شروط —————
const WB_GAZA_JRS = ["west_bank", "gaza", "east_jerusalem"];
const PALESTINE_REGIONS = ["west_bank", "gaza", "east_jerusalem", "inside_48"];

const regionIn = (regions: string[], w: string, e?: EvSpec): CondSpec => ({
  field: "founder.region", op: "in", value: regions, mandatory: true,
  sourceWording: w, evidence: e,
});
const sectorIn = (sectors: string[], e: EvSpec): CondSpec => ({
  field: "company.sectors", op: "in", value: sectors, mandatory: true,
  sourceWording: "Eligible sectors listed in program guidelines", evidence: e,
});
const regCountry = (countries: string[], w: string, e: EvSpec): CondSpec => ({
  field: "company.registrationCountry", op: "in", value: countries, mandatory: true,
  sourceWording: w, evidence: e,
});
const legalNeqUnregistered = (e: EvSpec): CondSpec => ({
  field: "company.legalStatus", op: "neq", value: "not_registered", mandatory: true,
  sourceWording: "Registered legal entity required", evidence: e,
});
const stageBetween = (min: string, max: string, e: EvSpec): CondSpec => ({
  field: "company.stage", op: "between", value: [min, max], mandatory: true,
  sourceWording: "Program targets specific venture stages", evidence: e,
});
const teamGte = (n: number, e: EvSpec): CondSpec => ({
  field: "company.teamSize", op: "gte", value: n, mandatory: true,
  sourceWording: "Minimum team size at time of application", evidence: e,
});
const langIn = (langs: string[], e: EvSpec): CondSpec => ({
  field: "company.languages", op: "in", value: langs, mandatory: false,
  sourceWording: "Application languages accepted", evidence: e,
});

// ————— الفرص (52 منشورة + 2 مسودات) —————
const OPPS: OppSpec[] = [
  // ============ محلية (21) ============
  {
    title: "حاضنة انطلاقة — الدفعة السابعة", orgName: "حاضنة انطلاقة التقنية",
    description: "برنامج احتضان مكثف لثلاثة أشهر في رام الله يشمل الإرشاد ومساحة عمل وتمويلًا أوليًا للشركات التقنية الناشئة الفلسطينية.",
    type: "incubator", fundingType: "convertible", amountMin: 10000, amountMax: 30000,
    sectors: ["software", "ai", "iot", "agritech", "fintech"], stageMin: "idea", stageMax: "prototype",
    geography: "local", languages: ["ar", "en"], url: DEMO_URL("intilaqa-7"), deadlineDays: 40,
    requiresDocs: ["pitch_deck", "founder_id"],
    conditions: [
      regionIn(WB_GAZA_JRS, "Open to founders based in the West Bank, Gaza, and East Jerusalem", ev(DEMO_URL("intilaqa-7"), "Open to founders based in the West Bank, Gaza, and East Jerusalem")),
      legalNeqUnregistered(ev(DEMO_URL("intilaqa-7"), "Applicants must hold a registered legal entity or commit to registering before contracting")),
    ],
  },
  {
    title: "صندوق بذرة الوطني — منح أولية", orgName: "صندوق بذرة الوطني",
    description: "منح غير ملكية تصل إلى 50 ألف دولار للشركات الناشئة في مراحل مبكرة، مع متابعة فنية لمدة عام.",
    type: "grant", fundingType: "non_equity", amountMin: 15000, amountMax: 50000,
    sectors: ["agritech", "food", "water", "energy", "cleantech"], stageMin: "idea", stageMax: "early_revenue",
    geography: "local", geoPriority: true, languages: ["ar"], url: DEMO_URL("badr-seed"), deadlineDays: 25,
    requiresDocs: ["pitch_deck", "business_plan"],
    conditions: [
      regionIn(PALESTINE_REGIONS, "يستهدف البرنامج الشركات داخل فلسطين التاريخية والضفة وغزة", ev(DEMO_URL("badr-seed"), "يستهدف البرنامج الشركات داخل فلسطين التاريخية والضفة وغزة")),
      regCountry(["ps"], "Registered in Palestine", ev(DEMO_URL("badr-seed"), "The startup must be registered with the Palestinian Companies Registrar")),
    ],
  },
  {
    title: "مسرعة أوغاريت — نمو المبيعات", orgName: "مسرعة أوغاريت للأعمال",
    description: "برنامج تسريع 12 أسبوعًا يركز على النمو التجاري وصولًا للعملاء الأوائل، مع استثمار أولي 75 ألف دولار.",
    type: "accelerator", fundingType: "equity", amountMin: 50000, amountMax: 75000,
    sectors: ["ecommerce", "logistics", "software", "agritech"], stageMin: "prototype", stageMax: "early_revenue",
    geography: "local", languages: ["ar", "en"], url: DEMO_URL("ugarit-growth"), deadlineDays: 60,
    requiresDocs: ["pitch_deck", "financial_statements"],
    conditions: [
      regionIn(WB_GAZA_JRS, "فلسطين: الضفة الغربية وقطاع غزة والقدس", ev(DEMO_URL("ugarit-growth"), "فلسطين: الضفة الغربية وقطاع غزة والقدس")),
      stageBetween("prototype", "early_revenue", ev(DEMO_URL("ugarit-growth"), "We work with teams at prototype to early revenue stage")),
      teamGte(3, ev(DEMO_URL("ugarit-growth"), "Teams of at least three full-time members")),
    ],
  },
  {
    title: "تحدي يابوس للأثر الاجتماعي", orgName: "مؤسسة يابوس للمجتمع",
    description: "مسابقة سنوية لأفضل مشروع اجتماعي مؤثر في فلسطين؛ جائزة الأولى 25 ألف دولار.",
    type: "competition", fundingType: "non_equity", amountMin: 5000, amountMax: 25000,
    sectors: ["social", "edtech", "healthtech", "agritech"], stageMin: "idea", stageMax: "early_revenue",
    geography: "local", languages: ["ar"], url: DEMO_URL("yabus-challenge"), deadlineDays: 15,
    requiresDocs: ["pitch_deck"],
    conditions: [
      regionIn(WB_GAZA_JRS, "Open to all Palestinian residents of the West Bank and Gaza", ev(DEMO_URL("yabus-challenge"), "Open to all Palestinian residents of the West Bank and Gaza")),
      { field: "company.womenLed", op: "eq", value: true, mandatory: false, sourceWording: "Bonus consideration for women-led ventures", evidence: ev(DEMO_URL("yabus-challenge"), "Bonus consideration for women-led ventures") },
    ],
  },
  {
    title: "منح التعاون التقني — قطاع الزراعة", orgName: "برنامج التعاون التقني الفلسطيني",
    description: "منح تكنولوجيا الزراعة لمزارعي الضفة وغزة؛ تركيز على حلول الري والإنترنت of Things.",
    type: "grant", fundingType: "non_equity", amountMin: 8000, amountMax: 20000,
    sectors: ["agritech", "iot", "water"], stageMin: "idea", stageMax: "early_revenue",
    geography: "local", languages: ["ar"], url: DEMO_URL("agri-tech-grants"), deadlineDays: 35,
    requiresDocs: ["pitch_deck", "letters_of_support"],
    conditions: [
      regionIn(WB_GAZA_JRS, "West Bank and Gaza based agri-ventures", ev(DEMO_URL("agri-tech-grants"), "West Bank and Gaza based agri-ventures")),
      sectorIn(["agritech", "iot", "water"], ev(DEMO_URL("agri-tech-grants"), "Agriculture technology, IoT, and water management ventures are eligible")),
    ],
  },
  {
    title: "برنامج سند — قروض ميسّرة", orgName: "شركة سند للتمويل الأصغر",
    description: "قروض ميسّرة بفائدة رمزية للمنشآت الصغيرة المسجلة في فلسطين، سداد حتى 36 شهرًا.",
    type: "loan", fundingType: "non_equity", amountMin: 5000, amountMax: 60000,
    sectors: ["manufacturing", "food", "ecommerce", "tourism", "agritech"], stageMin: "prototype", stageMax: "scaling",
    geography: "local", languages: ["ar"], url: DEMO_URL("sanad-loans"), deadlineDays: 120,
    requiresDocs: ["registration_cert", "bank_letter", "business_plan"],
    conditions: [
      regCountry(["ps"], "القروض للمنشآت المسجلة لدى سجل الشركات الفلسطيني", ev(DEMO_URL("sanad-loans"), "القروض للمنشآت المسجلة لدى سجل الشركات الفلسطيني")),
      { field: "company.ageMonths", op: "gte", value: 12, mandatory: true, sourceWording: "Minimum one year of operations", evidence: ev(DEMO_URL("sanad-loans"), "Minimum one year of operations required") },
    ],
  },
  {
    title: "زمالة بيرزيت للابتكار", orgName: "جامعة بيرزيت — مركز الابتكار",
    description: "زمالة بحثية-تطبيقية لطلبة الخريجين والشركات الناشئة الجامعية، بتمويل 12 ألف دولار.",
    type: "fellowship", fundingType: "non_equity", amountMin: 6000, amountMax: 12000,
    sectors: ["software", "ai", "healthtech", "agritech"], stageMin: "idea", stageMax: "prototype",
    geography: "local", languages: ["ar", "en"], url: DEMO_URL("bzu-fellowship"), deadlineDays: 50,
    conditions: [
      regionIn(WB_GAZA_JRS, "Palestinian founders in the West Bank and Gaza", ev(DEMO_URL("bzu-fellowship"), "Palestinian founders in the West Bank and Gaza")),
      { field: "company.teamSize", op: "gte", value: 2, mandatory: true, sourceWording: "At least two co-founders", evidence: ev(DEMO_URL("bzu-fellowship"), "At least two co-founders") },
    ],
  },
  {
    title: "حاضنة غزة الرقمية — عن بعد", orgName: "حاضنة غزة الرقمية",
    description: "برنامج عن بعد بالكامل لفرق غزة مع منح صغيرة وإرشاد دولي.",
    type: "incubator", fundingType: "non_equity", amountMin: 5000, amountMax: 15000,
    sectors: ["software", "ecommerce", "media"], stageMin: "idea", stageMax: "early_revenue",
    geography: "local", languages: ["ar", "en"], url: DEMO_URL("gaza-digital"), deadlineDays: 30,
    conditions: [
      // فخ 7: البرنامج يستهدف غزة حصرًا — مؤسستنا في الضفة → NOT_ELIGIBLE
      regionIn(["gaza"], "Gaza-based startups only", ev(DEMO_URL("gaza-digital"), "This program is exclusively for Gaza-based startups; West Bank teams should apply to our Ram Allah track")),
    ],
  },
  {
    title: "صندوق القدس للمشاريع الصغيرة", orgName: "صندوق القدس التنموي",
    description: "تمويل صغير لأصحاب المشاريع في القدس ومحيطها.",
    type: "grant", fundingType: "non_equity", amountMin: 3000, amountMax: 12000,
    sectors: ["tourism", "food", "ecommerce", "social"], stageMin: "idea", stageMax: "prototype",
    geography: "local", languages: ["ar"], url: DEMO_URL("quds-fund"), deadlineDays: 20,
    conditions: [
      regionIn(["east_jerusalem", "west_bank"], "مشاريع القدس والضفة المجاورة", ev(DEMO_URL("quds-fund"), "مشاريع القدس والضفة المجاورة")),
    ],
  },
  {
    title: "مبادرة رواد الصحّة الرقمية", orgName: "مجموعة رواد الصحة",
    description: "دعم مالي وفني لحلول الصحة الرقمية؛ قطاع الصحة فقط.",
    type: "grant", fundingType: "non_equity", amountMin: 10000, amountMax: 40000,
    sectors: ["healthtech"], stageMin: "prototype", stageMax: "early_revenue",
    geography: "local", languages: ["ar", "en"], url: DEMO_URL("digital-health"), deadlineDays: 45,
    conditions: [
      regionIn(WB_GAZA_JRS, "West Bank and Gaza", ev(DEMO_URL("digital-health"), "West Bank and Gaza based teams")),
      sectorIn(["healthtech"], ev(DEMO_URL("digital-health"), "Digital health ventures only")),
    ],
  },
  {
    title: "برنامج تمكين النساء المؤسسات", orgName: "جمعية تمكين",
    description: "منح ومرافقة أعمال للشركات التي تقودها نساء بنسبة 51% فأكثر.",
    type: "grant", fundingType: "non_equity", amountMin: 7000, amountMax: 20000,
    sectors: ["social", "food", "ecommerce", "edtech", "agritech"], stageMin: "idea", stageMax: "early_revenue",
    geography: "local", languages: ["ar"], url: DEMO_URL("women-led"), deadlineDays: 28,
    requiresDocs: ["founder_id", "registration_cert"],
    conditions: [
      regionIn(WB_GAZA_JRS, "نساء الضفة وغزة", ev(DEMO_URL("women-led"), "نساء الضفة وغرة")),
      { field: "company.womenLed", op: "eq", value: true, mandatory: true, sourceWording: "Majority women-owned (51%+)", evidence: ev(DEMO_URL("women-led"), "Majority women-owned (51%+) ventures") },
    ],
  },
  {
    title: "تحدي التقنية المفتوحة FLOSS", orgName: "مجتمع البرمجيات الحرة فلسطين",
    description: "منح صغيرة للمشاريع مفتوحة المصدر ذات الأثر المجتمعي.",
    type: "competition", fundingType: "non_equity", amountMin: 2000, amountMax: 8000,
    sectors: ["software", "ai", "edtech"], stageMin: "idea", stageMax: "prototype",
    geography: "local", languages: ["ar", "en"], url: DEMO_URL("floss"), deadlineDays: 18,
    conditions: [
      regionIn(PALESTINE_REGIONS, "All Palestinians including 1948 areas", ev(DEMO_URL("floss"), "All Palestinians including 1948 areas")),
    ],
  },
  {
    title: "برنامج المدن الذكية — بيت لحم", orgName: "هيئة المدن الذكية",
    description: "دعم حلول المدن الذكية ضمن منطقة بيت لحم-الضفة.",
    type: "grant", fundingType: "non_equity", amountMin: 10000, amountMax: 35000,
    sectors: ["iot", "cleantech", "energy"], stageMin: "prototype", stageMax: "early_revenue",
    geography: "local", languages: ["ar", "en"], url: DEMO_URL("smart-cities"), deadlineDays: 55,
    conditions: [
      regionIn(WB_GAZA_JRS, "West Bank municipalities service area", ev(DEMO_URL("smart-cities"), "West Bank municipalities service area")),
      { field: "company.legalStatus", op: "neq", value: "not_registered", mandatory: true, sourceWording: "Legal entity required", evidence: ev(DEMO_URL("smart-cities"), "Legal entity required at application") },
    ],
  },
  {
    title: "منحة الطاقة المتجددة للمنشآت", orgName: "صندوق الطاقة الفلسطيني",
    description: "تمويل جزئي لتقنيات الطاقة النظيفة في المنشآت الزراعية والصناعية.",
    type: "grant", fundingType: "non_equity", amountMin: 12000, amountMax: 45000,
    sectors: ["energy", "cleantech", "agritech"], stageMin: "prototype", stageMax: "scaling",
    geography: "local", languages: ["ar"], url: DEMO_URL("renewable-energy"), deadlineDays: 75,
    requiresDocs: ["registration_cert", "financial_statements"],
    conditions: [
      regCountry(["ps"], "المنشآت المسجلة في فلسطين فقط", ev(DEMO_URL("renewable-energy"), "المنشآت المسجلة في فلسطين فقط")),
      sectorIn(["energy", "cleantech", "agritech"], ev(DEMO_URL("renewable-energy"), "Energy, cleantech, and agri-tech ventures")),
    ],
  },
  {
    title: "مسابقة الشركات الطلابية", orgName: "اتحاد الطلبة التقني",
    description: "مسابقة سنوية لأفضل شركة طلابية ناشئة؛ جوائز نقدية وضمان مشاريع.",
    type: "competition", fundingType: "non_equity", amountMin: 1500, amountMax: 6000,
    sectors: ["software", "edtech", "media", "social"], stageMin: "idea", stageMax: "prototype",
    geography: "local", languages: ["ar"], url: DEMO_URL("student-startups"), deadlineDays: 12,
    conditions: [
      regionIn(WB_GAZA_JRS, "طلبة الجامعات الفلسطينية", ev(DEMO_URL("student-startups"), "طلبة الجامعات الفلسطينية في الضفة وغزة")),
      { field: "company.ageMonths", op: "lte", value: 18, mandatory: true, sourceWording: "Ventures younger than 18 months", evidence: ev(DEMO_URL("student-startups"), "Ventures younger than 18 months") },
    ],
  },
  {
    title: "برنامج الاستثمار المبكر رِواق", orgName: "شركة رِواق للاستثمار الجريء",
    description: "استثمار أولي 100-250 ألف دولار مقابل حصة، للشركات ذات جرّب مبكر.",
    type: "accelerator", fundingType: "equity", amountMin: 100000, amountMax: 250000,
    sectors: ["software", "fintech", "ai", "agritech", "logistics"], stageMin: "prototype", stageMax: "early_revenue",
    geography: "local", languages: ["ar", "en"], url: DEMO_URL("riwaq-early"), deadlineDays: 90,
    requiresDocs: ["pitch_deck", "financial_statements", "business_plan"],
    conditions: [
      regionIn(WB_GAZA_JRS, "Palestinian territories", ev(DEMO_URL("riwaq-early"), "Palestinian territories: West Bank, Gaza, and East Jerusalem")),
      { field: "company.monthlyRevenueUSD", op: "gte", value: 3000, mandatory: true, sourceWording: "Evidence of early revenue required", evidence: ev(DEMO_URL("riwaq-early"), "Evidence of monthly recurring revenue of at least $3,000") },
      teamGte(4, ev(DEMO_URL("riwaq-early"), "Team of four or more")),
    ],
  },
  {
    title: "منحة الشتات الفلسطيني — إطلاق", orgName: "شبكة الشتات لريادة الأعمال",
    description: "دعم مؤسسي الشتات الفلسطيني للعودة أو البناء عن بعد.",
    type: "grant", fundingType: "non_equity", amountMin: 10000, amountMax: 30000,
    sectors: ["software", "ecommerce", "agritech", "tourism"], stageMin: "idea", stageMax: "early_revenue",
    geography: "local", languages: ["ar", "en"], url: DEMO_URL("diaspora-launch"), deadlineDays: 65,
    conditions: [
      regionIn(["diaspora", "west_bank", "gaza"], "Palestinians in diaspora and homeland", ev(DEMO_URL("diaspora-launch"), "Palestinians in diaspora and homeland are welcome")),
      // فخ 8: يمر — مؤسسنا الأساسي في الضفة (scope any)
      { field: "founder.region", op: "not_in", value: ["diaspora"], mandatory: false, scope: "all", sourceWording: "On-site presence preferred", evidence: ev(DEMO_URL("diaspora-launch"), "On-site presence in Palestine preferred but not required") },
    ],
  },
  {
    title: "برنامج السياحة المستدامة", orgName: "مبادرة السياحة المستدامة",
    description: "منح لمنشآت السياحة والضيافة المستدامة في الضفة.",
    type: "grant", fundingType: "non_equity", amountMin: 5000, amountMax: 18000,
    sectors: ["tourism"], stageMin: "idea", stageMax: "early_revenue",
    geography: "local", languages: ["ar", "en"], url: DEMO_URL("sustainable-tourism"), deadlineDays: 42,
    conditions: [
      regionIn(WB_GAZA_JRS, "West Bank and Gaza tourism ventures", ev(DEMO_URL("sustainable-tourism"), "West Bank and Gaza tourism ventures")),
      sectorIn(["tourism"], ev(DEMO_URL("sustainable-tourism"), "Tourism and hospitality only")),
    ],
  },
  {
    title: "حاضنة صناعة الأغذية", orgName: "معهد الأغذية الفلسطيني",
    description: "دعم تصنيع الأغذية والزراعة: تجهيز مصانع صغيرة وترخيص.",
    type: "incubator", fundingType: "non_equity", amountMin: 8000, amountMax: 25000,
    sectors: ["food", "agritech", "manufacturing"], stageMin: "idea", stageMax: "early_revenue",
    geography: "local", languages: ["ar"], url: DEMO_URL("food-inc"), deadlineDays: 33,
    requiresDocs: ["registration_cert", "business_plan"],
    conditions: [
      regCountry(["ps"], "Palestinian food businesses", ev(DEMO_URL("food-inc"), "Palestinian food businesses with valid registration")),
      { field: "company.legalStatus", op: "neq", value: "not_registered", mandatory: true, sourceWording: "Registered entity required", evidence: ev(DEMO_URL("food-inc"), "Registered entity required before funding") },
    ],
  },
  {
    title: "منحة المياه الذكية", orgName: "هيئة المياه التعاونية",
    description: "حلول ترشيد المياه والري الذكي؛ أولوية للشركات النسائية.",
    type: "grant", fundingType: "non_equity", amountMin: 6000, amountMax: 22000,
    sectors: ["water", "agritech", "iot"], stageMin: "idea", stageMax: "early_revenue",
    geography: "local", geoPriority: true, languages: ["ar", "en"], url: DEMO_URL("smart-water"), deadlineDays: 22,
    conditions: [
      regionIn(WB_GAZA_JRS, "West Bank, Gaza and East Jerusalem", ev(DEMO_URL("smart-water"), "West Bank, Gaza and East Jerusalem")),
      sectorIn(["water", "agritech", "iot"], ev(DEMO_URL("smart-water"), "Water management, smart irrigation, and IoT solutions")),
    ],
  },
  {
    title: "برنامج التجارة الإلكترونية الريفية", orgName: "منصة سوق الريف",
    description: "تمويل صغير لربط المنتجات الريفية بالتجارة الإلكترونية.",
    type: "grant", fundingType: "non_equity", amountMin: 3000, amountMax: 10000,
    sectors: ["ecommerce", "food", "agritech"], stageMin: "idea", stageMax: "prototype",
    geography: "local", languages: ["ar"], url: DEMO_URL("rural-ecom"), deadlineDays: 16,
    conditions: [
      regionIn(WB_GAZA_JRS, "مناطق الضفة وغزة الريفية", ev(DEMO_URL("rural-ecom"), "مناطق الضفة وغزة الريفية أولوية")),
      { field: "company.teamSize", op: "gte", value: 2, mandatory: true, sourceWording: "Two founders minimum", evidence: ev(DEMO_URL("rural-ecom"), "Two founders minimum") },
    ],
  },
  // فخ محلي 9: دليل قديم → UNCERTAIN (موثوقية منخفضة)
  {
    title: "منحة التكنولوجيا المجتمعية (نسخة قديمة)", orgName: "مؤسسة التكنولوجيا المجتمعية",
    description: "منح تقنية للمبادرات المجتمعية — الصفحة لم تُحدّث منذ أشهر.",
    type: "grant", fundingType: "non_equity", amountMin: 4000, amountMax: 15000,
    sectors: ["software", "social", "edtech"], stageMin: "idea", stageMax: "prototype",
    geography: "local", languages: ["ar"], url: DEMO_URL("community-tech"), deadlineDays: 55, sourceType: "trusted_aggregator",
    conditions: [
      {
        field: "founder.region", op: "in", value: WB_GAZA_JRS, mandatory: true,
        sourceWording: "Palestinian community initiatives",
        evidence: ev(DEMO_URL("community-tech"), "Palestinian community initiatives across the territories", 240), // قديم → دليل stale
      },
    ],
  },

  // ============ إقليمية (15) ============
  {
    title: "Accelerate MENA Futures — Cohort 12", orgName: "MENA Futures Foundation",
    description: "Regional accelerator for MENA startups with $120K investment and global mentor network.",
    type: "accelerator", fundingType: "equity", amountMin: 80000, amountMax: 120000,
    sectors: ["software", "ai", "fintech", "agritech", "healthtech"], stageMin: "prototype", stageMax: "scaling",
    geography: "regional", languages: ["en"], url: DEMO_URL("mena-futures"), deadlineDays: 38,
    requiresDocs: ["pitch_deck", "financial_statements"],
    conditions: [
      regionIn(["eg", "jo", "ae", "sa", "ps"], "MENA countries including Palestine", ev(DEMO_URL("mena-futures"), "Applicants from MENA countries including Palestine (West Bank and Gaza) are eligible")),
      { field: "company.teamSize", op: "gte", value: 3, mandatory: true, sourceWording: "Teams of 3+ members", evidence: ev(DEMO_URL("mena-futures"), "Teams of three or more full-time members") },
      langIn(["en"], ev(DEMO_URL("mena-futures"), "Program delivered in English")),
    ],
  },
  {
    title: "SeedBridge Regional — AgriTrack", orgName: "SeedBridge Ventures",
    description: "Regional seed fund for agriculture technology across the Levant and Gulf.",
    type: "grant", fundingType: "non_equity", amountMin: 30000, amountMax: 90000,
    sectors: ["agritech", "water", "food"], stageMin: "prototype", stageMax: "early_revenue",
    geography: "regional", geoPriority: true, languages: ["en"], url: DEMO_URL("seedbridge-agri"), deadlineDays: 48,
    conditions: [
      regCountry(["ps", "jo", "eg"], "Levant registered entities including Palestine", ev(DEMO_URL("seedbridge-agri"), "Levant registered entities including Palestine are eligible")),
      sectorIn(["agritech", "water", "food"], ev(DEMO_URL("seedbridge-agri"), "Agri-tech, water, and food ventures only")),
    ],
  },
  {
    title: "Arab Innovators Prize 2027", orgName: "Arab Innovators Council",
    description: "Pan-Arab competition with $60K grand prize and corporate pilot opportunities.",
    type: "competition", fundingType: "non_equity", amountMin: 10000, amountMax: 60000,
    sectors: ["software", "ai", "cleantech", "agritech", "healthtech", "edtech"], stageMin: "idea", stageMax: "early_revenue",
    geography: "regional", languages: ["ar", "en"], url: DEMO_URL("arab-innovators"), deadlineDays: 26,
    conditions: [
      regionIn(["ps", "jo", "eg", "sa", "ae", "qa", "kw", "other"], "All Arab countries", ev(DEMO_URL("arab-innovators"), "Founders from all Arab countries, including Palestine, may apply")),
    ],
  },
  {
    title: "Gulf Impact Fund — MENA Outreach", orgName: "Gulf Impact Fund",
    description: "Impact investments for MENA social and environmental ventures.",
    type: "grant", fundingType: "non_equity", amountMin: 25000, amountMax: 100000,
    sectors: ["social", "cleantech", "energy", "water"], stageMin: "prototype", stageMax: "scaling",
    geography: "regional", languages: ["en"], url: DEMO_URL("gulf-impact"), deadlineDays: 70,
    conditions: [
      // فخ 1: MENA دون فلسطين — قائمة صريحة
      regionIn(["eg", "jo", "ae"], "MENA region", ev(DEMO_URL("gulf-impact"), "The fund accepts applications from the MENA region: Egypt, Jordan, and the GCC states")),
    ],
  },
  {
    title: "Levant Fintech Lab", orgName: "Levant Financial Innovation",
    description: "Regional fintech sandbox with regulatory support and seed grants.",
    type: "incubator", fundingType: "non_equity", amountMin: 20000, amountMax: 60000,
    sectors: ["fintech"], stageMin: "prototype", stageMax: "early_revenue",
    geography: "regional", languages: ["en"], url: DEMO_URL("levant-fintech"), deadlineDays: 44,
    conditions: [
      regionIn(["ps", "jo", "eg"], "Levant region including Palestine", ev(DEMO_URL("levant-fintech"), "Levant region: Jordan, Egypt, and Palestine")),
      sectorIn(["fintech"], ev(DEMO_URL("levant-fintech"), "Financial technology ventures only")),
    ],
  },
  {
    title: "MENA Women in Tech Fellowship", orgName: "MENA WiT Alliance",
    description: "Fellowship and grant program for women-led technology ventures across MENA.",
    type: "fellowship", fundingType: "non_equity", amountMin: 10000, amountMax: 35000,
    sectors: ["software", "ai", "healthtech", "agritech", "edtech"], stageMin: "idea", stageMax: "early_revenue",
    geography: "regional", languages: ["en", "ar"], url: DEMO_URL("mena-wit"), deadlineDays: 32,
    conditions: [
      regionIn(["ps", "eg", "jo", "sa", "ae", "other"], "MENA women founders including Palestine", ev(DEMO_URL("mena-wit"), "Women founders across MENA, explicitly including Palestinian founders")),
      { field: "company.womenLed", op: "eq", value: true, mandatory: true, sourceWording: "Women-led (majority female founding team)", evidence: ev(DEMO_URL("mena-wit"), "Ventures with a majority-female founding team") },
    ],
  },
  {
    title: "Crescent Moon Accelerator", orgName: "Crescent Ventures",
    description: "Sharia-compliant accelerator for MENA startups; up to $150K funding.",
    type: "accelerator", fundingType: "mixed", amountMin: 50000, amountMax: 150000,
    sectors: ["food", "ecommerce", "logistics", "manufacturing"], stageMin: "early_revenue", stageMax: "scaling",
    geography: "regional", languages: ["ar", "en"], url: DEMO_URL("crescent-moon"), deadlineDays: 58,
    requiresDocs: ["registration_cert", "financial_statements"],
    conditions: [
      regCountry(["ps", "jo", "eg", "sa"], "Registered MENA entities", ev(DEMO_URL("crescent-moon"), "Registered MENA entities; Palestinian registration accepted")),
      stageBetween("early_revenue", "scaling", ev(DEMO_URL("crescent-moon"), "Post-revenue ventures only at this time")),
    ],
  },
  {
    title: "Sahara Cleantech Challenge", orgName: "Sahara Climate Initiative",
    description: "Regional challenge for water and clean energy innovation in arid climates.",
    type: "competition", fundingType: "non_equity", amountMin: 15000, amountMax: 70000,
    sectors: ["water", "cleantech", "energy"], stageMin: "prototype", stageMax: "early_revenue",
    geography: "regional", languages: ["en"], url: DEMO_URL("sahara-cleantech"), deadlineDays: 36,
    conditions: [
      regionIn(["ps", "eg", "jo", "sa", "other"], "MENA and arid-region countries including Palestine", ev(DEMO_URL("sahara-cleantech"), "MENA and arid-region countries, including Palestine, are eligible")),
      sectorIn(["water", "cleantech", "energy"], ev(DEMO_URL("sahara-cleantech"), "Water, clean energy, and climate ventures")),
    ],
  },
  {
    title: "MedHealth MENA Grant", orgName: "MedHealth Regional Network",
    description: "Grants for digital health pilots in MENA health systems.",
    type: "grant", fundingType: "non_equity", amountMin: 20000, amountMax: 80000,
    sectors: ["healthtech"], stageMin: "prototype", stageMax: "early_revenue",
    geography: "regional", languages: ["en"], url: DEMO_URL("medhealth-mena"), deadlineDays: 52,
    conditions: [
      regionIn(["eg", "jo", "sa", "ae"], "Partner countries list", ev(DEMO_URL("medhealth-mena"), "Open to ventures from our partner countries: Egypt, Jordan, Saudi Arabia, and the UAE")),
      sectorIn(["healthtech"], ev(DEMO_URL("medhealth-mena"), "Digital health ventures")),
    ],
  },
  {
    title: "Amman TechBridge — Regional", orgName: "TechBridge Amman",
    description: "Regional soft-landing program with grants for expansion to Jordan.",
    type: "grant", fundingType: "non_equity", amountMin: 10000, amountMax: 40000,
    sectors: ["software", "ecommerce", "logistics"], stageMin: "early_revenue", stageMax: "scaling",
    geography: "regional", languages: ["en", "ar"], url: DEMO_URL("amman-techbridge"), deadlineDays: 62,
    requiresDocs: ["registration_cert"],
    conditions: [
      // فخ 4: شرط كيان مسجل خارج فلسطين
      {
        field: "company.legalStatus", op: "eq", value: "registered_foreign", mandatory: true,
        sourceWording: "Companies must be registered outside Palestine for contracting purposes",
        evidence: ev(DEMO_URL("amman-techbridge"), "Companies must be registered outside Palestine (e.g., Jordan or UAE) for contracting and payment purposes"),
      },
    ],
  },
  {
    title: "Nile EdTech Fund", orgName: "Nile Education Fund",
    description: "Regional fund for education technology across the Arab world.",
    type: "grant", fundingType: "non_equity", amountMin: 12000, amountMax: 50000,
    sectors: ["edtech"], stageMin: "idea", stageMax: "early_revenue",
    geography: "regional", languages: ["ar", "en"], url: DEMO_URL("nile-edtech"), deadlineDays: 47,
    conditions: [
      regionIn(["ps", "eg", "jo", "sa", "other"], "Arab countries", ev(DEMO_URL("nile-edtech"), "Educators and founders from Arab countries including Palestine")),
      sectorIn(["edtech"], ev(DEMO_URL("nile-edtech"), "Education technology only")),
    ],
  },
  {
    title: "Red Sea Tourism Innovation", orgName: "Red Sea Development Co",
    description: "Innovation grants for tourism tech in the Red Sea economic zone.",
    type: "grant", fundingType: "non_equity", amountMin: 8000, amountMax: 30000,
    sectors: ["tourism", "software"], stageMin: "prototype", stageMax: "early_revenue",
    geography: "regional", languages: ["en"], url: DEMO_URL("red-sea-tourism"), deadlineDays: 41,
    conditions: [
      regionIn(["sa", "eg", "jo"], "Red Sea zone countries", ev(DEMO_URL("red-sea-tourism"), "Applicants must operate in Red Sea zone countries: Saudi Arabia, Egypt, Jordan")),
    ],
  },
  {
    title: "MENA Logistics Sprint", orgName: "Regional Logistics Alliance",
    description: "Sprint program for logistics and last-mile innovation in the region.",
    type: "accelerator", fundingType: "non_equity", amountMin: 15000, amountMax: 55000,
    sectors: ["logistics", "ecommerce"], stageMin: "prototype", stageMax: "early_revenue",
    geography: "regional", languages: ["en"], url: DEMO_URL("mena-logistics"), deadlineDays: 29,
    conditions: [
      regionIn(["ps", "jo", "eg", "ae"], "MENA countries including Palestine", ev(DEMO_URL("mena-logistics"), "MENA countries, including Palestinian logistics ventures")),
      sectorIn(["logistics", "ecommerce"], ev(DEMO_URL("mena-logistics"), "Logistics and e-commerce enablement")),
    ],
  },
  {
    title: "Fertile Crescent AgriFund", orgName: "Fertile Crescent AgriFund",
    description: "Agri-food fund for the Levant; irrigation and post-harvest tech focus.",
    type: "grant", fundingType: "non_equity", amountMin: 25000, amountMax: 85000,
    sectors: ["agritech", "food"], stageMin: "prototype", stageMax: "early_revenue",
    geography: "regional", languages: ["en"], url: DEMO_URL("fertile-agri"), deadlineDays: 54, sourceType: "trusted_aggregator",
    conditions: [
      // فخ 5: صياغة غامضة — «Palestinian Territories and the wider region»
      {
        field: "founder.region", op: "in", value: ["west_bank", "gaza", "east_jerusalem"], mandatory: true,
        ambiguous: true,
        sourceWording: "Palestinian Territories and the wider region",
        evidence: ev(DEMO_URL("fertile-agri"), "Ventures based in the Palestinian Territories and the wider region may be considered"),
      },
      sectorIn(["agritech", "food"], ev(DEMO_URL("fertile-agri"), "Agri-food technology ventures")),
    ],
  },
  {
    title: "Middle East AI Fellowship", orgName: "MEAI Institute",
    description: "Advanced AI fellowship with compute credits and research grants.",
    type: "fellowship", fundingType: "non_equity", amountMin: 8000, amountMax: 25000,
    sectors: ["ai", "software", "healthtech"], stageMin: "idea", stageMax: "early_revenue",
    geography: "regional", languages: ["en"], url: DEMO_URL("meai-fellowship"), deadlineDays: 37,
    conditions: [
      regionIn(["ps", "eg", "jo", "sa", "ae", "qa", "kw", "tr", "other"], "Middle East countries including Palestine", ev(DEMO_URL("meai-fellowship"), "Middle East countries, including Palestine")),
      langIn(["en"], ev(DEMO_URL("meai-fellowship"), "English proficiency required for the research program")),
    ],
  },
  {
    title: "Levant Youth Entrepreneurs Grant", orgName: "Levant Youth Network",
    description: "Micro-grants for young founders (under 30) in the Levant.",
    type: "grant", fundingType: "non_equity", amountMin: 2000, amountMax: 9000,
    sectors: ["social", "ecommerce", "food", "media", "software"], stageMin: "idea", stageMax: "prototype",
    geography: "regional", languages: ["ar", "en"], url: DEMO_URL("levant-youth"), deadlineDays: 21,
    conditions: [
      regionIn(["ps", "jo", "eg"], "Levant youth including Palestine", ev(DEMO_URL("levant-youth"), "Levant youth founders, including Palestinians under 30")),
      { field: "company.ageMonths", op: "lte", value: 24, mandatory: true, sourceWording: "Ventures under two years", evidence: ev(DEMO_URL("levant-youth"), "Ventures younger than 24 months") },
    ],
  },

  // ============ دولية (16) ============
  {
    title: "Global Green Ventures — Climate Cohort", orgName: "GGV Climate Partners",
    description: "Global climate-tech program with $200K funding and COP showcase.",
    type: "accelerator", fundingType: "equity", amountMin: 100000, amountMax: 200000,
    sectors: ["cleantech", "energy", "water", "agritech"], stageMin: "prototype", stageMax: "scaling",
    geography: "international", languages: ["en"], url: DEMO_URL("ggv-climate"), deadlineDays: 50,
    requiresDocs: ["pitch_deck", "financial_statements", "business_plan"],
    conditions: [
      regionIn(["ps", "other", "eg", "jo", "us", "gb", "de", "fr", "sg", "tr", "ae", "sa", "qa", "kw"], "Global — all countries", ev(DEMO_URL("ggv-climate"), "We accept applications from all countries; climate impact is the sole geographic criterion")),
      { field: "company.languages", op: "in", value: ["en"], mandatory: true, sourceWording: "English program", evidence: ev(DEMO_URL("ggv-climate"), "The program is delivered in English; fluent participation is required") },
      teamGte(3, ev(DEMO_URL("ggv-climate"), "Teams of at least three")),
    ],
  },
  {
    title: "Open Doors Impact Prize", orgName: "Open Doors Foundation",
    description: "Global prize for impact ventures from underrepresented founder communities.",
    type: "competition", fundingType: "non_equity", amountMin: 5000, amountMax: 40000,
    sectors: ["social", "edtech", "healthtech", "agritech", "water"], stageMin: "idea", stageMax: "early_revenue",
    geography: "international", languages: ["en"], url: DEMO_URL("open-doors"), deadlineDays: 24,
    conditions: [
      regionIn(["ps", "west_bank", "gaza", "east_jerusalem", "other"], "Global; underrepresented communities prioritized", ev(DEMO_URL("open-doors"), "Global call; founders from underrepresented communities, explicitly including Palestinians, are prioritized")),
    ],
  },
  {
    title: "Silicon Seed Global Program", orgName: "Silicon Seed",
    description: "US-based seed program for international startups relocating to Silicon Valley.",
    type: "accelerator", fundingType: "equity", amountMin: 150000, amountMax: 500000,
    sectors: ["software", "ai", "fintech", "agritech"], stageMin: "early_revenue", stageMax: "scaling",
    geography: "international", languages: ["en"], url: DEMO_URL("silicon-seed"), deadlineDays: 66,
    requiresDocs: ["pitch_deck", "financial_statements", "registration_cert"],
    conditions: [
      // فخ 3: اشتراط تسجيل أمريكي/بريطاني/ألماني
      regCountry(["us", "gb", "de"], "US, UK, or EU registration", ev(DEMO_URL("silicon-seed"), "Applicants must be registered in the US, UK, or EU to participate (Delaware C-Corp or equivalent preferred)")),
      stageBetween("early_revenue", "scaling", ev(DEMO_URL("silicon-seed"), "Post-revenue startups only")),
    ],
  },
  {
    title: "Horizon Fellowship for Founders", orgName: "Horizon Global Institute",
    description: "Global fellowship with $20K grants and remote-first mentorship.",
    type: "fellowship", fundingType: "non_equity", amountMin: 10000, amountMax: 20000,
    sectors: ["software", "edtech", "healthtech", "agritech", "social"], stageMin: "idea", stageMax: "early_revenue",
    geography: "international", languages: ["en"], url: DEMO_URL("horizon-fellowship"), deadlineDays: 31,
    conditions: [
      regionIn(["ps", "other", "eg", "jo", "tr", "us", "gb", "de", "fr", "sg", "ae", "sa", "qa", "kw"], "Global, remote-first", ev(DEMO_URL("horizon-fellowship"), "Fully remote; founders from any country including Palestine may apply")),
    ],
  },
  {
    title: "Global Agri Innovation Award", orgName: "World Agri Innovation Council",
    description: "Global award for agricultural innovation; $50K top prize and expo booth.",
    type: "competition", fundingType: "non_equity", amountMin: 5000, amountMax: 50000,
    sectors: ["agritech", "food", "water"], stageMin: "prototype", stageMax: "scaling",
    geography: "international", languages: ["en"], url: DEMO_URL("agri-award"), deadlineDays: 46,
    conditions: [
      regionIn(["ps", "other", "eg", "jo", "us", "gb", "de", "fr", "sg", "tr", "ae", "sa", "qa", "kw"], "Global award", ev(DEMO_URL("agri-award"), "Open to agricultural innovators worldwide")),
      sectorIn(["agritech", "food", "water"], ev(DEMO_URL("agri-award"), "Agriculture, food, and water innovation categories")),
    ],
  },
  {
    title: "Founders Bridge Program", orgName: "Founders Bridge",
    description: "Global program for frontier-market founders; $75K and investor matching.",
    type: "grant", fundingType: "non_equity", amountMin: 30000, amountMax: 75000,
    sectors: ["software", "fintech", "healthtech", "logistics", "agritech"], stageMin: "prototype", stageMax: "early_revenue",
    geography: "international", languages: ["en"], url: DEMO_URL("founders-bridge"), deadlineDays: 43,
    requiresDocs: ["pitch_deck", "founder_id"],
    conditions: [
      regionIn(["ps", "other", "eg", "jo", "tr", "us", "gb", "de", "fr", "sg", "ae", "sa", "qa", "kw"], "Frontier markets globally", ev(DEMO_URL("founders-bridge"), "We serve founders in frontier markets globally, including Palestine")),
      { field: "company.monthlyRevenueUSD", op: "gte", value: 2000, mandatory: true, sourceWording: "Early revenue required", evidence: ev(DEMO_URL("founders-bridge"), "At least $2,000 MRR at the time of application") },
    ],
  },
  {
    title: "World Water Tech Prize", orgName: "Global Water Council",
    description: "International prize for water technology innovation.",
    type: "competition", fundingType: "non_equity", amountMin: 10000, amountMax: 60000,
    sectors: ["water", "cleantech", "iot"], stageMin: "prototype", stageMax: "early_revenue",
    geography: "international", languages: ["en"], url: DEMO_URL("water-prize"), deadlineDays: 39,
    conditions: [
      regionIn(["ps", "other", "eg", "jo", "us", "gb", "de", "fr", "sg", "tr", "ae", "sa", "qa", "kw"], "Global", ev(DEMO_URL("water-prize"), "Global competition for water technology")),
      sectorIn(["water", "cleantech", "iot"], ev(DEMO_URL("water-prize"), "Water technology categories")),
    ],
  },
  {
    title: "Empower Women Global Fund", orgName: "Empower Global",
    description: "Global fund for women-led ventures in emerging markets.",
    type: "grant", fundingType: "non_equity", amountMin: 15000, amountMax: 60000,
    sectors: ["agritech", "edtech", "healthtech", "social", "ecommerce"], stageMin: "idea", stageMax: "early_revenue",
    geography: "international", geoPriority: true, languages: ["en"], url: DEMO_URL("empower-women"), deadlineDays: 34,
    conditions: [
      regionIn(["ps", "other", "eg", "jo", "tr", "us", "gb", "de", "fr", "sg", "ae", "sa", "qa", "kw"], "Emerging markets globally", ev(DEMO_URL("empower-women"), "Women-led ventures across emerging markets, including Palestine and the MENA region")),
      { field: "company.womenLed", op: "eq", value: true, mandatory: true, sourceWording: "Women-led required", evidence: ev(DEMO_URL("empower-women"), "Ventures must be women-led (CEO or majority founding team)") },
    ],
  },
  {
    title: "Cloud Startup Grant Program", orgName: "CloudCorp Developer Relations",
    description: "Cloud credits and $25K grants for startups building on major cloud platforms.",
    type: "grant", fundingType: "non_equity", amountMin: 5000, amountMax: 25000,
    sectors: ["software", "ai", "iot", "media"], stageMin: "idea", stageMax: "early_revenue",
    geography: "international", languages: ["en"], url: DEMO_URL("cloud-grant"), deadlineDays: 27, sourceType: "official",
    conditions: [
      regionIn(["ps", "other", "eg", "jo", "us", "gb", "de", "fr", "sg", "tr", "ae", "sa", "qa", "kw"], "Global program", ev(DEMO_URL("cloud-grant"), "Available in all countries where our cloud services operate")),
      { field: "company.teamSize", op: "gte", value: 2, mandatory: true, sourceWording: "Two or more team members", evidence: ev(DEMO_URL("cloud-grant"), "Startups with at least two team members") },
    ],
  },
  {
    title: "Impact Ventures Loan Facility", orgName: "Global Impact Finance",
    description: "Impact loans $50-150K for social enterprises in developing markets.",
    type: "loan", fundingType: "non_equity", amountMin: 50000, amountMax: 150000,
    sectors: ["social", "agritech", "edtech", "healthtech"], stageMin: "early_revenue", stageMax: "scaling",
    geography: "international", languages: ["en"], url: DEMO_URL("impact-loans"), deadlineDays: 85,
    requiresDocs: ["registration_cert", "financial_statements", "bank_letter", "business_plan"],
    conditions: [
      regionIn(["ps", "other", "eg", "jo", "tr", "sg", "ae", "sa", "qa", "kw"], "Developing markets", ev(DEMO_URL("impact-loans"), "We lend to social enterprises in developing markets, including Palestine")),
      stageBetween("early_revenue", "scaling", ev(DEMO_URL("impact-loans"), "Revenue-generating enterprises only")),
      { field: "founder.hasBankAccount", op: "eq", value: true, mandatory: true, sourceWording: "International bank account required for disbursement", evidence: ev(DEMO_URL("impact-loans"), "An international bank account capable of receiving USD wires is required for disbursement") },
    ],
  },
  {
    title: "Global EdTech Exchange", orgName: "EdTech Global Alliance",
    description: "Global exchange program for education technology with pilot grants.",
    type: "grant", fundingType: "non_equity", amountMin: 10000, amountMax: 40000,
    sectors: ["edtech"], stageMin: "prototype", stageMax: "early_revenue",
    geography: "international", languages: ["en"], url: DEMO_URL("edtech-exchange"), deadlineDays: 57,
    conditions: [
      regionIn(["ps", "other", "eg", "jo", "us", "gb", "de", "fr", "sg", "tr", "ae", "sa", "qa", "kw"], "Global", ev(DEMO_URL("edtech-exchange"), "Global program for education innovators")),
      sectorIn(["edtech"], ev(DEMO_URL("edtech-exchange"), "Education technology ventures")),
    ],
  },
  {
    title: "Frontier AI Grant", orgName: "Frontier AI Labs",
    description: "Research grants for applied AI in resource-constrained settings.",
    type: "grant", fundingType: "non_equity", amountMin: 15000, amountMax: 45000,
    sectors: ["ai", "healthtech", "agritech"], stageMin: "idea", stageMax: "early_revenue",
    geography: "international", languages: ["en"], url: DEMO_URL("frontier-ai"), deadlineDays: 49,
    conditions: [
      regionIn(["ps", "other", "eg", "jo", "tr", "us", "gb", "de", "fr", "sg", "ae", "sa", "qa", "kw"], "Global south focus", ev(DEMO_URL("frontier-ai"), "Priority for global south applications, including Palestine and MENA")),
      langIn(["en"], ev(DEMO_URL("frontier-ai"), "Applications in English only")),
    ],
  },
  {
    title: "EuroScale Expansion Grant", orgName: "EuroScale Partners",
    description: "Expansion grants for startups entering European markets.",
    type: "grant", fundingType: "non_equity", amountMin: 20000, amountMax: 80000,
    sectors: ["software", "fintech", "logistics", "ecommerce", "agritech"], stageMin: "early_revenue", stageMax: "scaling",
    geography: "international", languages: ["en"], url: DEMO_URL("euroscale"), deadlineDays: 72,
    requiresDocs: ["registration_cert", "financial_statements"],
    conditions: [
      // فخ تسجيل أوروبي
      regCountry(["gb", "de", "fr", "sg", "other"], "EU/UK registration required", ev(DEMO_URL("euroscale"), "Applicants must hold an EU or UK registered entity to receive the expansion grant")),
      teamGte(8, ev(DEMO_URL("euroscale"), "Teams of eight or more for expansion readiness")),
    ],
  },
  {
    title: "Global Health Pioneers Fund", orgName: "Health Pioneers Alliance",
    description: "Global fund for community health innovation.",
    type: "grant", fundingType: "non_equity", amountMin: 12000, amountMax: 70000,
    sectors: ["healthtech", "social"], stageMin: "prototype", stageMax: "early_revenue",
    geography: "international", languages: ["en"], url: DEMO_URL("health-pioneers"), deadlineDays: 53,
    conditions: [
      regionIn(["ps", "other", "eg", "jo", "us", "gb", "de", "fr", "sg", "tr", "ae", "sa", "qa", "kw"], "Global community health", ev(DEMO_URL("health-pioneers"), "Community health innovators worldwide")),
      sectorIn(["healthtech", "social"], ev(DEMO_URL("health-pioneers"), "Community health and social impact ventures")),
    ],
  },
  {
    title: "Trade Corridors Logistics Fund", orgName: "Trade Corridors Institute",
    description: "Global fund for trade and logistics innovation in developing corridors.",
    type: "grant", fundingType: "non_equity", amountMin: 25000, amountMax: 90000,
    sectors: ["logistics", "manufacturing"], stageMin: "early_revenue", stageMax: "scaling",
    geography: "international", languages: ["en"], url: DEMO_URL("trade-corridors"), deadlineDays: 68, sourceType: "trusted_aggregator",
    conditions: [
      // فخ 6: شرط إلزامي بلا دليل → UNCERTAIN
      {
        field: "company.registrationCountry", op: "in", value: ["ps", "jo", "eg", "tr", "sg"], mandatory: true,
        sourceWording: "Registered in a developing trade corridor (list not published)",
        evidence: null as unknown as EvSpec,
      },
      { field: "company.teamSize", op: "gte", value: 10, mandatory: true, sourceWording: "Established operations teams", evidence: ev(DEMO_URL("trade-corridors"), "Operations teams of ten or more") },
    ],
  },
  {
    title: "Diaspora Founders Collective", orgName: "Global Diaspora Network",
    description: "Global program connecting diaspora founders with homeland ventures.",
    type: "fellowship", fundingType: "non_equity", amountMin: 5000, amountMax: 20000,
    sectors: ["software", "tourism", "food", "agritech", "social"], stageMin: "idea", stageMax: "early_revenue",
    geography: "international", languages: ["en", "ar"], url: DEMO_URL("diaspora-collective"), deadlineDays: 30,
    conditions: [
      // فخ 10: غموض داخل_48
      {
        field: "founder.region", op: "in", value: ["inside_48", "west_bank", "gaza"], mandatory: true,
        ambiguous: true,
        sourceWording: "Founders in historic Palestine (including 1948 areas) — territorial scope per funder policy",
        evidence: ev(DEMO_URL("diaspora-collective"), "Founders residing in historic Palestine (including 1948 areas) — territorial scope depends on funder policy"),
      },
    ],
  },
  {
    title: "Oceanic Frontiers Grant", orgName: "Oceanic Frontiers Foundation",
    description: "Coastal and marine innovation grants for ocean economies.",
    type: "grant", fundingType: "non_equity", amountMin: 10000, amountMax: 50000,
    sectors: ["cleantech", "energy", "logistics"], stageMin: "prototype", stageMax: "early_revenue",
    geography: "international", languages: ["en"], url: DEMO_URL("oceanic-frontiers"), deadlineDays: 59,
    conditions: [
      regionIn(["eg", "sa", "tr", "sg", "other"], "Coastal economies", ev(DEMO_URL("oceanic-frontiers"), "Ventures in coastal economies with port access")),
      sectorIn(["cleantech", "energy", "logistics"], ev(DEMO_URL("oceanic-frontiers"), "Blue economy categories")),
    ],
  },
  {
    title: "Universal Founders Prize", orgName: "Universal Founders Org",
    description: "Global open prize for early-stage ventures of any sector.",
    type: "competition", fundingType: "non_equity", amountMin: 3000, amountMax: 30000,
    sectors: ["software", "ai", "fintech", "agritech", "healthtech", "edtech", "social", "ecommerce"], stageMin: "idea", stageMax: "prototype",
    geography: "international", languages: ["en", "ar"], url: DEMO_URL("universal-prize"), deadlineDays: 19,
    conditions: [
      regionIn(["ps", "other", "eg", "jo", "us", "gb", "de", "fr", "sg", "tr", "ae", "sa", "qa", "kw"], "Open globally", ev(DEMO_URL("universal-prize"), "Open to founders globally, no geographic restrictions")),
      stageBetween("idea", "prototype", ev(DEMO_URL("universal-prize"), "Pre-revenue and prototype-stage ventures")),
    ],
  },
  // ============ مسودات للوحة المراجعة (2) ============
  {
    title: "حاضنة القدس التقنية — دفعة تجريبية (مسودة)", orgName: "حاضنة القدس التقنية",
    description: "برنامج قيد الإعداد؛ البيانات غير مكتملة وتنتظر المراجعة.",
    type: "incubator", fundingType: "convertible", amountMin: 5000, amountMax: 15000,
    sectors: ["software", "media"], stageMin: "idea", stageMax: "prototype",
    geography: "local", languages: ["ar"], url: DEMO_URL("quds-tech-draft"), deadlineDays: 80,
    conditions: [
      regionIn(["east_jerusalem", "west_bank"], "القدس والضفة", ev(DEMO_URL("quds-tech-draft"), "القدس والضفة")),
    ],
    status: "DRAFT",
  },
  {
    title: "منحة إقليمية للطاقة الشمسية — بانتظار المراجعة", orgName: "صندوق الشمس الإقليمي",
    description: "مسودة مكتملة الحقول بانتظار اعتماد مراجع ثانٍ.",
    type: "grant", fundingType: "non_equity", amountMin: 10000, amountMax: 40000,
    sectors: ["energy", "cleantech"], stageMin: "idea", stageMax: "early_revenue",
    geography: "regional", languages: ["ar", "en"], url: DEMO_URL("sun-regional"), deadlineDays: 64,
    requiresDocs: ["pitch_deck", "business_plan"],
    conditions: [
      regionIn(["ps", "jo", "eg"], "Levant including Palestine", ev(DEMO_URL("sun-regional"), "Levant region including Palestine")),
      sectorIn(["energy", "cleantech"], ev(DEMO_URL("sun-regional"), "Solar and clean energy ventures")),
    ],
    status: "NEEDS_REVIEW",
  },
];

// ————— العرض العربي الجاهز (إعادة مسجّلة) —————
const DECK_SLIDES: Slide[] = [
  { index: 1, title: "بذرة فلسطين للزراعة الذكية", text: "شركة بذرة فلسطين للزراعة الذكية\nنظام ري ذكي للمزارع الصغيرة" },
  { index: 2, title: "المشكلة", text: "المزارعون في فلسطين يستهلكون 60% من المياه في ري تقليدي\nهدر كبير في المياه والوقت وضعف في المحصول" },
  { index: 3, title: "العميل المستهدف", text: "المزارع الصغير مالك 1-10 دونمات\nالتعاونيات الزراعية في الضفة وغزة" },
  { index: 4, title: "الحل", text: "منصة بذرة: مستشعرات رطوبة تربة + تطبيق جوال\nتوفير مياه تلقائي حسب نوع المحصول\nخدمة اشتراك شهري" },
  { index: 5, title: "السوق", text: "حجم السوق TAM: 1.2 مليار دولار\nالسوق المتاح SAM: 300 مليون\nSOM: 15 مليون" },
  { index: 6, title: "نموذج العمل", text: "اشتراك شهري 12 دولار للمزرعة\nإيرادات متكررة + بيع المعدات" },
  { index: 7, title: "الجرّب", text: "500 مستخدم نشط\nنمو 40% شهريًا\nإيرادات شهرية 6000 دولار" },
  { index: 8, title: "الفريق", text: "فريق من 5 أعضاء\nالمؤسِسة سارة — مهندسة زراعية\nالمؤسس أحمد — مطور برمجيات" },
  { index: 9, title: "المنافسة", text: "منافسون: أنظمة ري تقليدية\nتمييزنا: أرخص 30% ومناسب للمزارع الصغيرة" },
  { index: 10, title: "الخطة", text: "توسع لدول الجوار خلال 18 شهرًا\nشراكات مع 3 تعاونيات جديدة" },
  { index: 11, title: "الطلب", text: "نطلب تمويلًا بقيمة 500 ألف دولار\nمقابل حصة 10%" },
  { index: 12, title: "الخاتمة", text: "شكرًا لكم\nبذرة — ري أذكى، محصول أوفر" },
];

const DECK_EXTRACTION: ExtractedField[] = [
  { key: "company.name", value: "بذرة فلسطين للزراعة الذكية", page: 1, quote: "شركة بذرة فلسطين للزراعة الذكية", confidence: 0.92, status: "pending" },
  { key: "company.sectors", value: ["agritech", "iot"], page: 4, quote: "منصة بذرة: مستشعرات رطوبة تربة + تطبيق جوال", confidence: 0.7, status: "pending" },
  { key: "company.stage", value: "early_revenue", page: 7, quote: "إيرادات شهرية 6000 دولار", confidence: 0.85, status: "pending" },
  { key: "company.tractionUsers", value: 500, page: 7, quote: "500 مستخدم نشط", confidence: 0.9, status: "pending" },
  { key: "company.monthlyRevenueUSD", value: 6000, page: 7, quote: "إيرادات شهرية 6000 دولار", confidence: 0.9, status: "pending" },
  { key: "company.teamSize", value: 5, page: 8, quote: "فريق من 5 أعضاء", confidence: 0.88, status: "pending" },
  { key: "company.askAmountUSD", value: 500000, page: 11, quote: "نطلب تمويلًا بقيمة 500 ألف دولار", confidence: 0.95, status: "pending" },
  { key: "company.askType", value: "equity", page: 11, quote: "مقابل حصة 10%", confidence: 0.8, status: "pending" },
];

// ————— التنفيذ —————

async function main() {
  // This seed is destructive and contains illustrative demo records only.
  // Never allow it to delete or contaminate production/unknown databases.
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo seed is disabled in production.");
  }
  if (process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Set ALLOW_DEMO_SEED=true explicitly to run the destructive demo seed.");
  }
  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    throw new Error("Demo seed requires a PostgreSQL DATABASE_URL; SQLite and unknown database URLs are blocked.");
  }
  console.log("🧹 تنظيف القاعدة...");
  await prisma.notification.deleteMany();
  await prisma.slideSuggestion.deleteMany();
  await prisma.aiRun.deleteMany();
  await prisma.application.deleteMany();
  await prisma.companyDocument.deleteMany();
  await prisma.deckVersion.deleteMany();
  await prisma.deck.deleteMany();
  await prisma.evidence.deleteMany();
  await prisma.condition.deleteMany();
  await prisma.opportunityVersion.deleteMany();
  await prisma.opportunity.deleteMany();
  await prisma.founder.deleteMany();
  await prisma.startupProfile.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();

  console.log("👤 إنشاء المستخدمين...");
  const pwHash = hashPassword("Masar#2026");
  const founderUser = await prisma.user.create({
    data: {
      email: "founder@masar.demo", name: "سارة نصار", passwordHash: pwHash, role: "FOUNDER",
      profile: {
        create: {
          fieldsJson: JSON.stringify([
            { field: "company.name", value: "بذرة فلسطين للزراعة الذكية", source: "manual", confirmedAt: iso(daysAgo(200)) },
            { field: "company.sectors", value: ["agritech", "iot"], source: "manual", confirmedAt: iso(daysAgo(200)) },
            { field: "company.stage", value: "early_revenue", source: "manual", confirmedAt: iso(daysAgo(60)) },
            { field: "company.registrationCountry", value: "ps", source: "manual", confirmedAt: iso(daysAgo(200)) },
            { field: "company.legalStatus", value: "registered_local", source: "manual", confirmedAt: iso(daysAgo(200)) },
            { field: "company.ageMonths", value: 26, source: "manual", confirmedAt: iso(daysAgo(30)) },
            { field: "company.teamSize", value: 5, source: "manual", confirmedAt: iso(daysAgo(30)) },
            { field: "company.womenLed", value: true, source: "manual", confirmedAt: iso(daysAgo(200)) },
            { field: "company.monthlyRevenueUSD", value: 6000, source: "manual", confirmedAt: iso(daysAgo(10)) },
            { field: "company.tractionUsers", value: 500, source: "manual", confirmedAt: iso(daysAgo(10)) },
            { field: "company.askAmountUSD", value: 500000, source: "manual", confirmedAt: iso(daysAgo(60)) },
            { field: "company.askType", value: "equity", source: "manual", confirmedAt: iso(daysAgo(60)) },
            { field: "company.languages", value: ["ar", "en"], source: "manual", confirmedAt: iso(daysAgo(200)) },
            { field: "company.requiredDocs", value: ["pitch_deck", "founder_id"], source: "manual", confirmedAt: iso(daysAgo(30)) },
            { field: "founder.region", value: "west_bank", source: "manual", confirmedAt: iso(daysAgo(200)) },
            { field: "founder.nationality", value: "ps", source: "manual", confirmedAt: iso(daysAgo(200)) },
            { field: "founder.hasBankAccount", value: true, source: "manual", confirmedAt: iso(daysAgo(100)) },
            { field: "founder.paymentMethods", value: ["bank_transfer"], source: "manual", confirmedAt: iso(daysAgo(100)) },
          ]),
          founders: {
            create: [
              { name: "سارة نصار", region: "west_bank", nationality: "ps", isPrimary: true },
              { name: "أحمد نصار", region: "diaspora", nationality: "ps", isPrimary: false },
            ],
          },
        },
      },
    },
    include: { profile: { include: { founders: true } } },
  });
  const reviewer = await prisma.user.create({
    data: { email: "reviewer@masar.demo", name: "ليلى مرار", passwordHash: pwHash, role: "REVIEWER" },
  });
  const reviewer2 = await prisma.user.create({
    data: { email: "reviewer2@masar.demo", name: "مروان صالح", passwordHash: pwHash, role: "REVIEWER" },
  });

  console.log("📋 إنشاء الفرص والشروط والأدلة...");
  const oppIds: string[] = [];
  for (const spec of OPPS) {
    const status = spec.status ?? "PUBLISHED";
    const opp = await prisma.opportunity.create({
      data: {
        title: spec.title,
        orgName: spec.orgName,
        description: spec.description,
        status,
        rejectReason: spec.rejectReason,
        type: spec.type,
        fundingType: spec.fundingType,
        amountMin: spec.amountMin,
        amountMax: spec.amountMax,
        currency: spec.currency ?? "USD",
        sectorsJson: JSON.stringify(spec.sectors),
        stageMin: spec.stageMin,
        stageMax: spec.stageMax,
        geography: spec.geography,
        geoPriority: spec.geoPriority ?? false,
        languagesJson: JSON.stringify(spec.languages ?? ["ar"]),
        applicationUrl: spec.url,
        normalizedUrl: spec.url.replace(/^https:\/\//, "").replace(/\/$/, ""),
        sourceType: spec.sourceType ?? "official",
        linkCheckState: "ok",
        deadline: daysFromNow(spec.deadlineDays),
        deadlineTz: "Asia/Hebron",
        requiresDocsJson: JSON.stringify(spec.requiresDocs ?? []),
        verifiedAt: status === "PUBLISHED" ? daysAgo(10) : null,
        currentVersion: 1,
        createdById: reviewer.id,
        approvedById: status === "PUBLISHED" ? reviewer2.id : null,
      },
    });
    oppIds.push(opp.id);

    for (const c of spec.conditions) {
      let evidenceId: string | null = null;
      if (c.evidence && typeof c.evidence === "object") {
        const evRow = await prisma.evidence.create({
          data: {
            url: c.evidence.url,
            quote: c.evidence.quote,
            verifiedAt: daysAgo(c.evidence.daysAgo ?? 12),
          },
        });
        evidenceId = evRow.id;
      }
      await prisma.condition.create({
        data: {
          opportunityId: opp.id,
          field: c.field,
          op: c.op,
          valueJson: JSON.stringify(c.value),
          mandatory: c.mandatory ?? false,
          ambiguous: c.ambiguous ?? false,
          scope: c.scope ?? "any",
          sourceWording: c.sourceWording,
          evidenceId,
        },
      });
    }
  }

  console.log("📚 إنشاء العرض العربي الجاهز (إعادة مسجّلة)...");
  const readiness = evaluateReadiness(DECK_SLIDES, DECK_EXTRACTION);
  const claims = extractClaims(DECK_SLIDES);
  const contradictions = detectContradictions(claims);

  // الفجوات: أفضل 8 مطابقات لمؤسسنا
  const published = await prisma.opportunity.findMany({
    where: { status: "PUBLISHED" },
    include: { conditions: { include: { evidence: true } } },
    orderBy: { deadline: "asc" },
    take: 60,
  });
  const founderProfile = founderUser.profile!;
  const snapshot: ProfileSnapshot = {
    fields: JSON.parse(founderProfile.fieldsJson),
    founders: founderProfile.founders.map((f) => ({
      name: f.name, region: f.region, nationality: f.nationality, isPrimary: f.isPrimary,
    })),
    documents: [
      { docType: "pitch_deck", status: "available" },
      { docType: "founder_id", status: "available" },
    ],
  };
  const ruleCond = (c: {
    id: string; field: string; op: string; valueJson: string; mandatory: boolean;
    ambiguous: boolean; scope: string; sourceWording: string | null;
    evidence: { url: string; quote: string; verifiedAt: Date } | null;
  }): RuleCondition => ({
    id: c.id,
    field: c.field as ProfileFieldKey,
    op: c.op as RuleCondition["op"],
    value: JSON.parse(c.valueJson),
    mandatory: c.mandatory,
    ambiguous: c.ambiguous,
    scope: (c.scope as "any" | "all") ?? "any",
    sourceWording: c.sourceWording,
    evidence: c.evidence
      ? { url: c.evidence.url, quote: c.evidence.quote, verifiedAt: iso(c.evidence.verifiedAt) }
      : null,
  });

  const evaluated = published.map((o) => {
    const result = evaluateEligibility(snapshot, o.conditions.map(ruleCond));
    return { opp: o, result };
  });
  const ranked = evaluated
    .filter((e) => e.result.judgment !== "NOT_ELIGIBLE")
    .sort((a, b) => a.opp.deadline!.getTime() - b.opp.deadline!.getTime())
    .slice(0, 8);
  const gapReport = buildGapReport(
    snapshot,
    ranked.map((e) => ({
      opp: {
        id: e.opp.id,
        title: e.opp.title,
        requiresDocs: JSON.parse(e.opp.requiresDocsJson) as string[],
      },
      result: e.result,
    })),
    readiness,
  );

  const deck = await prisma.deck.create({
    data: {
      profileId: founderProfile.id,
      currentVersion: 1,
      versions: {
        create: {
          versionNumber: 1,
          fileHash: createHash("sha256").update("demo-deck-v1").digest("hex"),
          fileName: "عرض-بذرة-فلسطين.pdf",
          fileSize: 184320,
          fileType: "pdf",
          status: "READY",
          slideCount: DECK_SLIDES.length,
          pageCount: DECK_SLIDES.length,
          slidesJson: JSON.stringify(DECK_SLIDES),
          extractionJson: JSON.stringify(DECK_EXTRACTION),
          claimsJson: JSON.stringify({ items: claims, contradictions }),
          readinessJson: JSON.stringify(readiness),
          gapReportJson: JSON.stringify(gapReport),
        },
      },
    },
    include: { versions: true },
  });

  await prisma.aiRun.create({
    data: {
      purpose: "EXTRACTION",
      provider: "mock-replay",
      model: "recorded-replay",
      promptFingerprint: createHash("sha256").update("seed-extraction-prompt").digest("hex").slice(0, 16),
      latencyMs: 320,
      success: true,
      deckVersionId: deck.versions[0].id,
      userId: founderUser.id,
    },
  });

  console.log("📁 مستندات الملف...");
  const docSpecs: Array<[string, string, string | null]> = [
    ["pitch_deck", "available", "من العرض المرفوع (نسخة 1)"],
    ["founder_id", "available", "إدخال يدوي"],
    ["business_plan", "missing", null],
    ["financial_statements", "missing", null],
  ];
  for (const [docType, status, source] of docSpecs) {
    await prisma.companyDocument.create({
      data: { profileId: founderProfile.id, docType, status, source },
    });
  }

  console.log("🔔 طلب تتبع + إشعارات...");
  const eligibleLocal = ranked.find((e) => e.opp.geography === "local");
  if (eligibleLocal) {
    const app = await prisma.application.create({
      data: {
        profileId: founderProfile.id,
        opportunityId: eligibleLocal.opp.id,
        status: "INTERESTED",
        notes: "أبدأت التحضير — أكمل مستند خطة العمل",
      },
    });
    // فرصة لها نسخة ثانية (تغيير جوهري سابق) لإشعار مكتمل المعنى
    const changedOpp = eligibleLocal.opp;
    await prisma.opportunity.update({
      where: { id: changedOpp.id },
      data: { currentVersion: 2 },
    });
    const version = await prisma.opportunityVersion.create({
      data: {
        opportunityId: changedOpp.id,
        versionNumber: 2,
        diffJson: JSON.stringify([{ field: "deadline", oldValue: iso(daysFromNow(45)), newValue: iso(changedOpp.deadline!) }]),
        changeType: "substantive",
        changeCategory: "deadline",
        reason: "تحديث موعد التقديم بعد تمديد البرنامج",
        createdById: reviewer.id,
      },
    });
    await prisma.notification.create({
      data: {
        userId: founderUser.id,
        opportunityId: changedOpp.id,
        eventType: "SUBSTANTIVE_CHANGE",
        versionNumber: 2,
        payloadJson: JSON.stringify({ ar: `تغيّر الموعد النهائي لفرصة «${changedOpp.title}» — أُعيد تقييم أهليتك.`, en: `The deadline for “${changedOpp.title}” changed. Your eligibility has been re-evaluated; review the current official details.` }),
        versionId: version.id,
        readAt: daysAgo(3),
      },
    });
    await prisma.notification.create({
      data: {
        userId: founderUser.id,
        opportunityId: ranked[1]?.opp.id ?? changedOpp.id,
        eventType: "SUBSTANTIVE_CHANGE",
        versionNumber: 2,
        payloadJson: JSON.stringify({ ar: `تغيّر شرط إلزامي في فرصة «${(ranked[1] ?? ranked[0]).opp.title}» — راجع أهليتك.`, en: `A mandatory criterion changed for “${(ranked[1] ?? ranked[0]).opp.title}”. Review the updated eligibility criteria.` }),
      },
    });
    void app;
  }

  // ————— ملخص التحقق —————
  console.log("\n📊 ملخص البذر:");
  const byStatus = await prisma.opportunity.groupBy({ by: ["status"], _count: true });
  for (const s of byStatus) console.log(`   ${s.status}: ${s._count}`);
  const judgments = { ELIGIBLE: 0, NOT_ELIGIBLE: 0, UNCERTAIN: 0 } as Record<string, number>;
  for (const e of evaluated) judgments[e.result.judgment]++;
  console.log(`   أحكام مؤسسة «بذرة فلسطين» على ${evaluated.length} فرصة منشورة:`);
  console.log(`   ✓ مؤهل: ${judgments.ELIGIBLE} | ؟ غير محسوم: ${judgments.UNCERTAIN} | ✗ غير مؤهل: ${judgments.NOT_ELIGIBLE}`);
  const traps = OPPS.filter((o) => o.url.includes("gulf-impact") || o.url.includes("community-tech") ||
    o.url.includes("fertile-agri") || o.url.includes("trade-corridors") || o.url.includes("silicon-seed") ||
    o.url.includes("amman-techbridge") || o.url.includes("gaza-digital") || o.url.includes("diaspora-collective") ||
    o.url.includes("medhealth-mena") || o.url.includes("euroscale"));
  console.log(`   الفخاح المقصودة (10): ${traps.length}`);

  // تحقق القيود
  const bad = await prisma.opportunity.count({
    where: { status: "PUBLISHED", OR: [{ applicationUrl: null }, { verifiedAt: null }] },
  });
  const selfApp = await prisma.opportunity.count({
    where: { status: "PUBLISHED", createdById: { equals: prisma.opportunity.fields.approvedById } },
  } as never).catch(() => 0);
  console.log(`   قيود النشر: فرص منشورة ناقصة الرابط/التحقق = ${bad} (يجب 0)`);
  console.log("\n✅ DEMO SEED COMPLETED — demo accounts are for local development only.");
}

main()
  .catch((e) => {
    console.error("SEED FAILED:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
