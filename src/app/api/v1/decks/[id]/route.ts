/**
 * Masar — T12: حذف العرض DELETE /api/v1/decks/[id]
 * =====================================================
 * حذف العرض وكل نسخه من القاعدة (تتالي: DeckVersion + SlideSuggestion،
 * وAiRun.deckVersionId → SetNull بحكم المخطط) + مسح ملفات storage/decks
 * لكل نسخة (best-effort). audit DECK_DELETED بعدد النسخ المحذوفة فقط.
 * الملكية إلزامية: deck.profileId من requireProfile — غير المالك يرى 404.
 * params وعد في Next 16.
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
  prisma,
} from "@/lib/server/api";
import { getOwnedDeck, removeDeckFile } from "../_pipeline";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    assertSameOrigin(req);
    const user = await requireRole(req, ["FOUNDER"]);
    const profile = await requireProfile(user.id);

    const { id } = await ctx.params;
    const deck = await getOwnedDeck(profile.id, id);
    if (!deck) {
      return fail("DECK_NOT_FOUND", "العرض غير موجود", 404);
    }

    // ملفات النسخ كلها قبل حذف الصفوف (best-effort — الملف الغائب ليس خطأ)
    const versions = await prisma.deckVersion.findMany({
      where: { deckId: deck.id },
      select: { id: true, fileType: true },
    });
    for (const v of versions) {
      try {
        await removeDeckFile(v.id, v.fileType);
      } catch (e) {
        console.error(`[decks] تعذّر مسح ملف النسخة ${v.id}: ${(e as Error)?.message ?? e}`);
      }
    }

    // الحذف المتتالي: النسخ والاقتراحات cascade، وAiRun → SetNull (المخطط)
    await prisma.deck.delete({ where: { id: deck.id } });

    await audit(user.id, "DECK_DELETED", "Deck", deck.id, {
      versionsDeleted: versions.length,
    });

    return ok({ deleted: true, deckId: deck.id, versionsDeleted: versions.length });
  } catch (e) {
    return handleRouteError(e);
  }
}
