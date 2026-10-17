/**
 * Masar — T10: POST /api/v1/admin/opportunities/[id]/publish
 * =============================================================================
 * NEEDS_REVIEW → PUBLISHED — تحقق في الخادم إلزاميًّا:
 *  (أ) status = NEEDS_REVIEW (وإلا 409 INVALID_STATE).
 *  (ب) الناشر ≠ كاتب المسودة: approvedById(=المستخدم الحالي) ≠ createdById
 *      وإلا 403 SELF_APPROVAL «لا يجوز اعتماد مسودتك بنفسك».
 *  (ج) applicationUrl موجود (وإلا 422 INCOMPLETE) — وverifiedAt يُضبط «الآن»
 *      تلقائيًّا عند النشر (قرار موثّق: اعتماد المراجع الثاني للنشر هو تحقق فعلي
 *      من الرابط والمصدر، فالتاريخ يتحدّث لحظة النشر).
 *  (د) الشرط الإلزامي بلا دليل لا يمنع النشر لكن يُعلَّم في الرد
 *      (سلوك المحرك لاحقًا: الحكم يُقيَّد عند UNCERTAIN بسبب NO_EVIDENCE).
 * status→PUBLISHED + approvedById + audit OPPORTUNITY_PUBLISHED.
 */
import { NextRequest } from "next/server";
import { ok, fail, requireRole, assertSameOrigin, audit, handleRouteError, prisma } from "@/lib/server/api";

export const dynamic = "force-dynamic";

function hasValidEvidence(ev: { url: string; quote: string } | null): boolean {
  if (!ev) return false;
  return typeof ev.url === "string" && ev.url.trim() !== "" &&
    typeof ev.quote === "string" && ev.quote.trim() !== "";
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const user = await requireRole(req, ["REVIEWER", "ADMIN"]);
    const { id } = await ctx.params;

    const opp = await prisma.opportunity.findUnique({
      where: { id },
      include: { conditions: { include: { evidence: true } } },
    });
    if (!opp) {
      return fail("NOT_FOUND", "الفرصة غير موجودة", 404);
    }

    // (أ) الحالة
    if (opp.status !== "NEEDS_REVIEW") {
      return fail("INVALID_STATE", "النشر متاح للفرص في حالة مراجعة فقط (الحالة الحالية: " + opp.status + ")", 409, {
        status: opp.status,
      });
    }

    // (ب) لا اعتماد ذاتي
    if (opp.createdById && opp.createdById === user.id) {
      return fail("SELF_APPROVAL", "لا يجوز اعتماد مسودتك بنفسك — اطلب من مراجع آخر النشر", 403, {
        createdById: opp.createdById,
        userId: user.id,
      });
    }

    // (ج) رابط التقديم (verifiedAt يُضبط الآن تلقائيًّا — انظر الترويسة)
    if (!opp.applicationUrl || opp.applicationUrl.trim() === "") {
      return fail("INCOMPLETE", "رابط التقديم مطلوب قبل النشر", 422, { missing: ["applicationUrl"] });
    }

    // (د) أعلام الشروط الإلزامية بلا دليل (لا تمنع النشر)
    const mandatoryWithoutEvidence = opp.conditions.filter(
      (c) => c.mandatory && !hasValidEvidence(c.evidence)
    ).length;
    const warningsAr: string[] = [];
    if (mandatoryWithoutEvidence > 0) {
      warningsAr.push(
        `${mandatoryWithoutEvidence} شرطًا إلزاميًّا بلا دليل موثق — حكم الأهلية سيُقيَّد عند UNCERTAIN (لا دليل) حتى تُضاف الأدلة`
      );
    }

    const now = new Date();
    const updated = await prisma.opportunity.update({
      where: { id },
      data: {
        status: "PUBLISHED",
        approvedById: user.id,
        verifiedAt: now, // وثّق في الترويسة: اعتماد المراجع الثاني = تحقق فعلي
      },
      include: { conditions: { include: { evidence: true }, orderBy: { id: "asc" } } },
    });

    await audit(user.id, "OPPORTUNITY_PUBLISHED", "Opportunity", id, {
      title: updated.title,
      approvedById: user.id,
      verifiedAt: now.toISOString(),
      mandatoryWithoutEvidence,
    });

    return ok({
      opportunity: updated,
      verifiedAtSetBy: "publish (المراجع الثاني)",
      mandatoryWithoutEvidence,
      warningsAr,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
