/**
 * Masar — T11: POST /api/v1/matches/what-if — «ماذا لو» (محاكاة في الذاكرة فقط)
 * ---------------------------------------------------------------------------
 * القيود (§6 + مهمة T11):
 *  1) assertSameOrigin أولًا (كل POST).
 *  2) requireUser(FOUNDER) + requireProfile + parseBody(WhatIfInput من schemas).
 *  3) نسخة معدّلة **في الذاكرة فقط** (لا حفظ): تبدأ من الحقول الحالية وتستبدل
 *     ما جاء في body.fields (بالمصدر "manual" الوهمي «ماذا لو») + founderOverrides
 *     إن جاءت (تحل محل المؤسسين في النسخة — founder.region يُقرأ من founders أولًا).
 *  4) **لا يُكتب شيء في القاعدة ولا في سجل التدقيق** — بلا audit وبلا إشعارات.
 *
 * الرد: { matches: [نفس شكل GET /matches على النسخة المعدّلة],
 *          changed: [{ opportunityId, title, oldJudgment, newJudgment }] }
 * — فقط الفرص التي تغيّر حكمها؛ القديم من الملف الحقيقي والجديد من النسخة.
 * الحكمان يُحسبان بلحظة `now` واحدة (حتمية ومقارنة عادلة).
 */
import type { NextRequest } from "next/server";
import {
  assertSameOrigin,
  handleRouteError,
  ok,
  parseBody,
  requireProfile,
  requireRole,
} from "@/lib/server/api";
import { WhatIfInput } from "@/lib/schemas";
import {
  buildMatchesForProfile,
  buildMatchesForWhatIf,
  diffJudgments,
  rankMatches,
  toMatchResponse,
} from "@/lib/server/matches";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req); // أولًا دائمًا
    const user = await requireRole(req, ["FOUNDER"]);
    const profile = await requireProfile(user.id);
    const body = await parseBody(req, WhatIfInput);

    // لحظة واحدة للحكمين: القديم من الملف الحقيقي والجديد من النسخة الوهمية
    const now = new Date();
    const current = await buildMatchesForProfile(profile.id, now);
    // محاكاة في الذاكرة فقط — لا حفظ ولا audit (buildMatchesForWhatIf للقراءة فقط)
    const whatIf = await buildMatchesForWhatIf(
      profile.id,
      { fields: body.fields, founderOverrides: body.founderOverrides },
      now
    );

    return ok({
      matches: rankMatches(whatIf).map(toMatchResponse),
      changed: diffJudgments(current, whatIf),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
