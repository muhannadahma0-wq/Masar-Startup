/**
 * Masar — الحراس الأربعة + كشف الحقن (T5)
 * ---------------------------------------------------------------------------
 * citationCheck       : حارس الاقتباس — التطبع ثم الوجود في نص الشريحة بالصفحة.
 * suggestionGuard     : حارس منع الاختلاق — NEW_FACT / UNSUPPORTED_SUPERLATIVE / TOO_LONG.
 * redactPii           : إخفاء البريد/الهاتف/رقم الهوية بعناصر نائبة قبل أي استدعاء نموذج.
 * detectPromptInjection: نص العرض/الصفحة بيانات لا تعليمات — كشف أنماط الحقن وإبلاغها.
 *
 * مبادئ ملزِمة (AGENT_CONTRACT §9):
 *  - حتمية كاملة: لا شبكة، لا حالة، لا عشوائية، لا توقيت.
 *  - لا استثناءً أبدًا: كل دالة تعيد قيمة آمنة مهما كان المدخل.
 *  - الاستيراد من ./types و ./text فقط (لا اعتماد خارجي).
 *  - الأصل مصدر الحقيقة: كل رقم/اسم في الاقتراح يجب أن يسنده النص الأصلي
 *    أو الحقائق المؤكدة، وكل صيغة تفوق يجب أن ترد حرفيًّا في النص الأصلي.
 *
 * قرارات تفسيرية موثّقة (حالات لم تُحسم حرفيًّا — مثبّتة هنا):
 *  1) «نص الشريحة» في citationCheck = العنوان + النص (title + text): الاقتباس
 *     من عنوان الشريحة اقتباس صحيح من تلك الصفحة، ورفضه يُسقط قيمًا صحيحة.
 *  2) ترتيب فحوص الاقتباس: EMPTY_QUOTE ثم PAGE_OUT_OF_RANGE ثم QUOTE_NOT_FOUND
 *     (بترتيب ورودها في العقد) — علم واحد يكفي للرفض.
 *  3) مطابقة الأرقام في suggestionGuard «كقيمة»: يُستخرج الرمز مع وحداته
 *     (k/M/bn/million/ألف/مليون/مليار…) من النص الخام فيُقارن رقميًّا مع القيم
 *     المستخرجة بالمثل من النص الأصلي والحقائق — «٣ مليون» = «3M» = «3,000,000».
 *  4) الأسماء: كلمة إنجليزية بحرف أول كبير ليست بداية جملة (أو camelCase، أو
 *     Brand-like بحرف كبير >4 محارف ليس stopword)، أو محتوى عربي داخل «»،
 *     أو كلمة تحوي نطاقًا (.com ونظائره) — كلها يجب أن تظهر في المصدر.
 *  5) دعم التفوق يُفحص في «النص الأصلي» وحده (لا الحقائق) وبمطابقة مطبعة
 *     خفيفة (تشكيل/تطويل/همزات فقط) لأن العقد اشترط الورود «حرفيًّا».
 *  6) redactPii: كل الروابط محمية من الإخفاء (يشمل ذلك روابط البريد/API —
 *     «اتركها»)؛ سلسلة 9–10 أرقام متتالية تعامل كرقم هوية (الأولوية:
 *     بريد ← هوية ← هاتف) والهاتف يتطلب +/فواصل أو 11–15 رقمًا متتاليًا.
 *  7) أنماط الحقن تُطابق على نص مطبَع خفيف (بلا تشكيل/تطويل، همزات موحدة،
 *     خفض حالة) — فـ«تَجَاهِـــلْ» و«تجاهل» نمط واحد. النص يبقى بيانات:
 *     الحارس يبلّغ فقط ولا يعدّل شيئًا.
 */

import type {
  CitationCheckResult,
  GuardFlag,
  Slide,
  SuggestionGuardReport,
} from "./types";
import { normalizeText } from "./text";

// عقْد الأسماء §5 في AGENT_CONTRACT يُدرج normalizeText ضمن guards.ts أيضًا —
// نعيد تصديره من هنا ليظل مسار الاستيراد الوارد في العقد صالحًا للوكلاء اللاحقين.
export { normalizeText };

// ————— أدوات مساعدة عامة (بلا حالة) —————

