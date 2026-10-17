/**
 * Masar — T8: معايير جاهزية العرض التسعة (محللات نصية حتمية)
 * ---------------------------------------------------------------------------
 * evaluateReadiness(slides, fields) → ReadinessReport
 *
 * مبادئ ملزِمة (AGENT_CONTRACT §10 + المهمة):
 *  - حتمية كاملة: نفس (slides, fields) ⇒ نفس المعايير والأدلة حرفيًّا.
 *    (generatedAt ختم عرض فقط — التحليل نفسه لا يعتمد على الوقت.)
 *  - «لا تخمين»: الاستدلال من نص الشرائح فقط (عربي/إنجليزي بكلمات مفتاحية
 *    معًا). الحقول المستخرجة (ExtractedField) تستعمل كمصدر كمّي إضافي فقط
 *    إذا كانت بحالة confirmed/pending (نجحت في Citation Guard) — أما
 *    dropped/rejected فتُهمل تمامًا.
 *  - لا استثناءً أبدًا: أي مدخل فاسد/ناقص يُعامل كقيمة آمنة.
 *  - قيد الاستيراد (نص المهمة): من @/lib/core/types فقط — لذلك يوجد هنا
 *    تطبيع ومحلل أرقام محليان مستقلان (نسخة مصغّرة موثّقة، لا مشاركة مع
 *    ملفات T8 الأخرى).
 *
 * المستويات الأربعة (تعريف حاكم):
 *  - strong   : كلمات المعيار المفتاحية موجودة + عنصر كمّي (رقم/نسبة غير
 *               سنويّة) في شرائح ذات صلة، أو حقل مستخرج كمّي موثّق.
 *  - adequate : كلمات مفتاحية موجودة بلا أي عنصر كمّي.
 *  - weak     : إشارة جزئية/عابرة — كلمة عامة واحدة بسياق غير متخصص.
 *  - missing  : لا إشارة إطلاقًا.
 *
 * قواعد خاصة (من نص المهمة — «أمثلة لا قيود» طُبّقت كما وردت):
 *  1) السوق: TAM/SAM/SOM أو «حجم السوق» + أرقام → strong (مغطّاة بالقاعدة
 *     العامة: كلمات السوق تشمل tam/sam/som وحجم السوق والسوق).
 *  2) الطلب: «نطلب/raising/seek/جمع/استثمار…» + مبلغ → strong؛ وبلا مبلغ
 *     في العرض كله → missing («وإلا missing إن لا ذكر مبلغ»): بلا مبلغ لا
 *     يوجد «وضوح» أصلًا لهذا المعيار. المستوى weak غير مستخدم هنا عمدًا.
 *  3) الفريق: «فريق/members/مؤسس + أسماء أو أدوار» → adequate على الأقل؛
 *     كلمات الفريق وحدها (بلا أدوار/أسماء/أرقام) → weak (إشارة عابرة).
 *     كشف الأسماء متاح للإنجليزية فقط (كلمة Title-case ليست بداية جملة) —
 *     للعربية يعتمد المعيار على الأدوار (قيد حتمي موثّق).
 *
 * ملاحظة منهجية: المطابقة العربية تعتمد «جذوعًا» صرفية (بادئات/لواحق
 * شائعة) بكلمات ≥3 محارف — أداة استدلالية حتمية لا فهمًا لغويًّا؛
 * الزيجات الشاذة (مثل «مسوّق» لجذع «سوق») نادرة في العروض وموثّقة هنا.
 */

import type {
  CriterionResult,
  ExtractedField,
  ReadinessLevel,
  ReadinessReport,
  Slide,
} from "@/lib/core/types";

// ————— المعايير التسعة (الترتيب والملصقات حرفيًّا من المهمة) —————

export const CRITERIA: Array<{ key: string; labelAr: string; labelEn: string }> = [
  { key: "problem", labelAr: "المشكلة وحاجتها", labelEn: "Problem and need" },
  { key: "customer", labelAr: "العميل المستهدف", labelEn: "Target customer" },
  { key: "solution", labelAr: "الحل والمنتج", labelEn: "Solution and product" },
  { key: "market", labelAr: "السوق وحجمه", labelEn: "Market and size" },
  { key: "business_model", labelAr: "نموذج العمل والإيرادات", labelEn: "Business model and revenue" },
  { key: "traction", labelAr: "النمو والتحقق", labelEn: "Traction and validation" },
  { key: "team", labelAr: "الفريق", labelEn: "Team" },
  { key: "competition", labelAr: "المنافسة والتمييز", labelEn: "Competition and differentiation" },
  { key: "ask_clarity", labelAr: "وضوح الطلب التمويلي", labelEn: "Funding ask clarity" },
];

