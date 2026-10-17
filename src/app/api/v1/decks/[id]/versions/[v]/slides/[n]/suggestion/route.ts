/**
 * Masar — T13: قرار المؤسس على اقتراح الشريحة (قبول/تعديل/رفض)
 * PATCH /api/v1/decks/[id]/versions/[v]/slides/[n]/suggestion
 * ============================================================================
 * المسار (عقد §10 «الأصل محفوظ»):
 *   1) assertSameOrigin → requireRole(FOUNDER) → requireProfile → ملكية العرض
 *      (deck.profileId = profile.id وإلا 404 بلا كشف وجود — حماية IDOR) →
 *      النسخة v موجودة.
 *   2) parseBody(SuggestDecisionInput): decision ∈ accepted|edited|rejected.
 *      إن edited → editedText إلزامي (422 EDITED_TEXT_REQUIRED إن غاب/فرغ).
 *   3) النص المعدَّل يمرّ على suggestionGuard (T5) بنفس الشريحة والحقائق
 *      (الحقائق تُعاد بنفس الطريقة الحتمية في مسار التوليد: قيم الملف
 *      fieldsJson+founders+documents + الحقول المستخرجة المؤكدة لهذه النسخة)
 *      — الفشل → 422 GUARD_REJECTED «نصك المعدَّل يضيف معلومة غير موجودة في
 *      الشريحة أو الملف» مع الأعلام، وبلا أي كتابة قبل النجاح.
 *   4) تحديث الأحدث اقتراحًا للشريحة n (decision, editedText, decidedAt=الآن)
 *      — الاقتراحات الأقدم تبقى كما هي، والسماح ب تغيير القرار لاحقًا.
 *      audit SLIDE_SUGGESTION_DECIDED (القرار فقط — لا نص).
 *   5) الرد 200: { suggestionId, decision, editedText, decidedAt }.
 *
 * **الأصل لا يُعدَّل أبدًا**: لا كتابة في slidesJson هنا إطلاقًا، وdecision
 * accepted/rejected يفرّغ editedText (لا يبقى نص معدَّل لقرار غير «تعديل»).
 * النص المعدَّل خام raw (الواجهة تعرضه نصًّا).
 *
 * ملاحظة ملكية: الأدوات المشتركة مع مسار التوليد suggest/route.ts مكررة هنا
 * (قيد «ملفاتي فقط» + منع التصدير من ملفات المسارات في Next).
 */
import type { NextRequest } from "next/server";
import {
  ok,
  fail,
  parseBody,
  handleRouteError,
  requireRole,
  requireProfile,
  assertSameOrigin,
  audit,
  parseJsonField,
  ApiErrorClass,
  prisma,
} from "@/lib/server/api";
import { SuggestDecisionInput } from "@/lib/schemas";
import { suggestionGuard } from "@/lib/core/guards";

// ————— أدوات مشتركة (مكررة عمدًا — انظر ملاحظة الملكية أعلاه) —————

/** الحقل المخزن في fieldsJson (مطابق لتعليق مخطط Prisma) */
interface StoredProfileField {
  field: string;
  value: unknown;
}

/** الحقل المخزن في extractionJson (مطابق لتعليق مخطط Prisma) */
interface StoredExtractedField {
  key: string;
  value: unknown;
  status: string;
}

function formatFactValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolveProfileFields(raw: string): StoredProfileField[] {
  const parsed = parseJsonField<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (f): f is StoredProfileField =>
      typeof f === "object" && f !== null && typeof (f as { field?: unknown }).field === "string",
  );
}

function resolveExtractedFields(raw: string): StoredExtractedField[] {
  const parsed = parseJsonField<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (f): f is StoredExtractedField =>
      typeof f === "object" &&
      f !== null &&
      typeof (f as { key?: unknown }).key === "string" &&
      typeof (f as { status?: unknown }).status === "string",
  );
}

/** الحقائق المؤكدة — نفس بناء مسار التوليد (حتمي): «key=value» */
function buildConfirmedFacts(src: {
  fieldsJson: string;
  founders: Array<{ name: string | null; region: string | null; nationality: string | null }>;
  documents: Array<{ docType: string; status: string }>;
  extractionJson: string;
}): string[] {
  const facts: string[] = [];
  for (const f of resolveProfileFields(src.fieldsJson)) {
    const v = formatFactValue(f.value);
    if (v.length > 0) facts.push(`${f.field}=${v}`);
  }
  for (const founder of src.founders) {
    if (founder.name) facts.push(`founder.name=${founder.name}`);
    if (founder.region) facts.push(`founder.region=${founder.region}`);
    if (founder.nationality) facts.push(`founder.nationality=${founder.nationality}`);
  }
  for (const doc of src.documents) {
    facts.push(`document.${doc.docType}=${doc.status}`);
  }
  for (const ef of resolveExtractedFields(src.extractionJson)) {
    if (ef.status !== "confirmed") continue; // المؤكدة فقط — المرفوضة/الساقطة ليست حقائق
    const v = formatFactValue(ef.value);
    if (v.length > 0) facts.push(`${ef.key}=${v}`);
  }
  return facts;
}

