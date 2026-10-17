/**
 * Masar — محوّل النموذج اللغوي (T6)
 * =====================================================
 * نقطة عبور خادمية موحّدة إلى OpenAI Responses API أو GLM (بحسب الإعداد)،
 * لجميع أغراض المنصة، مع مهلة وسجل آمن لا يخزّن الموجّهات/المخرجات الخام.
 *   EXTRACTION | SUGGESTION | DRAFT_FROM_URL | PITCH_AGENT
 *
 * تصميم المسار:
 *   1) محاولة مزوّد حيّ مهيّأ بمهلة محددة (OpenAI أو GLM).
 *   2) أي فشل (خطأ/مهلة/نص فارغ/تكوين غائب) → مسار الطوارئ «mock-replay»:
 *      usedFallback=true مع errorCode، والمحتوى الحتمي لكل غرض يُبنى في ملف الغرض
 *      (extract.ts / suggest.ts / draft.ts) الذي يقرأ usedFallback.
 *   3) تسجيل AiRun في القاعدة عبر prisma (من @/lib/server/api — المحوّل على الطرف
 *      ومسموح له بالوصول للقاعدة) بلا أي نص خام: لا الموجّه ولا جزءًا منه ولا المخرجات —
 *      بصمة sha256 بطول 16 محرفًا فقط.
 *
 * خادم فقط: هذا الملف وكل ملفات src/lib/ai لا تُستورد في مكونات عميلة أبدًا
 * (z-ai-web-dev-sdk للخادم حصرًا).
 *
 * جسر الحراس (T5 بالتوازي): يُحمَّل @/lib/core/guards ديناميكيًّا عند توفره،
 * وإن لم يكن منجزًا بعد فتُستعمل بدائل محلية مطابقة لتواقيع العقد §5 ودلالات §9.
 * الالتزام النهائي عند التكامل: دوال T5 هي المرجع، والبدائل مؤقتة.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/server/api";
import type {
  CitationCheckResult,
  GuardFlag,
  LlmRequest,
  LlmResponse,
  Slide,
  SuggestionGuardReport,
} from "@/lib/core/types";

const LLM_TIMEOUT_MS = 60_000;
const FALLBACK_PROVIDER = "mock-replay";
const FALLBACK_MODEL = "masar-mock-replay/1";
const OPENAI_DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-6.1-sol";

/** True only when a live provider can plausibly be called; never treats mock-replay as live AI. */
export function hasConfiguredLlmProvider(): boolean {
  const provider = (process.env.MASAR_LLM_PROVIDER || "auto").toLowerCase();
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY?.trim());
  if (provider === "glm") return Boolean(process.env.ZAI_API_KEY?.trim() || process.env.Z_AI_API_KEY?.trim() || existsSync(path.join(process.cwd(), ".z-ai-config")));
  return Boolean(process.env.OPENAI_API_KEY?.trim() || process.env.ZAI_API_KEY?.trim() || process.env.Z_AI_API_KEY?.trim() || existsSync(path.join(process.cwd(), ".z-ai-config")));
}

/** فرض مسار الطوارئ (للفحوص الحتمية/CI): MASAR_AI_FORCE_FALLBACK=1 */
export function isForcedFallback(): boolean {
  return process.env.MASAR_AI_FORCE_FALLBACK === "1";
}

// ————————————————————————————————————————————————
// runLlm — التوقيع الملزم (عقد §5)
// ————————————————————————————————————————————————