// ————— تطبيع محلي (مستقل — قيد الاستيراد في نص المهمة) —————
// مثل أدوات T5 لكن مبسّطًا محليًّا: خفض الحالة، إزالة التشكيل والتطويل،
// توحيد الهمزات (أإآ→ا، ة→ه، ى→ي، ؤ→و، ئ→ي)، أرقام هندية/فارسية→غربية.

const AR_DIACRITICS = /[\u064B-\u065F\u0670]/g;
const AR_TATWEEL = /\u0640/g;
const EASTERN_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;
const NON_ALNUM = /[^\p{L}\p{N}]+/gu;

function easternToWesternDigit(ch: string): string {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return ch;
  const base = cp <= 0x0669 ? 0x0660 : 0x06f0;
  return String(cp - base);
}

/** تطبيع حروف فقط (يبقي الترقيم والمسافات كما هي — لتحليل الأرقام). */
function normalizeLetters(s: string): string {
  if (typeof s !== "string") return "";
  try {
    return s
      .toLowerCase()
      .replace(AR_DIACRITICS, "")
      .replace(AR_TATWEEL, "")
      .replace(EASTERN_DIGITS, easternToWesternDigit)
      .replace(/[أإآ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/\u066B/g, ".") // ٫ فاصلة عشرية عربية
      .replace(/\u066C/g, ","); // ، فاصلة الآلاف العربية
  } catch {
    return "";
  }
}

/** التطبيع الكامل للمطابقة الكلمية: الترقيم والرموز → مسافات. */
function norm(s: string): string {
  return normalizeLetters(s)
    .replace(NON_ALNUM, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ————— مطابقة الجذوع العربية —————
// كلمة مطابقة لجذع إذا: الكلمة == الجذع، أو بعد نزع بادئة/لواحق شائعة
// (بحد نزعين) بقيت الجذع أو زيادة/نقص محرف واحد. هذا يمنع الزيجات الشاذة
// مثل «نموذج» مع جذع «نمو» (زيادة ذج = محرفان → مرفوضة).

const AR_PREFIXES = ["وال", "بال", "فال", "كال", "لل", "ال", "و", "ف", "ب", "ك", "ل"];
const AR_SUFFIXES = ["ات", "ون", "ين", "ها", "هم", "هن", "كم", "نا", "ه", "ي", "ا", "ت"];

function matchCore(w: string, stem: string): boolean {
  const candidates: string[] = [w];
  for (const p of AR_PREFIXES) {
    if (w.startsWith(p) && w.length - p.length >= stem.length) {
      candidates.push(w.slice(p.length));
      break;
    }
  }
  for (const c of candidates) {
    let b = c;
    for (let round = 0; round < 2; round++) {
      let stripped = false;
      for (const s of AR_SUFFIXES) {
        if (b.endsWith(s) && b.length - s.length >= stem.length) {
          b = b.slice(0, b.length - s.length);
          stripped = true;
          break;
        }
      }
      if (!stripped) break;
    }
    if (b === stem) return true;
    if (b.startsWith(stem) && b.length - stem.length <= 1) return true;
    if (b.endsWith(stem) && b.length - stem.length <= 1) return true;
  }
  return false;
}

function isLatinText(s: string): boolean {
  return /^[a-z0-9][a-z0-9\s-]*$/.test(s) && /[a-z]/.test(s);
}

function hasArabicLetter(s: string): boolean {
  return /[\u0621-\u064A]/.test(s);
}

/** هل يحوي النص المطبَّع الكلمة المفتاحية (المطبَّعة)؟ */
function hasKw(normText: string, kw: string): boolean {
  if (!normText || !kw) return false;
  try {
    if (isLatinText(kw)) {
      if (kw.includes(" ")) return normText.includes(kw);
      return normText.split(" ").includes(kw);
    }
    if (kw.includes(" ")) return normText.includes(kw);
    if (!hasArabicLetter(kw)) return normText.split(" ").includes(kw);
    return normText.split(" ").some((t) => matchCore(t, kw));
  } catch {
    return false;
  }
}

// ————— محلل الأرقام المحلي (مختصر: قيمة + وحدة + نسبة + عملة + سنة) —————

interface NumInfo {
  value: number; // القيمة النهائية (مع المضاعف)
  multiplier: number; // 1 | 1e3 | 1e6 | 1e9
  isPercent: boolean;
  isCurrency: boolean;
  isYear: boolean; // 1900–2100 بلا وحدة/عملة/نسبة — يُهمل كمّيًّا
}

function parseDigits(raw: string): number | null {
  if (/^\d{1,3}(,\d{3})+$/.test(raw)) return Number(raw.replace(/,/g, ""));
  const n = Number(raw.replace(/,/g, "."));
  return Number.isFinite(n) ? n : null;
}

const CURRENCY_AFTER_RE =
  /^(?:دولار|usd|dollars?|dollar)(?![a-z\u0621-\u064A])/u;

/** الوحدة بعد الرقم: مضاعف/نسبة/عملة — حتمي، محارف متطابقة بلا حالة. */
function matchUnitAfter(lineD: string, pos: number): { mult: number; percent: boolean; currency: boolean } | null {
  if (pos >= lineD.length) return null;
  const rest = lineD.slice(pos);
  const c = rest[0];
  const out = { mult: 1, percent: false, currency: false };
  if (c === "%" || c === "٪") return { ...out, percent: true };
  if (/[a-z]/.test(c)) {
    if (/^bn(?![a-z])/.test(rest)) return { ...out, mult: 1e9 };
    if (/^b(?![a-z])/.test(rest)) return { ...out, mult: 1e9 };
    if (/^billion(?![a-z])/.test(rest)) return { ...out, mult: 1e9 };
    if (/^(?:mm|mn)(?![a-z])/.test(rest)) return { ...out, mult: 1e6 };
    if (/^million(?![a-z])/.test(rest)) return { ...out, mult: 1e6 };
    if (/^m(?![a-z])/.test(rest)) return { ...out, mult: 1e6 };
    if (/^thousand(?![a-z])/.test(rest)) return { ...out, mult: 1e3 };
    if (/^k(?![a-z])/.test(rest)) return { ...out, mult: 1e3 };
    if (/^percent(?![a-z])/.test(rest)) return { ...out, percent: true };
    if (CURRENCY_AFTER_RE.test(rest)) return { ...out, currency: true };
    return null;
  }
  if (hasArabicLetter(c)) {
    if (/^مليار/.test(rest)) return { ...out, mult: 1e9 };
    if (/^(?:ملايين|مليون)/.test(rest)) return { ...out, mult: 1e6 };
    if (/^(?:الف|الاف)(?!\p{L})/u.test(rest)) return { ...out, mult: 1e3 };
    if (/^دولار/.test(rest)) return { ...out, currency: true };
    if (/^(?:بالميه|بالمياه)/.test(rest)) return { ...out, percent: true };
    return null;
  }
  if (c === "$") return { ...out, currency: true };
  return null;
}

/** عملة قبل الرقم ($500 أو «دولار 500») — بحد 10 محارف للخلف. */
function currencyBefore(lineD: string, numStart: number): boolean {
  let i = numStart - 1;
  while (i >= 0 && lineD[i] === " ") i--;
  if (i < 0) return false;
  if (lineD[i] === "$") return true;
  const before = lineD.slice(Math.max(0, i - 9), i + 1);
  return /(?:^|\s)(?:دولار|usd)$/.test(before);
}

const NUM_RE = /(\d[\d,]*(?:\.\d+)?)/g;

/** أرقام سطر واحد (بالتطبيع الحرفي) — يتخطى الأرقام الملتصقة بكلمات (b2b). */
function scanLineNumbers(lineD: string): NumInfo[] {
  const out: NumInfo[] = [];
  if (!lineD) return out;
  let m: RegExpExecArray | null;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(lineD)) !== null) {
    const raw = m[1];
    const start = m.index;
    const prev = start > 0 ? lineD[start - 1] : "";
    if (prev !== "" && /[\p{L}]/u.test(prev)) continue; // b2b / عام2023
    const base = parseDigits(raw);
    if (base === null) continue;
    let pos = start + raw.length;
    while (pos < lineD.length && lineD[pos] === " ") pos++;
    const unit = matchUnitAfter(lineD, pos);
    const isPercent = unit?.percent === true;
    const isCurrency = currencyBefore(lineD, start) || unit?.currency === true;
    const multiplier = unit?.mult ?? 1;
    // عملة بعد المضاعف: «1.2 مليار دولار»
    const currencyAfterMult = (() => {
      if (!unit || unit.mult === 1) return false;
      let p = pos;
      if (/^مليار/.test(lineD.slice(p))) p += 5;
      else if (/^(?:ملايين|مليون)/.test(lineD.slice(p))) p += 5;
      else if (/^(?:الف|الاف)/.test(lineD.slice(p))) p += 3;
      else if (/^(?:bn|billion|mm|mn|million|thousand|k|m|b)/i.test(lineD.slice(p))) {
        const mm = lineD.slice(p).match(/^[a-z]+/);
        p += mm ? mm[0].length : 0;
      } else return false;
      while (p < lineD.length && lineD[p] === " ") p++;
      const after = lineD.slice(p, p + 8);
      if (/^\$/.test(after) || /^(?:usd|dollars?)/.test(after) || /^دولار/.test(after)) return true;
      return false;
    })();
    const finalCurrency = isCurrency || currencyAfterMult;
    const value = multiplier > 1 ? Math.round(base * multiplier) : base;
    const isYear =
      !isPercent &&
      !finalCurrency &&
      multiplier === 1 &&
      Number.isInteger(base) &&
      base >= 1900 &&
      base <= 2100;
    out.push({ value, multiplier, isPercent, isCurrency: finalCurrency, isYear });
  }
  return out;
}

// ————— قوائم الكلمات المفتاحية (تُطوَّع عند التحميل) —————
// ملاحظة: الكلمات العربية مكتوبة بصيغها الطبيعية ثم تُطبَّع؛ المطابقة بجذوع
// صرفية كما هو موثّق أعلاه. الإنجليزية تُطابق كلمة كاملة (صيغ الجمع مدرجة).

interface KwSet {
  primary: string[];
  weak: string[];
}

const KEYWORDS: Record<string, KwSet> = {
  problem: {
    primary: [
      "مشكل", "معاناه", "يعاني", "يعانون", "تحدي", "نقص", "صعوبه", "حاج", "حاجه",
      "فجوه", "عقبه", "خساره", "خسائر",
      "problem", "problems", "pain", "challenge", "challenges", "issue", "issues",
      "struggle", "difficulty", "barrier", "barriers", "unmet",
    ],
    weak: ["مخاطر", "خطر", "ضرر"],
  },
  customer: {
    primary: [
      "عميل", "عملاء", "زبون", "زبائن", "مستهدف", "شريحه", "شرائح",
      "customer", "customers", "client", "clients", "target", "audience",
      "segment", "segments", "buyer", "buyers", "icp",
    ],
    weak: ["b2b", "b2c", "جمهور"],
  },
  solution: {
    primary: [
      "حلول", "حل", "منتج", "منصه", "منصت", "نظام",
      "solution", "product", "platform", "feature", "features", "offering",
      "mvp", "app", "how it works",
    ],
    weak: ["خدمه", "خدمات", "مزايا", "ميزه", "فوائد"],
  },
  market: {
    primary: [
      "سوق", "اسواق", "حجم السوق",
      "tam", "sam", "som", "market", "markets", "addressable", "market size",
    ],
    weak: ["اتجاه", "trend", "trends"],
  },
  business_model: {
    primary: [
      "نموذج", "ايراد", "مبيعات", "اشتراك", "تسعير", "اسعار", "سعر", "ربح",
      "ارباح", "عموله", "ترخيص",
      "revenue", "revenues", "model", "monetization", "pricing", "subscription",
      "subscriptions", "commission", "licensing", "margin", "margins",
    ],
    weak: ["باقات", "باقه", "خطه"],
  },
  traction: {
    primary: [
      "زخم", "نمو", "نتائج", "تحقق", "مستخدم", "مشترك", "عملاء", "مبيعات",
      "ايراد", "تجريبي", "تجارب", "خطاب نوايا",
      "traction", "growth", "momentum", "results", "users", "pilot", "pilots",
      "beta", "kpi", "kpis", "mrr", "arr", "loi",
    ],
    weak: ["انجاز", "توسع", "شركاء", "milestone", "milestones", "partnership"],
  },
  ask_clarity: {
    primary: [], // تُدار بالكامل عبر المحلل الخاص (أفعال + أسماء أدناه)
    weak: [],
  },
  team: {
    primary: [
      "فريق", "مؤسس", "شريك مؤسس",
      "team", "teams", "founder", "founders", "cofounder", "cofounders",
      "co founder", "co founders", "member", "members", "ceo", "cto", "cmo",
      "cfo", "coo", "chief",
    ],
    weak: ["خبره", "مستشار", "خبير", "خبراء", "شريك", "شركاء", "advisor", "advisors", "experience"],
  },
  competition: {
    primary: [
      "منافس", "منافسه", "تنافس", "تميز", "فريد",
      "competitor", "competitors", "competition", "competitive", "rivals",
      "differentiation", "differentiator", "unique", "moat", "usp",
    ],
    weak: ["بديل", "بدائل", "alternative", "alternatives", "versus", "vs"],
  },
};

// ————— كلمات خاصة بالطلب التمويلي —————

const ASK_VERBS = [
  "نطلب", "طلبنا", "نجمع", "جمعنا", "جمعت", "المطلوب", "بقيمه", "جول",
  "raise", "raising", "seek", "seeking", "ask", "asking", "fundraising",
];

const ASK_NOUNS = [
  "استثمار", "تمويل", "راس المال",
  "funding", "investment", "seed", "pre seed", "series a", "round",
];

// ————— أدوار الفريق (ترفع الفريق إلى adequate على الأقل) —————

const TEAM_ROLES = [
  "رئيس", "مدير", "مهندس", "مطور", "مصمم", "مسؤول", "طبيب", "دكتور",
  "خبير", "مستشار", "عالم",
  "ceo", "cto", "cmo", "cfo", "coo", "chief", "officer", "founder",
  "founders", "cofounder", "cofounders", "co founder", "co founders",
  "engineer", "developer", "designer", "manager", "director", "scientist",
  "advisor", "advisors", "doctor", "phd", "lead", "head",
];

const TEAM_ROLE_STOP = new Set([
  "the", "our", "we", "team", "and", "of", "for", "with", "ceo", "cto",
  "cmo", "cfo", "coo", "founder", "cofounder",
]);

// ————— الحقول المستخرجة الداعمة كمّيًّا لكل معيار —————
// تُقبل فقط بحالة confirmed/pending (اجتازت Citation Guard) وبقيمة رقمية.

const QUANT_FIELDS: Record<string, string[]> = {
  traction: ["company.tractionUsers", "company.monthlyRevenueUSD"],
  business_model: ["company.monthlyRevenueUSD"],
  team: ["company.teamSize"],
};

// ————— تجهيز الشرائح —————

interface SafeSlide {
  index: number;
  title: string;
  rawLines: string[];
  normAll: string; // norm(title + " " + text)
  lineDigits: string[]; // normalizeLetters لكل سطر (لتحليل الأرقام)
}

function buildSafeSlides(slides: Slide[]): SafeSlide[] {
  if (!Array.isArray(slides)) return [];
  const out: SafeSlide[] = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (!s || typeof s !== "object") continue;
    const index =
      typeof s.index === "number" && Number.isFinite(s.index) && s.index >= 1
        ? Math.floor(s.index)
        : i + 1;
    const title = typeof s.title === "string" ? s.title.trim() : "";
    const text = typeof s.text === "string" ? s.text : "";
    let lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (title.length > 0 && (lines.length === 0 || lines[0] !== title)) {
      lines = [title, ...lines];
    }
    out.push({
      index,
      title,
      rawLines: lines,
      normAll: norm(`${title} ${text}`),
      lineDigits: lines.map(normalizeLetters),
    });
  }
  return out;
}

