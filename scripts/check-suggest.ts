/**
 * Masar — T13 تحقق ذاتي (إلزامي): اقتراح الشريحة عند الطلب + قرار المؤسس
 * تشغيل: bun scripts/check-suggest.ts  (من جذر المشروع)
 * يطبع «SUGGEST CHECK PASSED» عند نجاح كل الفحوص، ويخرج برمز 1 عند أي فشل.
 *
 * المنهج (نموذج check-ops.ts لدى T14): إعداد البيانات عبر prisma مباشرة
 * (مستخدمان + جلسات + ملفان + عرض بنسخة READY من شريحتين + نسخة PROCESSING)
 * ثم استدعاء معالجي POST/PATCH فعليًّا عبر NextRequest مُصنَّع يحمل كوكي جلسة
 * حقيقية من القاعدة — فيغطي الفحص المصادقة والملكية والحراس والقرار والتدقيق
 * دون تشغيل الخادم. MASAR_AI_FORCE_FALLBACK=1 يجعل التوليد حتميًّا بمسار
 * الطوارئ (mock-replay) — لا شبكة في الفحص.
 * البيانات كلها خاصة بالفحص (بريد *.test) وتُنظَّف في finally.
 */
process.env.MASAR_AI_FORCE_FALLBACK = "1"; // قبل أي استدعاء — فحص حتمي بلا شبكة

import { NextRequest } from "next/server";
import { prisma } from "../src/lib/server/api";
import { POST as postSuggest } from "../src/app/api/v1/decks/[id]/versions/[v]/slides/[n]/suggest/route";
import { PATCH as patchSuggestion } from "../src/app/api/v1/decks/[id]/versions/[v]/slides/[n]/suggestion/route";

// ————— أدوات الفحص —————

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

async function env<T>(res: Response): Promise<Envelope<T>> {
  try {
    return (await res.json()) as Envelope<T>;
  } catch {
    return { ok: false, error: { code: "NO_JSON", message: "الاستجابة بلا جسم JSON" } };
  }
}

const BASE = "http://localhost:3000";
const TOKEN = "t13-suggest-check-session-token-1";
const TOKEN2 = "t13-suggest-check-session-token-2";

interface ReqInit {
  method?: string;
  body?: string;
  origin?: string;
}

/** بناء NextRequest يحمل كوكي الجلسة (والأصل إن أُريد اختبار CSRF) — Host كما يرسله المتصفح */
function reqAs(token: string, path: string, init?: ReqInit): NextRequest {
  const headers: Record<string, string> = {
    cookie: `masar_session=${token}`,
    host: "localhost:3000",
  };
  if (init?.body !== undefined) headers["content-type"] = "application/json";
  if (init?.origin) headers["origin"] = init.origin;
  return new NextRequest(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body,
  });
}

function req(path: string, init?: ReqInit): NextRequest {
  return reqAs(TOKEN, path, init);
}

/** سياق المسارات الدينامية — params وعد في Next 16 */
function params(p: { id: string; v: string; n: string }): { params: Promise<{ id: string; v: string; n: string }> } {
  return { params: Promise.resolve(p) };
}

// ————— أشكال البيانات المتوقعة —————

interface SuggestionData {
  suggestionId: string;
  slideIndex: number;
  originalText: string;
  suggestedText: string;
  reasonAr: string;
  guard: { passed: boolean; flags: Array<{ rule: string; detailAr: string; matched?: string }> };
  provider: string;
  createdAt: string;
}

interface DecisionData {
  suggestionId: string;
  decision: string;
  editedText: string | null;
  decidedAt: string | null;
}

// ————— التنفيذ —————

const SLIDE1_TEXT =
  "تفقد المزارع في الضفة الغربية نحو 30% من المحصول بسبب الري التقليدي. يستخدم نظامنا مستشعرات أرضية وتحليل بيانات لتوفير 40% من مياه الري.";
const SLIDES_JSON = JSON.stringify([
  { index: 1, title: "المشكلة", text: SLIDE1_TEXT },
  { index: 2, title: "الجرّب", text: "خفضنا استهلاك المياه لدى 120 مزارعًا مشاركًا في التجربة بنسبة 40% خلال 6 أشهر من التشغيل." },
]);
const VALID_EDIT = "يستخدم نظامنا مستشعرات أرضية وتحليل بيانات لتوفير 40% من مياه الري.";
const BAD_EDIT_WITH_NEW_NUMBER = "نطلب تمويلًا بقيمة 5000000 دولار لتوسيع النظام."; // رقم غير موجود في الشريحة/الملف

