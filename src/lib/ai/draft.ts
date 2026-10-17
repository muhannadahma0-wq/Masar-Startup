/**
 * Masar — مسودة فرصة من نص صفحة (T6)
 * =====================================================
 * draftOpportunityFromPage(pageText, url): جلب الصفحة نفسه خارج نطاق T6 —
 * المستدعي (T10) يجلب النص بعد اجتياز ssrfGuard، ثم يمرره هنا.
 *
 * المسار:
 *   (1) ssrfGuard على الرابط (http/https فقط، بلا مضيفين داخليين، منافذ 80/443،
 *       حد 2000 محرف).
 *   (2) موجّه DRAFT → runLlm → JSON {opportunity, quotes} →
 *       تحقق Zod بمعمارية OpportunityCreateInput: فشل التحقق → إعادة المسودة الخام
 *       مع علامة needsManualFix.
 *       mock-replay: مسودة regex حتمية من نص الصفحة نفسها.
 *   (3) كل اقتباس في quotes حرفي من نص الصفحة (يفحص بـ Citation Guard —
 *       صفحة واحدة ملفوفة كشريحة)؛ غير الحرفي يُحذف.
 *
 * خادم فقط — لا يُستورد في مكونات عميلة.
 */
import { runLlm, loadGuards, normalizeDigits } from "./adapter";
import { draftSystemPrompt, draftUserPayload } from "./prompts";
import { parseJsonLoose, parseMoneyMentions, splitSentences, classifyMoneyContext } from "./extract";
import { OpportunityCreateInput } from "@/lib/schemas";
import { SECTOR_KEYS, type Slide } from "@/lib/core/types";

export type DraftMeta = { deckVersionId?: string; userId?: string };

export interface DraftEnvelope {
  needsManualFix: boolean;
  /** المسودة المتحققة (عند النجاح) أو الخام (عند الفشل) — يعالجها المراجع البشري */
  data: unknown;
  issuesAr?: string[];
}

// ————————————————————————————————————————————————
// T6/§5: ssrfGuard — حماية طلبات الجلب من استهداف الشبكة الداخلية
// ————————————————————————————————————————————————

const MAX_URL_LENGTH = 2000;
const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0", "::1", "0:0:0:0:0:0:0:1"]);

export function ssrfGuard(url: string): { allowed: boolean; reasonAr?: string } {
  if (typeof url !== "string" || url.trim().length === 0) {
    return { allowed: false, reasonAr: "رابط فارغ" };
  }
  if (url.length > MAX_URL_LENGTH) {
    return { allowed: false, reasonAr: `الرابط أطول من الحد المسموح (${MAX_URL_LENGTH} محرفًا)` };
  }
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { allowed: false, reasonAr: "رابط غير صالح" };
  }
  // البروتوكولات: http/https فقط (يمنع file: وdata: وftp: وغيرها)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { allowed: false, reasonAr: "يُسمح فقط ببروتوكولي http وhttps" };
  }
  // المنافذ: لا منفذ (الافتراضي) أو 80/443 فقط
  const port = parsed.port;
  if (port && port !== "80" && port !== "443") {
    return { allowed: false, reasonAr: `منفذ غير مسموح (${port}) — المسموح 80 و443 فقط` };
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (host.length === 0) {
    return { allowed: false, reasonAr: "مضيف فارغ في الرابط" };
  }
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { allowed: false, reasonAr: "مضيف داخلي/محلي ممنوع" };
  }
  if (host.endsWith(".internal") || host.endsWith(".local")) {
    return { allowed: false, reasonAr: "نطاق داخلي ممنوع (.internal/.local)" };
  }
  if (host.includes(":")) {
    // IPv6: حلقة عودة / رابط محلي / فريد خاص
    if (/^(fe80|fc|fd)/.test(host)) return { allowed: false, reasonAr: "عنوان IPv6 داخلي ممنوع" };
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 0 || a === 10 || a === 127) return { allowed: false, reasonAr: "عنوان شبكة داخلية ممنوع" };
    if (a === 172 && b >= 16 && b <= 31) return { allowed: false, reasonAr: "عنوان شبكة داخلية ممنوع (172.16-31)" };
    if (a === 192 && b === 168) return { allowed: false, reasonAr: "عنوان شبكة داخلية ممنوع (192.168)" };
    if (a === 169 && b === 254) return { allowed: false, reasonAr: "عنوان رابط محلي ممنوع (169.254)" };
  }
  return { allowed: true };
}

