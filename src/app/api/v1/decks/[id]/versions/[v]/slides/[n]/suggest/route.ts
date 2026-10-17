/**
 * Masar — T13: توليد اقتراح تحسين لشريحة واحدة عند الطلب
 * POST /api/v1/decks/[id]/versions/[v]/slides/[n]/suggest
 * ============================================================================
 * المسار (عقد §10 «اقتراح الشريحة عند الطلب لشريحة واحدة»):
 *   1) assertSameOrigin → requireRole(FOUNDER) → requireProfile → ملكية العرض
 *      (deck.profileId = profile.id وإلا 404 بلا كشف وجود — حماية IDOR) →
 *      النسخة v موجودة وحالتها READY أو PARTIAL (وإلا 409 VERSION_NOT_READY).
 *   2) n (رقم الشريحة من المسار) ضمن [1..slideCount] وإلا 404 SLIDE_NOT_FOUND
 *      (وكذلك إن غابت الشريحة بفهرسها من slidesJson).
 *   3) الشريحة من slidesJson + الحقائق المؤكدة: كل قيم ProfileSnapshot
 *      (profile.fieldsJson + founders + documents بصيغة «key=value») + قيم
 *      الحقول المستخرجة status=confirmed لنفس النسخة.
 *   4) ملاحظات التقييم من readinessJson: معايير هذه الشريحة (criteria التي
 *      slides تتضمن n) بدليلها العربي؛ وإن لم توجد فملاحظة عامة
 *      «حسّن الوضوح والاختصار».
 *   5) generateSuggestion (T6 — يمرّ بSuggestion Guard): الفشل الآمن
 *      (guard.passed=false وsuggestedText فارغ) → 422 GUARD_REJECTED مع الأعلام.
 *   6) إنشاء SlideSuggestion (decision="pending"): originalText = نص الشريحة
 *      كما هو (لا يُمسّ أبدًا) وguardReportJson = التقرير كاملًا. الاقتراحات
 *      السابقة للشريحة نفسها تبقى بالسجل كما هي (الاستعلام يأخذ الأحدث).
 *
 * الرد 201: { suggestionId, slideIndex, originalText, suggestedText, reasonAr,
 *   guard:{passed,flags}, provider, createdAt } — النص خام raw بلا sanitize HTML
 *   (الواجهة تعرضه نصًّا — مقاوم XSS بالعرض لا بالتعديل).
 *
 * ملاحظة ملكية: الأدوات المشتركة (تحميل النسخة المملوكة/بناء الحقائق/ملاحظات
 * التقييم) مكررة في مسار القرار suggestion/route.ts — قيد «ملفاتي فقط» يمنع
 * إنشاء ملف مشترك خارج المسارين، ولا يجوز التصدير من ملف مسار (قيد Next).
 */
import type { NextRequest } from "next/server";
import {
  ok,
  fail,
  handleRouteError,
  requireRole,
  requireProfile,
  assertSameOrigin,
  parseJsonField,
  ApiErrorClass,
  prisma,
} from "@/lib/server/api";
import { generateSuggestion } from "@/lib/ai/suggest";
import type { Slide } from "@/lib/core/types";

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

function resolveSlides(raw: string): Slide[] {
  const parsed = parseJsonField<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (s): s is Slide =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as { index?: unknown }).index === "number" &&
      typeof (s as { title?: unknown }).title === "string" &&
      typeof (s as { text?: unknown }).text === "string",
  );
}

/** الحقائق المؤكدة: قيم ProfileSnapshot (حقول+مؤسسون+مستندات) + الحقول المستخرجة المؤكدة — «key=value» */
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

const READINESS_LEVEL_AR: Record<string, string> = {
  strong: "قوي",
  adequate: "كافٍ",
  weak: "ضعيف",
  missing: "غائب",
};

