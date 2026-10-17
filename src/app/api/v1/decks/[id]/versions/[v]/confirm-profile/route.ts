/**
 * Masar — T12: تأكيد حقول الملف من العرض
 * POST /api/v1/decks/[id]/versions/[v]/confirm-profile
 * =====================================================
 * المسار الوحيد الذي تدخل به حقول العرض إلى ملف الشركة (مبدأ الخطة):
 *  1) assertSameOrigin → requireRole(FOUNDER) → requireProfile → ملكية النسخة.
 *  2) parseBody(ConfirmProfileInput) — الحقول المرسلة فقط (اختيار المؤسس).
 *  3) Citation Guard مجددًا لكل حقل (citationCheck من core/guards مع slidesJson):
 *     الفاشل → 422 QUOTE_NOT_FOUND «الاقتباس غير مطابق للشريحة» ولا يُكتب شيء.
 *  4) الناجح → دمج في StartupProfile.fieldsJson بمصدر "deck" مع
 *     deckId/deckVersion/page/quote/confirmedAt=الآن، والحقل القديم بنفس الاسم
 *     يُستبدل. الحقول الأخرى لا تُمَسّ.
 *  5) تعليم الحقول المعنية في extractionJson بstatus "confirmed".
 *  6) audit PROFILE_FIELDS_CONFIRMED (العدد والمعرفات فقط — لا قيم ولا اقتباسات).
 *  7) الرد: { updated: n, profile } (كم_GET /profile).
 * params وعد في Next 16.
 */
import type { NextRequest } from "next/server";
import {
  ok,
  fail,
  handleRouteError,
  parseBody,
  requireRole,
  requireProfile,
  assertSameOrigin,
  audit,
  prisma,
} from "@/lib/server/api";
import { ConfirmProfileInput } from "@/lib/schemas";
import { citationCheck } from "@/lib/core/guards";
import {
  buildProfilePayload,
  getOwnedVersion,
  parseExtraction,
  parseSlides,
  parseVersionParam,
  resolveProfileFields,
  type StoredProfileField,
} from "../../../../_pipeline";

export const runtime = "nodejs";

interface CitationFailure {
  key: string;
  page: number;
  reasons: string[];
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

    const body = await parseBody(req, ConfirmProfileInput);

    // ————— الحارس مجددًا على كل حقل قبل أي كتابة (كل شيء أو لا شيء) —————
    const slides = parseSlides(version.slidesJson);
    const failures: CitationFailure[] = [];
    for (const f of body.fields) {
      const check = citationCheck(slides, f.page, f.quote);
      if (!check.passed) {
        failures.push({
          key: f.key,
          page: f.page,
          reasons: check.flags.map((g) => g.rule),
        });
      }
    }
    if (failures.length > 0) {
      return fail("QUOTE_NOT_FOUND", "الاقتباس غير مطابق للشريحة", 422, { fields: failures });
    }

    // ————— الدمج في الملف: الحقل بنفس الاسم يُستبدل، والباقي لا يُمَسّ —————
    const byKey = new Map<string, StoredProfileField>();
    for (const f of resolveProfileFields(profile.fieldsJson)) byKey.set(f.field, f);
    const nowIso = new Date().toISOString();
    for (const f of body.fields) {
      byKey.set(f.key, {
        field: f.key,
        value: f.value,
        source: "deck",
        deckId: version.deckId,
        deckVersion: version.versionNumber,
        page: f.page,
        quote: f.quote,
        confirmedAt: nowIso,
      });
    }
    await prisma.startupProfile.update({
      where: { id: profile.id },
      data: { fieldsJson: JSON.stringify([...byKey.values()]) },
    });

    // ————— تعليم الحقول المؤكدة في extractionJson —————
    const confirmedKeys = new Set(body.fields.map((f) => f.key));
    const extraction = parseExtraction(version.extractionJson);
    const markedExtraction = extraction.map((e) =>
      confirmedKeys.has(e.key) ? { ...e, status: "confirmed" as const } : e,
    );
    await prisma.deckVersion.update({
      where: { id: version.id },
      data: { extractionJson: JSON.stringify(markedExtraction) },
    });

    // ————— التدقيق: العدد والمعرفات فقط — لا قيم ولا اقتباسات —————
    await audit(user.id, "PROFILE_FIELDS_CONFIRMED", "DeckVersion", version.id, {
      fieldsCount: body.fields.length,
      deckId: version.deckId,
      versionNumber: version.versionNumber,
    });

    const payload = await buildProfilePayload(profile.id);
    return ok({ updated: body.fields.length, profile: payload.profile });
  } catch (e) {
    return handleRouteError(e);
  }
}
