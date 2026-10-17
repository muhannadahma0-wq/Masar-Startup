/**
 * Masar — T8: استخراج الادعاءات الرقمية وكشف التعارض الداخلي (حتمي بلا نموذج لغوي)
 * ---------------------------------------------------------------------------
 * extractClaims(slides) → ClaimItem[]: الأرقام ذات السياق (إيرادات/نمو/سوق/مستخدمون/طلب تمويل).
 * detectContradictions(claims) → تناقضات حتمية: قيمتان مختلفتان لنوع واحد بفارق نسبي >20%،
 * ترتيب TAM/SAM/SOM غير منطقي، نمو مئوي >1000% موسوم «استثنائي».
 *
 * مبادئ: حتمية كاملة، لا استثناءً (مدخلات آمنة)، الاستدلال من النص فقط — لا تخمين.
 * تحويل الوحدات: ألف/مليون/مليار/k/M/B + أرقام هندية/فارسية.
 */
import type { ClaimItem, Slide } from "@/lib/core/types";

// ————— تطبيع وتحويل أرقام —————

const AR_DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g;
const EASTERN_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

function normalizeClaimText(s: string): string {
  if (typeof s !== "string") return "";
  let out = s.replace(AR_DIACRITICS, "");
  out = out.replace(EASTERN_DIGITS, (ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    const base = cp <= 0x0669 ? 0x0660 : 0x06f0;
    return String(cp - base);
  });
  return out;
}

const UNIT_MAP: Record<string, number> = {
  "مليون": 1_000_000,
  "مليونا": 1_000_000,
  "مليار": 1_000_000_000,
  "مليارا": 1_000_000_000,
  "الف": 1_000,
  "ألف": 1_000,
  M: 1_000_000,
  B: 1_000_000_000,
  K: 1_000,
};

