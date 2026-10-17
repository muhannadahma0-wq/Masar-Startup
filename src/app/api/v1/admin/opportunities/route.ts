/**
 * Masar — T10: POST /api/v1/admin/opportunities — إنشاء مسودة فرصة (L0)
 * =============================================================================
 * REVIEWER/ADMIN فقط (assertSameOrigin أولًا ثم parseBody(OpportunityCreateInput)).
 * ينشئ DRAFT:
 *  - normalizedUrl من applicationUrl عبر normalizeUrl — تكرار بالقاعدة → 409 CONFLICT.
 *  - sectorsJson/languagesJson/requiresDocsJson متسلسلة JSON.
 *  - الشروط تُنشأ مع أدلتها (Evidence لكل شرط معه evidence).
 *  - createdById = المستخدم الحالي، وcurrentVersion = 1 (لا سجل نسخة للإنشاء —
 *    النسخ تبدأ من 2 عند أول تحديث فعلي).
 *  - audit OPPORTUNITY_DRAFT_CREATED.
 */
import { NextRequest } from "next/server";
import {
  ok, fail, parseBody, requireRole, assertSameOrigin, audit, handleRouteError, prisma,
} from "@/lib/server/api";
import { OpportunityCreateInput } from "@/lib/schemas";
import { normalizeUrl } from "@/lib/core/text";
import { parseIsoDate } from "@/lib/server/conditions";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireRole(req, ["REVIEWER", "ADMIN"]);
    const body = await parseBody(req, OpportunityCreateInput);

    // ————— توحيد الرابط وفحص التكرار —————
    const normalizedUrl = normalizeUrl(body.applicationUrl);
    const dupe = await prisma.opportunity.findFirst({
      where: { normalizedUrl },
      select: { id: true, title: true, status: true },
    });
    if (dupe) {
      return fail("CONFLICT", "توجد فرصة أخرى بنفس رابط التقديم بعد التوحيد", 409, {
        normalizedUrl,
        existingId: dupe.id,
        existingTitle: dupe.title,
        existingStatus: dupe.status,
      });
    }

    const opp = await prisma.opportunity.create({
      data: {
        title: body.title,
        orgName: body.orgName,
        description: body.description,
        status: "DRAFT",
        type: body.type,
        fundingType: body.fundingType ?? null,
        amountMin: body.amountMin ?? null,
        amountMax: body.amountMax ?? null,
        currency: body.currency,
        sectorsJson: JSON.stringify(body.sectors),
        stageMin: body.stageMin ?? null,
        stageMax: body.stageMax ?? null,
        geography: body.geography,
        geoPriority: body.geoPriority,
        languagesJson: JSON.stringify(body.languages),
        applicationUrl: body.applicationUrl,
        normalizedUrl,
        sourceType: body.sourceType,
        deadline: body.deadline ? parseIsoDate(body.deadline, "الموعد النهائي") : null,
        deadlineTz: body.deadlineTz,
        requiresDocsJson: JSON.stringify(body.requiresDocs),
        createdById: user.id,
        conditions: {
          create: body.conditions.map((c) => ({
            field: c.field,
            op: c.op,
            valueJson: JSON.stringify(c.value === undefined ? null : c.value),
            mandatory: c.mandatory,
            ambiguous: c.ambiguous,
            scope: c.scope,
            sourceWording: c.sourceWording ?? null,
            ...(c.evidence
              ? {
                  evidence: {
                    create: {
                      url: c.evidence.url,
                      quote: c.evidence.quote,
                      verifiedAt: parseIsoDate(c.evidence.verifiedAt, "تاريخ تحقق الدليل"),
                    },
                  },
                }
              : {}),
          })),
        },
      },
      include: { conditions: { include: { evidence: true }, orderBy: { id: "asc" } } },
    });

    await audit(user.id, "OPPORTUNITY_DRAFT_CREATED", "Opportunity", opp.id, {
      title: opp.title,
      orgName: opp.orgName,
      conditionsCount: body.conditions.length,
      normalizedUrl,
    });

    return ok(
      {
        opportunity: {
          ...opp,
          sectors: body.sectors,
          languages: body.languages,
          requiresDocs: body.requiresDocs,
        },
        normalizedUrl,
        nextStep: "submit-review",
      },
      201
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
