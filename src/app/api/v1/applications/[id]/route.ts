/**
 * Masar — T14: تحديث طلب PATCH /api/v1/applications/[id]
 *
 * تحديث status/notes مع التحقق من الملكية: profile.userId = المستخدم أو 404
 * (حماية IDOR: لا يُكشف وجود طلب الغير — الرد نفسه للطلب الموجود لغيرك ولغير الموجود).
 * params وعد في Next 16 (Promise).
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import type { Application, Opportunity } from "@prisma/client";
import {
  ok,
  parseBody,
  handleRouteError,
  requireRole,
  requireProfile,
  assertSameOrigin,
  audit,
  ApiErrorClass,
  prisma,
} from "@/lib/server/api";

// مخطط محلي للتحديث الجزئي (status و/أو notes) — مخططات الحزمة للإنشاء فقط
const ApplicationPatchInput = z.object({
  status: z
    .enum(["INTERESTED", "PREPARING", "SUBMITTED", "REJECTED", "WITHDRAWN"])
    .optional(),
  // nullable لإفراغ الملاحظات
  notes: z.string().max(2000).nullable().optional(),
});

interface ApplicationView {
  id: string;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  opportunity: {
    id: string;
    title: string;
    orgName: string;
    type: string;
    fundingType: string | null;
    currency: string;
    amountMin: number | null;
    amountMax: number | null;
    status: string;
  } | null;
  deadline: string | null;
  deadlineIsPast: boolean;
}

function shapeApplication(app: Application, opp: Opportunity | null): ApplicationView {
  const deadline = opp?.deadline ?? null;
  return {
    id: app.id,
    status: app.status,
    notes: app.notes,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
    opportunity: opp
      ? {
          id: opp.id,
          title: opp.title,
          orgName: opp.orgName,
          type: opp.type,
          fundingType: opp.fundingType,
          currency: opp.currency,
          amountMin: opp.amountMin,
          amountMax: opp.amountMax,
          status: opp.status,
        }
      : null,
    deadline: deadline ? deadline.toISOString() : null,
    deadlineIsPast: deadline ? deadline.getTime() < Date.now() : false,
  };
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    // القيد: assertSameOrigin أولًا ثم requireUser/requireRole
    assertSameOrigin(req);
    const user = await requireRole(req, ["FOUNDER"]);
    const profile = await requireProfile(user.id);
    const { id } = await ctx.params;
    const body = await parseBody(req, ApplicationPatchInput);
    if (body.status === undefined && body.notes === undefined) {
      throw new ApiErrorClass("VALIDATION", "يجب إرسال status أو notes على الأقل", 422);
    }

    // الملكية: طلب الغير يُعامل كغير موجود (IDOR)
    const existing = await prisma.application.findUnique({
      where: { id },
      include: { opportunity: true, profile: { select: { userId: true } } },
    });
    if (!existing || existing.profile.userId !== user.id) {
      throw new ApiErrorClass("NOT_FOUND", "الطلب غير موجود", 404);
    }

    const data: { status?: string; notes?: string | null } = {};
    if (body.status !== undefined) data.status = body.status;
    if (body.notes !== undefined) data.notes = body.notes;

    const updated = await prisma.application.update({
      where: { id },
      data,
      include: { opportunity: true },
    });
    await audit(user.id, "APPLICATION_UPDATED", "Application", updated.id, {
      fields: Object.keys(data),
    });
    return ok({ application: shapeApplication(updated, updated.opportunity) });
  } catch (e) {
    return handleRouteError(e);
  }
}
