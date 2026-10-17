/**
 * Masar — T10: POST /api/v1/admin/opportunities/[id]/update — تحديث منشورة + نسخ + إشعارات
 * =============================================================================
 * يعمل على الفرص PUBLISHED فقط (نص المهمة). المسار:
 *  1) parseBody(OpportunityUpdateInput) { reason?, patch } — patch جزئي.
 *     موثّق (قيد zod v4): .partial() يشغّل القيم الافتراضية (description ""،
 *     type "grant"…) حتى عند غياب الحقل، لذا يُقرأ «المفاتيح المقدَّمة فعلًا»
 *     من نسخة خام للطلب (req.clone()) — parseBody يبقى المصدر الوحيد للتحقق.
 *  2) يُعاد بناء الحقول المتغيرة (patch جزئي) ويُحسب diff (قديم/جديد لكل حقل
 *     متغير بما فيه مقالة «conditions: قديمة N/جديدة M» عند استبدال الشروط).
 *  3) التصنيف: جوهري إن شمل deadline/الشروط الإلزامية/amount/requiresDocs/status،
 *     وإلا non_substantive — مع changeCategory.
 *  4) تنشأ OpportunityVersion (currentVersion+1) بdiffJson وchangeType وreason.
 *  5) الجوهري → notifyByIdempotent (T14) لكل مستخدم معني (Application بحالة
 *     INTERESTED/PREPARING/SUBMITTED على الفرصة) بمفتاح (userId, opportunityId,
 *     eventType=SUBSTANTIVE_CHANGE, versionNumber) — لا تكرار. عدا المُشعَرين
 *     يُعاد في الرد.
 *  6) audit OPPORTUNITY_UPDATED.
 *
 * ملاحظات موثّقة:
 *  - فرق فارغ (لا حقول مقدَّمة أو قيم مطابقة) → 422 NO_CHANGES.
 *  - تغيّر applicationUrl يعيد حساب normalizedUrl مع فحص تكرار يستثني الفرصة نفسها.
 *  - استبدال الشروط: deleteMany ثم create داخل معاملة واحدة؛ أدلة الشروط
 *    القديمة اليتيمة تُحذف بعد المعاملة (الأدلة الجديدة تُنشأ دائمًا).
 *  - حمولة الإشعار (payloadAr): ملخص عربي للتغيير + تنبيه إعادة تقييم الأهلية
 *    (إعادة التقييم التفصيلية من مسؤولية شاشة الفرص — عقد §11).
 */
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import {
  ok, fail, parseBody, requireRole, assertSameOrigin, audit, handleRouteError,
  prisma, parseJsonField,
} from "@/lib/server/api";
import { OpportunityUpdateInput } from "@/lib/schemas";
import { normalizeUrl } from "@/lib/core/text";
import {
  parseIsoDate, buildOppDiff, classifyChange, mandatoryConditionsChanged,
  conditionsDiffEntry, summarizeDiffAr, summarizeConditionsAr,
} from "@/lib/server/conditions";
import type {
  ConditionBrief, OpportunityScalarSnapshot,
} from "@/lib/server/conditions";
import { notifyByIdempotent } from "@/lib/server/notify";
import type { OpportunityChange } from "@/lib/core/types";

export const dynamic = "force-dynamic";

const NOTIFIABLE_APPLICATION_STATUSES = ["INTERESTED", "PREPARING", "SUBMITTED"] as const;

/** مدخل شرط من مخطط ConditionInput بعد التحقق (zod يجعل الافتراضيات موجودة). */
interface ConditionInputT {
  field: string;
  op: string;
  value?: unknown;
  mandatory: boolean;
  ambiguous: boolean;
  scope: string;
  sourceWording?: string;
  evidence?: { url: string; quote: string; verifiedAt: string };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const user = await requireRole(req, ["REVIEWER", "ADMIN"]);
    const { id } = await ctx.params;

    // ————— المفاتيح المقدَّمة فعلًا (parseBody مصدر التحقق؛ هذا للكشف فقط) —————
    const clone = req.clone();
    const providedKeys = new Set<string>();
    try {
      const raw: unknown = await clone.json();
      if (raw && typeof raw === "object") {
        const patchRaw = (raw as { patch?: unknown }).patch;
        if (patchRaw && typeof patchRaw === "object" && !Array.isArray(patchRaw)) {
          for (const k of Object.keys(patchRaw as Record<string, unknown>)) providedKeys.add(k);
        }
      }
    } catch {
      // جسم غير مقروء — سيفشل parseBody لاحقًا برسالة واضحة (BAD_JSON)
    }

    const body = await parseBody(req, OpportunityUpdateInput);
    const patch = body.patch;

    const opp = await prisma.opportunity.findUnique({
      where: { id },
      include: { conditions: { include: { evidence: true }, orderBy: { id: "asc" } } },
    });
    if (!opp) {
      return fail("NOT_FOUND", "الفرصة غير موجودة", 404);
    }
    if (opp.status !== "PUBLISHED") {
      return fail("INVALID_STATE", "التحديث بالنسخ يعمل على الفرص المنشورة فقط (الحالة الحالية: " + opp.status + ")", 409, {
        status: opp.status,
      });
    }