// ————————————————————————————————————————————————
// T6/§5: draftOpportunityFromPage — التوقيع الملزم (meta اختيارية لا تكسر العقد)
// ————————————————————————————————————————————————

export async function draftOpportunityFromPage(
  pageText: string,
  url: string,
  meta: DraftMeta = {}
): Promise<{ draft: unknown; quotes: Array<{ url: string; quote: string }>; provider: string }> {
  // حارس SSRF أولًا (دفاعًا ثانيًا — المستدعي يفحص قبل الجلب أصلًا)
  const guard = ssrfGuard(url);
  if (!guard.allowed) {
    return {
      draft: { needsManualFix: true, data: null, issuesAr: [`الرابط مرفوض بواسطة حارس SSRF: ${guard.reasonAr}`] } satisfies DraftEnvelope,
      quotes: [],
      provider: "none",
    };
  }
  if (typeof pageText !== "string" || pageText.trim().length === 0) {
    return {
      draft: { needsManualFix: true, data: null, issuesAr: ["نص الصفحة فارغ — لا يمكن بناء مسودة"] } satisfies DraftEnvelope,
      quotes: [],
      provider: "none",
    };
  }

  const guards = await loadGuards();
  // إخفاء PII قبل أي استدعاء نموذج (الاقتباسات تتحقق من النص الأصلي)
  const redacted = guards.redactPii(pageText);

  const res = await runLlm(
    {
      purpose: "DRAFT_FROM_URL",
      systemPrompt: draftSystemPrompt(),
      userPayload: draftUserPayload(redacted.redacted, url),
      maxTokens: 2048,
    },
    meta
  );

  // مسار الطوارئ: مسودة regex حتمية من نص الصفحة نفسها
  if (res.usedFallback) {
    return localDraftFromPage(pageText, url, res.provider);
  }

  // مسار GLM: JSON { opportunity, quotes }
  const raw = parseJsonLoose(res.text);
  if (raw === null || typeof raw !== "object") {
    return {
      draft: { needsManualFix: true, data: null, issuesAr: ["تعذّر تحليل مخرج النموذج بوصفه JSON صالحًا"] } satisfies DraftEnvelope,
      quotes: [],
      provider: res.provider,
    };
  }
  const obj = raw as { opportunity?: unknown; quotes?: unknown };
  const opportunity = obj.opportunity ?? null;
  const rawQuotes = Array.isArray(obj.quotes) ? obj.quotes.filter((q): q is string => typeof q === "string") : [];

  // الاقتباسات: حرفية من نص الصفحة فقط (Citation Guard على صفحة ملفوفة كشريحة واحدة)
  const pageAsSlide: Slide = { index: 1, title: "", text: pageText };
  const quotes: Array<{ url: string; quote: string }> = [];
  for (const q of rawQuotes.slice(0, 8)) {
    const check = guards.citationCheck([pageAsSlide], 1, q);
    if (check.passed) quotes.push({ url, quote: q });
  }

  // تحقق Zod بمعمارية OpportunityCreateInput
  const validation = OpportunityCreateInput.safeParse(opportunity);
  if (!validation.success) {
    return {
      draft: {
        needsManualFix: true,
        data: opportunity,
        issuesAr: validation.error.issues.map((i) => `${i.path.join(".") || "(جذر)"}: ${i.message}`),
      } satisfies DraftEnvelope,
      quotes,
      provider: res.provider,
    };
  }
  return { draft: { needsManualFix: false, data: validation.data } satisfies DraftEnvelope, quotes, provider: res.provider };
}

// ————————————————————————————————————————————————
// مسار الطوارئ: مسودة حتمية من نص الصفحة (regex بلا شبكة)
// ————————————————————————————————————————————————