export async function runLlm(
  req: LlmRequest,
  meta: { deckVersionId?: string; userId?: string } = {},
): Promise<LlmResponse> {
  const startedAt = Date.now();
  const promptFingerprint = fingerprint(req.systemPrompt);
  let errorCode: string | undefined;
  const providerSetting = (process.env.MASAR_LLM_PROVIDER || "auto").toLowerCase();
  const useOpenAi = providerSetting === "openai" || (providerSetting !== "glm" && Boolean(process.env.OPENAI_API_KEY?.trim()));

  if (!isForcedFallback()) {
    try {
      const liveCall = useOpenAi ? callOpenAi(req) : callGlm(req);
      const timeoutMs = Math.max(1_000, req.timeoutMs ?? LLM_TIMEOUT_MS);
      const outcome = await withTimeout(liveCall, timeoutMs, "LLM_TIMEOUT");
      const outputText = (outcome?.text ?? "").trim();
      if (outputText.length > 0) {
        const latencyMs = Date.now() - startedAt;
        const provider = outcome.provider ?? (useOpenAi ? "openai" : "glm");
        const model = outcome.modelVersion ?? req.model ?? (useOpenAi ? OPENAI_DEFAULT_MODEL : "glm");
        await logAiRun({
          purpose: req.purpose, provider, model, modelVersion: outcome.modelVersion ?? null,
          promptFingerprint, inputTokens: outcome.inputTokens ?? null, outputTokens: outcome.outputTokens ?? null,
          latencyMs, success: true, errorCode: null, deckVersionId: meta.deckVersionId ?? null,
          userId: meta.userId ?? null,
        });
        return {
          text: outputText, provider, model, latencyMs,
          inputTokens: outcome.inputTokens ?? undefined, outputTokens: outcome.outputTokens ?? undefined,
          usedFallback: false,
        };
      }
      errorCode = "LLM_EMPTY";
    } catch (e) {
      errorCode = errorCodeOf(e);
      // لا تُسجّل الحمولة أو المفتاح. تُسجّل الشيفرة فقط في قاعدة البيانات.
      console.error(`[ai] provider call failed (${req.purpose}) code=${errorCode}`);
    }
  } else {
    errorCode = "LLM_DISABLED";
  }

  const latencyMs = Date.now() - startedAt;
  const response = mockReplayResponse(req, errorCode, latencyMs);
  await logAiRun({
    purpose: req.purpose, provider: FALLBACK_PROVIDER, model: FALLBACK_MODEL, modelVersion: null,
    promptFingerprint, inputTokens: null, outputTokens: null, latencyMs, success: false,
    errorCode: errorCode ?? "LLM_ERROR", deckVersionId: meta.deckVersionId ?? null, userId: meta.userId ?? null,
  });
  return response;
}

/**
 * مسار الطوارئ «mock-replay» — دالة داخلية تحدد النتائج المسجّلة (المغلف):
 * provider=mock-replay + errorCode + نص فارغ (لا شبكة إطلاقًا).
 * المحتوى الحتمي لكل غرض (regex/قالبي) يُبنى في ملف الغرض اعتمادًا على usedFallback=true،
 * لأن البناء يحتاج المدخلات المهيكلة (شرائح/نص صفحة) لا مغلف الطلب.
 */
function mockReplayResponse(req: LlmRequest, errorCode: string | undefined, latencyMs: number): LlmResponse {
  return {
    text: "",
    provider: FALLBACK_PROVIDER,
    model: FALLBACK_MODEL,
    latencyMs,
    usedFallback: true,
    errorCode: errorCode ?? "LLM_ERROR",
  };
}

// ————————————————————————————————————————————————
// استدعاء GLM (z-ai-web-dev-sdk) — خادم فقط
// ————————————————————————————————————————————————

interface GlmOutcome {
  text: string;
  provider?: string;
  modelVersion: string | null;
  inputTokens?: number;
  outputTokens?: number;
}

