/**
 * Masar — T10: GET /api/v1/opportunities/[id] — تفاصيل فرصة (عرض المؤسس)
 * =============================================================================
 * تفاصيل PUBLISHED فقط (غير المنشورة → 404 — المراجع يرى الكل عبر admin endpoints).
 * يعرض: كل الشروط مع أدلتها (url/quote/verifiedAt) وsourceWording وambiguous،
 * وموثوقية كاملة بإشاراتها (حساب حيّ)، وآخر 3 نسخ
 * (versionNumber/changeType/reason/createdAt)، وverifiedAt.
 * Next 16: params وعد — `const { id } = await params`.
 */
import { NextRequest } from "next/server";
import { ok, fail, requireUser, handleRouteError, prisma, parseJsonField } from "@/lib/server/api";
import { loadRuleConditions, reliabilityForOpp } from "@/lib/server/conditions";
import type { ReliabilityResult, RuleCondition } from "@/lib/core/types";

export const dynamic = "force-dynamic";

interface VersionSummary {
  versionNumber: number;
  changeType: string;
  changeCategory: string | null;
  reason: string | null;
  createdAt: string;
}

interface OpportunityDetail {
  id: string;
  title: string;
  orgName: string;
  description: string;
  status: string;
  type: string;
  fundingType: string | null;
  amountMin: number | null;
  amountMax: number | null;
  currency: string;
  sectors: string[];
  stageMin: string | null;
  stageMax: string | null;
  geography: string;
  geoPriority: boolean;
  languages: string[];
  requiresDocs: string[];
  applicationUrl: string | null;
  sourceType: string;
  linkCheckState: string;
  deadline: string | null;
  deadlineTz: string;
  verifiedAt: string | null;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  conditions: RuleCondition[];
  reliability: ReliabilityResult;
  versions: VersionSummary[];
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(req);
    const { id } = await ctx.params;

    const opp = await prisma.opportunity.findUnique({
      where: { id },
      include: {
        conditions: { include: { evidence: true }, orderBy: { id: "asc" } },
        versions: { orderBy: { versionNumber: "desc" }, take: 3 },
      },
    });
    if (!opp || opp.status !== "PUBLISHED") {
      return fail("NOT_FOUND", "الفرصة غير موجودة أو غير منشورة", 404);
    }

    const conditions = await loadRuleConditions(opp.id);
    const reliability = reliabilityForOpp(
      { sourceType: opp.sourceType, verifiedAt: opp.verifiedAt, linkCheckState: opp.linkCheckState },
      opp.conditions
    );

    const detail: OpportunityDetail = {
      id: opp.id,
      title: opp.title,
      orgName: opp.orgName,
      description: opp.description,
      status: opp.status,
      type: opp.type,
      fundingType: opp.fundingType,
      amountMin: opp.amountMin,
      amountMax: opp.amountMax,
      currency: opp.currency,
      sectors: parseJsonField<string[]>(opp.sectorsJson, []),
      stageMin: opp.stageMin,
      stageMax: opp.stageMax,
      geography: opp.geography,
      geoPriority: opp.geoPriority,
      languages: parseJsonField<string[]>(opp.languagesJson, ["ar"]),
      requiresDocs: parseJsonField<string[]>(opp.requiresDocsJson, []),
      applicationUrl: opp.applicationUrl,
      sourceType: opp.sourceType,
      linkCheckState: opp.linkCheckState,
      deadline: opp.deadline ? opp.deadline.toISOString() : null,
      deadlineTz: opp.deadlineTz,
      verifiedAt: opp.verifiedAt ? opp.verifiedAt.toISOString() : null,
      currentVersion: opp.currentVersion,
      createdAt: opp.createdAt.toISOString(),
      updatedAt: opp.updatedAt.toISOString(),
      conditions,
      reliability,
      versions: opp.versions.map((v) => ({
        versionNumber: v.versionNumber,
        changeType: v.changeType,
        changeCategory: v.changeCategory,
        reason: v.reason,
        createdAt: v.createdAt.toISOString(),
      })),
    };

    return ok(detail);
  } catch (e) {
    return handleRouteError(e);
  }
}
