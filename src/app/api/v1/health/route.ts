/**
 * Masar — T10: GET /api/v1/health — فحص صحة الخدمة
 * =============================================================================
 * بلا مصادقة (فحص جاهزية عام): { ok: true, db: <اتصال prisma>, time }.
 * الاتصال: prisma.$queryRaw`SELECT 1` — يعاد مؤشر اتصال boolean بدل القيمة الخام.
 * فشل القاعدة → 503 DB_UNAVAILABLE (مغلف ok/fail كالعادة).
 */
import { ok, fail, handleRouteError, prisma } from "@/lib/server/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await prisma.$queryRaw`SELECT 1`;
    const dbConnected = Array.isArray(rows) && rows.length > 0;
    if (!dbConnected) {
      return fail("DB_UNAVAILABLE", "تعذّر التحقق من اتصال قاعدة البيانات", 503);
    }
    return ok({ ok: true, db: true, time: new Date().toISOString() });
  } catch (e) {
    return handleRouteError(e);
  }
}