async function callGlm(req: LlmRequest): Promise<GlmOutcome> {
  // استيراد ديناميكي: لا يُحمَّل الـ SDK إلا عند أول استدعاء فعلي
  const ZAI = (await import("z-ai-web-dev-sdk")).default;
  const zai = await ZAI.create();
  const body: Record<string, unknown> = {
    messages: [
      { role: "system", content: req.systemPrompt },
      { role: "user", content: req.userPayload },
    ],
    thinking: { type: "disabled" }, // لا تفكير داخلي: مخرجات JSON صارمة
  };
  if (typeof req.maxTokens === "number" && req.maxTokens > 0) body.max_tokens = req.maxTokens;

  const completion = (await zai.chat.completions.create(body as never)) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const rawText = completion?.choices?.[0]?.message?.content;
  return {
    text: typeof rawText === "string" ? rawText : "",
    modelVersion: completion?.model ?? null,
    inputTokens: completion?.usage?.prompt_tokens,
    outputTokens: completion?.usage?.completion_tokens,
  };
}


/** OpenAI Responses API provider; API keys are read only from server-side environment variables. */
async function callOpenAi(req: LlmRequest): Promise<GlmOutcome> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw Object.assign(new Error("OPENAI_API_KEY is not configured"), { code: "LLM_CONFIG" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1_000, req.timeoutMs ?? LLM_TIMEOUT_MS));
  try {
    const model = req.model || OPENAI_DEFAULT_MODEL;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        instructions: req.systemPrompt,
        input: req.userPayload,
        max_output_tokens: req.maxTokens ?? 1_200,
        ...(req.reasoningEffort ? { reasoning: { effort: req.reasoningEffort } } : {}),
        text: { format: { type: "json_object" } },
      }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const err = payload && typeof payload === "object" ? (payload as { error?: { code?: string; message?: string } }).error : undefined;
      const code = typeof err?.code === "string" ? err.code : `OPENAI_HTTP_${response.status}`;
      throw Object.assign(new Error(code), { code: response.status === 401 ? "LLM_CONFIG" : code });
    }
    const item = payload as {
      id?: string; model?: string; output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const outputText = typeof item.output_text === "string" ? item.output_text :
      (item.output ?? []).flatMap(block => block.content ?? []).filter(part => part.type === "output_text" && typeof part.text === "string").map(part => part.text).join("\n");
    return {
      text: outputText, provider: "openai", modelVersion: item.model ?? model,
      inputTokens: item.usage?.input_tokens, outputTokens: item.usage?.output_tokens,
    };
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error("OpenAI request timed out"), { code: "LLM_TIMEOUT" });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`تجاوز المهلة ${ms}ms`);
      (err as Error & { code?: string }).code = code;
      reject(err);
    }, ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer); // لا تُبقِ العملية حية بمؤقّت معلّق
  }
}

function errorCodeOf(e: unknown): string {
  const code = (e as { code?: string })?.code;
  if (typeof code === "string" && code.length > 0) return code;
  const msg = (e as Error)?.message ?? "";
  if (/timeout|مهلة/i.test(msg)) return "LLM_TIMEOUT";
  if (/config|\.z-ai-config|apiKey|baseUrl|OPENAI_API_KEY/i.test(msg)) return "LLM_CONFIG";
  if (/network|fetch|ECONN/i.test(msg)) return "LLM_NETWORK";
  return "LLM_ERROR";
}

// ————————————————————————————————————————————————
// AiRun — سجل بلا نص خام (سياسة الخطة: لا موجهات ولا مخرجات في القاعدة)
// ————————————————————————————————————————————————

interface AiRunRow {
  purpose: string;
  provider: string;
  model: string;
  modelVersion: string | null;
  promptFingerprint: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  success: boolean;
  errorCode: string | null;
  deckVersionId: string | null;
  userId: string | null;
}

async function logAiRun(row: AiRunRow): Promise<void> {
  try {
    await prisma.aiRun.create({
      data: {
        purpose: row.purpose,
        provider: row.provider,
        model: row.model,
        modelVersion: row.modelVersion,
        promptFingerprint: row.promptFingerprint,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        latencyMs: row.latencyMs,
        success: row.success,
        errorCode: row.errorCode,
        deckVersionId: row.deckVersionId,
        userId: row.userId,
      },
    });
  } catch (e) {
    // فشل التسجيل لا يُسقط المسار الوظيفي — لكن يُبلَّغ بلا أي بيانات حساسة
    console.error(`[ai] تعذّر تسجيل AiRun (${row.purpose}/${row.provider}): ${(e as Error)?.message ?? "غير معروف"}`);
  }
}

