/**
 * Masar — T10: GET /api/v1/admin/duplicates — كشف التكرارات المحتملة
 * =============================================================================
 * REVIEWER/ADMIN فقط. كل أزواج الفرص (DRAFT/PUBLISHED — المرفوضة والمؤرشفة
 * خارج النطاق، قرار موثّق حرفيًّا من نص المهمة) التي:
 *  - trigramSimilarity(title + orgName) ≥ 0.72، أو
 *  - نفس normalizedUrl.
 * الرد: قائمة أزواج { a, b, similarity, sameUrl, labelAr } مع تحذير «تكرار محتمل».
 * موثّق: مقارنة O(n²) على المجموعات المعروضة (حجم قاعدة الفرص هنا صغير)؛
 * الأزواج بترتيب ثابت (createdAt للفرصة الأقدم أولًا).
 */
import { NextRequest } from "next/server";
import { ok, requireRole, handleRouteError, prisma } from "@/lib/server/api";
import { trigramSimilarity } from "@/lib/core/text";

export const dynamic = "force-dynamic";

const SIMILARITY_THRESHOLD = 0.72;

interface DuplicateCandidate {
  id: string;
  title: string;
  orgName: string;
  status: string;
  type: string;
  normalizedUrl: string | null;
}

interface DuplicatePair {
  a: DuplicateCandidate;
  b: DuplicateCandidate;
  similarity: number;
  sameUrl: boolean;
  labelAr: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["REVIEWER", "ADMIN"]);

    const opps = await prisma.opportunity.findMany({
      where: { status: { in: ["DRAFT", "PUBLISHED"] } },
      select: { id: true, title: true, orgName: true, status: true, type: true, normalizedUrl: true },
      orderBy: { createdAt: "asc" },
    });

    const pairs: DuplicatePair[] = [];
    for (let i = 0; i < opps.length; i++) {
      for (let j = i + 1; j < opps.length; j++) {
        const a = opps[i];
        const b = opps[j];
        const sameUrl = Boolean(
          a.normalizedUrl && b.normalizedUrl && a.normalizedUrl === b.normalizedUrl
        );
        const similarity = round2(
          trigramSimilarity(`${a.title} ${a.orgName}`, `${b.title} ${b.orgName}`)
        );
        if (similarity >= SIMILARITY_THRESHOLD || sameUrl) {
          pairs.push({
            a: { id: a.id, title: a.title, orgName: a.orgName, status: a.status, type: a.type, normalizedUrl: a.normalizedUrl },
            b: { id: b.id, title: b.title, orgName: b.orgName, status: b.status, type: b.type, normalizedUrl: b.normalizedUrl },
            similarity,
            sameUrl,
            labelAr: "تكرار محتمل",
          });
        }
      }
    }

    return ok({
      pairs,
      count: pairs.length,
      scanned: opps.length,
      threshold: SIMILARITY_THRESHOLD,
      warningAr: pairs.length > 0 ? "تكرار محتمل — راجع الأزواج التالية قبل النشر" : "لا تكرارات محتملة",
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