// ————— أدوات القيم —————

function slideNumbers(slide: SafeSlide): NumInfo[] {
  const out: NumInfo[] = [];
  for (const ld of slide.lineDigits) {
    for (const n of scanLineNumbers(ld)) out.push(n);
  }
  return out;
}

function hasQuantity(slide: SafeSlide): NumInfo | null {
  for (const ld of slide.lineDigits) {
    for (const n of scanLineNumbers(ld)) {
      if (!n.isYear) return n; // أي رقم/نسبة غير سنويّة
    }
  }
  return null;
}

function fmtQuant(n: NumInfo): string {
  if (n.isPercent) return `${n.value}%`;
  return String(n.value);
}

function firstKwLine(slide: SafeSlide, kws: string[]): string | null {
  for (const line of slide.rawLines) {
    const nl = norm(line);
    if (kws.some((k) => hasKw(nl, k))) return line;
  }
  return null;
}

function excerptOf(line: string | null, slide: SafeSlide): string {
  const src = line ?? slide.rawLines[0] ?? slide.title ?? "";
  const trimmed = src.trim();
  if (trimmed.length <= 80) return trimmed;
  return `${trimmed.slice(0, 80)}…`;
}

function slidesLabel(slides: number[]): string {
  if (slides.length === 0) return "";
  if (slides.length === 1) return `شريحة ${slides[0]}`;
  if (slides.length === 2) return `شرائح ${slides[0]} و${slides[1]}`;
  return `شرائح ${slides[0]} و${slides[1]} وغيرها`;
}