/** بصمة الموجّه: sha256 → أول 16 محرفًا سداسية عشرية (لا علاقة عكسية بالنص) */
export function fingerprint(systemPrompt: string): string {
  return createHash("sha256").update(systemPrompt, "utf8").digest("hex").slice(0, 16);
}

// ————————————————————————————————————————————————
// جسر الحراس (T5) — تحميل @/lib/core/guards إن وُجد، وإلا بدائل محلية بالعقد نفسه
// ————————————————————————————————————————————————

export interface GuardsContract {
  citationCheck: (slides: Slide[], page: number, quote: string) => CitationCheckResult;
  suggestionGuard: (originalSlideText: string, confirmedFacts: string[], suggestion: string) => SuggestionGuardReport;
  redactPii: (text: string) => { redacted: string; replacements: number };
  detectPromptInjection: (text: string) => { suspicious: boolean; patterns: string[] };
}

let guardsCache: GuardsContract | undefined;

export async function loadGuards(): Promise<GuardsContract> {
  if (guardsCache !== undefined) return guardsCache;
  try {
    // مسار حرفي: يسمح لحواسم الحزم (Turbopack/webpack) بحزمه متى وُجد ملف T5
    // @ts-ignore — قد لا يكون guards.ts (T5) منجزًا بعد؛ التواقيع من عقد §5 ويتكامل تلقائيًّا متى وُجد
    const mod = (await import("@/lib/core/guards")) as unknown as Partial<GuardsContract>;
    if (mod && typeof mod.citationCheck === "function" && typeof mod.suggestionGuard === "function") {
      guardsCache = {
        citationCheck: mod.citationCheck,
        suggestionGuard: mod.suggestionGuard,
        redactPii: typeof mod.redactPii === "function" ? mod.redactPii : localRedactPii,
        detectPromptInjection: typeof mod.detectPromptInjection === "function" ? mod.detectPromptInjection : localDetectPromptInjection,
      };
      return guardsCache;
    }
  } catch {
    // guards.ts غائب حاليًّا (T5 بالتوازي) — البدائل المحلية أدناه
  }
  guardsCache = LOCAL_GUARDS;
  return guardsCache;
}

// ————— بدائل محلية مؤقتة (مطابقة لتواقيع العقد §5 ودلالات §9) —————
// ملاحظة: عند إنجاز T5 تُستبدل تلقائيًّا بدواله (جلب ديناميكي أعلاه).

const LOCAL_GUARDS: GuardsContract = {
  citationCheck: localCitationCheck,
  suggestionGuard: localSuggestionGuard,
  redactPii: localRedactPii,
  detectPromptInjection: localDetectPromptInjection,
};

