/**
 * Masar — GET /api/v1/auth/me (T9)
 * ---------------------------------------------------------------------------
 * التسلسل: requireUser (الجلسة من الكوكي httpOnly — لا معاملات من العميل)
 * → رد { user, profile }. الملف يُجلب كاملًا من القاعدة، ويُنشأ هنا lazily
 * إن غاب (توافق مع بيانات بذر جزئية أو سجلات قديمة): StartupProfile بحقول
 * فارغة "[]" + مؤسس أساسي isPrimary.
 *
 * GET آمن (لا تغيير حالة) — لا يحتاج assertSameOrigin.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  handleRouteError,
  ok,
  parseJsonField,
  prisma,
  requireUser,
} from "@/lib/server/api";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser(req);

    // أوجد الملف أو أنشئه lazily إن غاب
    let profile = await prisma.startupProfile.findUnique({
      where: { userId: user.id },
      include: { founders: true },
    });
    if (!profile) {
      profile = await prisma.startupProfile.create({
        data: {
          userId: user.id,
          fieldsJson: "[]",
          founders: {
            create: [{ name: user.name, isPrimary: true }],
          },
        },
        include: { founders: true },
      });
    }

    const documents = await prisma.companyDocument.findMany({
      where: { profileId: profile.id },
      orderBy: { docType: "asc" },
    });

    return ok({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        locale: user.locale,
      },
      profile: {
        id: profile.id,
        updatedAt: profile.updatedAt,
        // JSON.parse(fieldsJson) عبر الأداة المشتركة (سلسلة تالفة → [] لا 500)
        fields: parseJsonField<unknown[]>(profile.fieldsJson, []),
        founders: profile.founders.map((f) => ({
          id: f.id,
          name: f.name,
          region: f.region,
          nationality: f.nationality,
          isPrimary: f.isPrimary,
        })),
        documents: documents.map((d) => ({
          id: d.id,
          docType: d.docType,
          status: d.status,
          source: d.source,
          notes: d.notes,
          updatedAt: d.updatedAt,
        })),
      },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