const ORG_WORD_RE =
  /(مؤسسة|صندوق|برنامج|مبادرة|منصة|معهد|جامعة|مركز|هيئة|وزارة|شركة|association|foundation|fund|program|initiative|institute|university|center|centre|ministry|agency|company|platform)/i;
const VERB_WORD_RE =
  /^(تقدم|تمنح|تعلن|تفتح|تدعو|تهدف|تستهدف|تدعو|نقدم|نمنح|نعلن|يعلن|يقدم|يهدف|يستهدف|تقدم|يقدّم|offers?|provides?|announces?|seeks?|targets?|invites?|presents?|supports?|funds?|gives?)/i;

function extractOrgPhrase(pageText: string): { orgName: string | null; quote: string } {
  const sentences = splitSentences(pageText);
  for (const sent of sentences) {
    const m = ORG_WORD_RE.exec(sent.text);
    if (!m) continue;
    // كلمة النوع + حتى 4 كلمات لاحقة، مع تجاوز الأفعال الشائعة (تقدم/يقدم/offers…)
    const tail = sent.text.slice(m.index + m[0].length).trim();
    const words = tail.split(/\s+/).filter(Boolean);
    const nameWords: string[] = [];
    for (const w of words) {
      const clean = w.replace(/[.,!؟?؛:،"'()]+$/g, "");
      if (!clean) break;
      if (VERB_WORD_RE.test(clean) || /^[.$\d]/.test(clean)) break;
      nameWords.push(clean);
      if (nameWords.length >= 4) break;
    }
    const orgName = `${m[0]} ${nameWords.join(" ")}`.trim().replace(/[.,،؛:]+$/, "");
    if (orgName.replace(/\s/g, "").length >= 4) {
      return { orgName: orgName.slice(0, 120), quote: sent.text };
    }
  }
  return { orgName: null, quote: "" };
}

const TYPE_PATTERNS: Array<{ type: "grant" | "accelerator" | "incubator" | "competition" | "fellowship" | "loan"; re: RegExp }> = [
  { type: "loan", re: /قرض|قروض|loan|lending|تمويل مسترد/i },
  { type: "competition", re: /مسابقة|منافسة|competition|contest|challenge/i },
  { type: "fellowship", re: /زمالة|زمالات|fellowship/i },
  { type: "accelerator", re: /مسرّ?عة|مسرعة|accelerator/i },
  { type: "incubator", re: /حاضنة|حاضنات|incubator/i },
  { type: "grant", re: /منحة|منحًا|منح|grant|دعم مالي|إعانة/i },
];

function detectType(pageText: string): "grant" | "accelerator" | "incubator" | "competition" | "fellowship" | "loan" {
  for (const { type, re } of TYPE_PATTERNS) {
    if (re.test(pageText)) return type;
  }
  return "grant";
}

function localDraftFromPage(
  pageText: string,
  url: string,
  provider: string
): { draft: unknown; quotes: Array<{ url: string; quote: string }>; provider: string } {
  const lines = pageText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const sentences = splitSentences(pageText).map((s) => s.text);

  // العنوان: أول سطر غير فارغ (أو أول جملة)
  const titleRaw = (lines[0] ?? sentences[0] ?? "مسودة فرصة من الرابط").replace(/[.،؛:]+$/, "").trim();
  const title = (titleRaw.length >= 3 ? titleRaw : "مسودة فرصة من الرابط").slice(0, 160);

  // الجهة: عبارة اسم الجهة إن وُجدت، وإلا «جهة غير محددة» مع علامة معالجة يدوية
  const { orgName, quote: orgQuote } = extractOrgPhrase(pageText);

  // المبالغ: أقصى/أدنى مبلغ مذكور بسياق طلب/منحة
  const monies = parseMoneyMentions(pageText);
  const grantish = monies.filter((m) => {
    const sent = sentences.find((s) => normalizeDigits(s).includes(normalizeDigits(m.raw).slice(0, 4)));
    return !sent || classifyMoneyContext(sent) === "company.askAmountUSD";
  });
  const pool = grantish.length > 0 ? grantish : monies;
  const amounts = pool.map((m) => m.amount);
  const amountMax = amounts.length > 0 ? Math.max(...amounts) : undefined;
  const amountMin = amounts.length > 1 ? Math.min(...amounts) : undefined;

  // الموعد: تاريخ ISO صريح في النص
  const dl = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(normalizeDigits(pageText));
  const deadline = dl ? new Date(Date.UTC(Number(dl[1]), Number(dl[2]) - 1, Number(dl[3]))).toISOString() : undefined;

  // القطاعات: مفاتيح حرفية من SECTOR_KEYS إن ذُكرت
  const sectors = SECTOR_KEYS.filter((k) => new RegExp(`\\b${k}\\b`, "i").test(pageText));
  const sectorList = sectors.length > 0 ? [...sectors] : (["other"] as const);

  // اللغات من توزيع المحارف
  const arabicLetters = (pageText.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latinLetters = (pageText.match(/[A-Za-z]/g) ?? []).length;
  const languages: Array<"ar" | "en"> =
    arabicLetters > 30 && latinLetters > 30 ? ["ar", "en"] : arabicLetters >= latinLetters ? ["ar"] : ["en"];

  const fundingType = /(equity|حصة|استثمار مقابل)/i.test(pageText)
    ? ("equity" as const)
    : /(منحة|grant|غير استثماري|non[-\s]equity)/i.test(pageText)
      ? ("non_equity" as const)
      : undefined;

  // شروط مسودة أولية يراجعها المراجع (T10) — قطاع + سقف مبلغ إن وُجد
  const conditions = [
    {
      field: "company.sectors",
      op: "in" as const,
      value: sectorList,
      mandatory: true,
      ambiguous: false,
      scope: "any" as const,
    },
    ...(amountMax !== undefined
      ? [
          {
            field: "company.askAmountUSD",
            op: "lte" as const,
            value: amountMax,
            mandatory: false,
            ambiguous: false,
            scope: "any" as const,
          },
        ]
      : []),
  ];

  const draftObj = {
    title,
    orgName: orgName ?? "جهة غير محددة",
    description: sentences.slice(0, 3).join(" ").slice(0, 1200),
    type: detectType(pageText),
    fundingType,
    amountMin,
    amountMax,
    currency: "USD",
    sectors: sectorList,
    geography: "local" as const,
    geoPriority: false,
    languages,
    applicationUrl: url,
    sourceType: "official" as const,
    deadline,
    requiresDocs: [] as string[],
    conditions,
  };

  // اقتباسات حرفية: جمل حاملة للجهة/المبالغ/الموعد/القطاعات (بحد 5)
  const wanted: RegExp[] = [
    /(\$|usd|دولار|ألف|مليون)/i,
    /\b20\d{2}-\d{2}-\d{2}\b/,
    new RegExp(`\\b${sectorList.join("|")}\\b`, "i"),
    /منحة|grant|تمويل|funding|قرض|loan/i,
  ];
  const quoteTexts: string[] = [];
  if (orgQuote && !quoteTexts.includes(orgQuote)) quoteTexts.push(orgQuote);
  for (const s of sentences) {
    if (quoteTexts.length >= 5) break;
    if (wanted.some((re) => re.test(normalizeDigits(s))) && !quoteTexts.includes(s)) quoteTexts.push(s);
  }

  const validation = OpportunityCreateInput.safeParse(draftObj);
  const issuesAr: string[] = [];
  if (!orgName) issuesAr.push("لم يُعثر على اسم الجهة في نص الصفحة — يحتاج إدخالًا يدويًّا");
  if (!validation.success) {
    issuesAr.push(...validation.error.issues.map((i) => `${i.path.join(".") || "(جذر)"}: ${i.message}`));
  }

  const envelope: DraftEnvelope = {
    needsManualFix: !orgName || !validation.success,
    data: validation.success ? validation.data : draftObj,
    ...(issuesAr.length > 0 ? { issuesAr } : {}),
  };
  return { draft: envelope, quotes: quoteTexts.slice(0, 5).map((q) => ({ url, quote: q })), provider };
}