async function main(): Promise<void> {
  const suffix = `${Date.now()}`;

  // إعداد: مستخدمان (مؤسسان) + جلسات + ملفان (الأول بحقول ومؤسِّس) + عرض بنسختين
  const user = await prisma.user.create({
    data: {
      email: `t13-suggest-a-${suffix}@masar.test`,
      name: "فاحص الاقتراح أ",
      passwordHash: "not-a-real-hash",
      role: "FOUNDER",
    },
  });
  const user2 = await prisma.user.create({
    data: {
      email: `t13-suggest-b-${suffix}@masar.test`,
      name: "فاحص الاقتراح ب",
      passwordHash: "not-a-real-hash",
      role: "FOUNDER",
    },
  });
  await prisma.session.createMany({
    data: [
      { token: TOKEN, csrfToken: "t13-csrf-1", userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
      { token: TOKEN2, csrfToken: "t13-csrf-2", userId: user2.id, expiresAt: new Date(Date.now() + 3_600_000) },
    ],
  });
  const profile = await prisma.startupProfile.create({
    data: {
      userId: user.id,
      fieldsJson: JSON.stringify([
        { field: "company.name", value: "شركة الري الذكي", source: "manual", confirmedAt: "2025-03-01T00:00:00.000Z" },
        { field: "company.stage", value: "early_revenue", source: "manual", confirmedAt: "2025-03-01T00:00:00.000Z" },
      ]),
    },
  });
  const profile2 = await prisma.startupProfile.create({ data: { userId: user2.id, fieldsJson: "[]" } });
  await prisma.founder.create({
    data: { profileId: profile.id, name: "مؤسِّسة الفحص", region: "west_bank", isPrimary: true },
  });
  const deck = await prisma.deck.create({
    data: {
      profileId: profile.id,
      versions: {
        create: [
          {
            versionNumber: 1,
            fileHash: `t13-hash-1-${suffix}`,
            fileName: "t13-deck.pdf",
            fileSize: 2048,
            fileType: "pdf",
            status: "READY",
            slideCount: 2,
            pageCount: 2,
            slidesJson: SLIDES_JSON,
            extractionJson: "[]",
            readinessJson: "{}",
          },
          {
            versionNumber: 2,
            fileHash: `t13-hash-2-${suffix}`,
            fileName: "t13-deck.pdf",
            fileSize: 2048,
            fileType: "pdf",
            status: "PROCESSING",
            slideCount: 2,
            pageCount: 2,
            slidesJson: SLIDES_JSON,
          },
        ],
      },
    },
    include: { versions: true },
  });
  const v1 = deck.versions.find((ver) => ver.versionNumber === 1)!;
  const v2 = deck.versions.find((ver) => ver.versionNumber === 2)!;
  const slidesJsonBefore = v1.slidesJson;

  try {
    // ————— [1] POST suggest على شريحة موجودة → اقتراح pending —————
    console.log("\n[1] POST /slides/1/suggest — شريحة موجودة");
    const p1Res = await postSuggest(
      req(`/api/v1/decks/${deck.id}/versions/1/slides/1/suggest`, { method: "POST" }),
      params({ id: deck.id, v: "1", n: "1" }),
    );
    const p1Env = await env<SuggestionData>(p1Res);
    check(
      "POST → 201 ok باقتراح",
      p1Res.status === 201 && p1Env.ok === true && typeof p1Env.data?.suggestionId === "string",
      `status=${p1Res.status}`,
    );
    check("slideIndex = 1", p1Env.data?.slideIndex === 1);
    check(
      "originalText مطابق حرفيًّا لنص الشريحة (خام raw)",
      p1Env.data?.originalText === SLIDE1_TEXT,
      `got=${p1Env.data?.originalText?.slice(0, 40)}`,
    );
    check("suggestedText غير فارغ", (p1Env.data?.suggestedText ?? "").trim().length > 0);
    check("guard.passed = true", p1Env.data?.guard?.passed === true);
    check("provider = mock-replay (مسار الطوارئ الحتمي)", p1Env.data?.provider === "mock-replay", `got=${p1Env.data?.provider}`);
    check("reasonAr موجود", (p1Env.data?.reasonAr ?? "").length > 0);
    check("createdAt ISO صالح", !Number.isNaN(Date.parse(p1Env.data?.createdAt ?? "")));
    const row1 = await prisma.slideSuggestion.findUnique({ where: { id: p1Env.data?.suggestionId ?? "" } });
    check(
      "الصف في القاعدة: pending والأصل والتقرير كاملًا",
      row1 !== null &&
        row1.decision === "pending" &&
        row1.originalText === SLIDE1_TEXT &&
        row1.deckVersionId === v1.id &&
        row1.slideIndex === 1 &&
        (JSON.parse(row1.guardReportJson) as { passed: boolean; flags: unknown[] }).passed === true,
    );
    const suggestion1Id = p1Env.data?.suggestionId ?? "";

    // ————— [2] POST على شريحة خارج النطاق → 404 —————
    console.log("\n[2] POST خارج النطاق → 404 SLIDE_NOT_FOUND");
    const p2Res = await postSuggest(
      req(`/api/v1/decks/${deck.id}/versions/1/slides/3/suggest`, { method: "POST" }),
      params({ id: deck.id, v: "1", n: "3" }),
    );
    const p2Env = await env<unknown>(p2Res);
    check(
      "n=3 > slideCount=2 → 404 SLIDE_NOT_FOUND",
      p2Res.status === 404 && p2Env.error?.code === "SLIDE_NOT_FOUND",
      `status=${p2Res.status} code=${p2Env.error?.code}`,
    );
    const p3Res = await postSuggest(
      req(`/api/v1/decks/${deck.id}/versions/1/slides/0/suggest`, { method: "POST" }),
      params({ id: deck.id, v: "1", n: "0" }),
    );
    check("n=0 → 404 SLIDE_NOT_FOUND", p3Res.status === 404, `status=${p3Res.status}`);

    // ————— [3] PATCH accepted → decidedAt مضبوط —————
    console.log("\n[3] PATCH accepted");
    const tBefore = Date.now();
    const a1Res = await patchSuggestion(
      req(`/api/v1/decks/${deck.id}/versions/1/slides/1/suggestion`, {
        method: "PATCH",
        body: JSON.stringify({ decision: "accepted" }),
      }),
      params({ id: deck.id, v: "1", n: "1" }),
    );
    const a1Env = await env<DecisionData>(a1Res);
    check(
      "PATCH accepted → 200 ok",
      a1Res.status === 200 && a1Env.ok === true && a1Env.data?.decision === "accepted",
      `status=${a1Res.status}`,
    );
    check(
      "decidedAt مضبوط الآن",
      a1Env.data?.decidedAt !== null && new Date(a1Env.data?.decidedAt ?? "").getTime() >= tBefore,
    );
    check("editedText = null لقرار القبول", a1Env.data?.editedText === null);
    check("suggestionId هو الأحدث", a1Env.data?.suggestionId === suggestion1Id);
    const row1After = await prisma.slideSuggestion.findUnique({ where: { id: suggestion1Id } });
    check(
      "القاعدة: accepted وdecidedAt محفوظ والأصل والاقتراح لم يُمسّا",
      row1After !== null &&
        row1After.decision === "accepted" &&
        row1After.decidedAt !== null &&
        row1After.originalText === SLIDE1_TEXT &&
        row1After.suggestedText === row1?.suggestedText &&
        row1After.editedText === null,
    );

    // ————— [4] PATCH edited بدون نص → 422 —————
    console.log("\n[4] PATCH edited بلا نص → 422");
    const e1Res = await patchSuggestion(
      req(`/api/v1/decks/${deck.id}/versions/1/slides/1/suggestion`, {
        method: "PATCH",
        body: JSON.stringify({ decision: "edited" }),
      }),
      params({ id: deck.id, v: "1", n: "1" }),
    );
    const e1Env = await env<unknown>(e1Res);
    check(
      "edited بلا editedText → 422",
      e1Res.status === 422 && (e1Env.error?.code === "EDITED_TEXT_REQUIRED" || e1Env.error?.code === "VALIDATION"),
      `status=${e1Res.status} code=${e1Env.error?.code}`,
    );
    const row1AfterE1 = await prisma.slideSuggestion.findUnique({ where: { id: suggestion1Id } });
    check("لا كتابة جزئية: القرار ما زال accepted", row1AfterE1?.decision === "accepted" && row1AfterE1?.editedText === null);

    // ————— [5] PATCH edited برقم جديد (5000000) → 422 GUARD_REJECTED —————
    console.log("\n[5] PATCH edited برقم غير موجود → 422 GUARD_REJECTED");
    const e2Res = await patchSuggestion(
      req(`/api/v1/decks/${deck.id}/versions/1/slides/1/suggestion`, {
        method: "PATCH",
        body: JSON.stringify({ decision: "edited", editedText: BAD_EDIT_WITH_NEW_NUMBER }),
      }),
      params({ id: deck.id, v: "1", n: "1" }),
    );
    const e2Env = await env<unknown>(e2Res);
    check(
      "النص المعدَّل برقم جديد → 422 GUARD_REJECTED",
      e2Res.status === 422 && e2Env.error?.code === "GUARD_REJECTED",
      `status=${e2Res.status} code=${e2Env.error?.code}`,
    );
    const e2Flags = ((e2Env.error?.details as { flags?: Array<{ rule: string }> } | undefined)?.flags ?? []);
    check("الأعلام مرفقة وفيها NEW_FACT", e2Flags.some((f) => f.rule === "NEW_FACT"), JSON.stringify(e2Flags));
    const row1AfterE2 = await prisma.slideSuggestion.findUnique({ where: { id: suggestion1Id } });
    check(
      "لا كتابة جزئية: ما زال accepted بلا نص معدَّل",
      row1AfterE2?.decision === "accepted" && row1AfterE2?.editedText === null,
    );

    // ————— [6] المستخدم الآخر (IDOR) → 404 —————
    console.log("\n[6] IDOR — المستخدم الآخر → 404");
    const idorPostRes = await postSuggest(
      reqAs(TOKEN2, `/api/v1/decks/${deck.id}/versions/1/slides/1/suggest`, { method: "POST" }),
      params({ id: deck.id, v: "1", n: "1" }),
    );
    check("POST للغير → 404 (لا يُكشف وجود العرض)", idorPostRes.status === 404, `status=${idorPostRes.status}`);
    const idorPatchRes = await patchSuggestion(
      reqAs(TOKEN2, `/api/v1/decks/${deck.id}/versions/1/slides/1/suggestion`, {
        method: "PATCH",
        body: JSON.stringify({ decision: "rejected" }),
      }),
      params({ id: deck.id, v: "1", n: "1" }),
    );
    check("PATCH للغير → 404", idorPatchRes.status === 404, `status=${idorPatchRes.status}`);

    // ————— [7] إضافات: CSRF / 401 / نسخة غير جاهزة / الأحدث فقط / الأصل لا يُعدَّل / التدقيق —————
    console.log("\n[7] إضافات");
    const csrfRes = await postSuggest(
      req(`/api/v1/decks/${deck.id}/versions/1/slides/1/suggest`, {
        method: "POST",
        origin: "http://evil.example",
      }),
      params({ id: deck.id, v: "1", n: "1" }),
    );
    const csrfEnv = await env<unknown>(csrfRes);
    check("POST من أصل مختلف → 403 CSRF", csrfRes.status === 403 && csrfEnv.error?.code === "CSRF", `status=${csrfRes.status}`);
    const csrfPatchRes = await patchSuggestion(
      req(`/api/v1/decks/${deck.id}/versions/1/slides/1/suggestion`, {
        method: "PATCH",
        origin: "http://evil.example",
        body: JSON.stringify({ decision: "rejected" }),
      }),
      params({ id: deck.id, v: "1", n: "1" }),
    );
    check("PATCH من أصل مختلف → 403 CSRF", csrfPatchRes.status === 403, `status=${csrfPatchRes.status}`);
    const noAuthRes = await postSuggest(
      reqAs("no-session-token", `/api/v1/decks/${deck.id}/versions/1/slides/1/suggest`, { method: "POST" }),
      params({ id: deck.id, v: "1", n: "1" }),
    );
    check("POST بلا جلسة صالحة → 401", noAuthRes.status === 401, `status=${noAuthRes.status}`);
    const processingRes = await postSuggest(
      req(`/api/v1/decks/${deck.id}/versions/2/slides/1/suggest`, { method: "POST" }),
      params({ id: deck.id, v: "2", n: "1" }),
    );
    const processingEnv = await env<unknown>(processingRes);
    check(
      "نسخة PROCESSING → 409 VERSION_NOT_READY",
      processingRes.status === 409 && processingEnv.error?.code === "VERSION_NOT_READY",
      `status=${processingRes.status} code=${processingEnv.error?.code}`,
    );

    // اقتراح ثانٍ للشريحة نفسها: السجل يتراكم والقرار يخص الأحدث فقط
    const p4Res = await postSuggest(
      req(`/api/v1/decks/${deck.id}/versions/1/slides/1/suggest`, { method: "POST" }),
      params({ id: deck.id, v: "1", n: "1" }),
    );
    const p4Env = await env<SuggestionData>(p4Res);
    check("POST ثانٍ للشريحة نفسها → 201", p4Res.status === 201 && p4Env.ok === true, `status=${p4Res.status}`);
    const suggestion2Id = p4Env.data?.suggestionId ?? "";
    const allRows = await prisma.slideSuggestion.findMany({
      where: { deckVersionId: v1.id, slideIndex: 1 },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    check("صفّان بالسجل (التراكم بلا حذف)", allRows.length === 2, `len=${allRows.length}`);
    check("الأحدث أولًا في الاستعلام", allRows[0]?.id === suggestion2Id && allRows[1]?.id === suggestion1Id);
    check("الأقدم بقراره والأحدث pending", allRows[1]?.decision === "accepted" && allRows[0]?.decision === "pending");

    // edited صالح (أرقام من الشريحة نفسها) → 200 ويخص الأحدث فقط
    const e3Res = await patchSuggestion(
      req(`/api/v1/decks/${deck.id}/versions/1/slides/1/suggestion`, {
        method: "PATCH",
        body: JSON.stringify({ decision: "edited", editedText: VALID_EDIT }),
      }),
      params({ id: deck.id, v: "1", n: "1" }),
    );
    const e3Env = await env<DecisionData>(e3Res);
    check(
      "PATCH edited بنص مسنود → 200 مع النص المعدَّل",
      e3Res.status === 200 && e3Env.data?.decision === "edited" && e3Env.data?.editedText === VALID_EDIT,
      `status=${e3Res.status}`,
    );
    check("القرار على الأحدث", e3Env.data?.suggestionId === suggestion2Id);
    const row1Final = await prisma.slideSuggestion.findUnique({ where: { id: suggestion1Id } });
    check(
      "الأقدم لم يُمسّ (ما زال accepted بقراره الأول)",
      row1Final?.decision === "accepted" && row1Final?.editedText === null && row1Final?.decidedAt !== null,
    );

    // الأصل لا يُعدَّل أبدًا: slidesJson كما هو بعد كل العمليات
    const v1After = await prisma.deckVersion.findUnique({ where: { id: v1.id } });
    check("slidesJson لم يُكتب فيه شيء (الأصل محفوظ)", v1After?.slidesJson === slidesJsonBefore);

    // التدقيق: القرار فقط — لا نص ولا قيم
    const decidedAudits = await prisma.auditLog.findMany({
      where: { action: "SLIDE_SUGGESTION_DECIDED", userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    check("audit SLIDE_SUGGESTION_DECIDED مسجَّل لكل قرار (2)", decidedAudits.length === 2, `len=${decidedAudits.length}`);
    const auditDetails = decidedAudits.map((a) => JSON.parse(a.detailsJson) as Record<string, unknown>);
    check(
      "التدقيق يحمل القرار فقط (بلا نص)",
      auditDetails.length === 2 &&
        auditDetails[0]?.decision === "accepted" &&
        auditDetails[1]?.decision === "edited" &&
        auditDetails.every((d) => Object.keys(d).length === 1),
    );
    check("كيانات التدقيق تشير إلى الاقتراح", decidedAudits.every((a) => a.entityType === "SlideSuggestion"));
  } finally {
    // ————— التنظيف —————
    await prisma.aiRun.deleteMany({ where: { userId: { in: [user.id, user2.id] } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [user.id, user2.id] } } });
    await prisma.session.deleteMany({ where: { userId: { in: [user.id, user2.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, user2.id] } } }); // يتتالى: الملف ← العرض ← النسخ ← الاقتراحات
    const leftover = await prisma.slideSuggestion.count({
      where: { deckVersionId: { in: [v1.id, v2.id] } },
    });
    const leftoverProfiles = await prisma.startupProfile.count({
      where: { id: { in: [profile.id, profile2.id] } },
    });
    check("التنظيف كامل (0 اقتراحات و0 ملفات متبقية)", leftover === 0 && leftoverProfiles === 0, `leftover=${leftover}/${leftoverProfiles}`);
    console.log("\n(نُظِّفت بيانات الفحص)");
  }

  console.log(`\nالنتيجة: ${passed} ناجح / ${failed} فاشل`);
  if (failed > 0) {
    console.error("SUGGEST CHECK FAILED");
    process.exit(1);
  }
  console.log("SUGGEST CHECK PASSED");
}

main()
  .catch((e: unknown) => {
    console.error("فشل تشغيل الفحص:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