/** ملاحظات التقييم: معايير الجاهزية المستنتَجة من هذه الشريحة بدليلها العربي */
function buildEvaluationNotes(readinessJson: string, slideNumber: number): string[] {
  const parsed = parseJsonField<{ criteria?: unknown }>(readinessJson, {});
  const criteria = Array.isArray(parsed?.criteria) ? parsed.criteria : [];
  const notes: string[] = [];
  for (const c of criteria) {
    if (typeof c !== "object" || c === null) continue;
    const record = c as Record<string, unknown>;
    const slides = record.slides;
    if (!Array.isArray(slides) || !slides.some((p) => p === slideNumber)) continue;
    const labelAr = typeof record.labelAr === "string" ? record.labelAr : "";
    const evidenceAr = typeof record.evidenceAr === "string" ? record.evidenceAr : "";
    const level = typeof record.level === "string" ? record.level : "";
    const parts: string[] = [];
    if (labelAr) parts.push(`معيار «${labelAr}»`);
    if (level) parts.push(`المستوى: ${READINESS_LEVEL_AR[level] ?? level}`);
    if (evidenceAr) parts.push(evidenceAr);
    const note = parts.join(" — ").trim();
    if (note.length > 0) notes.push(note);
  }
  if (notes.length === 0) notes.push("حسّن الوضوح والاختصار");
  return notes;
}

interface OwnedVersion {
  deckId: string;
  versionId: string;
  versionNumber: number;
  status: string;
  slideCount: number;
  slidesJson: string;
  extractionJson: string;
  readinessJson: string;
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
    status: version.status,
    slideCount: version.slideCount,
    slidesJson: version.slidesJson,
    extractionJson: version.extractionJson,
    readinessJson: version.readinessJson,
  };
}

// ————— المعالج —————

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; v: string; n: string }> },
): Promise<Response> {
  try {
    // القيد: assertSameOrigin أولًا ثم requireUser/requireRole
    assertSameOrigin(req);
    const user = await requireRole(req, ["FOUNDER"]);
    const profile = await requireProfile(user.id);
    const { id, v, n } = await ctx.params;

    const nNum = Number.parseInt(n, 10);
    if (!Number.isInteger(nNum) || nNum < 1) {
      throw new ApiErrorClass("SLIDE_NOT_FOUND", "رقم الشريحة غير صالح", 404);
    }

    const version = await loadOwnedVersion(profile.id, id, v);
    if (version.status !== "READY" && version.status !== "PARTIAL") {
      throw new ApiErrorClass(
        "VERSION_NOT_READY",
        "لم تكتمل معالجة هذه النسخة من العرض بعد — أعد المحاولة بعد جهوزيتها",
        409,
      );
    }

    // الشريحة ضمن [1..slideCount] وموجودة بفهرسها في slidesJson
    if (nNum > version.slideCount) {
      throw new ApiErrorClass("SLIDE_NOT_FOUND", "رقم الشريحة خارج نطاق هذا العرض", 404);
    }
    const slides = resolveSlides(version.slidesJson);
    const slide = slides.find((s) => s.index === nNum);
    if (!slide) {
      throw new ApiErrorClass("SLIDE_NOT_FOUND", "الشريحة غير موجودة في هذه النسخة", 404);
    }

    // الحقائق المؤكدة: لقطة الملف كاملة + الحقول المستخرجة المؤكدة لهذه النسخة
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

    // ملاحظات التقييم من تقرير الجاهزية (أو الملاحظة العامة)
    const evaluationNotesAr = buildEvaluationNotes(version.readinessJson, nNum);

    // التوليد — يمرّ بحارس الاقتراحات (T5) داخل generateSuggestion
    const gen = await generateSuggestion(slide, evaluationNotesAr, confirmedFacts, {
      deckVersionId: version.versionId,
      userId: user.id,
    });
    if (!gen.suggestedText.trim() || !gen.guard.passed) {
      // فشل آمن: الحارس رفض — لا اقتراح ناقصًا ولا 500
      return fail("GUARD_REJECTED", "تعذّر توليد اقتراح آمن لهذه الشريحة (الحارس رفض المحاولتين)", 422, {
        flags: gen.guard.flags,
      });
    }

    // الأصل محفوظ: originalText = نص الشريحة كما هو، وslidesJson لم يُمَسّ
    const suggestion = await prisma.slideSuggestion.create({
      data: {
        deckVersionId: version.versionId,
        slideIndex: nNum,
        originalText: slide.text,
        suggestedText: gen.suggestedText,
        reason: gen.reasonAr,
        guardReportJson: JSON.stringify(gen.guard),
        decision: "pending",
      },
    });

    return ok(
      {
        suggestionId: suggestion.id,
        slideIndex: nNum,
        originalText: suggestion.originalText,
        suggestedText: suggestion.suggestedText,
        reasonAr: suggestion.reason ?? "",
        guard: { passed: gen.guard.passed, flags: gen.guard.flags },
        provider: gen.provider,
        createdAt: suggestion.createdAt.toISOString(),
      },
      201,
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
