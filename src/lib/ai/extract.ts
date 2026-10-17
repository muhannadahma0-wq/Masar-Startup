/**
 * Masar — خط استخراج حقول الملف من عرض تقديمي (T6)
 * =====================================================
 * المسار:
 *   (1) تجهيز الحمولة: شرائح مرقّمة (index/title/text) بعد redactPii (حراس T5).
 *   (2) runLlm (GLM أو مسار الطوارئ mock-replay).
 *   (3) GLM: تحويل مخرج JSON بمخطط Zod داخلي ثم Citation Guard على كل حقل.
 *       mock-replay: محلل نصي regex حتمي بلا شبكة — القيم من نص الشرائح نفسها
 *       بمقتطفات حرفية، ثم يمرّ بنفس Citation Guard/الدمج (سلوك موحّد).
 *   (4) الحقل الفاشل حارسًا يُعلَّم dropped مع droppedReason عربي وتُصفَّر قيمته null،
 *       والحقول بنفس key تُدمج (أول واحدة تمرّ).
 *
 * المبدأ الحاكم: الفرصة الوحيدة لظهور حقل بقيمة في النتيجة هي صفحة صحيحة
 * واقتباس موجود حرفيًّا في الشريحة — لا تخمين أبدًا (null بدل التخمين).
 *
 * خادم فقط — لا يُستورد في مكونات عميلة.
 */
import { z } from "zod";
import { runLlm, loadGuards, normalizeDigits } from "./adapter";
import { extractionSystemPrompt, extractionUserPayload, buildExtractionRequestInput } from "./prompts";
import {
  COUNTRY_KEYS,
  DOC_TYPE_KEYS,
  LEGAL_STATUS_VALUES,
  PROFILE_FIELD_KEYS,
  REGION_VALUES,
  SECTOR_KEYS,
  STAGE_KEYS,
  type ExtractedField,
  type LlmRequest,
  type Slide,
} from "@/lib/core/types";

// ————— الحزمة الاختيارية (meta) لربط AiRun بنسخة العرض/المستخدم —————
export type ExtractionMeta = { deckVersionId?: string; userId?: string };

// ————————————————————————————————————————————————
// T6/§5: extractDeckFields — التوقيع الملزم (meta اختيارية لا تكسر العقد)
// ————————————————————————————————————————————————

export async function extractDeckFields(
  slides: Slide[],
  profileHints: string[],
  meta: ExtractionMeta = {}
): Promise<{ fields: ExtractedField[]; provider: string; model: string }> {
  if (!Array.isArray(slides) || slides.length === 0) {
    return { fields: [], provider: "none", model: "none" };
  }
  const guards = await loadGuards();

  // (1) تجهيز الحمولة: إخفاء PII قبل أي استدعاء نموذج + كشف حقن محتمل (تبليغ فقط؛ النص بيانات)
  const payloadSlides = buildExtractionRequestInput(slides).map((s) => {
    const r = guards.redactPii(`${s.title}\n${s.text}`);
    return { ...s, text: r.redacted };
  });
  const injection = guards.detectPromptInjection(slides.map((s) => `${s.title} ${s.text}`).join("\n"));
  if (injection.suspicious) {
    console.warn(`[ai] أنماط حقن محتملة في نص العرض (${injection.patterns.length}) — النص يُعامل بيانات فقط ولا يُنفَّذ`);
  }

  const req: LlmRequest = {
    purpose: "EXTRACTION",
    systemPrompt: extractionSystemPrompt(profileHints ?? []),
    userPayload: extractionUserPayload(payloadSlides),
    maxTokens: 4096,
  };
  const res = await runLlm(req, meta);

  // (2) مسار الطوارئ: محلل regex حتمي — القيم من النص نفسه باقتباسات حرفية
  if (res.usedFallback) {
    const fields = await applyGuarded(slides, mockExtractRawFields(slides));
    return { fields, provider: res.provider, model: res.model };
  }

  // (3) مسار GLM: تحليل JSON ثم Zod ثم الحارس
  const raw = parseJsonLoose(res.text);
  const rawItems: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { fields?: unknown[] }).fields)
      ? ((raw as { fields: unknown[] }).fields)
      : [];
  const parsed = rawItems
    .map((it) => LlmExtractedItem.safeParse(it))
    .filter((r) => r.success)
    .map((r) => r.data);

  const fields = await applyGuarded(slides, parsed);
  return { fields, provider: res.provider, model: res.model };
}

