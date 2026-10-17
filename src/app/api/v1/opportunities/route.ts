/**
 * Masar — T10: GET /api/v1/opportunities — قائمة الفرص
 * =============================================================================
 * لعرض المؤسس (الافتراضي): status=PUBLISHED حصرًا. نطاق إداري scope=admin
 * (REVIEWER/ADMIN فقط): كل الحالات أو status=DRAFT|NEEDS_REVIEW|...|all|unpublished
 * — لطابور لوحة المراجعة.
 *
 * المعاملات:
 *  - q             : بحث نصي (title/orgName contains — بحث Prisma)
 *  - geography     : local | regional | international
 *  - type          : grant | accelerator | incubator | competition | fellowship | loan
 *  - sector        : مفتاح من SECTOR_KEYS (يطابق عنصر sectorsJson المقتبس JSON)
 *  - sort          : deadline (افتراضي — الموعد الأقرب أولًا والمواعيد الفارغة أخيرًا)
 *                    | newest (الأحدث إنشاءً)
 *  - skip / take   : ترقيم صفحات (take افتراضي 20 وبحد أقصى 100 — يُقصّ تلقائيًّا)
 *
 * موثّق: ترتيب deadline مع فرص بلا موعد يتم باستعلامين للحفاظ على ترتيب المواعيد الفارغة أخيرًا على جميع مزودي القاعدة.
 */
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { ok, fail, requireUser, handleRouteError, prisma, parseJsonField } from "@/lib/server/api";
import { reliabilityForOpp } from "@/lib/server/conditions";
import { SECTOR_KEYS } from "@/lib/core/types";
import type { ReliabilityResult } from "@/lib/core/types";

export const dynamic = "force-dynamic";

const OPP_TYPES = ["grant", "accelerator", "incubator", "competition", "fellowship", "loan"] as const;
const GEOGRAPHIES = ["local", "regional", "international"] as const;

const MAX_TAKE = 100;
const DEFAULT_TAKE = 20;

