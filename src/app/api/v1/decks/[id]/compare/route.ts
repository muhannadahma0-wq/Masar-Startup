/**
 * Masar — T12: مقارنة نسختين GET /api/v1/decks/[id]/compare?from=X&to=Y
 * =====================================================
 * نسختان للعرض نفسه (ملكية إلزامية — IDOR) → الفروق:
 *  - extractionDiff: حقل بقيمة قديمة/جديدة (ومضاف/محذوف) — الساقطة خارج المقارنة.
 *  - readinessDiff: معيار بمستوى قديم/جديد (معايير التسعة).
 *  - claimsDiff: ادعاءات جديدة/محذوفة/متغيرة القيمة (مطابقة حتمية داخل كل
 *    مجموعة type+unit بترتيب القيمة).
 * الشكل: { deckId, from: {…ملخص}, to: {…ملخص}, changes: [...] }.
 * من=إلى مرفوض (422)، وأي نسخة غائبة → 404. params وعد في Next 16.
 */
import type { NextRequest } from "next/server";
import {
  ok,
  fail,
  handleRouteError,
  requireRole,
  requireProfile,
  zodDetails,
  prisma,
} from "@/lib/server/api";
import { CompareQuery } from "@/lib/schemas";
import { buildCompareChanges, getOwnedDeck, summarizeVersion } from "../../_pipeline";

export const runtime = "nodejs";

interface CompareResult {
  deckId: string;
  from: ReturnType<typeof summarizeVersion>;
  to: ReturnType<typeof summarizeVersion>;
  changes: ReturnType<typeof buildCompareChanges>;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireRole(req, ["FOUNDER"]);
    const profile = await requireProfile(user.id);

    const { id } = await ctx.params;
    const deck = await getOwnedDeck(profile.id, id);
    if (!deck) {
      return fail("DECK_NOT_FOUND", "العرض غير موجود", 404);
    }

    // من = النسخة القديمة، إلى = النسخة الجديدة — رقمان موجبان
    const url = new URL(req.url);
    const parsed = CompareQuery.safeParse({
      from: url.searchParams.get("from") ?? "",
      to: url.searchParams.get("to") ?? "",
    });
    if (!parsed.success) {
      return fail("VALIDATION", "حدّد رقم النسختين من وإلى (رقمان موجبان)", 422, zodDetails(parsed.error));
    }
    if (parsed.data.from === parsed.data.to) {
      return fail("SAME_VERSION", "لا يمكن مقارنة النسخة بنفسها — اختر نسختين مختلفتين", 422);
    }

    const [fromV, toV] = await Promise.all([
      prisma.deckVersion.findFirst({
        where: { deckId: deck.id, versionNumber: parsed.data.from },
      }),
      prisma.deckVersion.findFirst({
        where: { deckId: deck.id, versionNumber: parsed.data.to },
      }),
    ]);
    if (!fromV || !toV) {
      return fail("VERSION_NOT_FOUND", "إحدى النسختين المطلوبتين غير موجودة", 404);
    }

    const result: CompareResult = {
      deckId: deck.id,
      from: summarizeVersion(fromV),
      to: summarizeVersion(toV),
      changes: buildCompareChanges(fromV, toV),
    };
    return ok(result);
  } catch (e) {
    return handleRouteError(e);
  }
}