// ————— مخطط Zod داخلي لمخرج النموذج: { key, value, page, quote, confidence? } —————
const LlmExtractedItem = z.object({
  key: z.string().min(1).max(64),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number(), z.boolean()]))])
    .optional()
    .transform((v) => v ?? null),
  page: z.coerce.number().int(),
  quote: z.string().min(1).max(600),
  confidence: z.coerce.number().min(0).max(1).optional(),
});

export interface RawField {
  key: string;
  value: unknown;
  page: number;
  quote: string;
  confidence?: number;
}

// ————————————————————————————————————————————————
// تطبيق Citation Guard + الدمج (أول واحدة تمرّ لكل key)
// ————————————————————————————————————————————————

const DROP_QUOTE_REASON = "الاقتباس غير موجود في الشريحة";
const NUMERIC_KEYS = new Set([
  "company.ageMonths",
  "company.teamSize",
  "company.monthlyRevenueUSD",
  "company.tractionUsers",
  "company.askAmountUSD",
]);
const BOOLEAN_KEYS = new Set(["company.womenLed", "founder.hasBankAccount"]);
const ENUM_KEYS: Record<string, readonly string[]> = {
  "company.stage": STAGE_KEYS,
  "company.legalStatus": LEGAL_STATUS_VALUES,
  "company.registrationCountry": [...COUNTRY_KEYS, "none"],
  "company.askType": ["equity", "non_equity", "any"],
  "founder.region": REGION_VALUES,
  "founder.nationality": [...COUNTRY_KEYS, "none"],
};
const ARRAY_ENUM_KEYS: Record<string, readonly string[]> = {
  "company.sectors": SECTOR_KEYS,
  "company.languages": ["ar", "en"],
  "company.requiredDocs": DOC_TYPE_KEYS,
  "founder.paymentMethods": ["bank_transfer", "paypal", "wise", "other"],
};

/** أي مفتاح مسموح: من PROFILE_FIELD_KEYS أو امتداد ادعاء claim.* (يستعمله المحلل الحتمي) */
function isAllowedKey(key: string): boolean {
  return (PROFILE_FIELD_KEYS as readonly string[]).includes(key) || key.startsWith("claim.");
}

/** تحويل القيمة إلى نوع الحقل المتوقع؛ null = لا يمكن قبولها */
function coerceValue(key: string, value: unknown): { ok: boolean; value: unknown } {
  if (value === null || value === undefined) return { ok: false, value: null };
  if (key === "company.name") {
    const s = typeof value === "string" ? value.trim() : "";
    return s.length >= 2 ? { ok: true, value: s.slice(0, 200) } : { ok: false, value: null };
  }
  if (NUMERIC_KEYS.has(key) || key.startsWith("claim.")) {
    if (typeof value === "number" && isFinite(value)) return { ok: true, value: value };
    if (typeof value === "string") {
      const n = parseFloat(normalizeDigits(value).replace(/[^\d.]/g, ""));
      return isFinite(n) ? { ok: true, value: n } : { ok: false, value: null };
    }
    return { ok: false, value: null };
  }
  if (BOOLEAN_KEYS.has(key)) {
    if (typeof value === "boolean") return { ok: true, value };
    if (typeof value === "string") {
      const v = normalizeDigits(value).trim().toLowerCase();
      if (["true", "نعم", "yes", "صحيح", "مؤسسة تقودها امرأة"].includes(v)) return { ok: true, value: true };
      if (["false", "لا", "no", "غير"].includes(v)) return { ok: true, value: false };
    }
    return { ok: false, value: null };
  }
  if (key in ENUM_KEYS) {
    const enumValues = ENUM_KEYS[key];
    const s = typeof value === "string" ? normalizeDigits(value).trim().toLowerCase() : "";
    return enumValues.includes(s) ? { ok: true, value: s } : { ok: false, value: null };
  }
  if (key in ARRAY_ENUM_KEYS) {
    const enumValues = ARRAY_ENUM_KEYS[key];
    const arr = Array.isArray(value) ? value.map((v) => String(v).trim().toLowerCase()) : [String(value).trim().toLowerCase()];
    const cleaned = [...new Set(arr.filter((v) => enumValues.includes(v)))];
    return cleaned.length > 0 ? { ok: true, value: cleaned } : { ok: false, value: null };
  }
  // مفاتيح claim.* النصية أو أي امتداد آخر: تقبل نصًّا/رقمًا كما هو
  if (typeof value === "string" || typeof value === "number") return { ok: true, value };
  return { ok: false, value: null };
}