function fieldQuantDetail(key: string, fields: ExtractedField[]): string | null {
  if (!Array.isArray(fields)) return null;
  const keys = QUANT_FIELDS[key] ?? [];
  if (keys.length === 0) return null;
  for (const f of fields) {
    if (!f || typeof f !== "object") continue;
    if (!keys.includes(String(f.key))) continue;
    if (f.status !== "confirmed" && f.status !== "pending") continue;
    if (typeof f.value === "number" && Number.isFinite(f.value)) {
      const page = typeof f.page === "number" && Number.isFinite(f.page) ? f.page : 0;
      return `${f.key} (شريحة ${page})`;
    }
  }
  return null;
}

function askFieldAmount(fields: ExtractedField[]): { page: number; value: number } | null {
  if (!Array.isArray(fields)) return null;
  for (const f of fields) {
    if (!f || typeof f !== "object") continue;
    if (f.key !== "company.askAmountUSD") continue;
    if (f.status !== "confirmed" && f.status !== "pending") continue;
    if (typeof f.value === "number" && Number.isFinite(f.value) && f.value > 0) {
      return {
        page: typeof f.page === "number" && Number.isFinite(f.page) ? f.page : 0,
        value: f.value,
      };
    }
  }
  return null;
}

// ————— إشارة المبلغ في شريحة (للطلب التمويلي) —————
// مبلغ = رقم مع عملة/مضاعف، أو رقم ≥1000 غير سنويّ، أو «مليون/مليار/ألف»
// حرفيًّا مع عملة (مثل «نطلب مليون دولار» بلا أرقام).

