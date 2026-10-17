/**
 * Masar — أدوات النص العربية/الإنجليزية (T5)
 * ---------------------------------------------------------------------------
 * normalizeText : التطبيع الكامل لمطابقة الاقتباسات (تشكيل/تطويل/همزات/أرقام/ترقيم).
 * normalizeUrl  : توحيد الرابط (https، بلا www، بلا معاملات تتبع، بلا تجزئة).
 * trigramSimilarity : تشابه زخرفي (Jaccard) لمجموعات المثلثات الحرفية على النص المطبع.
 *
 * مبادئ ملزِمة:
 *  - حتمية كاملة: لا حالة، لا شبكة، لا عشوائية، لا توقيت زمني.
 *  - لا استثناءً أبدًا: أي مدخل غير نصي أو خلل داخلي يُعاد كقيمة آمنة.
 *  - لا استيراد خارجي إطلاقًا (ملف نقي قابل لإعادة الاستخدام في الطرفين).
 *
 * ترتيب تطبيع normalizeText (الترتيب مقصود):
 *  1) خفض الحالة اللاتينية.
 *  2) إزالة التشكيل (064B–065F + 0670) ثم التطويل (0640).
 *  3) تحويل الأرقام الهندية (0660–0669) والفارسية (06F0–06F9) إلى الغربية.
 *  4) توحيد الهمزات والحروف: أ إ آ → ا، ة → ه، ى → ي، ؤ → و، ئ → ي.
 *  5) إزالة فواصل الأرقام العربية (٫ 066B ، 066C) — دمجًا متسقًا في الطرفين.
 *  6) إزالة علامات الترقيم والرموز كلها (\p{P} \p{S}) وأحرف التنسيق (\p{Cf}
 *     مثل اتجاهات النص وZWJ/ZWNJ) — بلا إحلال مسافات (المسافات الأصلية تكفي).
 *  7) تقليص المسافات المتكررة إلى مسافة واحدة ثم trim.
 */

// ————— أنماط ثابتة (تُستعمل عبر replace/match فقط — بلا حالة lastIndex) —————

const AR_DIACRITICS = /[\u064B-\u065F\u0670]/g; // التشكيل + السكون المفرد
const AR_TATWEEL = /\u0640/g; // ــــ
const EASTERN_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g; // ٠-٩ + ۰-۹
const AR_NUM_SEPARATORS = /[\u066B\u066C]/g; // الفاصلة والفاصلة العربية
const PUNCT_SYMBOLS_FORMAT = /[\p{P}\p{S}\p{Cf}]/gu;

function easternToWesternDigit(ch: string): string {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return ch;
  const base = cp <= 0x0669 ? 0x0660 : 0x06f0;
  return String(cp - base); // 0x0660 → "0" (0x30) وليس محرف التحكم NUL
}

// ————— normalizeText —————

export function normalizeText(s: string): string {
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
      .replace(AR_NUM_SEPARATORS, "")
      .replace(PUNCT_SYMBOLS_FORMAT, "")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

// ————— normalizeUrl —————

const TRACKING_PARAM_EXACT = new Set(["fbclid", "gclid", "ref", "ref_src"]);

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith("utm_") || TRACKING_PARAM_EXACT.has(k);
}

/**
 * يوحّد الرابط لأغراض مطابقة التكرارات:
 *  - البروتوكول https دومًا، واسم النطاق بخفض الحالة وبلا «www.».
 *  - حذف المسار الفارغ والشرطة الخلفية الزائدة («/a/» → «/a»).
 *  - حذف كل معاملات التتبع (utm_* وfbclid وgclid وref وref_src) مع الإبقاء
 *    على بقية المعاملات بترتيبها الأصلي، وحذف التجزئة (#…) كليًّا.
 *  - مدخل بلا بروتوكول يُفسَّر https؛ المخططات غير الويبية (mailto: وغيرها)
 *    والمدخلات غير القابلة للتحليل تُعاد كما وردت (بلا استثناء).
 */
export function normalizeUrl(u: string): string {
  if (typeof u !== "string") return "";
  const input = u.trim();
  if (input.length === 0) return "";
  try {
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      parsed = new URL("https://" + input);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return input; // مخطط غير ويبي (mailto/ftp/…) — خارج نطاق التوحيد
    }
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    let out = `https://${host}${parsed.port ? ":" + parsed.port : ""}`;
    let path = parsed.pathname;
    if (path.length > 1) path = path.replace(/\/+$/, "");
    if (path && path !== "/") out += path;
    const kept: Array<[string, string]> = [];
    for (const pair of parsed.searchParams) {
      if (!isTrackingParam(pair[0])) kept.push([pair[0], pair[1]]);
    }
    if (kept.length > 0) {
      const qs = new URLSearchParams();
      for (const [k, v] of kept) qs.append(k, v);
      out += "?" + qs.toString();
    }
    return out;
  } catch {
    return input;
  }
}

// ————— trigramSimilarity —————

/**
 * تشابه Jaccard على مجموعة المثلثات الحرفية (3-grams) للنص المطبع:
 *   التشابه = |A ∩ B| / |A ∪ B|
 * نصان متطابقان (بعد التطبيع) → 1. نص أقصر من 3 محارف مطبعة → 0، أو 1 إن
 * كانا متطابقين حرفيًّا. المدخلات غير النصية تُعامل كنص فارغ.
 */
export function trigramSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === nb) return 1;
  if (na.length < 3 || nb.length < 3) return 0;
  try {
    const setA = new Set<string>();
    for (let i = 0; i + 3 <= na.length; i++) setA.add(na.slice(i, i + 3));
    const setB = new Set<string>();
    for (let i = 0; i + 3 <= nb.length; i++) setB.add(nb.slice(i, i + 3));
    if (setA.size === 0 || setB.size === 0) return 0;
    let inter = 0;
    for (const g of setA) if (setB.has(g)) inter++;
    const union = setA.size + setB.size - inter;
    if (union <= 0) return 0;
    return inter / union;
  } catch {
    return 0;
  }
}
