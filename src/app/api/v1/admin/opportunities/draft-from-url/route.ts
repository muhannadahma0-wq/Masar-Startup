/**
 * Masar — T10: POST /api/v1/admin/opportunities/draft-from-url — مسودة آلية من رابط (Should)
 * =============================================================================
 * REVIEWER/ADMIN فقط. المسار:
 *  1) ssrfGuard (من @/lib/ai/draft — T6) — مرفوض → 403 SSRF_BLOCKED.
 *  2) جلب الصفحة: مهلة 15 ث لكل قفزة، UA «MasarBot/1.0 (contact@masar.example)»،
 *     حدود: حجم ≤ 2MB، إعادة توجيه ≤ 3 (كل وجهة تُعاد فحصها بssrfGuard)،
 *     Content-Type نصي أو html (text/* أو يحوي html/xhtml/xml — موثّق).
 *     الفشل (مهلة/شبكة/حجم/توجيه/نوع محتوى/رمز خطأ) → 502 FETCH_FAILED عربي.
 *  3) النص: إزالة الوسوم بregex بسيط + فك الكيانات → draftOpportunityFromPage
 *     (T6) — لا نسخ كامل الصفحة: الحقول والاقتباسات فقط.
 *  4) من مخرج المسار تُنشأ DRAFT مع تعليم «مسودة آلية من رابط — تحتاج مراجعة»
 *     (بادئة في الوصف)، والاقتباسات الحرفية تُخزَّن Evidence وترتبط بالشروط
 *     بالترتيب (الشرط i ← الاقتباس i إن وُجد — القرار موثّق: اقتباس حرفي من
 *     الصفحة المُتحقَّقة، والربط تقديري يعيد المراجع البشري ترتيبه).
 *     verifiedAt للأدلة = الآن (الجلب الفعلي للصفحة الآن).
 *  5) إن احتاجت المسودة تصحيحًا يدويًّا (needsManualFix) → 422
 *     DRAFT_NEEDS_MANUAL_FIX مع بيانات المسودة والمشكلات (يُنشئها المراجع
 *     بعد التصحيح عبر POST /admin/opportunities) — لا يُنشأ سجل ناقص.
 *  6) audit DRAFT_FROM_URL (نجاح أو حاجة تصحيح).
 */
import { NextRequest } from "next/server";
import {
  ok, fail, parseBody, requireRole, assertSameOrigin, audit, handleRouteError,
  prisma, ApiErrorClass,
} from "@/lib/server/api";
import { DraftFromUrlInput, OpportunityCreateInput } from "@/lib/schemas";
import { ssrfGuard, draftOpportunityFromPage } from "@/lib/ai/draft";
import { normalizeUrl } from "@/lib/core/text";
import { parseIsoDate } from "@/lib/server/conditions";

export const dynamic = "force-dynamic";

const USER_AGENT = "MasarBot/1.0 (contact@masar.example)";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_REDIRECTS = 3;
const MAX_TEXT_CHARS = 30_000; // سقف النص الممرر لمسار المسودة (لا نسخ كامل الصفحة)
const AUTO_DRAFT_MARKER = "【مسودة آلية من رابط — تحتاج مراجعة بشرية】";

interface DraftEnvelope {
  needsManualFix: boolean;
  data: unknown;
  issuesAr?: string[];
}

interface FetchedPage {
  text: string;
  finalUrl: string;
  bytes: number;
  contentType: string;
}

function fetchFailure(messageAr: string, details?: unknown): ApiErrorClass {
  return new ApiErrorClass("FETCH_FAILED", messageAr, 502, details);
}

/** هل Content-Type نصي أو html؟ (فارغ يُقبل — بعض الخوادم لا ترسل النوع). */
function isTextyContentType(ct: string): boolean {
  const c = ct.toLowerCase();
  return (
    c === "" ||
    c.startsWith("text/") ||
    c.includes("html") ||
    c.includes("xhtml") ||
    c.includes("xml")
  );
}

