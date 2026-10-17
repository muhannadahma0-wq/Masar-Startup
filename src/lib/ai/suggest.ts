/**
 * Masar — توليد اقتراح تحسين شريحة (T6)
 * =====================================================
 * المسار:
 *   (1) موجّه SUGGESTION (ملاحظات التقييم + الحقائق المؤكدة) → runLlm.
 *   (2) GLM: تحليل JSON → suggestionGuard (حراس T5).
 *       فشل الحارس → إعادة محاولة واحدة بموجّه تنبيهي (الأعلام مرفقة).
 *       فشل مجدد → suggestedText="" مع guard.passed=false (فشل آمن للواجهة).
 *       mock-replay: إعادة صياغة قالبية حتمية (ترتيب الجمل بحسب ملاحظات التقييم،
 *       إزالة الحشو وصيغ التفوق، الإبقاء الحرفي على كل الأرقام والأسماء،
 *       جملة خلاصة من الأرقام الموجودة نفسها) — تمرّ بالحارس بالضرورة.
 *   (3) النص خام دائمًا — لا HTML ولا Markdown (XSS-safe).
 *
 * الأصل لا يُعدَّل هنا: القرار accepted/edited/rejected يعالجه T13.
 * خادم فقط — لا يُستورد في مكونات عميلة.
 */
import { z } from "zod";
import { runLlm, loadGuards, normalizeDigits } from "./adapter";
import {
  suggestionSystemPrompt,
  suggestionUserPayload,
  suggestionRetryPayload,
} from "./prompts";
import { splitSentences, parseJsonLoose } from "./extract";
import type { GuardFlag, LlmRequest, Slide, SuggestionGuardReport } from "@/lib/core/types";

export type SuggestionMeta = { deckVersionId?: string; userId?: string };

const SuggestionJson = z.object({
  suggestion: z.string().min(1).max(2000),
  reason: z.string().max(1000).default(""),
});

// ————————————————————————————————————————————————
// T6/§5: generateSuggestion — التوقيع الملزم (meta اختيارية لا تكسر العقد)
// ————————————————————————————————————————————————

export async function generateSuggestion(
  slide: Slide,
  evaluationNotesAr: string[],
  confirmedFacts: string[],
  meta: SuggestionMeta = {}
): Promise<{
  suggestedText: string;
  reasonAr: string;
  guard: SuggestionGuardReport;
  provider: string;
}> {
  const guards = await loadGuards();
  const notes = evaluationNotesAr ?? [];
  const facts = confirmedFacts ?? [];

  // إخفاء PII قبل أي استدعاء نموذج (الحراس) — الحارس يقارن بالنص الأصلي
  const redacted = guards.redactPii(slide.text ?? "");

  let lastFlags: GuardFlag[] = [];
  let lastProvider = "glm";

  for (let attempt = 0; attempt < 2; attempt++) {
    const userPayload =
      attempt === 0
        ? suggestionUserPayload(slide.title, redacted.redacted, notes, facts)
        : suggestionRetryPayload(slide.title, redacted.redacted, notes, facts, lastFlags);
    const req: LlmRequest = {
      purpose: "SUGGESTION",
      systemPrompt: suggestionSystemPrompt(),
      userPayload,
      maxTokens: 1024,
    };
    const res = await runLlm(req, meta);
    lastProvider = res.provider;

    // مسار الطوارئ: إعادة صياغة قالبية حتمية (لا معنى لإعادة المحاولة — نفس النتيجة)
    if (res.usedFallback) {
      const local = localRewrite(slide, notes);
      const guard = guards.suggestionGuard(slide.text, facts, local.suggestedText);
      if (guard.passed) {
        return { suggestedText: local.suggestedText, reasonAr: local.reasonAr, guard, provider: res.provider };
      }
      return { suggestedText: "", reasonAr: "تعذّر توليد اقتراح آمن.", guard, provider: res.provider };
    }

    // مسار GLM: تحليل JSON صارم ثم الحارس
    const parsed = parseSuggestionJson(res.text);
    if (!parsed) {
      lastFlags = [
        { rule: "SUSPICIOUS_PATTERN", detailAr: "تعذّر تحليل مخرج النموذج بوصفه JSON صالحًا" },
      ];
      continue; // إعادة محاولة واحدة بموجّه تنبيهي
    }
    const guard = guards.suggestionGuard(slide.text, facts, parsed.suggestion);
    if (guard.passed) {
      return { suggestedText: parsed.suggestion, reasonAr: parsed.reason, guard, provider: res.provider };
    }
    lastFlags = guard.flags;
  }

  // فشل مجدد بعد إعادة المحاولة → فشل آمن (نص فارغ) والواجهة تعرض الفشل
  return {
    suggestedText: "",
    reasonAr: `رُفض الاقتراح مرتين بواسطة حارس الاقتراحات: ${summarizeFlags(lastFlags)}`,
    guard: { passed: false, flags: lastFlags },
    provider: lastProvider,
  };
}

function parseSuggestionJson(text: string): { suggestion: string; reason: string } | null {
  const raw = parseJsonLoose(text);
  if (raw === null || typeof raw !== "object") return null;
  const result = SuggestionJson.safeParse(raw);
  return result.success ? result.data : null;
}

function summarizeFlags(flags: GuardFlag[]): string {
  if (flags.length === 0) return "بلا تفصيل";
  return flags.map((f) => f.detailAr).join("؛ ");
}

// ————————————————————————————————————————————————
// مسار الطوارئ: إعادة صياغة قالبية حتمية (بلا شبكة)
// ————————————————————————————————————————————————