    // ————— الحقول القديمة (لقطة) —————
    const before: OpportunityScalarSnapshot = {
      title: opp.title,
      orgName: opp.orgName,
      description: opp.description,
      type: opp.type,
      fundingType: opp.fundingType,
      amountMin: opp.amountMin,
      amountMax: opp.amountMax,
      currency: opp.currency,
      sectors: parseJsonField<string[]>(opp.sectorsJson, []),
      stageMin: opp.stageMin,
      stageMax: opp.stageMax,
      geography: opp.geography,
      geoPriority: opp.geoPriority,
      languages: parseJsonField<string[]>(opp.languagesJson, ["ar"]),
      applicationUrl: opp.applicationUrl,
      sourceType: opp.sourceType,
      deadline: opp.deadline,
      deadlineTz: opp.deadlineTz,
      requiresDocs: parseJsonField<string[]>(opp.requiresDocsJson, []),
    };

    // ————— بناء اللقطة الجديدة من المفاتيح المقدَّمة فقط —————
    const after: OpportunityScalarSnapshot = { ...before };
    if (providedKeys.has("title")) after.title = patch.title as string;
    if (providedKeys.has("orgName")) after.orgName = patch.orgName as string;
    if (providedKeys.has("description")) after.description = patch.description as string;
    if (providedKeys.has("type")) after.type = patch.type as string;
    if (providedKeys.has("fundingType")) after.fundingType = (patch.fundingType ?? null) as string | null;
    if (providedKeys.has("amountMin")) after.amountMin = (patch.amountMin ?? null) as number | null;
    if (providedKeys.has("amountMax")) after.amountMax = (patch.amountMax ?? null) as number | null;
    if (providedKeys.has("currency")) after.currency = patch.currency as string;
    if (providedKeys.has("sectors")) after.sectors = patch.sectors as string[];
    if (providedKeys.has("stageMin")) after.stageMin = (patch.stageMin ?? null) as string | null;
    if (providedKeys.has("stageMax")) after.stageMax = (patch.stageMax ?? null) as string | null;
    if (providedKeys.has("geography")) after.geography = patch.geography as string;
    if (providedKeys.has("geoPriority")) after.geoPriority = patch.geoPriority as boolean;
    if (providedKeys.has("languages")) after.languages = patch.languages as string[];
    if (providedKeys.has("applicationUrl")) after.applicationUrl = (patch.applicationUrl ?? null) as string | null;
    if (providedKeys.has("sourceType")) after.sourceType = patch.sourceType as string;
    if (providedKeys.has("deadline")) {
      // patch.deadline: ISO اختياري (لا يمكن إفراغ الموعد عبر هذا المخطط — قيد schemas)
      after.deadline = patch.deadline ? parseIsoDate(patch.deadline, "الموعد النهائي") : null;
    }
    if (providedKeys.has("deadlineTz")) after.deadlineTz = patch.deadlineTz as string;
    if (providedKeys.has("requiresDocs")) after.requiresDocs = patch.requiresDocs as string[];

    // ————— الشروط: استبدال كامل إن قُدّمت —————
    const oldConditions: ConditionBrief[] = opp.conditions.map((c) => ({
      field: c.field,
      op: c.op,
      value: parseJsonField<unknown>(c.valueJson, null),
      mandatory: c.mandatory,
      scope: c.scope,
      ambiguous: c.ambiguous,
    }));
    const conditionsProvided = providedKeys.has("conditions") && Array.isArray(patch.conditions);
    const newConditionInputs: ConditionInputT[] = conditionsProvided
      ? (patch.conditions as ConditionInputT[])
      : [];
    const newConditions: ConditionBrief[] = newConditionInputs.map((c) => ({
      field: c.field,
      op: c.op,
      value: c.value === undefined ? null : c.value,
      mandatory: c.mandatory,
      scope: c.scope,
      ambiguous: c.ambiguous,
    }));

    // ————— فحص تكرار الرابط عند تغيّره —————
    if (after.applicationUrl && after.applicationUrl !== before.applicationUrl) {
      const newNormalized = normalizeUrl(after.applicationUrl);
      const dupe = await prisma.opportunity.findFirst({
        where: { normalizedUrl: newNormalized, id: { not: opp.id } },
        select: { id: true, title: true },
      });
      if (dupe) {
        return fail("CONFLICT", "رابط التقديم الجديد يطابق فرصة أخرى بعد التوحيد", 409, {
          normalizedUrl: newNormalized,
          existingId: dupe.id,
          existingTitle: dupe.title,
        });
      }
    }

    // ————— حساب الفرق —————
    const diff: OpportunityChange[] = buildOppDiff(before, after);
    const mandatoryChanged = conditionsProvided
      ? mandatoryConditionsChanged(oldConditions, newConditions)
      : false;
    if (conditionsProvided) {
      diff.push(conditionsDiffEntry(oldConditions, newConditions));
    }

    if (diff.length === 0) {
      return fail("NO_CHANGES", "لا توجد تغييرات فعلية في الطلب — عدّل حقلًا واحدًا على الأقل", 422, {
        providedKeys: [...providedKeys],
      });
    }

