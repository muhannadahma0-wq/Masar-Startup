/**
 * Masar — T10: POST /api/v1/admin/opportunities/[id]/reject
 * =============================================================================
 * NEEDS_REVIEW → REJECTED مع reason إلزامي (parseBody(RejectInput) — min 3).
 * audit OPPORTUNITY_REJECTED. الفرص المرفوضة لا تظهر للمؤسس (عرض PUBLISHED فقط).
 */
import { NextRequest } from "next/server";
import { ok, fail, parseBody, requireRole, assertSameOrigin, audit, handleRouteError, prisma } from "@/lib/server/api";
import { RejectInput } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const user = await requireRole(req, ["REVIEWER", "ADMIN"]);
    const { id } = await ctx.params;
    const body = await parseBody(req, RejectInput);

    const opp = await prisma.opportunity.findUnique({ where: { id } });
    if (!opp) {
      return fail("NOT_FOUND", "الفرصة غير موجودة", 404);
    }
    if (opp.status !== "NEEDS_REVIEW") {
      return fail("INVALID_STATE", "الرفض متاح للفرص في حالة مراجعة فقط (الحالة الحالية: " + opp.status + ")", 409, {
        status: opp.status,
      });
    }

    const updated = await prisma.opportunity.update({
      where: { id },
      data: { status: "REJECTED", rejectReason: body.reason },
      include: { conditions: { include: { evidence: true }, orderBy: { id: "asc" } } },
    });

    await audit(user.id, "OPPORTUNITY_REJECTED", "Opportunity", id, {
      title: updated.title,
      reason: body.reason,
    });

    return ok({ opportunity: updated, reason: body.reason });
  } catch (e) {
    return handleRouteError(e);
  }
}