const FILLER_PATTERNS: RegExp[] = [
  /نحن\s+نسعى\s+جاهدين/g, /نسعى\s+جاهدين/g, /فريقنا\s+المميّ?ز/g, /فريقنا\s+الممتاز/g,
  /نحن\s+نعمل\s+بكل\s+جدية/g, /نعمل\s+بلا\s+كلل/g, /بأقصى\s+جهد/g, /نحن\s+فخورون/g,
  /نحن\s+ملتزمون/g, /بشكل\s+عام/g, /كما\s+هو\s+معروف/g, /بكل\s+ثقة/g,
  /in\s+today'?s\s+fast[-\s]?paced\s+world/gi, /we\s+are\s+proud\s+to/gi,
  /hard[-\s]?working/gi, /world[-\s]?class/gi, /as\s+we\s+all\s+know/gi,
];

const SUPERLATIVE_REMOVE: RegExp[] = [
  /الْ?أفضل/g, /الأضخم/g, /الأكبر/g, /الأسرع/g, /الأعلى/g, /الأمثل/g, /الأكثر\s+تميّ?زًا?/g,
  /فريد\s+من\s+نوعه/g, /رقم\s+[1١]/g, /الأول(?:ى)?\s+عالميًّا?/g, /ثوّ?ريّ?ة?/g, /ريادة\s+السوق/g,
  /\brevolutionary\b/gi, /\bworld'?s\s+first\b/gi, /\bbest[-\s]?in[-\s]?class\b/gi,
  /\bmarket\s+leader\b/gi, /\bgame[-\s]?changer\b/gi, /\bnumber\s+1\b/gi, /\bno\.?\s?1\b/gi,
  /\bfirst\s+ever\b/gi, /\btop\s+1\b/gi, /\bleading\b/gi,
];

const AR_STOPWORDS = new Set([
  "في", "من", "على", "إلى", "عن", "مع", "هذا", "هذه", "ذلك", "التي", "الذي", "أن", "إن",
  "كان", "ما", "لا", "و", "أو", "ثم", "قد", "هو", "هي", "نحن", "عند", "كل", "بعض", "غير",
  "بأن", "بدون", "هناك", "ركّز", "ركز", "بحسب", "وفق", "أكثر", "الأرقام", "ارقام", "على",
  "the", "and", "for", "with", "focus",
]);

function cleanSentence(sentence: string): string {
  let out = sentence;
  for (const p of FILLER_PATTERNS) out = out.replace(p, "");
  for (const p of SUPERLATIVE_REMOVE) out = out.replace(p, "");
  return out.replace(/\s{2,}/g, " ").trim();
}

function lightNormalize(s: string): string {
  return normalizeDigits(s)
    .toLowerCase()
    .replace(/\u0640/g, "")
    .replace(/[\u064B-\u0652\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[ًٌٍَُِّْ]/g, "")
    .replace(/[.,!؟?؛:،"'()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function relevanceScore(sentence: string, notes: string[]): number {
  if (notes.length === 0) return 0;
  const normSentence = lightNormalize(sentence);
  let score = 0;
  for (const note of notes) {
    for (const token of lightNormalize(note).split(/\s+/)) {
      const t = token.replace(/^(ال)/, "");
      if (t.length < 3 || AR_STOPWORDS.has(token) || AR_STOPWORDS.has(t)) continue;
      if (normSentence.includes(t)) score += 1;
    }
  }
  // الجمل الحاملة لأرقام أعلى أهمية في العروض
  if (/\d/.test(normalizeDigits(sentence))) score += 2;
  return score;
}

/** المقتطفات الرقمية الحرفية من النص الأصلي (بصيغتها نفسها — لا تُنشئ أرقامًا جديدة) */
function collectNumberLiterals(text: string): string[] {
  const re = /(?:\$|usd)?\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|b|ألف|آلاف|مليون|مليار)?\s*%?/giu;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0].trim();
    if (/\d/.test(normalizeDigits(raw)) && !out.includes(raw)) out.push(raw);
  }
  return out;
}

const LOCAL_REASON_AR =
  "إعادة صياغة قالبية آمنة (مسار الطوارئ دون شبكة): رُتِّبت الجمل بحسب ملاحظات التقييم، وأُزيل الحشو وصيغ التفوق، مع الحفاظ الحرفي على كل الأرقام والأسماء كما وردت في الشريحة.";

export function localRewrite(slide: Slide, notes: string[]): { suggestedText: string; reasonAr: string } {
  const sentences = splitSentences(slide.text ?? "").map((sp) => sp.text);
  const cleaned = sentences.map(cleanSentence).filter((s) => s.trim().length > 2);

  // الترتيب: الأهم أولًا بحسب ملاحظات التقييم (ثم الأقصر للأطول للانضباط بالحد)
  const scored = cleaned
    .map((s) => ({ text: s, score: relevanceScore(s, notes) }))
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length);

  // جملة خلاصة من الأرقام الموجودة نفسها (إن وجدت) — إعادة عرض حرفية لا إضافة
  const literals = collectNumberLiterals(slide.text ?? "");
  const summary = literals.length > 0 ? `خلاصة الشريحة: ${literals.slice(0, 3).join(" و")}.` : "";

  const parts: string[] = [];
  if (summary) parts.push(summary);
  for (const item of scored) {
    if (parts.length >= 3) break; // حد الحارس: 3 جمل
    if (item.text.length > 280) continue; // جملة طويلة جدًّا تهدد حد 320 حرفًا
    const projected = parts.join(" ").length + (parts.length ? 1 : 0) + item.text.length;
    if (projected > 300) continue; // هامش أمان تحت حد 320
    parts.push(item.text);
  }

  let suggested = parts.join(" ").replace(/\s{2,}/g, " ").trim();
  if (suggested.length > 320) suggested = summary; // احتياط نهائي لا يقصّ أرقامًا أبدًا

  return { suggestedText: suggested, reasonAr: LOCAL_REASON_AR };
}
