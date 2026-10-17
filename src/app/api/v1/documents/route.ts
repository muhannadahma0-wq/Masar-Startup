/**
 * Masar — T14: قائمة مستندات الشركة GET /api/v1/documents
 *
 * requireUser + requireProfile → كل CompanyDocument للملف + قائمة الأنواع القياسية
 * الغائبة (DOC_TYPE_KEYS من core/types) بحالة missing افتراضية ومصدر null.
 */
import type { NextRequest } from "next/server";
import type { CompanyDocument } from "@prisma/client";
import { ok, handleRouteError, requireUser, requireProfile, prisma } from "@/lib/server/api";
import { DOC_TYPE_KEYS } from "@/lib/core/types";

interface DocumentView {
  docType: string;
  status: "available" | "missing" | "expired";
  source: string | null;
  notes: string | null;
  updatedAt: string | null;
}

function shapeDocument(d: CompanyDocument): DocumentView {
  return {
    docType: d.docType,
    status: d.status as DocumentView["status"],
    source: d.source,
    notes: d.notes,
    updatedAt: d.updatedAt.toISOString(),
  };
}

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const user = await requireUser(req);
    const profile = await requireProfile(user.id);

    const stored = await prisma.companyDocument.findMany({ where: { profileId: profile.id } });
    const byType = new Map(stored.map((d) => [d.docType, d]));

    // الأنواع القياسية بترتيبها المعرفي؛ الغائب يظهر missing/مصدر null
    const documents: DocumentView[] = DOC_TYPE_KEYS.map((docType) => {
      const d = byType.get(docType);
      return d
        ? shapeDocument(d)
        : { docType, status: "missing", source: null, notes: null, updatedAt: null };
    });
    // أي نوع مخزّن خارج القائمة القياسية يُعرض بعد القائمة (بيانات قديمة مثلًا)
    for (const d of stored) {
      if (!(DOC_TYPE_KEYS as readonly string[]).includes(d.docType)) documents.push(shapeDocument(d));
    }

    return ok({ documents });
  } catch (e) {
    return handleRouteError(e);
  }
}