const WORD_AMOUNT_CURRENCY = /(?:^|\s)(?:مليون|مليار|الف|الاف)(?:\s|$)/;
const CURRENCY_MARK = /(?:دولار|usd|\$)/i;

function slideHasAskAmount(slide: SafeSlide): boolean {
  for (const ld of slide.lineDigits) {
    for (const n of scanLineNumbers(ld)) {
      if (n.isCurrency || n.multiplier > 1) return true;
      if (!n.isPercent && !n.isYear && n.value >= 1000) return true;
    }
    if (WORD_AMOUNT_CURRENCY.test(ld) && CURRENCY_MARK.test(ld)) return true;
  }
  return false;
}

// ————— محلل معيار واحد —————

function normalizeKwList(list: string[]): string[] {
  return list.map(norm).filter((k) => k.length > 0);
}

const NORM_KW_CACHE = new Map<string, { primary: string[]; weak: string[] }>();
function kwsFor(key: string): { primary: string[]; weak: string[] } {
  let cached = NORM_KW_CACHE.get(key);
  if (!cached) {
    const raw = KEYWORDS[key] ?? { primary: [], weak: [] };
    cached = {
      primary: normalizeKwList(raw.primary),
      weak: normalizeKwList(raw.weak),
    };
    NORM_KW_CACHE.set(key, cached);
  }
  return cached;
}

