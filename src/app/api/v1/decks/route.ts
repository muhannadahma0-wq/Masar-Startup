/**
 * Masar — T12: رفع العروض POST/GET /api/v1/decks
 * =====================================================
 * POST (multipart): assertSameOrigin → requireRole(FOUNDER) → requireProfile
 *  → قراءة حقل «file» من formData والتحقق من الحجم بالبايتات قبل القراءة الكاملة
 *  → validateUpload (بصمة ثنائية — T7) → Deck جديد أو أحدث عرض للملف برقم نسخة أعلى
 *  → معالجة متزامنة كاملة (شرائح → حقن → استخراج → ادعاءات → جاهزية → فجوات)
 *  → تخزين الملف الأصلي storage/decks/{id}.{pdf|pptx} → audit DECK_UPLOADED.
 *  أي فشل استخراج → حالة FAILED_EXTRACTION برسالة عربية (لا 500 أبدًا).
 *
 * GET: قائمة نسخ أحدث عرض للملف (ملكية profileId — IDOR).
 */
import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import {
  ok,
  fail,
  handleRouteError,
  requireRole,
  requireProfile,
  assertSameOrigin,
  audit,
  prisma,
} from "@/lib/server/api";
import { validateUpload } from "@/lib/files/validate";
import { extractPdfSlides } from "@/lib/files/pdf";
import { extractPptxSlides } from "@/lib/files/pptx";
import type { Slide } from "@/lib/core/types";
import {
  analyzeSlides,
  failedAnalysis,
  latestDeckForProfile,
  persistAnalysis,
  profileHintsFrom,
  saveDeckFile,
  PROCESS_BUDGET_MS,
} from "./_pipeline";

export const runtime = "nodejs";

/** حد الرفع بالبايتات (يفحص من file.size قبل قراءة المحتوى — §10). */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

interface UploadResult {
  deckId: string;
  versionNumber: number;
  status: string;
  slideCount: number;
  fileType: string;
  statusMessage?: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    // قيد العقد: الأصل أولًا ثم الجلسة/الدور/الملف
    assertSameOrigin(req);
    const user = await requireRole(req, ["FOUNDER"]);
    const profile = await requireProfile(user.id);

    // ————— (1) multipart: حقل «file» —————
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail("BAD_MULTIPART", "الطلب ليس بصيغة multipart/form-data صالحة", 422);
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return fail("NO_FILE", "أرفق ملف العرض (PDF أو PPTX) في حقل «file»", 422);
    }
    // الحجم بالبايتات قبل قراءة كل شيء
    if (file.size > MAX_UPLOAD_BYTES) {
      return fail("TOO_LARGE", "حجم الملف يتجاوز 20 ميجابايت", 422);
    }
    if (file.size === 0) {
      return fail("EMPTY_FILE", "الملف المرفق فارغ", 422);
    }

    // ————— (2) البصمة الثنائية (T7) — الامتداد لا يشارك في القرار —————
    const buf = Buffer.from(await file.arrayBuffer());
    const verdict = validateUpload(buf, file.name || "deck");
    if (!verdict.ok || !verdict.fileType) {
      return fail(verdict.code ?? "BAD_TYPE", verdict.messageAr, 422);
    }
    const fileType = verdict.fileType;
    const fileHash = createHash("sha256").update(buf).digest("hex");
    const fileName = (file.name || `deck.${fileType}`).slice(0, 200);

    // ————— (3) Deck جديد أو أحدث عرض للملف برقم أعلى —————
    const existing = await latestDeckForProfile(profile.id);
    const deck = existing
      ? await prisma.deck.update({
          where: { id: existing.id },
          data: { currentVersion: existing.currentVersion + 1 },
        })
      : await prisma.deck.create({ data: { profileId: profile.id, currentVersion: 1 } });
    const versionNumber = deck.currentVersion;

    const version = await prisma.deckVersion.create({
      data: {
        deckId: deck.id,
        versionNumber,
        fileHash,
        fileName,
        fileSize: buf.length,
        fileType,
        status: "PROCESSING",
      },
    });

    // ————— (4) استخراج الشرائح (حد 60 صفحة/شريحة داخل T7 — يرمي خطأ عربيًّا) —————
    let slides: Slide[] = [];
    let slideError: string | null = null;
    try {
      slides = fileType === "pdf" ? await extractPdfSlides(buf) : await extractPptxSlides(buf);
    } catch (e) {
      slideError =
        e instanceof Error && e.message.length > 0 ? e.message : "تعذّر استخراج الشرائح من الملف";
    }

    // ————— (5) التحليل المتزامن الكامل (بلا طوابير في هذه البيئة) —————
    const analysis = slideError
      ? failedAnalysis(fileType, slideError)
      : await analyzeSlides(slides, {
          profileId: profile.id,
          userId: user.id,
          deckVersionId: version.id,
          hints: profileHintsFrom(profile),
          fileType,
          deadlineAt: Date.now() + PROCESS_BUDGET_MS,
        });

    // ————— (6) حفظ الملف الأصلي (فشله عيب يُعلَّم لا يهدم التحليل) —————
    let fileNote: string | null = null;
    try {
      await saveDeckFile(version.id, fileType, buf);
    } catch (e) {
      console.error(`[decks] تعذّر حفظ الملف الأصلي: ${(e as Error)?.message ?? e}`);
      fileNote = "تعذّر حفظ الملف الأصلي في التخزين";
    }
    const finalStatus =
      fileNote && analysis.status === "READY" ? "PARTIAL" : analysis.status;
    const statusMessage = [analysis.statusMessage, fileNote].filter(Boolean).join("؛ ") || null;

    // ————— (7) التخزين والتدقيق —————
    await persistAnalysis(version.id, { ...analysis, status: finalStatus, statusMessage });
    await audit(user.id, "DECK_UPLOADED", "DeckVersion", version.id, {
      deckId: deck.id,
      versionNumber,
      fileType,
      status: finalStatus,
      slideCount: analysis.slides.length,
      fileSize: buf.length,
    });

    const result: UploadResult = {
      deckId: deck.id,
      versionNumber,
      status: finalStatus,
      slideCount: analysis.slides.length,
      fileType,
      ...(statusMessage ? { statusMessage } : {}),
    };
    return ok(result, 201);
  } catch (e) {
    return handleRouteError(e);
  }
}

interface VersionListItem {
  versionNumber: number;
  status: string;
  fileType: string;
  fileName: string;
  slideCount: number;
  createdAt: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const user = await requireRole(req, ["FOUNDER"]);
    const profile = await requireProfile(user.id);

    const deck = await latestDeckForProfile(profile.id);
    if (!deck) {
      return ok({ deckId: null, currentVersion: 0, versions: [] as VersionListItem[] });
    }
    const versions = await prisma.deckVersion.findMany({
      where: { deckId: deck.id },
      orderBy: { versionNumber: "desc" },
      select: {
        versionNumber: true,
        status: true,
        fileType: true,
        fileName: true,
        slideCount: true,
        createdAt: true,
      },
    });
    return ok({
      deckId: deck.id,
      currentVersion: deck.currentVersion,
      versions: versions.map(
        (v): VersionListItem => ({
          versionNumber: v.versionNumber,
          status: v.status,
          fileType: v.fileType,
          fileName: v.fileName,
          slideCount: v.slideCount,
          createdAt: v.createdAt.toISOString(),
        }),
      ),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