const AR_MARKS = /[\u064B-\u065F\u0670\u0640]/g; // تشكيل + تطويل
const EASTERN_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

function toWesternDigit(ch: string): string {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return ch;
  const base = cp <= 0x0669 ? 0x0660 : 0x06f0;
  return String(cp - base); // 0x0660 → "0" (0x30) وليس محرف التحكم NUL
}

/**
 * تطبيع خفيف لغوي المطابقة (الحقن/التفوق): بلا تشكيل وتطويل، همزات أإآ موحدة،
 * أرقام غربية، خفض حالة، مسافات مقلصة — مع الإبقاء على الترقيم والرموز (#1 …).
 */
function lightNormalize(s: string): string {
  if (typeof s !== "string") return "";
  try {
    return s
      .toLowerCase()
      .replace(AR_MARKS, "")
      .replace(EASTERN_DIGITS, toWesternDigit)
      .replace(/[أإآ]/g, "ا")
      .replace(/\p{Cf}/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

/** مسح بلا حالة: يبني RegExp جديدًا لكل استدعاء فلا يتسرب lastIndex بين الاستدعاءات. */
function scan(text: string, source: string, flags: string): RegExpExecArray[] {
  const re = new RegExp(source, flags.includes("g") ? flags : flags + "g");
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m);
    if (m[0] === "") re.lastIndex++;
  }
  return out;
}

function pushFlag(flags: GuardFlag[], flag: GuardFlag): void {
  const key = `${flag.rule}|${flag.matched ?? ""}`;
  const exists = flags.some((f) => `${f.rule}|${f.matched ?? ""}` === key);
  if (!exists) flags.push(flag);
}

// ————— 1) citationCheck —————

/**
 * حارس الاقتباس: يطبع الاقتباس (normalizeText) ويتحقق وجوده في نص الشريحة
 * slides[page-1] (العنوان + النص، بترتيب 0). الأعلام بترتيب العقد:
 * EMPTY_QUOTE (بعد التطبيع أقصر من 3 محارف) ← PAGE_OUT_OF_RANGE ←
 * QUOTE_NOT_FOUND (مع matched = أول 30 محرفًا من الاقتباس).
 */
export function citationCheck(slides: Slide[], page: number, quote: string): CitationCheckResult {
  const flags: GuardFlag[] = [];
  const rawQuote = typeof quote === "string" ? quote : "";
  const normalizedQuote = normalizeText(rawQuote);
  try {
    const arr = Array.isArray(slides) ? slides : [];

    if (normalizedQuote.length < 3) {
      flags.push({
        rule: "EMPTY_QUOTE",
        detailAr: "الاقتباس فارغ أو أقصر من 3 محارف بعد التطبيع — لا يصلح دليلًا.",
        matched: rawQuote.trim().slice(0, 30) || undefined,
      });
      return { passed: false, flags, normalizedQuote };
    }

    if (!Number.isInteger(page) || page < 1 || page > arr.length) {
      flags.push({
        rule: "PAGE_OUT_OF_RANGE",
        detailAr: `الصفحة ${String(page)} خارج النطاق [1..${arr.length}] من شرائح العرض.`,
        matched: String(page),
      });
      return { passed: false, flags, normalizedQuote };
    }

    const slide = arr[page - 1];
    const slideText = slide && typeof slide.text === "string" ? slide.text : "";
    const slideTitle = slide && typeof slide.title === "string" ? slide.title : "";
    const haystack = normalizeText(`${slideTitle}\n${slideText}`);

    if (!haystack.includes(normalizedQuote)) {
      flags.push({
        rule: "QUOTE_NOT_FOUND",
        detailAr: "الاقتباس غير موجود في نص الشريحة المذكورة بعد التطبيع.",
        matched: rawQuote.trim().slice(0, 30),
      });
      return { passed: false, flags, normalizedQuote };
    }

    return { passed: true, flags, normalizedQuote };
  } catch {
    return { passed: flags.length === 0, flags, normalizedQuote };
  }
}

// ————— 2) suggestionGuard —————

/** الكلمات الإنجليزية الشائعة/التجارية — ليست أسماء علم (استدلال Brand-like). */
const STOPWORDS = new Set<string>(
  `the a an and or but if then else when while of for to in on at by with from about
   above across after again against all almost also although always am among any anyone
   anything are around as at back be because been before being below between both but by
   can cannot come could did do does doing down during each either enough even ever every
   everyone everything few for found from further get give go goes going gone good got had
   has have having he her here hers herself him himself his how however i in include
   includes including instead into is it its itself just keep kept key know known last late
   later latest least less let like likely little long look looking lot made main make
   makes making many may maybe me mean means might more most much must my myself near need
   needs neither never new next no nor not now nowhere of off often on once one only or
   other others our ours out over own part per perhaps please put rather really right same
   see seem seems seen several shall she should show showed shown shows since so some such
   sure take taken takes than that their theirs them themselves then there these they thing
   things think this those though through throughout till to today together too took toward
   towards under until up upon us use used uses using usually value values various very was
   way we well went were what when where whether which while who whom whose why will with
   within without would yet you your yours yourself yourselves
   revenue revenues user users customer customers client clients product products platform
   platforms solution solutions service services company companies startup startups business
   businesses funding investment investments investor investors stage seed scale scaling
   growth market markets marketing strategy strategies traction monthly annual quarterly
   quarter launch launched launching brand brands global regional local national
   international price pricing cost costs profit profits margin margins cash flow capital
   equity grant grants debt loan loans valuation share shares data number numbers total
   average rate rates percent percentage million billion thousand dollars dollar financial
   finance team teams partner partners partnership partnerships technology digital smart
   green future mission vision story journey impact innovation efficient efficiency quality
   premium trust secure simple easy fast faster cheap cheaper affordable access reach
   reports report reporting help helps helping work works working worked world region
   country countries city community communities support supported supporting education
   learning training session sessions meeting meetings plan plans planning goal goals
   target targets process processes system systems tool tools feature features offer
   offers offering buyer buyers seller sellers order orders subscription subscriptions
   payment payments paid free trial demo video content media social email website site
   app apps mobile web cloud server servers
   ai ml api ceo cto coo cfo gdp kpi okr roi cagr mvp saas b2b b2c crm erp hr it ui ux ip
   ar vr iot poc q1 q2 q3 q4 ngo usd eur sdk`
    .trim()
    .split(/\s+/),
);

/** سلسلة 9–10 أرقام متتالية (هوية) — غربية أو هندية. */
const ID_RUN = "[0-9٠-٩۰-۹]+";
/** مقطع أرقام مع فواصل/إشارة زائد — مرشح هاتف. */
const PHONE_RUN = "[+0-9٠-٩۰-۹\\s\\-()]+";
const EMAIL = "[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+";

// — استخراج الأرقام كقيم (مع الوحدات) —

const NUMBER_TOKEN = "\\d[\\d,]*(?:\\.[\\d]+)?";
const UNIT_SOURCE =
  "(?:(bn|k|K|m|M)(?![A-Za-z])|\\s?(?:million|billion|thousand)(?![A-Za-z])|\\s?(?:مليون|ملايين|مليار|مليارات|ألف|آلاف|الف))";
const UNIT_MULTIPLIERS: Record<string, number> = {
  bn: 1e9, k: 1e3, K: 1e3, m: 1e6, M: 1e6,
  million: 1e6, billion: 1e9, thousand: 1e3,
  "مليون": 1e6, "ملايين": 1e6, "مليار": 1e9, "مليارات": 1e9,
  "ألف": 1e3, "آلاف": 1e3, "الف": 1e3,
};

interface NumTok {
  value: number;
  display: string;
}

/** يحوّل الأرقام الهندية ويحذف التشكيل/التطويل ويوحّد فواصل الأرقام العربية (٫→.). */
function stripForNumbers(s: string): string {
  if (typeof s !== "string") return "";
  try {
    return s
      .replace(AR_MARKS, "")
      .replace(EASTERN_DIGITS, toWesternDigit)
      .replace(/\u066B/g, ".")
      .replace(/\u066C/g, ",");
  } catch {
    return "";
  }
}

/** «1,200,000»→1200000 و«12,5»→12.5 و«1.5»→1.5 — الفواصل 3 أرقام = آلاف وإلا فاصلة عشرية. */
function parseNumberToken(tok: string): number | null {
  if (!/^\d[\d,]*(?:\.\d+)?$/.test(tok)) return null;
  let intPart = tok;
  let decPart: string | null = null;
  const dot = tok.indexOf(".");
  if (dot >= 0) {
    intPart = tok.slice(0, dot);
    decPart = tok.slice(dot + 1);
  }
  if (intPart.includes(",")) {
    const groups = intPart.split(",");
    const thousands = groups.length > 1 && groups.slice(1).every((g) => /^\d{3}$/.test(g));
    if (thousands) {
      intPart = groups.join("");
    } else {
      intPart = groups[0];
      const rest = groups.slice(1).join("");
      decPart = decPart !== null ? rest + decPart : rest;
    }
  }
  const str = decPart !== null && decPart.length > 0 ? intPart + "." + decPart : intPart;
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

function extractNumbers(raw: string): NumTok[] {
  const s = stripForNumbers(raw);
  const out: NumTok[] = [];
  if (s.length === 0) return out;
  try {
    for (const m of scan(s, NUMBER_TOKEN, "g")) {
      const tok = m[0];
      const base = parseNumberToken(tok);
      if (base === null) continue;
      const rest = s.slice(m.index + tok.length);
      const um = new RegExp("^" + UNIT_SOURCE).exec(rest);
      let value = base;
      let display = tok;
      if (um) {
        const unit = (um[1] ?? um[0].trim()) as string;
        const mult = UNIT_MULTIPLIERS[unit] ?? 1;
        value = base * mult;
        display = (tok + um[0]).trim();
      }
      out.push({ value, display });
    }
  } catch {
    return out;
  }
  return out;
}

function numEq(a: number, b: number): boolean {
  if (a === b) return true;
  const d = Math.abs(a - b);
  return d <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

// — استخراج الأسماء —

/** هل الكلمة في بداية جملة/سطر/نقطة تعداد؟ (للأحرف الكبيرة الإنجليزية) */
function isSentenceStart(text: string, pos: number): boolean {
  let i = pos - 1;
  while (i >= 0 && (text[i] === " " || text[i] === "\t")) i--;
  if (i < 0) return true;
  const ch = text[i];
  if (ch === "\n" || ch === "\r") return true;
  if (".!?؟۔…".includes(ch)) return true;
  const lineStart = text.lastIndexOf("\n", i) + 1;
  const seg = text.slice(lineStart, i + 1);
  if (/^\s*(?:[-*•–—>]|\d+[.)])\s*$/.test(seg)) return true;
  return false;
}

function latinLetterRatio(w: string): number {
  if (w.length === 0) return 0;
  let letters = 0;
  for (const ch of w) if (/[A-Za-z]/.test(ch)) letters++;
  return letters / w.length;
}

interface NameCandidate {
  display: string;
  norm: string;
  kind: "latin" | "quoted" | "domain";
}

const TLD_RE = /\.(?:com|net|org|io|co|ai|dev|app|me|tv|fm)\b/i;
const EDGE_PUNCT = /^[.,;:!؟«»"()[\]{}'’…—–-]+|[.,;:!؟«»"()[\]{}'’…—–-]+$/g;

function extractNameCandidates(suggRaw: string): NameCandidate[] {
  const out: NameCandidate[] = [];
  if (typeof suggRaw !== "string" || suggRaw.length === 0) return out;
  try {
    // (أ) كلمات إنجليزية: حرف أول كبير ليس بداية جملة، أو camelCase، أو Brand-like.
    for (const m of scan(suggRaw, "[A-Za-z][A-Za-z0-9]*", "g")) {
      const w = m[0];
      const lower = w.toLowerCase();
      if (STOPWORDS.has(lower)) continue;
      const isCap = /^[A-Z]/.test(w);
      const isCamel = /^[a-z]+[A-Z]/.test(w);
      if (!isCap && !isCamel) continue;
      const atStart = isSentenceStart(suggRaw, m.index);
      let candidate = false;
      if (isCamel) candidate = true;
      else if (isCap && !atStart) candidate = true;
      else if (isCap && atStart && w.length > 4 && latinLetterRatio(w) >= 0.8) candidate = true;
      if (candidate) out.push({ display: w, norm: lower, kind: "latin" });
    }
    // (ب) محتوى عربي داخل «» — اسم علم/جهة/برنامج.
    for (const m of scan(suggRaw, "«([^»]{1,60})»", "g")) {
      const inner = (m[1] ?? "").trim();
      if (inner.length === 0) continue;
      out.push({ display: inner, norm: normalizeText(inner), kind: "quoted" });
    }
    // (ج) كلمات تحوي نطاقًا (مثل stripe.com) — اسم جهة/برنامج.
    for (const m of scan(suggRaw, "\\S+", "g")) {
      const tok = m[0].replace(EDGE_PUNCT, "");
      if (tok.length === 0 || !TLD_RE.test(tok)) continue;
      out.push({ display: tok, norm: normalizeText(tok), kind: "domain" });
    }
  } catch {
    return out;
  }
  return out;
}

// — صيغ التفوق غير المدعومة —

interface Superlative {
  matched: string;
  test: (s: string) => boolean;
}

function containsPhrase(phrase: string): (s: string) => boolean {
  return (s: string): boolean => s.includes(phrase);
}

function wordBoundary(phrase: string): (s: string) => boolean {
  const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  return (s: string): boolean => re.test(s);
}

const SUPERLATIVES: Superlative[] = [
  { matched: "أفضل/الأفضل", test: containsPhrase("افضل") },
  { matched: "الوحيد", test: containsPhrase("الوحيد") },
  { matched: "الأوحد", test: containsPhrase("الاوحد") },
  { matched: "رقم واحد", test: containsPhrase("رقم واحد") },
  { matched: "رقم 1", test: containsPhrase("رقم 1") },
  { matched: "الأضخم", test: containsPhrase("اضخم") },
  { matched: "الأكبر", test: containsPhrase("اكبر") },
  { matched: "الأسرع", test: containsPhrase("اسرع") },
  { matched: "الأول عالميًّا", test: containsPhrase("الاول عالميا") },
  { matched: "الأولى عالميًّا", test: containsPhrase("الاولى عالميا") },
  { matched: "الأول في العالم", test: containsPhrase("الاول في العالم") },
  { matched: "فريد عالميًّا", test: containsPhrase("فريد عالميا") },
  { matched: "الأول من نوعه", test: containsPhrase("الاول من نوعه") },
  { matched: "لا مثيل له", test: containsPhrase("لا مثيل") },
  { matched: "بلا منافس", test: containsPhrase("بلا منافس") },
  { matched: "#1", test: containsPhrase("#1") },
  { matched: "leading", test: wordBoundary("leading") },
  { matched: "world's first", test: containsPhrase("world's first") },
  { matched: "world's best", test: containsPhrase("world's best") },
  { matched: "best in the world", test: containsPhrase("best in the world") },
  { matched: "best-in-class", test: containsPhrase("best-in-class") },
  { matched: "revolutionary", test: wordBoundary("revolutionary") },
  { matched: "game-changing", test: containsPhrase("game-changing") },
  { matched: "game changing", test: containsPhrase("game changing") },
  { matched: "unique", test: wordBoundary("unique") },
  { matched: "number one", test: containsPhrase("number one") },
  { matched: "unmatched", test: wordBoundary("unmatched") },
  { matched: "unrivaled", test: wordBoundary("unrivaled") },
  { matched: "one of a kind", test: containsPhrase("one of a kind") },
  { matched: "first in the world", test: containsPhrase("first in the world") },
  { matched: "first ever", test: containsPhrase("first ever") },
  { matched: "world-first", test: containsPhrase("world-first") },
  { matched: "the only", test: containsPhrase("the only") },
];

// — عدّ الجمل (مع حماية الفاصلة العشرية 1.5 من الانقسام) —

const SENTENCE_SPLIT = /[.!؟۔?!]+/;

function countSentences(text: string): number {
  const guarded = text.replace(/(\d)[.](\d)/g, "$1\u0001$2");
  let n = 0;
  for (const seg of guarded.split(SENTENCE_SPLIT)) {
    if (seg.trim().length > 0) n++;
  }
  return n;
}

/**
 * حارس منع الاختلاق: كل رقم (كقيمة، بوحداته) وكل اسم علم في الاقتراح يجب أن
 * يسندَه originalSlideText أو أحد confirmedFacts؛ وكل صيغة تفوق يجب أن ترد
 * حرفيًّا في النص الأصلي؛ والطول ≤320 حرفًا و≤3 جمل. passed = بلا أعلام.
 */
export function suggestionGuard(
  originalSlideText: string,
  confirmedFacts: string[],
  suggestion: string,
): SuggestionGuardReport {
  const flags: GuardFlag[] = [];
  try {
    const orig = typeof originalSlideText === "string" ? originalSlideText : "";
    const facts = Array.isArray(confirmedFacts)
      ? confirmedFacts.filter((f): f is string => typeof f === "string")
      : [];
    const sugg = typeof suggestion === "string" ? suggestion : "";

    const sourceRaw = [orig, ...facts].join("\n");
    const sourceNorm = normalizeText(sourceRaw);
    const origPrepared = lightNormalize(orig);
    const suggPrepared = lightNormalize(sugg);

    // (1) NEW_FACT — أرقام غير مسندة
    const sourceValues = extractNumbers(sourceRaw).map((n) => n.value);
    for (const n of extractNumbers(sugg)) {
      if (!sourceValues.some((v) => numEq(v, n.value))) {
        pushFlag(flags, {
          rule: "NEW_FACT",
          detailAr: `الرقم «${n.display}» ورد في الاقتراح ولا يسنده النص الأصلي ولا الحقائق المؤكدة.`,
          matched: n.display,
        });
      }
    }

    // (2) NEW_FACT — أسماء غير مسندة
    for (const c of extractNameCandidates(sugg)) {
      const supported =
        (c.norm.length > 0 && sourceNorm.includes(c.norm)) ||
        (c.kind === "latin" &&
          c.norm.length > 3 &&
          sourceNorm.includes(c.norm.replace(/\d+$/, "")));
      if (!supported) {
        pushFlag(flags, {
          rule: "NEW_FACT",
          detailAr: `الاسم «${c.display}» ورد في الاقتراح ولا يسنده النص الأصلي ولا الحقائق المؤكدة.`,
          matched: c.display,
        });
      }
    }

    // (3) UNSUPPORTED_SUPERLATIVE — تفوق بلا دليل في النص الأصلي
    for (const sp of SUPERLATIVES) {
      if (sp.test(suggPrepared) && !sp.test(origPrepared)) {
        pushFlag(flags, {
          rule: "UNSUPPORTED_SUPERLATIVE",
          detailAr: `صيغة تفوق «${sp.matched}» في الاقتراح لا تسندها عبارة مطابقة في النص الأصلي.`,
          matched: sp.matched,
        });
      }
    }

    // (4) TOO_LONG — أكثر من 320 حرفًا أو أكثر من 3 جمل
    const len = sugg.length;
    const sentences = countSentences(sugg);
    if (len > 320 || sentences > 3) {
      flags.push({
        rule: "TOO_LONG",
        detailAr: `الاقتراح يتجاوز الحد المسموح (320 حرفًا / 3 جمل): ${len} حرفًا و${sentences} جملة.`,
        matched: sentences > 3 ? `${sentences} جمل` : `${len} حرفًا`,
      });
    }

    return { passed: flags.length === 0, flags };
  } catch {
    return { passed: flags.length === 0, flags };
  }
}

// ————— 3) redactPii —————

interface RedactRange {
  start: number;
  end: number;
  ph: string;
}

function overlaps(ranges: RedactRange[], start: number, end: number): boolean {
  return ranges.some((r) => start < r.end && end > r.start);
}

function idxToLetters(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function lettersToIdx(s: string): number {
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 96);
  return n - 1;
}

/**
 * يخفي البيانات الشخصية بعناصر نائبة مرقّمة لكل نوع: [EMAIL_n] و[PHONE_n]
 * و[ID_n]، ويعيد عدد الاستبدالات. الروابط (http(s)/www/mailto — بما فيها
 * روابط البريد وapi) تُترك كما هي. الأولوية: بريد ← هوية (9–10 أرقام
 * متتالية) ← هاتف (9–15 رقمًا مع +/فواصل، أو 11–15 رقمًا متتاليًا).
 */
export function redactPii(text: string): { redacted: string; replacements: number } {
  if (typeof text !== "string") return { redacted: "", replacements: 0 };
  if (text.length === 0) return { redacted: text, replacements: 0 };
  try {
    // (1) حماية الروابط كاملة — «روابط تحتوي بريدًا أو api… اتركها».
    const urls: string[] = [];
    const protectedText = text.replace(
      /(?:https?:\/\/|www\.|mailto:)[^\s<>"'`)\]}]+/gi,
      (u: string): string => {
        urls.push(u);
        return `\u0000U${idxToLetters(urls.length - 1)}\u0000`;
      },
    );

    const ranges: RedactRange[] = [];
    const counters: Record<string, number> = {};
    const nextPh = (type: string): string => {
      counters[type] = (counters[type] ?? 0) + 1;
      return `[${type}_${counters[type]}]`;
    };

    // (2) البريد الإلكتروني
    for (const m of scan(protectedText, EMAIL, "g")) {
      ranges.push({ start: m.index, end: m.index + m[0].length, ph: nextPh("EMAIL") });
    }

    // (3) رقم هوية: 9–10 أرقام متتالية (غربية/هندية/فارسية)
    for (const m of scan(protectedText, ID_RUN, "g")) {
      const run = m[0];
      const digits = run.replace(EASTERN_DIGITS, toWesternDigit);
      if (!/^\d{9,10}$/.test(digits)) continue;
      if (overlaps(ranges, m.index, m.index + run.length)) continue;
      ranges.push({ start: m.index, end: m.index + run.length, ph: nextPh("ID") });
    }

    // (4) الهاتف: مقاطع أرقام وفواصل — 9–15 رقمًا
    for (const m of scan(protectedText, PHONE_RUN, "g")) {
      const run = m[0];
      const lead = run.match(/^\s*/)?.[0].length ?? 0;
      const trail = run.match(/\s*$/)?.[0].length ?? 0;
      const tStart = m.index + lead;
      const tEnd = m.index + run.length - trail;
      const tRun = run.slice(lead, run.length - trail);
      if (tRun.length === 0) continue;
      if (overlaps(ranges, tStart, tEnd)) continue;
      const western = tRun.replace(EASTERN_DIGITS, toWesternDigit);
      const digits = western.replace(/[^0-9]/g, "");
      const count = digits.length;
      if (count < 9 || count > 15) continue;
      const startsPlus = tRun.startsWith("+");
      const hasSep = /[\s\-()]/.test(tRun);
      const pure = /^\+?\d+$/.test(western);
      if (startsPlus || hasSep || (pure && count >= 11)) {
        ranges.push({ start: tStart, end: tEnd, ph: nextPh("PHONE") });
      }
    }

    // (5) التطبيق من آخر النص إلى أوله (لا إزاحة للمواضع السابقة)
    let out = protectedText;
    const sorted = [...ranges].sort((a, b) => b.start - a.start);
    for (const r of sorted) {
      out = out.slice(0, r.start) + r.ph + out.slice(r.end);
    }

    // (6) إعادة الروابط
    out = out.replace(/\u0000U([a-z]+)\u0000/g, (_all: string, letters: string): string => {
      const idx = lettersToIdx(letters);
      return urls[idx] ?? "";
    });

    return { redacted: out, replacements: ranges.length };
  } catch {
    return { redacted: text, replacements: 0 };
  }
}

// ————— 4) detectPromptInjection —————

/**
 * أنماط الحقن العربية/الإنجليزية — تُطابق على النص المطبَع خفيفًا (بلا تشكيل
 * وتطويل، همزات موحدة، خفض حالة). القوائم مرتبة: الأنماط المحددة قبل العامة.
 */
const INJECTION_PATTERNS: RegExp[] = [
  // — إنجليزي —
  /\bignore\s+(?:(?:all|any|the|your)\s+)?(?:previous|above|prior|earlier|all)\s+instructions?\b/,
  /\bignore\s+(?:(?:all|any|the|your)\s+)?(?:previous|above|prior|earlier)\b/,
  /\bignore\s+all\b/,
  /\bdisregard\s+(?:(?:all|any|the|your|previous|above|prior|earlier)\s+)*(?:instructions?|directives?|rules|context|guidelines)\b/,
  /\bdisregard\s+(?:(?:all|any|the)\s+)?(?:previous|above|prior|earlier|all)\b/,
  /\bsystem\s+prompt\b/,
  /\boverride\s+(?:(?:all|any|the|your|previous|above|prior|earlier)\s+)*(?:instructions?|directives?|rules|context|settings)\b/,
  /\bact\s+as\b/,
  /\byou\s+are\s+now\b/,
  /\bnow\s+you\s+are\b/,
  /\bpretend\s+to\s+be\b/,
  /\breveal(?:ed|ing|s)?\s+(?:your|the|this|my|our)?\s*system\b/,
  /\bshow\s+me\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions)\b/,
  /\byour\s+new\s+task\b/,
  /\bforget\s+(?:(?:all|everything|anything|the)\s+)*(?:previous|above|prior|earlier|instructions?|context|rules|prompts?)\b/,
  /\bforget\s+everything\b/,
  /\b(?:do\s+not|don'?t)\s+follow\s+(?:(?:any|the|all|previous|above)\s+)*(?:instructions?|rules|guidelines)\b/,
  /\bjailbreak\b/,
  /\bdeveloper\s+mode\b/,
  // — عربي —
  /(?<![\u0621-\u064A])(?:و|ف)?تجاهل[\s]*(?:(?:كل|جميع|جميعا)\s+)?(?:التعليمات|تعليماتي?|الاوامر|اوامري?|السياق\s*السابق|ما\s*(?:سبق|قلته|كتبته))/,
  /(?<![\u0621-\u064A])(?:و|ف)?(?:نفذ|تنفيذ)?\s*(?:ما\s+يلي|التالي|الاتي)\s+بغض\s+النظر/,
  /(?<![\u0621-\u064A])بغض\s+النظر\s+عن\s+(?:اي|كل|جميع|الجميع|كل\s*ما|ما)(?![\u0621-\u064A])/,
  /(?<![\u0621-\u064A])انت\s+الان(?![\u0621-\u064A])/,
  /(?<![\u0621-\u064A])(?:و|ف)?تصرف\s*ك/,
  /(?<![\u0621-\u064A])تخيل\s+ان(?:ك|كم|نا)/,
  /(?<![\u0621-\u064A])اعتبر\s+نفسك(?![\u0621-\u064A])/,
  /(?<![\u0621-\u064A])مهمتك\s+(?:الان|الجديدة?)(?![\u0621-\u064A])/,
  /(?:رسالة|تعليمات|مطالبة|اوامر|امر)\s+النظام(?![\u0621-\u064A])/,
];

interface Hit {
  start: number;
  end: number;
  text: string;
}

/**
 * يفحص النص (بيانات العرض/الصفحة) بحثًا عن محاولات حقن تعليمات. يعيد
 * suspicious=true مع الأنماط المطابقة (مقتطفات من النص المطبَع) — النص
 * يبقى بيانات لا تعليمات: الحارس يبلّغ ولا يعدّل ولا يحذف شيئًا.
 */
export function detectPromptInjection(text: string): { suspicious: boolean; patterns: string[] } {
  if (typeof text !== "string" || text.length === 0) {
    return { suspicious: false, patterns: [] };
  }
  try {
    const prepared = lightNormalize(text);
    if (prepared.length === 0) return { suspicious: false, patterns: [] };
    const hits: Hit[] = [];
    for (const p of INJECTION_PATTERNS) {
      for (const m of scan(prepared, p.source, "g")) {
        const snippet = m[0].trim();
        if (snippet.length === 0) continue;
        hits.push({ start: m.index, end: m.index + m[0].length, text: snippet });
      }
    }
    // حذف التكرار: نُبقي أطول مطابقة ونحذف أي مطابقة محتواة ضمن أخرى.
    const kept: string[] = [];
    for (const h of hits) {
      const contained = hits.some(
        (o) => o !== h && o.start <= h.start && h.end <= o.end && o.end - o.start > h.end - h.start,
      );
      if (!contained && !kept.includes(h.text)) kept.push(h.text);
    }
    return { suspicious: kept.length > 0, patterns: kept };
  } catch {
    return { suspicious: false, patterns: [] };
  }
}