function decodeBody(bytes: Uint8Array, contentType: string): string {
  const m = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType);
  if (m) {
    try {
      return new TextDecoder(m[1]).decode(bytes);
    } catch {
      // ترميز غير مدعوم — السقوط إلى utf-8
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** جلب الصفحة بالحدود: مهلة 15 ث، توجيه ≤ 3، حجم ≤ 2MB، نوع نصي/html. */
async function fetchPage(startUrl: string): Promise<FetchedPage> {
  let currentUrl = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        redirect: "manual",
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        },
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      throw fetchFailure("تعذّر جلب الصفحة (مهلة 15 ثانية أو خطأ شبكة)", { url: currentUrl });
    }
    clearTimeout(timer);

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      if (!location) {
        throw fetchFailure("إعادة توجيه بلا وجهة واضحة", { url: currentUrl, status: res.status });
      }
      let next: string;
      try {
        next = new URL(location, currentUrl).toString();
      } catch {
        throw fetchFailure("وجهة إعادة توجيه غير صالحة", { url: currentUrl, location });
      }
      // كل قفزة توجيه تعيد فحص SSRF (منع الانزلاق إلى شبكة داخلية)
      const guard = ssrfGuard(next);
      if (!guard.allowed) {
        throw new ApiErrorClass("SSRF_BLOCKED", "إعادة توجيه إلى هدف ممنوع: " + (guard.reasonAr ?? ""), 403, {
          url: next,
        });
      }
      if (hop === MAX_REDIRECTS) {
        throw fetchFailure("تجاوز الحد الأقصى لإعادة التوجيه (3)", { url: next });
      }
      currentUrl = next;
      continue;
    }

    if (!res.ok) {
      throw fetchFailure(`تعذّر جلب الصفحة (رمز HTTP ${res.status})`, { url: currentUrl, status: res.status });
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!isTextyContentType(contentType)) {
      throw fetchFailure("نوع محتوى غير نصي — يُسمح بالنص أو html فقط", { url: currentUrl, contentType });
    }

    // الحجم: فحص Content-Length ثم قراءة مبثوثة بسقف صارم
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      throw fetchFailure("حجم الصفحة يتجاوز الحد المسموح (2MB)", { url: currentUrl, declaredBytes: declared });
    }
    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      if (text.length > MAX_BYTES) {
        throw fetchFailure("حجم الصفحة يتجاوز الحد المسموح (2MB)", { url: currentUrl });
      }
      return { text, finalUrl: currentUrl, bytes: text.length, contentType };
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw fetchFailure("حجم الصفحة يتجاوز الحد المسموح (2MB)", { url: currentUrl });
        }
        chunks.push(value);
      }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return { text: decodeBody(merged, contentType), finalUrl: currentUrl, bytes: total, contentType };
  }
  throw fetchFailure("تجاوز الحد الأقصى لإعادة التوجيه (3)", { url: startUrl });
}

/** إزالة الوسوم بregex بسيط + فك كيانات HTML شائعة (لا DOM كامل). */
function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol|tr|td|th|h[1-6]|section|article|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&#x(\d+);/gi, (_, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(Number(d)))
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (s.length > MAX_TEXT_CHARS) s = s.slice(0, MAX_TEXT_CHARS);
  return s;
}

function safeCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 1 || cp > 0x10ffff) return " ";
  try {
    return String.fromCodePoint(cp);
  } catch {
    return " ";
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireRole(req, ["REVIEWER", "ADMIN"]);
    const { url } = await parseBody(req, DraftFromUrlInput);

    // 1) حارس SSRF
    const guard = ssrfGuard(url);
    if (!guard.allowed) {
      return fail("SSRF_BLOCKED", guard.reasonAr ?? "رابط ممنوع لأسباب أمنية", 403, { url });
    }

    // 2) جلب الصفحة بالحدود
    const page = await fetchPage(url);

    // 3) النص → مسودة عبر T6
    const pageText = htmlToText(page.text);
    if (pageText.trim() === "") {
      return fail("FETCH_FAILED", "نص الصفحة فارغ بعد التنظيف — لا يمكن بناء مسودة", 502, { url });
    }
    const result = await draftOpportunityFromPage(pageText, url, { userId: user.id });
    const draft = result.draft as DraftEnvelope;

    // 4) مسودة تحتاج تصحيحًا يدويًّا → لا سجل ناقص
    if (draft.needsManualFix) {
      await audit(user.id, "DRAFT_FROM_URL", "Opportunity", "none", {
        url,
        provider: result.provider,
        needsManualFix: true,
        issuesAr: draft.issuesAr ?? [],
      });
      return fail(
        "DRAFT_NEEDS_MANUAL_FIX",
        "المسودة الآلية تحتاج تصحيحًا يدويًّا قبل إنشائها — راجع المشكلات ثم أنشئ الفرصة عبر POST /admin/opportunities",
        422,
        { draft: draft.data, issuesAr: draft.issuesAr ?? [], provider: result.provider, quotes: result.quotes }
      );
    }

    // 5) التحقق النهائي بمخطط الإنشاء (يضيق النوع من unknown)
    const parsed = OpportunityCreateInput.safeParse(draft.data);
    if (!parsed.success) {
      await audit(user.id, "DRAFT_FROM_URL", "Opportunity", "none", {
        url, provider: result.provider, needsManualFix: true,
        issuesAr: parsed.error.issues.map((i) => `${i.path.join(".") || "(جذر)"}: ${i.message}`),
      });
      return fail(
        "DRAFT_NEEDS_MANUAL_FIX",
        "مخرج المسودة الآلية لم يجتز التحقق — صحّحه يدويًّا ثم أنشئ الفرصة",
        422,
        {
          draft: draft.data,
          issuesAr: parsed.error.issues.map((i) => `${i.path.join(".") || "(جذر)"}: ${i.message}`),
          provider: result.provider,
          quotes: result.quotes,
        }
      );
    }
    const data = parsed.data;

    // 6) تكرار الرابط الموحّد
    const normalizedUrl = normalizeUrl(data.applicationUrl);
    const dupe = await prisma.opportunity.findFirst({
      where: { normalizedUrl },
      select: { id: true, title: true, status: true },
    });
    if (dupe) {
      return fail("CONFLICT", "توجد فرصة أخرى بنفس رابط التقديم بعد التوحيد", 409, {
        normalizedUrl, existingId: dupe.id, existingTitle: dupe.title, existingStatus: dupe.status,
      });
    }

    // 7) إنشاء DRAFT مع التعليم + الاقتباسات كأدلة (الشرط i ← الاقتباس i)
    const now = new Date();
    const quotes = result.quotes;
    const markedDescription = `${AUTO_DRAFT_MARKER}\n${data.description ?? ""}`.slice(0, 4000);

    const opp = await prisma.opportunity.create({
      data: {
        title: data.title,
        orgName: data.orgName,
        description: markedDescription,
        status: "DRAFT",
        type: data.type,
        fundingType: data.fundingType ?? null,
        amountMin: data.amountMin ?? null,
        amountMax: data.amountMax ?? null,
        currency: data.currency,
        sectorsJson: JSON.stringify(data.sectors),
        stageMin: data.stageMin ?? null,
        stageMax: data.stageMax ?? null,
        geography: data.geography,
        geoPriority: data.geoPriority,
        languagesJson: JSON.stringify(data.languages),
        applicationUrl: data.applicationUrl,
        normalizedUrl,
        sourceType: data.sourceType,
        deadline: data.deadline ? parseIsoDate(data.deadline, "الموعد النهائي") : null,
        deadlineTz: data.deadlineTz,
        requiresDocsJson: JSON.stringify(data.requiresDocs),
        createdById: user.id,
        conditions: {
          create: data.conditions.map((c, i) => {
            const quote = i < quotes.length ? quotes[i] : null;
            return {
              field: c.field,
              op: c.op,
              valueJson: JSON.stringify(c.value === undefined ? null : c.value),
              mandatory: c.mandatory,
              ambiguous: c.ambiguous,
              scope: c.scope,
              sourceWording: c.sourceWording ?? null,
              ...(quote
                ? {
                    evidence: {
                      create: { url: quote.url, quote: quote.quote, verifiedAt: now },
                    },
                  }
                : {}),
            };
          }),
        },
      },
      include: { conditions: { include: { evidence: true }, orderBy: { id: "asc" } } },
    });

    await audit(user.id, "DRAFT_FROM_URL", "Opportunity", opp.id, {
      url,
      finalUrl: page.finalUrl,
      provider: result.provider,
      needsManualFix: false,
      opportunityId: opp.id,
      quotesCount: quotes.length,
      fetchedBytes: page.bytes,
    });

    return ok(
      {
        opportunity: opp,
        provider: result.provider,
        quotes: quotes.length,
        evidenceLinked: Math.min(quotes.length, data.conditions.length),
        fetchedBytes: page.bytes,
        note: "مسودة آلية من رابط — تحتاج مراجعة بشرية قبل الإرسال للنشر",
        nextStep: "submit-review",
      },
      201
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
