/**
 * Masar — T11: GET /api/v1/matches — مطابقات الملف الحالي (الحكم المفسَّر + الدرجات)
 * ---------------------------------------------------------------------------
 * التدفق (§6): requireUser بدور FOUNDER → requireProfile → buildMatchesForProfile
 * → ترتيب (NOT_ELIGIBLE أخيرًا؛ ضمن الباقي بالملاءمة تنازليًّا).
 *
 * الرد: مصفوفة من:
 *  { opportunity (compact), judgment, summary, blockingReasons, uncertainReasons,
 *    conditions: [{ field, op, mandatory, status, evidenceState, expected, actual,
 *                   unresolvedReason?, sourceWording?, evidence? }],
 *    fit: { total, factors[] } | null,   // null لـ NOT_ELIGIBLE
 *    reliability: { total, level, warningAr? } }
 *
 * قراءة فقط: لا حفظ ولا سجل تدقيق. `now` ضمني (لحظة الطلب) — نفس المدخلات في
 * نفس اللحظة ⇒ نفس المخرجات حرفيًّا (المحرك والدرجات حتمية).
 */
import type { NextRequest } from "next/server";
import { handleRouteError, ok, requireProfile, requireRole } from "@/lib/server/api";
import { buildMatchesForProfile, rankMatches, toMatchResponse } from "@/lib/server/matches";

export async function GET(req: NextRequest) {
  try {
    // قراءة فقط: requireUser(FOUNDER) عبر requireRole — بلا CSRF (طلب GET)
    const user = await requireRole(req, ["FOUNDER"]);
    const profile = await requireProfile(user.id);
    const matches = await buildMatchesForProfile(profile.id);
    return ok(rankMatches(matches).map(toMatchResponse));
  } catch (e) {
    return handleRouteError(e);
  }
}
