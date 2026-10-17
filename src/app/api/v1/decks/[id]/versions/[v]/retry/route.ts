/**
 * Masar — T12: إعادة معالجة نسخة PARTIAL
 * POST /api/v1/decks/[id]/versions/[v]/retry
 * =====================================================
 * متاحة فقط للنسخ بحالة PARTIAL (READY/FAILED → 409). تعيد تشغيل التحليل كله
 * من slidesJson المخزنة — دون إعادة رفع الملف — وتحدّث الحالة إلى
 * READY/PARTIAL/FAILED_EXTRACTION. (النصوص المصدر حتمية؛ إعادة الكل أبسط
 * وأدق هنا من التعقب الجزئي — موثّق في سجل العمل.)
 * audit DECK_RETRIED. params وعد في Next 16.
 */
import type { NextRequest } from "next/server";
import {
  ok,
  fail,
  handleRouteError,
  requireRole,
  requireProfile,
  assertSameOrigin,
  audit,
} from "@/lib/server/api";
import {
  analyzeSlides,
  getOwnedVersion,
  parseSlides,
  parseVersionParam,
  persistAnalysis,
  profileHintsFrom,
  PROCESS_BUDGET_MS,
} from "../../../../_pipeline";

export const runtime = "nodejs";

interface RetryResult {
  deckId: string;
  versionNumber: number;
  status: string;
  slideCount: number;
  statusMessage?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; v: string }> },
): Promise<Response> {
  try {
    assertSameOrigin(req);
    const user = await requireRole(req, ["FOUNDER"]);
    const profile = await requireProfile(user.id);

    const { id, v } = await ctx.params;
    let versionNumber: number;
    try {
      versionNumber = parseVersionParam(v);
    } catch (e) {
      return fail("BAD_VERSION", (e as Error).message, 400);
    }
    const found = await getOwnedVersion(profile.id, id, versionNumber);
    if (!found) {
      return fail("VERSION_NOT_FOUND", "النسخة غير موجودة", 404);
    }
    const { version } = found;

    // إعادة المعالجة للفاشل جزئيًّا فقط (§10)
    if (version.status !== "PARTIAL") {
      return fail(
        "NOT_PARTIAL",
        "إعادة المعالجة متاحة فقط للنسخ ذات الحالة PARTIAL (الجزئية) — الفاشلة كليًّا تُعاد رفعها",
        409,
      );
    }
    const slides = parseSlides(version.slidesJson);
    if (slides.length === 0) {
      return fail("NO_SLIDES", "لا توجد شرائح مخزنة لهذه النسخة — أعد رفع الملف من جديد", 409);
    }

    const analysis = await analyzeSlides(slides, {
      profileId: profile.id,
      userId: user.id,
      deckVersionId: version.id,
      hints: profileHintsFrom(profile),
      fileType: version.fileType,
      deadlineAt: Date.now() + PROCESS_BUDGET_MS,
    });
    await persistAnalysis(version.id, analysis);

    await audit(user.id, "DECK_RETRIED", "DeckVersion", version.id, {
      deckId: version.deckId,
      versionNumber,
      status: analysis.status,
    });

    const result: RetryResult = {
      deckId: version.deckId,
      versionNumber,
      status: analysis.status,
      slideCount: analysis.slides.length,
      ...(analysis.statusMessage ? { statusMessage: analysis.statusMessage } : {}),
    };
    return ok(result);
  } catch (e) {
    return handleRouteError(e);
  }
}
