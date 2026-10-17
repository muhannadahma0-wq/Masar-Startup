/**
 * Masar — T14: تعليم إشعار مقروءًا PATCH /api/v1/notifications/[id]
 *
 * assertSameOrigin أولًا ثم requireUser — الملكية: إشعار المستخدم أو 404
 * (لا يُكشف وجود إشعار الغير). التعليم idempotent: الإشعار المقروء سابقًا يحتفظ
 * بreadAt الأصلي. params وعد في Next 16 (Promise).
 */
import type { NextRequest } from "next/server";
import type { Notification } from "@prisma/client";
import {
  ok,
  handleRouteError,
  requireUser,
  assertSameOrigin,
  ApiErrorClass,
  prisma,
} from "@/lib/server/api";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    // القيد: assertSameOrigin أولًا ثم requireUser
    assertSameOrigin(req);
    const user = await requireUser(req);
    const { id } = await ctx.params;

    const existing: Notification | null = await prisma.notification.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      throw new ApiErrorClass("NOT_FOUND", "الإشعار غير موجود", 404);
    }

    const updated = existing.readAt
      ? existing // مقروء سابقًا — لا نغيّر readAt (idempotent)
      : await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });

    return ok({
      notification: {
        id: updated.id,
        readAt: updated.readAt ? updated.readAt.toISOString() : null,
      },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