/** تطبيع نص عربي/إنجليزي: تشكيل/تطويل/همزات/مسافات/ترقيم/أرقام هندية↔غربية (عقد §9) */
export function localNormalizeText(s: string): string {
  let out = (s ?? "").toLowerCase();
  out = out.replace(/\u0640/g, ""); // تطويل
  out = out.replace(/[\u064B-\u0652\u0670\u06D6-\u06ED]/g, ""); // تشكيل وعلامات
  out = out.replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ة/g, "ه");
  out = out.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  out = out.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  // فواصل الأرقام والنِّسب تُحذف (توصيل) حتى يتطابق "500,000" مع "500000" و"40%" مع "40"
  out = out.replace(/[٬,،%٪]/g, "");
  // بقية علامات الترقيم والرموز → مسافة
  out = out.replace(/[.!?؟؛:؛"'`«»()\[\]{}<>/\\|@#$^&*_=+~\-—–…؛\n\r\t]/g, " ");
  return out.replace(/\s+/g, " ").trim();
}

function localCitationCheck(slides: Slide[], page: number, quote: string): CitationCheckResult {
  const flags: GuardFlag[] = [];
  const normalizedQuote = localNormalizeText(quote ?? "");
  if (!normalizedQuote) {
    flags.push({ rule: "EMPTY_QUOTE", detailAr: "اقتباس فارغ أو غير صالح" });
    return { passed: false, flags, normalizedQuote };
  }
  const slide = Array.isArray(slides) ? slides.find((s) => s && s.index === page) : undefined;
  if (!slide) {
    flags.push({ rule: "PAGE_OUT_OF_RANGE", detailAr: "الصفحة خارج نطاق شرائح العرض" });
    return { passed: false, flags, normalizedQuote };
  }
  const haystack = localNormalizeText(`${slide.title ?? ""} ${slide.text ?? ""}`);
  if (!haystack.includes(normalizedQuote)) {
    flags.push({ rule: "QUOTE_NOT_FOUND", detailAr: "الاقتباس غير موجود في الشريحة" });
    return { passed: false, flags, normalizedQuote };
  }
  return { passed: true, flags: [], normalizedQuote };
}

// — صيغ التفوق غير المدعومة (عقد §9) —
const SUPERLATIVE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /الأفضل|الأضخم|الأكبر|الأسرع|الأعلى|الأمثل|الأكثر تميز|فريد من نوعه|رقم واحد|الأول عالميا|الاول عالميا|ثوري|ريادة السوق/i, label: "صيغة تفوق عربية" },
  { re: /\b(best|largest|biggest|fastest|greatest|leading|world[- ]?class|revolutionary|game[- ]?changer|best[- ]in[- ]class|market leader)\b/i, label: "صيغة تفوق إنجليزية" },
  { re: /(#1|no\.?\s?1|number\s?1|world'?s first|first ever|top 1)\b/i, label: "ادعاء تصنيف أول" },
];

function extractNumericValues(text: string): number[] {
  const norm = normalizeDigits(text.toLowerCase());
  const values: number[] = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(k|m|b|ألف|آلاف|الف|مليون|مليار)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (!isFinite(n)) continue;
    const mult = m[2] ? MULTIPLIER[m[2].toLowerCase()] : 1;
    values.push(n * mult);
  }
  return values;
}

const MULTIPLIER: Record<string, number> = {
  k: 1e3, m: 1e6, b: 1e9,
  "ألف": 1e3, "آلاف": 1e3, "الف": 1e3,
  "مليون": 1e6, "مليار": 1e9,
};

const NAME_STOPWORDS = new Set(["we", "our", "the", "team", "their", "this", "that", "with", "for", "and", "they", "you", "your", "more", "from", "into", "about", "using", "based"]);

function extractProperNouns(text: string): string[] {
  const out: string[] = [];
  const re = /\b[A-Z][a-z]{2,}\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const w = m[0];
    if (!NAME_STOPWORDS.has(w.toLowerCase())) out.push(w);
  }
  return out;
}