    const { changeType, changeCategory } = classifyChange(diff, { mandatoryConditionsChanged: mandatoryChanged });
    const newVersion = opp.currentVersion + 1;

    // ————— تطبيق التحديث + إنشاء النسخة في معاملة واحدة —————
    const updateData: Prisma.OpportunityUpdateInput = {
      title: after.title,
      orgName: after.orgName,
      description: after.description,
      type: after.type,
      fundingType: after.fundingType,
      amountMin: after.amountMin,
      amountMax: after.amountMax,
      currency: after.currency,
      sectorsJson: JSON.stringify(after.sectors),
      stageMin: after.stageMin,
      stageMax: after.stageMax,
      geography: after.geography,
      geoPriority: after.geoPriority,
      languagesJson: JSON.stringify(after.languages),
      applicationUrl: after.applicationUrl,
      ...(after.applicationUrl ? { normalizedUrl: normalizeUrl(after.applicationUrl) } : {}),
      sourceType: after.sourceType,
      deadline: after.deadline,
      deadlineTz: after.deadlineTz,
      requiresDocsJson: JSON.stringify(after.requiresDocs),
      currentVersion: newVersion,
      ...(conditionsProvided
        ? {
            conditions: {
              deleteMany: {},
              create: newConditionInputs.map((c) => ({
                field: c.field,
                op: c.op,
                valueJson: JSON.stringify(c.value === undefined ? null : c.value),
                mandatory: c.mandatory,
                ambiguous: c.ambiguous,
                scope: c.scope,
                sourceWording: c.sourceWording ?? null,
                ...(c.evidence
                  ? {
                      evidence: {
                        create: {
                          url: c.evidence.url,
                          quote: c.evidence.quote,
                          verifiedAt: parseIsoDate(c.evidence.verifiedAt, "تاريخ تحقق الدليل"),
                        },
                      },
                    }
                  : {}),
              })),
            },
          }
        : {}),
    };

    const [updatedOpp] = await prisma.$transaction([
      prisma.opportunity.update({
        where: { id },
        data: updateData,
        include: { conditions: { include: { evidence: true }, orderBy: { id: "asc" } } },
      }),
      prisma.opportunityVersion.create({
        data: {
          opportunityId: id,
          versionNumber: newVersion,
          diffJson: JSON.stringify(diff),
          changeType,
          changeCategory,
          reason: body.reason ?? null,
          createdById: user.id,
        },
      }),
    ]);

    // ————— تنظيف أدلة الشروط المحذوفة (اليتيمة فقط) —————
    const oldEvidenceIds = opp.conditions
      .map((c) => c.evidenceId)
      .filter((x): x is string => x !== null);
    if (conditionsProvided && oldEvidenceIds.length > 0) {
      await prisma.evidence.deleteMany({
        where: { id: { in: oldEvidenceIds }, conditions: { none: {} } },
      });
    }

    // ————— إشعار التغيير الجوهري (مفتاح فريد — لا تكرار) —————
    let notified = 0;
    const notifiedUserIds: string[] = [];
    if (changeType === "substantive") {
      const apps = await prisma.application.findMany({
        where: { opportunityId: id, status: { in: [...NOTIFIABLE_APPLICATION_STATUSES] } },
        select: { profile: { select: { userId: true } } },
      });
      const userIds = [...new Set(apps.map((a) => a.profile.userId))];
      const payloadAr =
        `تحديث جوهري (نسخة ${newVersion}) في الفرصة «${after.title}» من ${after.orgName}: ` +
        summarizeDiffAr(diff) +
        "؛ قد يتغيّر حكم الأهلية — راجع تفاصيل الفرصة.";
      const payloadEn = `A material update (version ${newVersion}) was made to “${after.title}” by ${after.orgName}. Your eligibility assessment may change; review the updated opportunity details and official source.`;
      for (const uid of userIds) {
        try {
          const sent = await notifyByIdempotent({
            userId: uid,
            opportunityId: id,
            eventType: "SUBSTANTIVE_CHANGE",
            versionNumber: newVersion,
            payloadAr,
            payloadEn,
          });
          if (sent) {
            notified++;
            notifiedUserIds.push(uid);
          }
        } catch (e) {
          console.error("[update] notify failed", { userId: uid, opportunityId: id, error: (e as Error)?.message });
        }
      }
    }

    await audit(user.id, "OPPORTUNITY_UPDATED", "Opportunity", id, {
      versionNumber: newVersion,
      changeType,
      changeCategory,
      changedFields: diff.map((d) => d.field),
      notified,
    });

    return ok({
      opportunity: updatedOpp,
      version: {
        versionNumber: newVersion,
        changeType,
        changeCategory,
        reason: body.reason ?? null,
        diff,
        ...(conditionsProvided
          ? {
              mandatoryConditionsChanged: mandatoryChanged,
              oldConditionsSummary: summarizeConditionsAr(oldConditions),
              newConditionsSummary: summarizeConditionsAr(newConditions),
            }
          : {}),
      },
      notified,
      notifiedUserIds,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