const NORM_ASK_VERBS = ASK_VERBS.map(norm);
const NORM_ASK_NOUNS = ASK_NOUNS.map(norm);
const NORM_TEAM_ROLES = TEAM_ROLES.map(norm);

/** اسم إنجليزي محتمل: Title-case ليس بداية الجملة وليس كلمة شائعة. */
function hasEnglishName(slide: SafeSlide): boolean {
  for (const line of slide.rawLines) {
    const toks = line.split(/\s+/).filter(Boolean);
    for (let i = 1; i < toks.length; i++) {
      const t = toks[i].replace(/[^A-Za-z-]/g, "");
      if (t.length >= 3 && /^[A-Z][a-z]+(?:-[A-Z][a-z]+)?$/.test(t)) {
        if (!TEAM_ROLE_STOP.has(t.toLowerCase())) return true;
      }
    }
  }
  return false;
}

function analyzeCriterion(
  spec: { key: string; labelAr: string; labelEn?: string },
  slides: SafeSlide[],
  fields: ExtractedField[]
): CriterionResult {
  const { key, labelAr } = spec;
  const kws = kwsFor(key);
  const relevant = slides.filter((s) => kws.primary.some((k) => hasKw(s.normAll, k)));

  // — المعيار 9: وضوح الطلب التمويلي (قاعدة خاصة) —
  if (key === "ask_clarity") {
    const verbSlides = slides.filter((s) =>
      NORM_ASK_VERBS.some((k) => hasKw(s.normAll, k))
    );
    const amountSlides = verbSlides.filter(slideHasAskAmount);
    const nounLineHit = slides.some((s) =>
      s.lineDigits.some((ld, i) => {
        const nl = norm(s.rawLines[i] ?? "");
        if (!NORM_ASK_NOUNS.some((k) => hasKw(nl, k))) return false;
        return scanLineNumbers(ld).some(
          (n) => !n.isPercent && !n.isYear && (n.isCurrency || n.multiplier > 1)
        );
      })
    );
    const fieldAsk = askFieldAmount(fields);
    if (amountSlides.length > 0 || nounLineHit || fieldAsk) {
      const slidesUsed = [
        ...amountSlides.map((s) => s.index),
        ...(fieldAsk && fieldAsk.page > 0 ? [fieldAsk.page] : []),
      ];
      const rep = amountSlides[0] ?? null;
      const line = rep ? firstKwLine(rep, NORM_ASK_VERBS) : null;
      const excerptSrc = rep ? excerptOf(line, rep) : "";
      const amount =
        fieldAsk && fieldAsk.value > 0 ? String(fieldAsk.value) : "مبلغ مذكور";
      const fieldNote = fieldAsk ? ` + الحقل المستخرج company.askAmountUSD (شريحة ${fieldAsk.page})` : "";
      const evidence = rep
        ? `${slidesLabel(amountSlides.map((s) => s.index))}: «${excerptSrc}» — كلمات الطلب مع مبلغ واضح (${amount})${fieldNote}.`
        : `ورد الطلب التمويلي في نص الشرائح مع مبلغ${fieldAsk ? ` (الحقل المستخرج company.askAmountUSD بشريحة ${fieldAsk.page})` : ""}.`;
      return { key, labelAr, level: "strong", evidenceAr: evidence, slides: slidesUsed };
    }
    // لا مبلغ → missing حتى لو وردت كلمات الطلب (قاعدة الوضوح)
    const anyAskKw = slides.some((s) =>
      [...NORM_ASK_VERBS, ...NORM_ASK_NOUNS].some((k) => hasKw(s.normAll, k))
    );
    const evidence = anyAskKw
      ? `وردت كلمات مرتبطة بالطلب التمويلي في الشرائح لكن دون أي مبلغ محدد — لا وضوح للطلب بلا مبلغ.`
      : `لا إشارة نصية لطلب تمويلي (لا كلمات الطلب ولا مبلغ) في نص الشرائح.`;
    return { key, labelAr, level: "missing", evidenceAr: evidence, slides: [] };
  }

  if (relevant.length === 0) {
    const weakSlides = kws.weak.length
      ? slides.filter((s) => kws.weak.some((k) => hasKw(s.normAll, k)))
      : [];
    if (weakSlides.length > 0) {
      const rep = weakSlides[0];
      const line = firstKwLine(rep, kws.weak);
      return {
        key,
        labelAr,
        level: "weak",
        evidenceAr: `${slidesLabel(weakSlides.map((s) => s.index))}: «${excerptOf(line, rep)}» — إشارة عابرة فقط (كلمة عامة بسياق غير متخصص).`,
        slides: weakSlides.map((s) => s.index),
      };
    }
    return {
      key,
      labelAr,
      level: "missing",
      evidenceAr: "لا إشارة نصية لهذا المعيار في أي شريحة (محلل كلمات مفتاحية عربية/إنجليزية).",
      slides: [],
    };
  }

  // — المعيار 7: الفريق (قاعدة خاصة: أدوار/أسماء → adequate على الأقل) —
  if (key === "team") {
    const rolesOrNames =
      relevant.some((s) => NORM_TEAM_ROLES.some((k) => hasKw(s.normAll, k))) ||
      relevant.some((s) => hasEnglishName(s));
    const quant = relevant.find(hasQuantity) ?? null;
    const fieldDetail = fieldQuantDetail(key, fields);
    if (quant || fieldDetail) {
      const rep = quant ?? relevant[0];
      const line = firstKwLine(rep, kws.primary);
      const quantInfo = quant ? hasQuantity(quant) : null;
      const quantText = quantInfo
        ? fmtQuant(quantInfo)
        : `حقل مستخرج: ${fieldDetail}`;
      return {
        key,
        labelAr,
        level: "strong",
        evidenceAr: `${slidesLabel(relevant.map((s) => s.index))}: «${excerptOf(line, rep)}» — كلمات الفريق مع عنصر كمّي (${quantText}).`,
        slides: relevant.map((s) => s.index),
      };
    }
    if (rolesOrNames) {
      const rep = relevant[0];
      const line = firstKwLine(rep, kws.primary);
      return {
        key,
        labelAr,
        level: "adequate",
        evidenceAr: `${slidesLabel(relevant.map((s) => s.index))}: «${excerptOf(line, rep)}» — كلمات الفريق مع أدوار/أسماء، بلا عنصر كمّي.`,
        slides: relevant.map((s) => s.index),
      };
    }
    const rep = relevant[0];
    const line = firstKwLine(rep, kws.primary);
    return {
      key,
      labelAr,
      level: "weak",
      evidenceAr: `${slidesLabel(relevant.map((s) => s.index))}: «${excerptOf(line, rep)}» — ذِكر الفريق بلا أدوار أو أسماء أو أرقام (إشارة عابرة).`,
      slides: relevant.map((s) => s.index),
    };
  }

  // — القاعدة العامة: كلمات + كمّ → strong؛ كلمات بلا كمّ → adequate —
  const quantSlide = relevant.find((s) => hasQuantity(s) !== null);
  const fieldDetail = fieldQuantDetail(key, fields);
  const rep = quantSlide ?? relevant[0];
  const line = firstKwLine(rep, kws.primary);
  if (quantSlide || fieldDetail) {
    const q = quantSlide ? hasQuantity(quantSlide) : null;
    const quantText = q
      ? fmtQuant(q)
      : `حقل مستخرج: ${fieldDetail}`;
    return {
      key,
      labelAr,
      level: "strong",
      evidenceAr: `${slidesLabel(relevant.map((s) => s.index))}: «${excerptOf(line, rep)}» — كلمات المعيار مع عنصر كمّي (${quantText}).`,
      slides: relevant.map((s) => s.index),
    };
  }
  return {
    key,
    labelAr,
    level: "adequate",
    evidenceAr: `${slidesLabel(relevant.map((s) => s.index))}: «${excerptOf(line, rep)}» — كلمات المعيار موجودة بلا عنصر كمّي.`,
    slides: relevant.map((s) => s.index),
  };
}

