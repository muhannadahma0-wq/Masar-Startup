/**
 * Masar — T14: إشعارات المستخدم GET /api/v1/notifications
 *
 * requireUser → إشعارات المستخدم مرتبة بالأحدث أولًا (حد 50) مع
 * { id, eventType, opportunity {id,title} إن وجد, payloadAr, readAt, createdAt }.
 * دعم ?unread=true — غير المقروءة فقط (readAt = null).
 */
import type { NextRequest } from "next/server";
import { ok, handleRouteError, requireUser, prisma } from "@/lib/server/api";
import { payloadArFromJson, payloadEnFromJson } from "@/lib/server/notify";

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const user = await requireUser(req);
    const unreadOnly = req.nextUrl.searchParams.get("unread") === "true";

    const items = await prisma.notification.findMany({
      where: {
        userId: user.id,
        ...(unreadOnly ? { readAt: null } : {}),
      },
      include: { opportunity: { select: { id: true, title: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    });

    return ok({
      unreadOnly,
      notifications: items.map((n) => ({
        id: n.id,
        eventType: n.eventType,
        opportunity: n.opportunity ? { id: n.opportunity.id, title: n.opportunity.title } : null,
        payloadAr: payloadArFromJson(n.payloadJson),
        payloadEn: payloadEnFromJson(n.payloadJson),
        readAt: n.readAt ? n.readAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