interface CompactOpportunity {
  id: string;
  title: string;
  orgName: string;
  type: string;
  amountMin: number | null;
  amountMax: number | null;
  currency: string;
  sectors: string[];
  geography: string;
  deadline: string | null;
  deadlineTz: string;
  reliability: ReliabilityResult;
  status: string;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);

    const sp = req.nextUrl.searchParams;
    // ————— نطاق إداري: طابور المراجعة يرى المسودات وغير المنشورة —————
    const isAdminScope = sp.get("scope") === "admin";
    const ADMIN_STATUSES = ["DRAFT", "NEEDS_REVIEW", "PUBLISHED", "ARCHIVED", "REJECTED"] as const;
    const statusFilter = sp.get("status");
    let statusWhere: Prisma.OpportunityWhereInput["status"] = "PUBLISHED";
    if (isAdminScope) {
      if (user.role !== "REVIEWER" && user.role !== "ADMIN") {
        return fail("FORBIDDEN", "نطاق الإدارة للمراجعين فقط", 403);
      }
      if (statusFilter && (ADMIN_STATUSES as readonly string[]).includes(statusFilter)) {
        statusWhere = statusFilter;
      } else if (statusFilter === "unpublished") {
        statusWhere = { in: ["DRAFT", "NEEDS_REVIEW", "REJECTED", "ARCHIVED"] };
      } else if (statusFilter && statusFilter !== "all") {
        return fail("VALIDATION", "قيمة الحالة غير صالحة", 422, { status: statusFilter });
      } else {
        statusWhere = undefined; // كل الحالات
      }
    }

    const q = (sp.get("q") ?? "").trim().slice(0, 200);
    const geography = sp.get("geography");
    const type = sp.get("type");
    const sector = sp.get("sector");
    const sortRaw = sp.get("sort");
    const sort = sortRaw === null || sortRaw === "" ? "deadline" : sortRaw;
    if (sort !== "deadline" && sort !== "newest") {
      return fail("VALIDATION", "قيمة الفرز غير صالحة (المسموح: deadline أو newest)", 422, { sort });
    }
    if (geography !== null && geography !== "" && !(GEOGRAPHIES as readonly string[]).includes(geography)) {
      return fail("VALIDATION", "قيمة النطاق الجغرافي غير صالحة", 422, { geography });
    }
    if (type !== null && type !== "" && !(OPP_TYPES as readonly string[]).includes(type)) {
      return fail("VALIDATION", "قيمة نوع الفرصة غير صالحة", 422, { type });
    }
    if (sector !== null && sector !== "" && !(SECTOR_KEYS as readonly string[]).includes(sector)) {
      return fail("VALIDATION", "مفتاح القطاع غير صالح", 422, { sector });
    }

    const takeRaw = sp.get("take");
    let take = DEFAULT_TAKE;
    if (takeRaw !== null && takeRaw !== "") {
      const n = Number(takeRaw);
      if (!Number.isInteger(n) || n < 1) {
        return fail("VALIDATION", "قيمة take غير صالحة (عدد صحيح ≥ 1)", 422, { take: takeRaw });
      }
      take = Math.min(n, MAX_TAKE); // يُقصّ تلقائيًّا إلى 100
    }
    const skipRaw = sp.get("skip");
    let skip = 0;
    if (skipRaw !== null && skipRaw !== "") {
      const n = Number(skipRaw);
      if (!Number.isInteger(n) || n < 0) {
        return fail("VALIDATION", "قيمة skip غير صالحة (عدد صحيح ≥ 0)", 422, { skip: skipRaw });
      }
      skip = n;
    }

    // ————— بناء شرط البحث —————
    const where: Prisma.OpportunityWhereInput = {
      ...(statusWhere ? { status: statusWhere } : {}),
      ...(q !== ""
        ? { OR: [{ title: { contains: q } }, { orgName: { contains: q } }] }
        : {}),
      ...(geography ? { geography } : {}),
      ...(type ? { type } : {}),
      // sectorsJson مصفوفة JSON نصية — مفتاح مقتبس يطابق العنصر حصرًا (sector مقيد بSECTOR_KEYS)
      ...(sector ? { sectorsJson: { contains: `"${sector}"` } } : {}),
    };

    const total = await prisma.opportunity.count({ where });

    // ————— الجلب مع ترتيب deadline (NULL أخيرًا عبر استعلامين) —————
    let rows;
    if (sort === "newest") {
      rows = await prisma.opportunity.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: { conditions: { include: { evidence: true }, orderBy: { id: "asc" } } },
      });
    } else {
      const datedWhere: Prisma.OpportunityWhereInput = { ...where, deadline: { not: null } };
      const dated = await prisma.opportunity.findMany({
        where: datedWhere,
        orderBy: [{ deadline: "asc" }, { createdAt: "desc" }],
        skip,
        take,
        include: { conditions: { include: { evidence: true }, orderBy: { id: "asc" } } },
      });
      if (dated.length < take) {
        // استكمال الصفحة من الفرص بلا موعد (تأتي بعد كل المؤرخة)
        const datedTotal = await prisma.opportunity.count({ where: datedWhere });
        const nullSkip = Math.max(0, skip - datedTotal);
        const noDeadline = await prisma.opportunity.findMany({
          where: { ...where, deadline: null },
          orderBy: { createdAt: "desc" },
          skip: nullSkip,
          take: take - dated.length,
          include: { conditions: { include: { evidence: true }, orderBy: { id: "asc" } } },
        });
        rows = [...dated, ...noDeadline];
      } else {
        rows = dated;
      }
    }

    // ————— الصياغة المضغوطة مع الموثوقية الحية —————
    const items: CompactOpportunity[] = rows.map((o) => ({
      id: o.id,
      title: o.title,
      orgName: o.orgName,
      type: o.type,
      amountMin: o.amountMin,
      amountMax: o.amountMax,
      currency: o.currency,
      sectors: parseJsonField<string[]>(o.sectorsJson, []),
      geography: o.geography,
      deadline: o.deadline ? o.deadline.toISOString() : null,
      deadlineTz: o.deadlineTz,
      reliability: reliabilityForOpp(
        { sourceType: o.sourceType, verifiedAt: o.verifiedAt, linkCheckState: o.linkCheckState },
        o.conditions
      ),
      status: o.status,
    }));

    return ok({ items, total, skip, take, sort });
  } catch (e) {
    return handleRouteError(e);
  }
}