// ————— الملخص العام —————

function buildOverallSummary(criteria: CriterionResult[]): string {
  if (criteria.length === 0) return "لا معايير لتلخيصها.";
  const strong = criteria.filter((c) => c.level === "strong");
  const missing = criteria.filter((c) => c.level === "missing");
  const weak = criteria.filter((c) => c.level === "weak");
  const adequate = criteria.filter((c) => c.level === "adequate");
  if (missing.length === criteria.length) {
    return "نص العرض لا يغطي أيًّا من المعايير التسعة — تحقق أولًا من نجاح استخراج نص الشرائح.";
  }
  const strongLabels = strong.slice(0, 3).map((c) => c.labelAr);
  const strongPart = strong.length === 0
      ? "لا يوجد معيار بمستوى قوي"
      : strongLabels.join("، ") + (strong.length > 3 ? ` (+${strong.length - 3} أخرى)` : "");
  const weakItems: string[] = [
    ...missing.map((c) => `${c.labelAr} (غائب)`),
    ...weak.map((c) => `${c.labelAr} (ضعيف)`),
    ...adequate.map((c) => `${c.labelAr} (بلا عنصر كمّي)`),
  ].slice(0, 3);
  const weakPart = weakItems.length > 0 ? weakItems.join("، ") : "لا معايير غائبة أو ضعيفة";
  return `أقوى ما في العرض: ${strongPart}؛ أضعفه: ${weakPart}.`;
}