function clampConfidence(c: unknown): number {
  const n = typeof c === "number" && isFinite(c) ? c : 0.6;
  return Math.max(0, Math.min(1, n));
}

async function applyGuarded(slides: Slide[], raw: RawField[]): Promise<ExtractedField[]> {
  const guards = await loadGuards();
  const passing = new Map<string, ExtractedField>();
  const dropped = new Map<string, ExtractedField>();

  for (const item of raw) {
    // 1) مفتاح مسموح؟
    if (!isAllowedKey(item.key)) {
      if (!dropped.has(item.key)) {
        dropped.set(item.key, {
          key: item.key, value: null, page: item.page, quote: item.quote,
          confidence: clampConfidence(item.confidence), status: "dropped",
          droppedReason: "مفتاح غير ضمن القائمة المسموحة لحقول الملف",
        });
      }
      continue;
    }
    // 2) نوع القيمة؟
    const coerced = coerceValue(item.key, item.value);
    if (!coerced.ok) {
      if (!dropped.has(item.key)) {
        dropped.set(item.key, {
          key: item.key, value: null, page: item.page, quote: item.quote,
          confidence: clampConfidence(item.confidence), status: "dropped",
          droppedReason: "قيمة لا تطابق نوع الحقل المتوقع",
        });
      }
      continue;
    }
    // 3) Citation Guard: صفحة + اقتباس حرفي
    const check = guards.citationCheck(slides, item.page, item.quote);
    if (check.passed) {
      if (!passing.has(item.key)) {
        passing.set(item.key, {
          key: item.key, value: coerced.value, page: item.page, quote: item.quote,
          confidence: clampConfidence(item.confidence), status: "pending",
        });
      }
      // حقل مكرر مارّ — أول واحدة تمرّ تفوز ويُتجاهل الباقي
      continue;
    }
    if (!dropped.has(item.key)) {
      dropped.set(item.key, {
        key: item.key, value: null, page: item.page, quote: item.quote,
        confidence: clampConfidence(item.confidence), status: "dropped",
        droppedReason: DROP_QUOTE_REASON,
      });
    }
  }

  const out: ExtractedField[] = [];
  for (const f of passing.values()) out.push(f);
  // المفاتيح بلا نسخة مارّة تظهر مسقطة (value=null) لتفسير السقوط للمؤسس
  for (const f of dropped.values()) if (!passing.has(f.key)) out.push(f);
  out.sort((a, b) => a.page - b.page || a.key.localeCompare(b.key));
  return out;
}

/** نسخة عامة (تُستعمل في الفحص الذاتي ويمكن أن يستفيد منها T12) */
export const applyCitationGuardAndMerge = applyGuarded;

// ————————————————————————————————————————————————
// تحليل JSON مرن (يتعامل مع أسوار Markdown وحالات الالتفاف)
// ————————————————————————————————————————————————