interface OwnedVersion {
  deckId: string;
  versionId: string;
  versionNumber: number;
  slideCount: number;
  slidesJson: string;
  extractionJson: string;
}

/** تحميل العرض المملوكة + النسخة v — أخطاء عربية بلا كشف وجود الغير (IDOR) */
async function loadOwnedVersion(
  profileId: string,
  deckId: string,
  vRaw: string,
): Promise<OwnedVersion> {
  const vNum = Number.parseInt(vRaw, 10);
  if (!Number.isInteger(vNum) || vNum < 1) {
    throw new ApiErrorClass("DECK_VERSION_NOT_FOUND", "نسخة العرض المطلوبة غير موجودة", 404);
  }
  const deck = await prisma.deck.findUnique({ where: { id: deckId }, include: { versions: true } });
  if (!deck || deck.profileId !== profileId) {
    // الرد نفسه للعرض الموجود لغيرك وغير الموجود — لا كشف وجود
    throw new ApiErrorClass("DECK_NOT_FOUND", "العرض غير موجود", 404);
  }
  const version = deck.versions.find((ver) => ver.versionNumber === vNum);
  if (!version) {
    throw new ApiErrorClass("DECK_VERSION_NOT_FOUND", "نسخة العرض المطلوبة غير موجودة", 404);
  }
  return {
    deckId: deck.id,
    versionId: version.id,
    versionNumber: version.versionNumber,
    slideCount: version.slideCount,
    slidesJson: version.slidesJson,
    extractionJson: version.extractionJson,
  };
}

// ————— المعالج —————

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; v: string; n: string }> },
): Promise<Response> {
  try {
    // القيد: assertSameOrigin أولًا ثم requireUser/requireRole
    assertSameOrigin(req);
    const user = await requireRole(req, ["FOUNDER"]);
    const profile = await requireProfile(user.id);
    const { id, v, n } = await ctx.params;
    const body = await parseBody(req, SuggestDecisionInput);

    const nNum = Number.parseInt(n, 10);
    if (!Number.isInteger(nNum) || nNum < 1) {
      throw new ApiErrorClass("SLIDE_NOT_FOUND", "رقم الشريحة غير صالح", 404);
    }

    const version = await loadOwnedVersion(profile.id, id, v);
    if (nNum > version.slideCount) {
      throw new ApiErrorClass("SLIDE_NOT_FOUND", "رقم الشريحة خارج نطاق هذا العرض", 404);
    }

    // الأحدث اقتراحًا لهذه الشريحة (كسر تعادل حتمي بالمعرف)
    const latest = await prisma.slideSuggestion.findFirst({
      where: { deckVersionId: version.versionId, slideIndex: nNum },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (!latest) {
      throw new ApiErrorClass("SUGGESTION_NOT_FOUND", "لا يوجد اقتراح لهذه الشريحة بعد", 404);
    }

    // النص المعدَّل يمرّ على حارس الاقتراحات بنفس الشريحة والحقائق — قبل أي كتابة
    let editedText: string | null = null;
    if (body.decision === "edited") {
      // القرار «تعديل» يستلزم نصًّا معدَّلًا (خارج المخطط المشترك — تحقق دلالي هنا)
      const text = body.editedText;
      if (typeof text !== "string" || text.trim().length === 0) {
        throw new ApiErrorClass(
          "EDITED_TEXT_REQUIRED",
          "النص المعدَّل إلزامي عند اختيار قرار «تعديل»",
          422,
        );
      }
      const [founders, documents] = await Promise.all([
        prisma.founder.findMany({ where: { profileId: profile.id } }),
        prisma.companyDocument.findMany({ where: { profileId: profile.id } }),
      ]);
      const confirmedFacts = buildConfirmedFacts({
        fieldsJson: profile.fieldsJson,
        founders: founders.map((f) => ({ name: f.name, region: f.region, nationality: f.nationality })),
        documents: documents.map((d) => ({ docType: d.docType, status: d.status })),
        extractionJson: version.extractionJson,
      });
      // نفس نص الشريحة الأصلي المخزَّن (لا يُمسّ أبدًا) + نفس الحقائق
      const guard = suggestionGuard(latest.originalText, confirmedFacts, text);
      if (!guard.passed) {
        return fail(
          "GUARD_REJECTED",
          "نصك المعدَّل يضيف معلومة غير موجودة في الشريحة أو الملف",
          422,
          { flags: guard.flags },
        );
      }
      editedText = text; // خام كما أرسله المؤسس
    }

    // الأصل محفوظ: لا كتابة في slidesJson — القرار فقط على الاقتراح
    const updated = await prisma.slideSuggestion.update({
      where: { id: latest.id },
      data: { decision: body.decision, editedText, decidedAt: new Date() },
    });

    // التدقيق: القرار فقط — لا نص ولا قيم
    await audit(user.id, "SLIDE_SUGGESTION_DECIDED", "SlideSuggestion", updated.id, {
      decision: body.decision,
    });

    return ok({
      suggestionId: updated.id,
      decision: updated.decision,
      editedText: updated.editedText,
      decidedAt: updated.decidedAt ? updated.decidedAt.toISOString() : null,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