function localSuggestionGuard(
  originalSlideText: string,
  confirmedFacts: string[],
  suggestion: string
): SuggestionGuardReport {
  const flags: GuardFlag[] = [];
  const suggestionText = suggestion ?? "";
  // 1) أرقام جديدة لم ترد في الشريحة أو الحقائق المؤكدة
  const allowedNumbers = extractNumericValues(`${originalSlideText} ${confirmedFacts.join(" ")}`);
  for (const v of extractNumericValues(suggestionText)) {
    if (!allowedNumbers.includes(v)) {
      flags.push({ rule: "NEW_FACT", detailAr: `رقم جديد لم يرد في الشريحة أو الحقائق المؤكدة: ${v}`, matched: String(v) });
    }
  }
  // 2) أسماء علم (لاتينية) جديدة
  const originalNorm = localNormalizeText(`${originalSlideText} ${confirmedFacts.join(" ")}`);
  for (const name of extractProperNouns(suggestionText)) {
    if (!originalNorm.includes(localNormalizeText(name))) {
      flags.push({ rule: "NEW_FACT", detailAr: `اسم لم يرد في الشريحة أو الحقائق المؤكدة: ${name}`, matched: name });
    }
  }
  // 3) صيغ تفوق غير مدعومة
  const suggestionNorm = localNormalizeText(suggestionText);
  for (const p of SUPERLATIVE_PATTERNS) {
    const m = p.re.exec(suggestion) ?? p.re.exec(suggestionNorm);
    if (m) {
      flags.push({ rule: "UNSUPPORTED_SUPERLATIVE", detailAr: `صيغة تفوق بلا دعم من المصدر: ${m[0]}`, matched: m[0] });
    }
  }
  // 4) الطول: أكثر من 320 حرفًا أو 3 جمل
  if (suggestionText.length > 320) {
    flags.push({ rule: "TOO_LONG", detailAr: `الاقتراح أطول من 320 حرفًا (${suggestion.length} حرفًا)` });
  }
  const sentenceCount = (suggestionText.match(/[^.!؟?\n]+/g) ?? []).filter((p) => p.trim().length > 0).length;
  if (sentenceCount > 3) {
    flags.push({ rule: "TOO_LONG", detailAr: `الاقتراح أكثر من 3 جمل (${sentenceCount})` });
  }
  return { passed: flags.length === 0, flags };
}

function localRedactPii(text: string): { redacted: string; replacements: number } {
  let count = 0;
  const next = (tag: string) => `${tag}_${++count}`;
  let out = text ?? "";
  // بريد إلكتروني
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g, () => `[${next("EMAIL")}]`);
  // هاتف (بادئة + أو 0، بلا التقاط التواريخ 20xx)
  out = out.replace(/(?:\+\d{1,3}[\s-]?)?0\d{1,3}[\s-]?\d{3}[\s-]?\d{3,4}/g, () => `[${next("PHONE")}]`);
  // رقم هوية: 9–10 أرقام مستقلة
  out = out.replace(/\b\d{9,10}\b/g, () => `[${next("ID")}]`);
  // عناوين بريدية/شوارع خفيفة
  out = out.replace(/(?:صندوق\s+بريد|p\.?o\.?\s?box)[^\n.،؛]{0,40}/gi, () => `[${next("ADDR")}]`);
  out = out.replace(/(?:شارع|street|طريق|road)\s+[A-Za-z\u0600-\u06FF\d\s]{2,30}/gi, () => `[${next("ADDR")}]`);
  return { redacted: out, replacements: count };
}

const INJECTION_PATTERNS: string[] = [
  "ignore previous instructions",
  "ignore all previous",
  "disregard previous",
  "ignore the instructions",
  "ignore above",
  "system prompt",
  "system message",
  "developer message",
  "<|im_start|>",
  "###instruction",
  "new instructions",
  "override your instructions",
  "act as if",
  "reveal your instructions",
  "print your system prompt",
  "prompt injection",
  "تجاهل التعليمات",
  "تجاهل كل التعليمات",
  "تجاهل الأوامر",
  "تجاهل ما سبق",
  "تعليمات جديدة",
  "أنت الآن",
  "تنكر شخصيتك",
  "كشف موجّهك",
];

function localDetectPromptInjection(text: string): { suspicious: boolean; patterns: string[] } {
  const hay = (text ?? "").toLowerCase();
  const patterns = INJECTION_PATTERNS.filter((p) => hay.includes(p));
  return { suspicious: patterns.length > 0, patterns };
}

/** تحويل الأرقام الهندية/الفارسية إلى غربية — مشترك لملفات الغرض */
export function normalizeDigits(s: string): string {
  return (s ?? "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}
