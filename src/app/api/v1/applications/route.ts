/**
 * Masar — T14: متتبع الطلبات GET/POST /api/v1/applications
 *
 * GET  : requireUser(FOUNDER) + requireProfile → طلبات الملف مع الفرصة (compact)
 *        وdeadline مع تاريخ منقضٍ معلَّم deadlineIsPast.
 * POST : assertSameOrigin أولًا ثم requireUser(FOUNDER) + requireProfile + parseBody(ApplicationInput)
 *        — الفرصة يجب أن تكون PUBLISHED (وإلا 404) — التكرار (profileId+opportunityId
 *        فريد) → 409 ALREADY_TRACKING.
 */
import type { NextRequest } from "next/server";
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
import { ApplicationInput } from "@/lib/schemas";

// ————— شكل العرض —————

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
  /** الموعد النهائي للفرصة (ISO) أو null */
  deadline: string | null;
  /** true إن كان الموعد النهائي تاريخًا منقضيًا */
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

// ————— المعالجات —————

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const user = await requireRole(req, ["FOUNDER"]);
    const profile = await requireProfile(user.id);
    const applications = await prisma.application.findMany({
      where: { profileId: profile.id },
      include: { opportunity: true },
      orderBy: { updatedAt: "desc" },
    });
    return ok({
      applications: applications.map((a) => shapeApplication(a, a.opportunity)),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    // القيد: assertSameOrigin أولًا ثم requireUser/requireRole
    assertSameOrigin(req);
    const user = await requireRole(req, ["FOUNDER"]);
    const profile = await requireProfile(user.id);
    const body = await parseBody(req, ApplicationInput);

    // الفرصة للمؤسس تُعرض فقط إن كانت PUBLISHED — غير ذلك كأنها غير موجودة
    const opp = await prisma.opportunity.findUnique({ where: { id: body.opportunityId } });
    if (!opp || opp.status !== "PUBLISHED") {
      throw new ApiErrorClass("NOT_FOUND", "الفرصة غير موجودة أو غير متاحة", 404);
    }

    // قيد التفرد (profileId, opportunityId) — لا تتبع مزدوج
    const existing = await prisma.application.findUnique({
      where: {
        profileId_opportunityId: { profileId: profile.id, opportunityId: opp.id },
      },
    });
    if (existing) {
      throw new ApiErrorClass("ALREADY_TRACKING", "أنت تتابع هذه الفرصة بالفعل", 409);
    }

    const created = await prisma.application.create({
      data: {
        profileId: profile.id,
        opportunityId: opp.id,
        status: body.status,
        notes: body.notes ?? null,
      },
      include: { opportunity: true },
    });
    await audit(user.id, "APPLICATION_CREATED", "Application", created.id, {
      opportunityId: opp.id,
      status: body.status,
    });
    return ok({ application: shapeApplication(created, created.opportunity) }, 201);
  } catch (e) {
    return handleRouteError(e);
  }
}
