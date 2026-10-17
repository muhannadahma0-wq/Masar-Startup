/**
 * Masar — T10: POST /api/v1/admin/opportunities/[id]/submit-review
 * =============================================================================
 * DRAFT → NEEDS_REVIEW. يجب اكتمال الحقول الأساسية قبل الإرسال:
 * title/orgName/applicationUrl وشروط ≥ 1 وإلا 422 INCOMPLETE_DRAFT.
 * audit OPPORTUNITY_SUBMITTED (موثّق: اسم الفعل من اختيار T10 — غير منصوص في المهمة).
 */
import { NextRequest } from "next/server";
import { ok, fail, parseBody, requireRole, assertSameOrigin, audit, handleRouteError, prisma } from "@/lib/server/api";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const user = await requireRole(req, ["REVIEWER", "ADMIN"]);
    const { id } = await ctx.params;

    const opp = await prisma.opportunity.findUnique({
      where: { id },
      include: { conditions: { select: { id: true } } },
    });
    if (!opp) {
      return fail("NOT_FOUND", "الفرصة غير موجودة", 404);
    }
    if (opp.status !== "DRAFT") {
      return fail("INVALID_STATE", "الإرسال للمراجعة متاح للمسودات فقط (الحالة الحالية: " + opp.status + ")", 409, {
        status: opp.status,
      });
    }

    // ————— اكتمال الحقول الأساسية —————
    const missing: string[] = [];
    if (!opp.title || opp.title.trim() === "") missing.push("title");
    if (!opp.orgName || opp.orgName.trim() === "") missing.push("orgName");
    if (!opp.applicationUrl || opp.applicationUrl.trim() === "") missing.push("applicationUrl");
    if (opp.conditions.length < 1) missing.push("conditions");
    if (missing.length > 0) {
      return fail("INCOMPLETE_DRAFT", "المسودة غير مكتملة — أكمل الحقول الأساسية قبل إرسالها للمراجعة", 422, {
        missing,
      });
    }

    const updated = await prisma.opportunity.update({
      where: { id },
      data: { status: "NEEDS_REVIEW" },
      include: { conditions: { include: { evidence: true }, orderBy: { id: "asc" } } },
    });

    await audit(user.id, "OPPORTUNITY_SUBMITTED", "Opportunity", id, { title: opp.title });

    return ok({ opportunity: updated, nextStep: "publish أو reject (بمراجع ثانٍ غير كاتب المسودة)" });
  } catch (e) {
    return handleRouteError(e);
  }
}