function parseNumberToken(token: string): number | null {
  const cleaned = token.replace(/[,،\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

interface ScannedNumber {
  value: number;
  isPercent: boolean;
  isCurrency: boolean;
  isYear: boolean;
  start: number;
  end: number;
  nextWord: string;
}

function scanNumbers(line: string): ScannedNumber[] {
  const out: ScannedNumber[] = [];
  const re = /([$]?)\s*(\d[\d,،\.]*)\s*(٪|%|مليون|مليونًا|مليار|مليارًا|ألف|M|B|K)?/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const base = parseNumberToken(m[2]);
    if (base === null) continue;
    const unit = (m[3] ?? "").trim();
    const percent = unit === "٪" || unit === "%";
    const currency = m[1] === "$" || /\$/.test(line.slice(Math.max(0, m.index - 1), m.index + 1));
    const mult = UNIT_MAP[unit] ?? 1;
    const value = base * mult;
    const isYear = !percent && base >= 1900 && base <= 2100 && mult === 1 && !currency;
    out.push({ value, isPercent: percent, isCurrency: currency, isYear, start: m.index, end: m.index + m[0].length, nextWord: nextWordAfter(line, m.index + m[0].length) });
  }
  return out;
}

// الكلمة الحرفية التالية بعد الرقم — لكشف وحدات صارفة (دونمات/شهور/...) لا تصف مستخدمين
const DISTRACTOR_UNITS = /دونم|كم2|كيلو|طن|شهر|شهرا|سنوات|سنة|يوم|ساعة|دولار|دينار|شيكل|متر|هكتار|فدان/i;

function nextWordAfter(line: string, from: number): string {
  const tail = line.slice(from, from + 14);
  const m = /[\p{L}]{2,}/u.exec(tail);
  return m ? m[0] : "";
}

// ————— مطابقة السياق لكل نوع ادعاء —————

const CONTEXT_RULES: Array<{
  type: ClaimItem["type"];
  kws: RegExp;
  requirePercent?: boolean;
  requireCurrency?: boolean;
  label?: (line: string) => string | undefined;
}> = [
  {
    type: "market_size",
    kws: /\b(TAM|SAM|SOM|market size|total addressable)\b|حجم السوق|السوق الكلي|السوق المتاح|السوق المستهدف|سوق يقارب|حجمه/i,
    label: (line) => {
      const m = /\b(TAM|SAM|SOM)\b/i.exec(line);
      return m ? m[1].toUpperCase() : undefined;
    },
  },
  {
    type: "revenue",
    kws: /\brevenues?\b|\bsales\b|\bMRR\b|\bARR\b|إيرادات|إيراد|مبيعات|دخل/i,
  },
  {
    type: "growth",
    kws: /\bgrowth\b|\bgrew\b|\bincrease[d]?\b|نمو|نمت|زيادة|ارتفاع/i,
    requirePercent: true,
  },
  {
    type: "users",
    kws: /\busers?\b|\bsubscribers?\b|\bcustomers?\b|\bfarmers\b|\bclients?\b|(?<![\p{L}])مستخدم|(?<![\p{L}])مشترك|(?<![\p{L}])عميل|(?<![\p{L}])عملاء|(?<![\p{L}])مستخدمين/u,
  },
  {
    type: "funding_ask",
    kws: /\braising\b|\bseek(ing)?\b|\bask(ing)? for\b|\bround of\b|نطلب|جمع(نا)?|استثمار|تمويلا?|رأسمال/i,
    requireCurrency: true,
  },
];

function quoteOfLine(line: string): string {
  const t = line.trim();
  return t.length > 140 ? `${t.slice(0, 140)}…` : t;
}

// ————— extractClaims —————

export function extractClaims(slides: Slide[]): ClaimItem[] {
  const out: ClaimItem[] = [];
  if (!Array.isArray(slides)) return out;
  for (const slide of slides) {
    if (!slide || typeof slide !== "object") continue;
    const index = Number(slide.index) || 0;
    const rawText = typeof slide.text === "string" ? slide.text : "";
    const title = typeof slide.title === "string" ? slide.title : "";
    const lines = [title, ...rawText.split(/\n+/)].map((l) => l).filter((l) => l.trim().length > 0);
    for (const line of lines) {
      const norm = normalizeClaimText(line);
      const nums = scanNumbers(norm);
      if (nums.length === 0) continue;
      for (const rule of CONTEXT_RULES) {
        if (!rule.kws.test(norm)) continue;
        for (const n of nums) {
          if (n.isYear) continue;
          if (rule.requirePercent && !n.isPercent) continue;
          if (rule.requireCurrency && !n.isCurrency && n.value < 1000) continue;
          // مستخدمون: تجاهل النسب والقيم الصغيرة (<5) والأرقام متبوعة بوحدة صارفة (دونمات/أشهر...)
          if (rule.type === "users") {
            if (n.isPercent) continue;
            if (n.value < 5) continue;
            if (n.nextWord && DISTRACTOR_UNITS.test(n.nextWord)) continue;
          }
          if (rule.type === "market_size" && n.isPercent) continue;
          if (rule.type === "revenue" && n.isPercent) continue;
          const id = `${rule.type}-${index}-${out.length}`;
          out.push({
            id,
            type: rule.type,
            value: Math.round(n.value * 100) / 100,
            unit: rule.label?.(norm) ?? (n.isPercent ? "%" : undefined),
            page: index,
            quote: quoteOfLine(line),
            status: "kept",
          });
          break; // أول رقم سياقي لكل نوع في السطر يكفي
        }
      }
    }
  }
  return out;
}

// ————— detectContradictions —————

export function detectContradictions(claims: ClaimItem[]): Array<{ ar: string; pages: number[] }> {
  const out: Array<{ ar: string; pages: number[] }> = [];
  if (!Array.isArray(claims)) return out;
  const kept = claims.filter((c) => c && c.status === "kept" && typeof c.value === "number" && Number.isFinite(c.value));

  // (1) قيمتان مختلفتان لنفس النوع **ونفس المقياس** (TAM مع TAM فقط، والقيم غير المعنونة معًا)
  // بفارق نسبي > 20% — النسب المئوية للنمو خارج المقارنة
  const byType = new Map<string, ClaimItem[]>();
  for (const c of kept) {
    if (c.type === "growth") continue;
    const key = `${c.type}:${(c.unit ?? "").toLowerCase()}`;
    const arr = byType.get(key) ?? [];
    arr.push(c);
    byType.set(key, arr);
  }
  for (const [type, arr] of byType) {
    if (arr.length < 2) continue;
    const [baseType, unitLabel] = type.split(":");
    const label = `${typeAr(baseType)}${unitLabel ? ` (${unitLabel.toUpperCase()})` : ""}`;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];
        const max = Math.max(Math.abs(a.value), Math.abs(b.value));
        if (max === 0) continue;
        const rel = Math.abs(a.value - b.value) / max;
        if (rel > 0.2) {
          const pages = [a.page, b.page].filter((p) => p > 0);
          out.push({
            ar: `توجد قيمتان مختلفتان لـ«${label}» بفارق ${Math.round(rel * 100)}% (${fmtNum(a.value)} مقابل ${fmtNum(b.value)}) — راجع اتساق الأرقام.`,
            pages: [...new Set(pages)],
          });
        }
      }
    }
  }

  // (2) ترتيب TAM ≥ SAM ≥ SOM غير منطقي
  const tam = kept.find((c) => c.type === "market_size" && c.unit === "TAM");
  const sam = kept.find((c) => c.type === "market_size" && c.unit === "SAM");
  const som = kept.find((c) => c.type === "market_size" && c.unit === "SOM");
  if (tam && sam && tam.value < sam.value) {
    out.push({ ar: `ترتيب الأحجام غير منطقي: TAM (${fmtNum(tam.value)}) أصغر من SAM (${fmtNum(sam.value)}).`, pages: [tam.page, sam.page] });
  }
  if (sam && som && sam.value < som.value) {
    out.push({ ar: `ترتيب الأحجام غير منطقي: SAM (${fmtNum(sam.value)}) أصغر من SOM (${fmtNum(som.value)}).`, pages: [sam.page, som.page] });
  }
  if (tam && som && tam.value < som.value) {
    out.push({ ar: `ترتيب الأحجام غير منطقي: TAM (${fmtNum(tam.value)}) أصغر من SOM (${fmtNum(som.value)}).`, pages: [tam.page, som.page] });
  }

  // (3) نمو مئوي استثنائي > 1000%
  for (const c of kept) {
    if (c.type === "growth" && c.value > 1000) {
      out.push({ ar: `نمو مذكور بنسبة ${fmtNum(c.value)}% — استثنائي، تحقق منه قبل عرضه للممولين.`, pages: [c.page] });
    }
  }

  // إزالة التكرارات النصية
  const seen = new Set<string>();
  return out.filter((c) => {
    if (seen.has(c.ar)) return false;
    seen.add(c.ar);
    return true;
  });
}

function typeAr(type: string): string {
  switch (type) {
    case "market_size": return "حجم السوق";
    case "revenue": return "الإيرادات";
    case "users": return "المستخدمون";
    case "funding_ask": return "الطلب التمويلي";
    default: return type;
  }
}

function fmtNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} مليار`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} مليون`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} ألف`;
  return String(Math.round(n * 100) / 100);
}
