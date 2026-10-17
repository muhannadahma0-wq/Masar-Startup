/**
 * Masar — T11: POST /api/v1/quick-check — الفحص السريع للزوار (بلا حساب)
 * ---------------------------------------------------------------------------
 * الخصوصية (مهمة T11 + §3):
 *  - **بلا requireUser وبلا أي حفظ أو سجلات** — لا Session ولا AuditLog ولا
 *    AiRun ولا أي جدول: إجابات الزائر تُحلَّل بمخطط QuickCheckAnswers (المعرّف في
 *    engine.ts — نفس شكل مخطط schemas) ثم تُحوَّل في الذاكرة إلى ProfileSnapshot
 *    عبر quickProfileFromAnswers، وتُقيَّم عليها الفرص PUBLISHED، وتُعاد النتيجة
 *    وتُنسى. **الإجابات لا تُخزَّن أبدًا** ولا تُكتتب في أي مكان.
 *  - assertSameOrigin أولًا (كل POST) — حتى للزوار (حماية CSRF لا تتطلب جلسة).
 *
 * الرد: { matches: [{ opportunity (compact), judgment, summary, uncertainReasons,
 *                     fit: { total, factors[] } | null }] }
 * الحد 15 فرصة بعد الترتيب (الملاءمة للـ ELIGIBLE/UNCERTAIN ثم الاسم — NOT_ELIGIBLE
 * أخيرًا) لتخفيف الحمل.
 */
import type { NextRequest } from "next/server";
import { assertSameOrigin, handleRouteError, ok, parseBody } from "@/lib/server/api";
import { QuickCheckAnswers, quickProfileFromAnswers } from "@/lib/core/engine";
import { buildMatchesForSnapshot, toQuickMatchResponse } from "@/lib/server/matches";

/** الحد الأقصى للفرص المُعادة في الفحص السريع (بعد الترتيب) — تخفيف الحمل. */
const QUICK_CHECK_LIMIT = 15;

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req); // أولًا دائمًا
    // زائر بلا حساب: لا requireUser — والتحقق بمخطط engine (نفس شكل schemas)
    const answers = await parseBody(req, QuickCheckAnswers);
    // **الإجابات لا تُخزَّن أبدًا** — snapshot في الذاكرة فقط ثم يُنسى
    const snapshot = quickProfileFromAnswers(answers);
    const all = await buildMatchesForSnapshot(snapshot); // مرتبة: NOT_ELIGIBLE أخيرًا
    return ok({ matches: all.slice(0, QUICK_CHECK_LIMIT).map(toQuickMatchResponse) });
  } catch (e) {
    return handleRouteError(e);
  }
}
