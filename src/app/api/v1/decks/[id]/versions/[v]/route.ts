/**
 * Masar — T12: تفاصيل نسخة عرض GET /api/v1/decks/[id]/versions/[v]
 * =====================================================
 * الحالة والرسالة + الشرائح كاملة بالنص + الاستخراج (بحالة كل حقل وسبب سقوطه)
 * + الادعاءات وتناقضاتها + الجاهزية (9 معايير) + تقرير الفجوات + اقتراحات
 * الشرائح (الأحدث لكل شريحة). v رقم فقط (لا «all»).
 * الملكية إلزامية (IDOR): deck.profileId من requireProfile وإلا 404.
 * التناقضات تُحسب الآن من الادعاءات المخزنة (detectContradictions حتمية نقية).
 * params وعد في Next 16.
 */
import type { NextRequest } from "next/server";
import type { PitchAgentReview } from "@/lib/ai/agent-types";
import { ok, fail, handleRouteError, requireRole, requireProfile, parseJsonField, prisma } from "@/lib/server/api";
import { detectContradictions } from "@/lib/pitch/claims";
import {
  getOwnedVersion,
  parseClaims,
  parseExtraction,
  parseGapReport,
  parseReadiness,
  parseSlides,
  parseVersionParam,
} from "../../../_pipeline";

export const runtime = "nodejs";

interface SuggestionView {
  id: string;
  slideIndex: number;
  originalText: string;
  suggestedText: string;
  reason: string | null;
  decision: string;
  editedText: string | null;
  guardReport: unknown;
  decidedAt: string | null;
  createdAt: string;
}

interface VersionDetail {
  deckId: string;
  versionNumber: number;
  status: string;
  statusMessage: string | null;
  fileType: string;
  fileName: string;
  fileSize: number;
  slideCount: number;
  pageCount: number;
  createdAt: string;
  slides: ReturnType<typeof parseSlides>;
  extraction: ReturnType<typeof parseExtraction>;
  claims: {
    items: ReturnType<typeof parseClaims>;
    contradictions: Array<{ ar: string; pages: number[] }>;
  };
  readiness: ReturnType<typeof parseReadiness>;
  gapReport: ReturnType<typeof parseGapReport>;
  agentReview: PitchAgentReview | null;
  suggestions: SuggestionView[];
}

function parseAgentReview(raw: string): PitchAgentReview | null {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<PitchAgentReview>;
    if (!Array.isArray(candidate.agents) || typeof candidate.totalAgents !== "number" || !candidate.status) return null;
    return candidate as PitchAgentReview;
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; v: string }> },
): Promise<Response> {
  try {
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
    const { deck, version } = found;

    // الاقتراحات: الأحدث لكل شريحة (آخر صف للشريحة يفوز)
    const suggestionRows = await prisma.slideSuggestion.findMany({
      where: { deckVersionId: version.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const latestPerSlide = new Map<number, (typeof suggestionRows)[number]>();
    for (const s of suggestionRows) latestPerSlide.set(s.slideIndex, s);
    const suggestions: SuggestionView[] = [...latestPerSlide.values()]
      .sort((a, b) => a.slideIndex - b.slideIndex)
      .map((s) => ({
        id: s.id,
        slideIndex: s.slideIndex,
        originalText: s.originalText,
        suggestedText: s.suggestedText,
        reason: s.reason,
        decision: s.decision,
        editedText: s.editedText,
        guardReport: parseJsonField<unknown>(s.guardReportJson, {}),
        decidedAt: s.decidedAt ? s.decidedAt.toISOString() : null,
        createdAt: s.createdAt.toISOString(),
      }));

    const claims = parseClaims(version.claimsJson);
    const detail: VersionDetail = {
      deckId: deck.id,
      versionNumber: version.versionNumber,
      status: version.status,
      statusMessage: version.statusMessage,
      fileType: version.fileType,
      fileName: version.fileName,
      fileSize: version.fileSize,
      slideCount: version.slideCount,
      pageCount: version.pageCount,
      createdAt: version.createdAt.toISOString(),
      slides: parseSlides(version.slidesJson),
      extraction: parseExtraction(version.extractionJson),
      claims: {
        items: claims,
        contradictions: detectContradictions(claims),
      },
      readiness: parseReadiness(version.readinessJson),
      gapReport: parseGapReport(version.gapReportJson),
      agentReview: parseAgentReview(version.agentReviewJson),
      suggestions,
    };
    return ok(detail);
  } catch (e) {
    return handleRouteError(e);
  }
}
