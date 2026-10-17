/**
 * Masar — T14: تحديث مستند PUT /api/v1/documents/[type]
 *
 * assertSameOrigin أولًا ثم requireUser + requireProfile + parseBody(DocumentUpdateInput)
 * — upsert بالنوع (docType من المسار؛ يجب أن يكون ضمن DOC_TYPE_KEYS وإلا 422)
 * — audit DOCUMENT_UPDATED.
 * params وعد في Next 16 (Promise).
 */
import type { NextRequest } from "next/server";
import type { CompanyDocument } from "@prisma/client";
import {
  ok,
  parseBody,
  handleRouteError,
  requireUser,
  requireProfile,
  assertSameOrigin,
  audit,
  ApiErrorClass,
  prisma,
} from "@/lib/server/api";
import { DOC_TYPE_KEYS } from "@/lib/core/types";
import { DocumentUpdateInput } from "@/lib/schemas";

interface DocumentView {
  docType: string;
  status: "available" | "missing" | "expired";
  source: string | null;
  notes: string | null;
  updatedAt: string;
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

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ type: string }> },
): Promise<Response> {
  try {
    // القيد: assertSameOrigin أولًا ثم requireUser
    assertSameOrigin(req);
    const user = await requireUser(req);
    const profile = await requireProfile(user.id);
    const { type } = await ctx.params;

    if (!(DOC_TYPE_KEYS as readonly string[]).includes(type)) {
      throw new ApiErrorClass("INVALID_DOC_TYPE", "نوع مستند غير معروف", 422, {
        allowed: DOC_TYPE_KEYS,
      });
    }

    const body = await parseBody(req, DocumentUpdateInput);

    const doc = await prisma.companyDocument.upsert({
      where: {
        profileId_docType: { profileId: profile.id, docType: type },
      },
      create: {
        profileId: profile.id,
        docType: type,
        status: body.status,
        source: body.source ?? null,
        notes: body.notes ?? null,
      },
      update: {
        status: body.status,
        source: body.source ?? null,
        notes: body.notes ?? null,
      },
    });
    await audit(user.id, "DOCUMENT_UPDATED", "CompanyDocument", doc.id, {
      docType: type,
      status: body.status,
    });
    return ok({ document: shapeDocument(doc) });
  } catch (e) {
    return handleRouteError(e);
  }
}