export function parseJsonLoose(text: string): unknown {
  const cleaned = (text ?? "").replace(/```(?:json)?/gi, "").trim();
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned);
  } catch {
    /* متابعة بالاقتطاع */
  }
  for (const [open, close] of [
    ["[", "]"],
    ["{", "}"],
  ] as const) {
    const i = cleaned.indexOf(open);
    const j = cleaned.lastIndexOf(close);
    if (i !== -1 && j > i) {
      try {
        return JSON.parse(cleaned.slice(i, j + 1));
      } catch {
        /* تجربة المحدّد الآخر */
      }
    }
  }
  return null;
}

// ————————————————————————————————————————————————
// أدوات نصية حتمية مشتركة (تستعملها مسارات الطوارئ في extract/suggest/draft)
// ————————————————————————————————————————————————

export interface SentenceSpan {
  /** نص الجملة (مقتطف حرفي متصل من الأصل، منزوع الفراغات الطرفية) */
  text: string;
  start: number;
  end: number;
}

/** تقسيم إلى جمل مع إرجاع مقاطع حرفية من النص الأصلي (تصلح اقتباساتٍ حكيمة) */
export function splitSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const re = /[^.!؟?؛;\n]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    if (!raw.trim()) continue;
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    const start = m.index + lead;
    let end = m.index + raw.length - (trail || 0);
    if (end < start) end = start;
    // ضمّ علامة النهاية إن وُجدت (تبقى حرفية)
    if (end < text.length && /[.!؟?؛;]/.test(text[end])) end += 1;
    spans.push({ text: text.slice(start, end), start, end });
  }
  return spans;
}

// ————— المبالغ المالية —————

export interface MoneyMention {
  amount: number;
  raw: string;
  index: number;
}

const MULTIPLIER: Record<string, number> = {
  k: 1e3, m: 1e6, b: 1e9,
  "ألف": 1e3, "آلاف": 1e3, "الف": 1e3,
  "مليون": 1e6, "مليار": 1e9,
};

/**
 * نمط واحد: يُشترط دلالة مالية صريحة — بادئة $/usd، أو مضاعف (k/m/b/ألف/مليون/مليار)،
 * أو لاحقة دولار/dollars. الأرقام المجردة (40%، 2026، أعداد المستخدمين بلا عملة) ليست مبالغ.
 */
const MONEY_RE =
  /(?:\$|usd)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|b)?|\b\d[\d,]*(?:\.\d+)?\s?(?:k|m|b|ألف|آلاف|الف|مليون|مليار)(?![\p{L}\p{N}])|\b\d[\d,]*(?:\.\d+)?\s?(?:دولار|دولارات|dollars?)/giu;

function moneyValueFrom(raw: string): number | null {
  const r = normalizeDigits(raw).toLowerCase();
  const num = r.match(/(\d[\d,]*(?:\.\d+)?)/);
  if (!num) return null;
  const n = parseFloat(num[1].replace(/,/g, ""));
  if (!isFinite(n)) return null;
  // مضاعفات عربية صريحة
  if (/مليار/.test(r)) return n * 1e9;
  if (/مليون/.test(r)) return n * 1e6;
  if (/ألف|آلاف|الف/.test(r)) return n * 1e3;
  // مضاعف لاتيني: حرف واحد يلي الرقم مباشرة ولا يتبعه حرف/رقم (كي لا يلتبس بـ b2b أو كلمات)
  const mult = /\d\s?([kmb])(?![a-z0-9\u0600-\u06FF])/.exec(r);
  if (mult) {
    const c = mult[1].toLowerCase();
    if (c === "k") return n * 1e3;
    if (c === "m") return n * 1e6;
    if (c === "b") return n * 1e9;
  }
  return n;
}

/** استخراج كل المبالغ المذكورة في نص (يتعامل مع الأرقام الهندية تلقائيًّا) */
export function parseMoneyMentions(text: string): MoneyMention[] {
  const out: MoneyMention[] = [];
  const re = new RegExp(MONEY_RE.source, "giu");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const amount = moneyValueFrom(m[0]);
    if (amount !== null && isFinite(amount)) out.push({ amount, raw: m[0], index: m.index });
  }
  return out;
}

// ————— سياق التصنيف: طلب تمويل أم إيراد —————

const REVENUE_WORDS = /(إيراد|ايراد|إيرادات|ايرادات|مبيعات|دخل|\brevenue\b|\bsales\b|\bmrr\b|\barr\b)/i;
const ASK_WORDS =
  /(طلب|نسعى|نجمع|جمع|نطلب|نسعى لجمع|raise|raising|seek|seeking|\bask\b|funding|تمويل|جولة|round|seed|استثمار|invest|منحة|grant|إعانة|قيمة المنحة|بقيمة)/i;

export function classifyMoneyContext(sentence: string): "company.askAmountUSD" | "company.monthlyRevenueUSD" {
  const norm = normalizeDigits(sentence);
  const r = REVENUE_WORDS.exec(norm);
  const a = ASK_WORDS.exec(norm);
  if (r && a) return r.index < a.index ? "company.monthlyRevenueUSD" : "company.askAmountUSD";
  if (r) return "company.monthlyRevenueUSD";
  return "company.askAmountUSD"; // الافتراض: مبالغ العروض تُقرأ طلب تمويل
}

// ————— أعداد المستخدمين —————

const USERS_BEFORE_RE =
  /\b(\d[\d,]*(?:\.\d+)?)\s*(k|m|b|ألف|آلاف|مليون)?(?:\s+[\p{L}]{1,15}){0,2}\s+(?:users?|user|مستخدم|مشترك|عملاء|customers?)/iu;
const USERS_AFTER_RE = /(?:users?|مستخدم|مشترك|عدد\s+المستخدمين)\s*[:=]?\s*(\d[\d,]*(?:\.\d+)?)/i;

export function parseUsersCount(sentence: string): number | null {
  const norm = normalizeDigits(sentence);
  const before = USERS_BEFORE_RE.exec(norm);
  if (before) {
    const n = parseFloat(before[1].replace(/,/g, ""));
    if (isFinite(n)) return n * (before[2] ? MULTIPLIER[before[2].toLowerCase()] ?? 1 : 1);
  }
  const after = USERS_AFTER_RE.exec(norm);
  if (after) {
    const n = parseFloat(after[1].replace(/,/g, ""));
    if (isFinite(n)) return n;
  }
  return null;
}

// ————— الفريق —————

const TEAM_BEFORE_RE = /(\d[\d,]*)\s*(?:مؤسسين?|مؤسس|founders?|موظفين?|موظف|employees?|مهندسين?|engineers?|أشخاص|people|members?|أعضاء)/i;
const TEAM_AFTER_RE = /(?:فريق(?:نا)?(?:\s+(?:عمل|التأسيس))?(?:\s+(?:يتكون|يضم|مكون|من))?\s*|team(?:\s+of)?\s+|بفريق\s+)(?:من\s*)?(\d[\d,]*)/i;

export function parseTeamCount(sentence: string): number | null {
  const norm = normalizeDigits(sentence);
  const after = TEAM_AFTER_RE.exec(norm);
  if (after) {
    const n = parseInt(after[1].replace(/,/g, ""), 10);
    if (isFinite(n)) return n;
  }
  const before = TEAM_BEFORE_RE.exec(norm);
  if (before) {
    const n = parseInt(before[1].replace(/,/g, ""), 10);
    if (isFinite(n)) return n;
  }
  return null;
}

// ————— نسب النمو —————

const GROWTH_CONTEXT = /(نمو|نموا|نموًّا|نمواً|grew|growth|grow\b|increase|زيادة|ارتفاع|ازدياد)/i;

export function parseGrowthPercent(sentence: string): number | null {
  const norm = normalizeDigits(sentence);
  if (!GROWTH_CONTEXT.test(norm)) return null;
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(norm);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return isFinite(n) ? n : null;
}

// ————— المرحلة —————

const STAGE_PATTERNS: Array<{ stage: (typeof STAGE_KEYS)[number]; re: RegExp }> = [
  { stage: "scaling", re: /\bscaling\b|توسع|تتوسع|توسّع/i },
  { stage: "early_revenue", re: /\brevenue\b|\bsales\b|\bmrr\b|\barr\b|إيراد|ايراد|إيرادات|ايرادات|مبيعات/i },
  { stage: "prototype", re: /\bprototype\b|\bmvp\b|نموذج أولي|نموذج تجريبي/i },
  { stage: "idea", re: /\bidea\b|فكرة/i },
];

// ————— القطاعات (مفاتيح حرفية من SECTOR_KEYS) —————

function sectorKeyRegex(key: string): RegExp {
  return new RegExp(`\\b${key}\\b`, "i");
}

// ————————————————————————————————————————————————
// مسار الطوارئ: محلل regex حتمي (بلا شبكة) — القيم من نص الشرائح نفسها
// كل قيمة بquote حرفي (الجملة الحاوية) وpage صحيح → تمرّ الحارس بالضرورة.
// ————————————————————————————————————————————————

export function mockExtractRawFields(slides: Slide[]): RawField[] {
  const out: RawField[] = [];
  const seen = new Set<string>();
  const put = (key: string, value: unknown, page: number, quote: string, confidence = 0.75) => {
    if (seen.has(key) || !quote) return;
    seen.add(key);
    out.push({ key, value, page, quote, confidence });
  };

  // القطاعات: اتحاد كل المفاتيح الحرفية المذكورة عبر الشرائح (الاقتباس من أول جملة حاوية)
  const sectorSet = new Set<string>();
  let sectorQuote = "";
  let sectorPage = 0;
  for (const slide of slides) {
    const normSlide = normalizeDigits(slide.text);
    for (const k of SECTOR_KEYS) {
      if (sectorKeyRegex(k).test(normSlide)) {
        sectorSet.add(k);
        if (!sectorQuote) {
          const sent = splitSentences(slide.text).find((sp) => sectorKeyRegex(k).test(normalizeDigits(sp.text)));
          if (sent) {
            sectorQuote = sent.text;
            sectorPage = slide.index;
          }
        }
      }
    }
  }
  if (sectorSet.size > 0 && sectorQuote) {
    put("company.sectors", [...sectorSet].sort(), sectorPage, sectorQuote, 0.7);
  }

  for (const slide of slides) {
    // المرحلة: أول شريحة تذكر كلمة مرحلة (بالأسبقية scaling > early_revenue > prototype > idea)
    for (const { stage, re } of STAGE_PATTERNS) {
      const normSlide = normalizeDigits(slide.text);
      if (re.test(normSlide)) {
        const sent = splitSentences(slide.text).find((sp) => re.test(normalizeDigits(sp.text)));
        if (sent) put("company.stage", stage, slide.index, sent.text, 0.65);
        break;
      }
    }
    // أنماط على مستوى الجملة
    for (const sent of splitSentences(slide.text)) {
      const normSent = normalizeDigits(sent.text);

      // مبالغ مالية (تُصنّف طلب تمويل أو إيرادًا حسب سياق الجملة)
      const money = parseMoneyMentions(sent.text);
      if (money.length > 0) {
        const key = classifyMoneyContext(normSent);
        put(key, money[0].amount, slide.index, sent.text, 0.8);
      }

      // نسب نمو
      const growth = parseGrowthPercent(normSent);
      if (growth !== null) put("claim.growth", growth, slide.index, sent.text, 0.7);

      // أعداد مستخدمين
      const users = parseUsersCount(normSent);
      if (users !== null) put("company.tractionUsers", users, slide.index, sent.text, 0.75);

      // الفريق
      const team = parseTeamCount(normSent);
      if (team !== null) put("company.teamSize", team, slide.index, sent.text, 0.7);
    }
  }
  return out;
}