function evidenceSummaryEn(result: CriterionResult): string {
  const pages = result.slides.length ? `Relevant slide(s): ${result.slides.join(", ")}. ` : "";
  const levelText: Record<ReadinessLevel, string> = {
    strong: "Relevant keywords and at least one quantitative signal were detected.",
    adequate: "Relevant keywords were detected, but quantitative evidence was limited.",
    weak: "Only a partial or incidental reference was detected.",
    missing: "No relevant evidence was detected in the extracted slide text.",
  };
  const askSuffix = result.key === "ask_clarity" && result.level === "missing"
    ? " A specific funding amount is needed to make the ask clear."
    : "";
  return `${pages}${levelText[result.level]}${askSuffix}`;
}

function buildOverallSummaryEn(criteria: CriterionResult[]): string {
  if (!criteria.length) return "There are no criteria to summarize.";
  const strong = criteria.filter((c) => c.level === "strong");
  const missing = criteria.filter((c) => c.level === "missing");
  const weak = criteria.filter((c) => c.level === "weak");
  const adequate = criteria.filter((c) => c.level === "adequate");
  if (missing.length === criteria.length) {
    return "No criteria were detected in the extracted slide text. First check whether text extraction succeeded; image-only slides are not evaluated as text.";
  }
  const strongLabels = strong.slice(0, 3).map((c) => c.labelEn ?? c.key);
  const strongPart = strong.length === 0
    ? "No criterion currently has strong evidence"
    : `${strongLabels.join(", ")}${strong.length > 3 ? ` (+${strong.length - 3} more)` : ""}`;
  const gaps = [
    ...missing.map((c) => `${c.labelEn ?? c.key} (missing)`),
    ...weak.map((c) => `${c.labelEn ?? c.key} (weak)`),
    ...adequate.map((c) => `${c.labelEn ?? c.key} (limited quantitative evidence)`),
  ].slice(0, 3);
  return `Strongest areas: ${strongPart}. First improvement priorities: ${gaps.length ? gaps.join(", ") : "no missing or weak criteria were detected"}.`;
}

// ————— النقطة العامة —————

/**
 * تقييم جاهزية العرض على المعايير التسعة. حتمي، لا يرمي استثناءً أبدًا.
 * slides فارغة/فاسدة → كل المعايير missing.
 */
export function evaluateReadiness(slides: Slide[], fields: ExtractedField[]): ReadinessReport {
  const safeSlides = buildSafeSlides(slides);
  const safeFields = Array.isArray(fields) ? fields : [];
  const criteria: CriterionResult[] = CRITERIA.map((spec) => {
    const result = analyzeCriterion(spec, safeSlides, safeFields);
    const bilingual = { ...result, labelEn: spec.labelEn, evidenceEn: evidenceSummaryEn(result) };
    return bilingual;
  });
  return {
    criteria,
    generatedAt: new Date().toISOString(),
    overallSummaryAr: buildOverallSummary(criteria),
    overallSummaryEn: buildOverallSummaryEn(criteria),
  };
}

