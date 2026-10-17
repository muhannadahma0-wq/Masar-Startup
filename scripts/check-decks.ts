/**
 * Masar — T12 تحقق ذاتي (إلزامي): مسار العروض كاملًا
 * تشغيل: bun scripts/check-decks.ts  (من جذر المشروع)
 * يطبع «DECKS CHECK PASSED» عند نجاح كل الفحوص، ويخرج برمز 1 عند أي فشل.
 *
 * المنهج (كما في check-ops): إعداد البيانات عبر prisma مباشرة — مستخدمون
 * وجلسات وملف وDeck+DeckVersion بنصوص شرائح عربية جاهزة (محاكاة ما يخزنه
 * مسار الرفع — بلا HTTP) — ثم استدعاء معالجات المسارات فعليًا عبر NextRequest
 * يحمل كوكي جلسة حقيقية. يغطي الفحص:
 *   (1) دمج حقول مؤكدة بمصدر deck وpage/quote وconfirmedAt مع استبدال القديم،
 *   (2) citation فاشل يرفض (422) ولا يُكتب شيء،
 *   (3) مقارنة نسختين تلتقط فرق قيمة/مستوى/ادعاء،
 *   (4) DELETE ينظف القاعدة والتخزين وAiRun→SetNull،
 *   إضافة إلى الرفع الفعلي (PPTX مولّد) وإعادة المعالجة والقوائم والملكية.
 * MASAR_AI_FORCE_FALLBACK=1 → مسار الطوارئ الحتمي (بلا شبكة).
 * البيانات كلها خاصة بالفحص (بريد *.test) وتُنظَّف في finally.
 */
process.env.MASAR_AI_FORCE_FALLBACK = "1";

import { NextRequest } from "next/server";
import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { prisma } from "../src/lib/server/api";
import { POST as uploadDeck, GET as listDecks } from "../src/app/api/v1/decks/route";
import { DELETE as deleteDeck } from "../src/app/api/v1/decks/[id]/route";
import { GET as getVersion } from "../src/app/api/v1/decks/[id]/versions/[v]/route";
import { POST as confirmProfile } from "../src/app/api/v1/decks/[id]/versions/[v]/confirm-profile/route";
import { POST as retryVersion } from "../src/app/api/v1/decks/[id]/versions/[v]/retry/route";
import { GET as compareVersions } from "../src/app/api/v1/decks/[id]/compare/route";
import { deckStoragePath } from "../src/app/api/v1/decks/_pipeline";
import { evaluateReadiness } from "../src/lib/pitch/criteria";
import type { ExtractedField, Slide } from "../src/lib/core/types";

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
const TOKEN = "t12-decks-check-session-token-1";
const TOKEN2 = "t12-decks-check-session-token-2";
const TOKEN_REVIEWER = "t12-decks-check-session-token-r";

interface ReqInit {
  method?: string;
  body?: string;
  origin?: string;
}

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

function req(pathUrl: string, init?: ReqInit): NextRequest {
  return reqAs(TOKEN, pathUrl, init);
}

/** سياق المسارات الدينامية — params وعد في Next 16 */
function params<T extends Record<string, string>>(p: T): { params: Promise<T> } {
  return { params: Promise.resolve(p) };
}

/** طلب رفع multipart بحقيقي (File) */
function uploadReq(token: string, buf: Buffer, name: string): NextRequest {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array(buf)], name));
  return new NextRequest(`${BASE}/api/v1/decks`, {
    method: "POST",
    headers: { cookie: `masar_session=${token}`, host: "localhost:3000" },
    body: fd,
  });
}

// ————— بيانات الشرائح الجاهزة (عربية) —————

const SLIDES_V1: Slide[] = [
  {
    index: 1,
    title: "الزراعة الذكية — نظرة عامة",
    text: "شركة نبتة تقدم منصة ري ذكية للمزارع. نسعى لجمع تمويل بقيمة $500,000 لتوسيع عملياتنا.",
  },
  {
    index: 2,
    title: "الجرّب والتحقق",
    text: "يخدم المنصة ٥٠٠٠ مستخدم نشط. حققنا نموًّا بنسبة 40% في الاشتراكات الشهرية. الإيراد الشهري بلغ $12,000.",
  },
  {
    index: 3,
    title: "الفريق",
    text: "فريقنا يتكون من 8 مؤسسين ومهندسين. شركة مسجلة محليًا في فلسطين.",
  },
];

const SLIDES_V2: Slide[] = [
  {
    index: 1,
    title: "الزراعة الذكية — نظرة عامة",
    text: "شركة نبتة تقدم منصة ري ذكية للمزارع.\nنسعى لجمع تمويل بقيمة $750,000 لتوسيع عملياتنا.",
  },
  {
    index: 2,
    title: "الجرّب والتحقق",
    text: "يخدم المنصة ٦٠٠٠ مستخدم نشط.\nالإيراد الشهري بلغ $18,000 هذا الشهر.",
  },
  {
    index: 3,
    title: "الفريق",
    text: "فريقنا يتكون من 12 مهندسًا.\nشركة مسجلة محليًا.",
  },
];

const EXTRACTION_V1: ExtractedField[] = [
  {
    key: "company.teamSize",
    value: 6,
    page: 3,
    quote: "فريقنا يتكون من 8 مؤسسين ومهندسين",
    confidence: 0.7,
    status: "pending",
  },
  {
    key: "company.stage",
    value: "early_revenue",
    page: 2,
    quote: "الإيراد الشهري بلغ $12,000",
    confidence: 0.65,
    status: "pending",
  },
];

const CLAIMS_V1 = [
  { id: "revenue-2-0", type: "revenue", value: 5000, page: 2, quote: "الإيراد الشهري بلغ $12,000", status: "kept" },
  { id: "revenue-2-1", type: "revenue", value: 20000, page: 2, quote: "الإيراد بلغ $20,000 في الشهر الماضي", status: "kept" },
  { id: "funding_ask-1-2", type: "funding_ask", value: 500000, page: 1, quote: "نسعى لجمع تمويل بقيمة $500,000", status: "kept" },
] as const;

// ————— توليد PPTX حقيقي لفحص الرفع (نمط check-files) —————

function makeSlideXml(title: string, paragraphs: string[]): string {
  const titleRun = `<a:p><a:r><a:rPr lang="ar-SA"/><a:t>${title}</a:t></a:r></a:p>`;
  const body = paragraphs
    .map((p) => `<a:p><a:r><a:rPr lang="ar-SA"/><a:t>${p}</a:t></a:r></a:p>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/>${titleRun}</p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Content 1"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

const EMPTY_SLIDE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;

async function buildTestPptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide4.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`,
  );
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  zip.file("ppt/slides/slide1.xml", makeSlideXml("الزراعة الذكية — نظرة عامة", ["شركة نبتة تقدم منصة ري ذكية للمزارع.", "نسعى لجمع تمويل بقيمة $900,000 لتوسيع عملياتنا."]));
  zip.file("ppt/slides/slide2.xml", makeSlideXml("الجرّب", ["يخدم المنصة ٧٠٠٠ مستخدم نشط.", "الإيراد الشهري بلغ $15,000."]));
  zip.file("ppt/slides/slide3.xml", makeSlideXml("الفريق", ["فريقنا يتكون من 10 مهندسين."]));
  zip.file("ppt/slides/slide4.xml", EMPTY_SLIDE_XML); // شريحة فارغة → PARTIAL
  return zip.generateAsync({ type: "nodebuffer" });
}

// ————— أشكال البيانات المتوقعة —————

interface VersionListItem {
  versionNumber: number;
  status: string;
  fileType: string;
  fileName: string;
  slideCount: number;
  createdAt: string;
}

interface DecksListData {
  deckId: string | null;
  currentVersion: number;
  versions: VersionListItem[];
}

interface VersionDetail {
  deckId: string;
  versionNumber: number;
  status: string;
  statusMessage: string | null;
  fileType: string;
  fileName: string;
  slideCount: number;
  slides: Slide[];
  extraction: ExtractedField[];
  claims: { items: Array<{ type: string; value: number; page: number }>; contradictions: Array<{ ar: string; pages: number[] }> };
  readiness: { criteria: Array<{ key: string; level: string; labelAr: string }> } | null;
  gapReport: { missingProfileFields: string[]; missingCriteria: string[]; perOpportunity: unknown[]; notesAr: string[] } | null;
  suggestions: Array<{ slideIndex: number; suggestedText: string; decision: string }>;
}

interface StoredField {
  field: string;
  value: unknown;
  source: "manual" | "deck";
  deckId?: string;
  deckVersion?: number;
  page?: number;
  quote?: string;
  confirmedAt?: string;
}

interface ConfirmData {
  updated: number;
  profile: { fields: StoredField[]; founders: unknown[]; documents: unknown[] };
}

interface RetryData {
  deckId: string;
  versionNumber: number;
  status: string;
  slideCount: number;
  statusMessage?: string;
}

interface UploadData {
  deckId: string;
  versionNumber: number;
  status: string;
  slideCount: number;
  fileType: string;
  statusMessage?: string;
}

interface CompareChange {
  kind: "extraction" | "readiness" | "claim";
  change: string;
  key?: string;
  criterion?: string;
  claimType?: string;
  from?: { value?: unknown; level?: string };
  to?: { value?: unknown; level?: string };
}

interface CompareData {
  deckId: string;
  from: { versionNumber: number; fields: { confirmed: number; pending: number; dropped: number } };
  to: { versionNumber: number; fields: { confirmed: number; pending: number; dropped: number } };
  changes: CompareChange[];
}

// ————— التنفيذ —————

async function main(): Promise<void> {
  const suffix = `${Date.now()}`;

  // إعداد: مؤسس أ (صاحب العرض) + مؤسس ب (IDOR) + مراجع (دور) + جلسات + ملف أ
  const user = await prisma.user.create({
    data: {
      email: `t12-decks-a-${suffix}@masar.test`,
      name: "فاحص العروض أ",
      passwordHash: "not-a-real-hash",
      role: "FOUNDER",
    },
  });
  const user2 = await prisma.user.create({
    data: {
      email: `t12-decks-b-${suffix}@masar.test`,
      name: "فاحص العروض ب",
      passwordHash: "not-a-real-hash",
      role: "FOUNDER",
    },
  });
  const reviewer = await prisma.user.create({
    data: {
      email: `t12-decks-r-${suffix}@masar.test`,
      name: "فاحص العروض المراجع",
      passwordHash: "not-a-real-hash",
      role: "REVIEWER",
    },
  });
  await prisma.session.createMany({
    data: [
      { token: TOKEN, csrfToken: "t12-csrf-1", userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
      { token: TOKEN2, csrfToken: "t12-csrf-2", userId: user2.id, expiresAt: new Date(Date.now() + 3_600_000) },
      { token: TOKEN_REVIEWER, csrfToken: "t12-csrf-r", userId: reviewer.id, expiresAt: new Date(Date.now() + 3_600_000) },
    ],
  });
  const profile = await prisma.startupProfile.create({
    data: {
      userId: user.id,
      fieldsJson: JSON.stringify([
        { field: "company.name", value: "شركة الزراعة الذكية", source: "manual", confirmedAt: "2025-01-01T00:00:00.000Z" },
        { field: "company.stage", value: "idea", source: "deck", deckId: "deck_t12_old", deckVersion: 1, page: 1, quote: "مرحلة الفكرة" },
      ] satisfies StoredField[]),
    },
  });
  await prisma.startupProfile.create({ data: { userId: user2.id, fieldsJson: "[]" } });

  // محاكاة ما يخزنه مسار الرفع: Deck + نسختان جاهزتان بالنصوص والمشتقات
  const deck = await prisma.deck.create({ data: { profileId: profile.id, currentVersion: 2 } });

  const readinessV1 = evaluateReadiness(SLIDES_V1, EXTRACTION_V1);
  const teamCriterion = readinessV1.criteria.find((c) => c.key === "team");
  if (teamCriterion) teamCriterion.level = "missing"; // فرق جاهزية مقصود للمقارنة

  const v1 = await prisma.deckVersion.create({
    data: {
      deckId: deck.id,
      versionNumber: 1,
      fileHash: "t12-hash-v1",
      fileName: "deck-v1.pdf",
      fileSize: 1024,
      fileType: "pdf",
      status: "READY",
      slideCount: SLIDES_V1.length,
      pageCount: SLIDES_V1.length,
      slidesJson: JSON.stringify(SLIDES_V1),
      extractionJson: JSON.stringify(EXTRACTION_V1),
      claimsJson: JSON.stringify(CLAIMS_V1),
      readinessJson: JSON.stringify(readinessV1),
      gapReportJson: JSON.stringify({
        missingProfileFields: ["founder.region", "company.legalStatus"],
        missingCriteria: ["market"],
        perOpportunity: [],
        notesAr: ["نسخة الفحص الأولى"],
      }),
    },
  });
  const v2 = await prisma.deckVersion.create({
    data: {
      deckId: deck.id,
      versionNumber: 2,
      fileHash: "t12-hash-v2",
      fileName: "deck-v2.pdf",
      fileSize: 2048,
      fileType: "pdf",
      status: "PARTIAL",
      statusMessage: "تعذّر استخراج النص من 1 شريحة من أصل 4 (تاريخي)",
      slideCount: SLIDES_V2.length,
      slidesJson: JSON.stringify(SLIDES_V2),
      extractionJson: "[]",
      claimsJson: "[]",
    },
  });

  // ملفات تخزين وهمية للنسختين + اقتراحان لشريحة 2 (الأحدث يفوز) + AiRun مربوطة
  const storageDir = path.join(process.cwd(), "storage", "decks");
  await mkdir(storageDir, { recursive: true });
  await Promise.all([
    writeFile(deckStoragePath(v1.id, "pdf"), Buffer.from("fake-pdf-v1")),
    writeFile(deckStoragePath(v2.id, "pdf"), Buffer.from("fake-pdf-v2")),
  ]);
  const now = Date.now();
  await prisma.slideSuggestion.createMany({
    data: [
      {
        deckVersionId: v1.id,
        slideIndex: 2,
        originalText: "يخدم المنصة ٥٠٠٠ مستخدم نشط.",
        suggestedText: "يخدم المنصة ٥٠٠٠ مستخدم نشط شهريًّا.",
        reason: "اختبار قديم",
        guardReportJson: '{"verdict":"pass","flags":[]}',
        createdAt: new Date(now - 3_600_000),
      },
      {
        deckVersionId: v1.id,
        slideIndex: 2,
        originalText: "يخدم المنصة ٥٠٠٠ مستخدم نشط.",
        suggestedText: "يخدم منصتنا ٥٠٠٠ مستخدم نشط حتى اليوم.",
        reason: "اختبار أحدث",
        guardReportJson: '{"verdict":"pass","flags":[]}',
        createdAt: new Date(now),
      },
    ],
  });
  const aiRun = await prisma.aiRun.create({
    data: {
      purpose: "EXTRACTION",
      provider: "mock-replay",
      model: "masar-mock-replay/1",
      promptFingerprint: "t12-fingerprint",
      deckVersionId: v1.id,
      userId: user.id,
    },
  });

  try {
    // ————— [1] GET /decks — القائمة والملكية —————
    console.log("\n[1] GET /decks — قائمة نسخ الملف");
    const listRes = await listDecks(req("/api/v1/decks"));
    const listEnv = await env<DecksListData>(listRes);
    check("GET /decks → 200 ok", listRes.status === 200 && listEnv.ok === true, `status=${listRes.status}`);
    check("deckId وcurrentVersion=2", listEnv.data?.deckId === deck.id && listEnv.data?.currentVersion === 2);
    check("نسختان بالترتيب الأحدث أولًا", listEnv.data?.versions?.length === 2 && listEnv.data?.versions[0]?.versionNumber === 2, `len=${listEnv.data?.versions?.length}`);
    check(
      "عناصر القائمة بالشكل المتفق",
      listEnv.data?.versions?.every((v) => typeof v.status === "string" && typeof v.fileType === "string" && typeof v.fileName === "string" && typeof v.slideCount === "number" && typeof v.createdAt === "string") === true,
    );
    const listBRes = await listDecks(reqAs(TOKEN2, "/api/v1/decks"));
    const listBEnv = await env<DecksListData>(listBRes);
    check("IDOR: ملف بلا عروض → بنية فارغة (deckId=null)", listBRes.status === 200 && listBEnv.data?.deckId === null && listBEnv.data?.versions?.length === 0);
    const noAuthList = await listDecks(reqAs("short-token", "/api/v1/decks"));
    check("بلا جلسة → 401", noAuthList.status === 401, `status=${noAuthList.status}`);

    // ————— [2] GET /decks/[id]/versions/[v] — التفاصيل —————
    console.log("\n[2] GET نسخة 1 — الحالة والاستخراج والادعاءات والجاهزية والفجوات");
    const detRes = await getVersion(req(`/api/v1/decks/${deck.id}/versions/1`), params({ id: deck.id, v: "1" }));
    const detEnv = await env<VersionDetail>(detRes);
    check("GET نسخة 1 → 200 ok", detRes.status === 200 && detEnv.ok === true, `status=${detRes.status}`);
    const det = detEnv.data;
    check("الحالة READY وslides كاملة بالنص (3)", det?.status === "READY" && det?.slides?.length === 3 && (det?.slides?.[0]?.text.includes("منصة ري ذكية") ?? false));
    check("الاستخراج: حقلان بحالة pending مع page/quote", (det?.extraction?.length ?? 0) === 2 && (det?.extraction?.every((f) => f.status === "pending" && typeof f.page === "number" && typeof f.quote === "string") ?? false));
    check(
      "الادعاءات: 3 عناصر + تناقض revenue مكتشف (فارق >20%)",
      det?.claims?.items?.length === 3 && det?.claims?.contradictions?.length === 1,
      `items=${det?.claims?.items?.length} contradictions=${det?.claims?.contradictions?.length}`,
    );
    check("الجاهزية: 9 معايير بمستويات", (det?.readiness?.criteria?.length ?? 0) === 9 && (det?.readiness?.criteria?.every((c) => typeof c.level === "string") ?? false));
    check("تقرير الفجوات حاضر", det?.gapReport?.missingProfileFields?.length === 2 && det?.gapReport?.perOpportunity?.length === 0);
    check(
      "الاقتراحات: الأحدث لكل شريحة (واحد = الأحدث لشريحة 2)",
      det?.suggestions?.length === 1 && det?.suggestions?.[0]?.slideIndex === 2 && det?.suggestions?.[0]?.suggestedText === "يخدم منصتنا ٥٠٠٠ مستخدم نشط حتى اليوم.",
      `len=${det?.suggestions?.length}`,
    );
    const detV99 = await getVersion(req(`/api/v1/decks/${deck.id}/versions/99`), params({ id: deck.id, v: "99" }));
    check("نسخة غير موجودة → 404", detV99.status === 404, `status=${detV99.status}`);
    const detAll = await getVersion(req(`/api/v1/decks/${deck.id}/versions/all`), params({ id: deck.id, v: "all" }));
    check("v=all مرفوض → 400 BAD_VERSION", detAll.status === 400, `status=${detAll.status}`);
    const detIdor = await getVersion(reqAs(TOKEN2, `/api/v1/decks/${deck.id}/versions/1`), params({ id: deck.id, v: "1" }));
    check("IDOR: نسخة الغير → 404", detIdor.status === 404, `status=${detIdor.status}`);

    // ————— [3] confirm-profile — الدمج بمصدر deck —————
    console.log("\n[3] POST confirm-profile — دمج الحقول المؤكدة");
    const tBefore = Date.now();
    const goodBody = JSON.stringify({
      fields: [
        { key: "company.stage", value: "early_revenue", page: 2, quote: "الإيراد الشهري بلغ $12,000" },
        { key: "company.teamSize", value: 8, page: 3, quote: "فريقنا يتكون من 8 مؤسسين ومهندسين" },
      ],
    });
    const cRes = await confirmProfile(
      req(`/api/v1/decks/${deck.id}/versions/1/confirm-profile`, { method: "POST", body: goodBody }),
      params({ id: deck.id, v: "1" }),
    );
    const cEnv = await env<ConfirmData>(cRes);
    check("confirm → 200 ok وupdated=2", cRes.status === 200 && cEnv.ok === true && cEnv.data?.updated === 2, `status=${cRes.status}`);

    const profileRow = await prisma.startupProfile.findUniqueOrThrow({ where: { id: profile.id } });
    const storedFields = JSON.parse(profileRow.fieldsJson) as StoredField[];
    const nameField = storedFields.find((f) => f.field === "company.name");
    const stageField = storedFields.find((f) => f.field === "company.stage");
    const teamField = storedFields.find((f) => f.field === "company.teamSize");
    check("الملف: 3 حقول فقط (القديم بنفس الاسم استُبدل)", storedFields.length === 3, `len=${storedFields.length}`);
    check(
      "حقل يدوي لم يُمَسّ",
      nameField?.source === "manual" && nameField?.value === "شركة الزراعة الذكية" && nameField?.confirmedAt === "2025-01-01T00:00:00.000Z",
    );
    check(
      "الحقل القديم استُبدل بمصدر deck كامل المرجع",
      stageField?.source === "deck" &&
        stageField?.value === "early_revenue" &&
        stageField?.deckId === deck.id &&
        stageField?.deckVersion === 1 &&
        stageField?.page === 2 &&
        stageField?.quote === "الإيراد الشهري بلغ $12,000" &&
        stageField?.confirmedAt !== undefined &&
        new Date(stageField.confirmedAt).getTime() >= tBefore,
    );
    check(
      "حقل جديد أُضيف بمصدر deck وpage/quote/confirmedAt",
      teamField?.source === "deck" && teamField?.value === 8 && teamField?.page === 3 && teamField?.quote === "فريقنا يتكون من 8 مؤسسين ومهندسين" && teamField?.confirmedAt !== undefined,
    );
    check(
      "الرد يحمل الملف كـ GET /profile (نفس الشكل)",
      cEnv.data?.profile?.fields?.length === 3 && Array.isArray(cEnv.data?.profile?.founders) && Array.isArray(cEnv.data?.profile?.documents),
    );

    const v1After = await prisma.deckVersion.findUniqueOrThrow({ where: { id: v1.id } });
    const extractionAfter = JSON.parse(v1After.extractionJson) as ExtractedField[];
    check(
      "extractionJson: الحقلان عُلِّما confirmed",
      extractionAfter.length === 2 && extractionAfter.every((f) => f.status === "confirmed"),
      extractionAfter.map((f) => `${f.key}:${f.status}`).join(","),
    );
    const confirmAudit = await prisma.auditLog.findFirst({
      where: { action: "PROFILE_FIELDS_CONFIRMED", userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    check(
      "audit PROFILE_FIELDS_CONFIRMED: العدد فقط بلا قيم/اقتباسات",
      confirmAudit !== null &&
        (JSON.parse(confirmAudit.detailsJson) as { fieldsCount?: number }).fieldsCount === 2 &&
        !confirmAudit.detailsJson.includes("teamSize") &&
        !confirmAudit.detailsJson.includes("الإيراد الشهري"),
      `details=${confirmAudit?.detailsJson ?? "لا سجل"}`,
    );

    // ————— [4] citation فاشل يرفض —————
    console.log("\n[4] confirm-profile — اقتباس فاشل يرفض ولا يُكتب شيء");
    const fieldsCountBefore = (JSON.parse(profileRow.fieldsJson) as StoredField[]).length;
    const badQuoteRes = await confirmProfile(
      req(`/api/v1/decks/${deck.id}/versions/1/confirm-profile`, {
        method: "POST",
        body: JSON.stringify({ fields: [{ key: "company.womenLed", value: true, page: 3, quote: "فريقنا يقوده نساء بالكامل وهذا غير موجود" }] }),
      }),
      params({ id: deck.id, v: "1" }),
    );
    const badQuoteEnv = await env<ConfirmData>(badQuoteRes);
    check("اقتباس غير موجود → 422 QUOTE_NOT_FOUND", badQuoteRes.status === 422 && badQuoteEnv.error?.code === "QUOTE_NOT_FOUND", `status=${badQuoteRes.status}`);
    const profileAfterBad = await prisma.startupProfile.findUniqueOrThrow({ where: { id: profile.id } });
    check("لا شيء كُتب بعد الرفض", (JSON.parse(profileAfterBad.fieldsJson) as StoredField[]).length === fieldsCountBefore);

    const badPageRes = await confirmProfile(
      req(`/api/v1/decks/${deck.id}/versions/1/confirm-profile`, {
        method: "POST",
        body: JSON.stringify({ fields: [{ key: "company.womenLed", value: true, page: 99, quote: "فريقنا يتكون من 8 مؤسسين ومهندسين" }] }),
      }),
      params({ id: deck.id, v: "1" }),
    );
    check("صفحة خارج النطاق → 422 QUOTE_NOT_FOUND", badPageRes.status === 422, `status=${badPageRes.status}`);

    const csrfRes = await confirmProfile(
      req(`/api/v1/decks/${deck.id}/versions/1/confirm-profile`, {
        method: "POST",
        origin: "http://evil.example",
        body: goodBody,
      }),
      params({ id: deck.id, v: "1" }),
    );
    check("CSRF: أصل مختلف → 403", csrfRes.status === 403, `status=${csrfRes.status}`);
    const idorRes = await confirmProfile(
      reqAs(TOKEN2, `/api/v1/decks/${deck.id}/versions/1/confirm-profile`, { method: "POST", body: goodBody }),
      params({ id: deck.id, v: "1" }),
    );
    check("IDOR: تأكيد على عرض الغير → 404", idorRes.status === 404, `status=${idorRes.status}`);
    const noAuthRes = await confirmProfile(
      reqAs("short-token", `/api/v1/decks/${deck.id}/versions/1/confirm-profile`, { method: "POST", body: goodBody }),
      params({ id: deck.id, v: "1" }),
    );
    check("بلا جلسة → 401", noAuthRes.status === 401, `status=${noAuthRes.status}`);

    // ————— [5] retry —————
    console.log("\n[5] POST retry — إعادة معالجة PARTIAL فقط");
    const retryReadyRes = await retryVersion(
      req(`/api/v1/decks/${deck.id}/versions/1/retry`, { method: "POST" }),
      params({ id: deck.id, v: "1" }),
    );
    check("retry على نسخة READY → 409 NOT_PARTIAL", retryReadyRes.status === 409, `status=${retryReadyRes.status}`);

    const retryRes = await retryVersion(
      req(`/api/v1/decks/${deck.id}/versions/2/retry`, { method: "POST" }),
      params({ id: deck.id, v: "2" }),
    );
    const retryEnv = await env<RetryData>(retryRes);
    check("retry على PARTIAL → 200", retryRes.status === 200 && retryEnv.ok === true, `status=${retryRes.status}`);
    check("الحالة صارت READY بلا رسالة", retryEnv.data?.status === "READY" && retryEnv.data?.statusMessage === undefined, `status=${retryEnv.data?.status}`);
    const v2After = await prisma.deckVersion.findUniqueOrThrow({ where: { id: v2.id } });
    const v2Extraction = JSON.parse(v2After.extractionJson) as ExtractedField[];
    const v2Claims = JSON.parse(v2After.claimsJson) as Array<{ type: string; value: number }>;
    const v2Readiness = JSON.parse(v2After.readinessJson) as { criteria: Array<{ key: string; level: string }> };
    const v2Gap = JSON.parse(v2After.gapReportJson) as { notesAr: string[]; perOpportunity: unknown[] };
    check("أعيد التحليل من slidesJson بلا إعادة رفع: 3 شرائح", v2After.slideCount === 3 && v2After.status === "READY");
    check(
      "الاستخراج أعاد حقولًا باقتباسات حرفية من الشرائح",
      v2Extraction.length >= 3 &&
        v2Extraction.every((f) => f.status === "pending" || f.status === "confirmed") &&
        v2Extraction.some((f) => f.key === "company.teamSize" && f.value === 12) &&
        v2Extraction.some((f) => f.key === "company.askAmountUSD" && f.value === 750000),
      v2Extraction.map((f) => `${f.key}=${String(f.value)}`).join(","),
    );
    check(
      "اقتباسات الحقول موجودة حرفيًّا في نص الشرائح (Citation Guard)",
      v2Extraction.every((f) => SLIDES_V2.some((s) => s.text.includes(f.quote.replace(/[.؟]$/, "")) || s.text.includes(f.quote))),
    );
    check("الادعاءات أُعيد حسابها", v2Claims.length >= 3 && v2Claims.some((c) => c.type === "revenue" && c.value === 18000), v2Claims.map((c) => `${c.type}:${c.value}`).join(","));
    check("الجاهزية 9 معايير", v2Readiness.criteria?.length === 9);
    check("تقرير الفجوات أعيد بناؤه", Array.isArray(v2Gap.notesAr) && v2Gap.notesAr.length > 0);
    const retryAudit = await prisma.auditLog.findFirst({
      where: { action: "DECK_RETRIED", userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    check("audit DECK_RETRIED", retryAudit !== null);

    // ————— [6] compare — فرق قيمة ومستوى وادعاء —————
    console.log("\n[6] GET compare — فروق النسختين");
    const cmpRes = await compareVersions(
      req(`/api/v1/decks/${deck.id}/compare?from=1&to=2`),
      params({ id: deck.id }),
    );
    const cmpEnv = await env<CompareData>(cmpRes);
    check("compare → 200 ok", cmpRes.status === 200 && cmpEnv.ok === true, `status=${cmpRes.status}`);
    const changes = cmpEnv.data?.changes ?? [];
    const teamChange = changes.find((c) => c.kind === "extraction" && c.key === "company.teamSize");
    check(
      "extractionDiff: فرق قيمة teamSize 6→12",
      teamChange?.change === "changed" && (teamChange.from?.value as number) === 6 && (teamChange.to?.value as number) === 12,
      JSON.stringify(teamChange ?? {}),
    );
    check(
      "extractionDiff: حقول جديدة مضافة في النسخة 2",
      changes.some((c) => c.kind === "extraction" && c.change === "added" && ["company.askAmountUSD", "company.tractionUsers", "company.monthlyRevenueUSD"].includes(String(c.key))),
      changes.filter((c) => c.kind === "extraction").map((c) => `${c.key}:${c.change}`).join(","),
    );
    const teamReadiness = changes.find((c) => c.kind === "readiness" && c.criterion === "team");
    check("readinessDiff: مستوى الفريق تغيّر (missing → غيرها)", teamReadiness?.change === "changed" && teamReadiness.from?.level === "missing" && teamReadiness.to?.level !== "missing");
    const revenueClaim = changes.find((c) => c.kind === "claim" && c.claimType === "revenue" && c.change === "changed");
    check("claimsDiff: إيراد متغير القيمة 5000→18000", revenueClaim !== undefined && (revenueClaim.from?.value as number) === 5000 && (revenueClaim.to?.value as number) === 18000, JSON.stringify(revenueClaim ?? {}));
    check("claimsDiff: ادعاء محذوف (20000) وادعاء مضاف (users)", changes.some((c) => c.kind === "claim" && c.change === "removed" && (c.from?.value as number) === 20000) && changes.some((c) => c.kind === "claim" && c.change === "added" && c.claimType === "users"));
    check(
      "ملخصا النسختين: from.fields.confirmed=2",
      cmpEnv.data?.from?.versionNumber === 1 && cmpEnv.data?.from?.fields?.confirmed === 2 && cmpEnv.data?.to?.versionNumber === 2,
      JSON.stringify(cmpEnv.data?.from ?? {}),
    );
    const sameRes = await compareVersions(req(`/api/v1/decks/${deck.id}/compare?from=1&to=1`), params({ id: deck.id }));
    check("from=to → 422 SAME_VERSION", sameRes.status === 422, `status=${sameRes.status}`);
    const missingRes = await compareVersions(req(`/api/v1/decks/${deck.id}/compare?from=1&to=99`), params({ id: deck.id }));
    check("نسخة غائبة → 404", missingRes.status === 404, `status=${missingRes.status}`);
    const badQRes = await compareVersions(req(`/api/v1/decks/${deck.id}/compare?from=abc&to=2`), params({ id: deck.id }));
    check("معامل غير رقمي → 422 VALIDATION", badQRes.status === 422, `status=${badQRes.status}`);
    const cmpIdor = await compareVersions(reqAs(TOKEN2, `/api/v1/decks/${deck.id}/compare?from=1&to=2`), params({ id: deck.id }));
    check("IDOR: مقارنة عرض الغير → 404", cmpIdor.status === 404, `status=${cmpIdor.status}`);

    // ————— [7] POST /decks — رفع فعلي (PPTX مولّد فيه شريحة فارغة) —————
    console.log("\n[7] POST /decks — رفع PPTX فعلي ومعالجة متزامنة");
    const pptxBuffer = await buildTestPptx();
    const upRes = await uploadDeck(uploadReq(TOKEN, pptxBuffer, "t12-deck.pptx"));
    const upEnv = await env<UploadData>(upRes);
    check("رفع → 201 بنفس العرض ورقم نسخة 3", upRes.status === 201 && upEnv.data?.deckId === deck.id && upEnv.data?.versionNumber === 3, `status=${upRes.status}`);
    check("الحالة PARTIAL (شريحة فارغة) برسالة عربية", upEnv.data?.status === "PARTIAL" && (upEnv.data?.statusMessage ?? "").includes("تعذّر استخراج النص من 1 شريحة من أصل 4"), `status=${upEnv.data?.status} msg=${upEnv.data?.statusMessage}`);
    check("slideCount=4 وfileType=pptx", upEnv.data?.slideCount === 4 && upEnv.data?.fileType === "pptx");
    const v3 = await prisma.deckVersion.findFirstOrThrow({ where: { deckId: deck.id, versionNumber: 3 } });
    check("fileHash sha256 مخزّن (64 محرفًا)", /^[0-9a-f]{64}$/.test(v3.fileHash));
    check("الملف الأصلي محفوظ في storage/decks", existsSync(deckStoragePath(v3.id, "pptx")));
    const v3Extraction = JSON.parse(v3.extractionJson) as ExtractedField[];
    const v3Gap = JSON.parse(v3.gapReportJson) as { notesAr?: string[]; perOpportunity?: unknown[] };
    check("المعالجة أنتجت استخراجًا وفجوات داخل الطلب", v3Extraction.length >= 2 && Array.isArray(v3Gap.notesAr) && v3Gap.notesAr.length > 0, `fields=${v3Extraction.length}`);
    check("pageCount=0 لملفات pptx", v3.pageCount === 0);
    const uploadAudit = await prisma.auditLog.findFirst({
      where: { action: "DECK_UPLOADED", userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    check("audit DECK_UPLOADED", uploadAudit !== null && (JSON.parse(uploadAudit.detailsJson) as { versionNumber?: number }).versionNumber === 3);

    // مرفوضات الرفع
    const noFileRes = await uploadDeck(new NextRequest(`${BASE}/api/v1/decks`, { method: "POST", headers: { cookie: `masar_session=${TOKEN}`, host: "localhost:3000" }, body: new FormData() }));
    check("بلا حقل file → 422 NO_FILE", noFileRes.status === 422 && (await env<never>(noFileRes)).error?.code === "NO_FILE", `status=${noFileRes.status}`);
    const badTypeRes = await uploadDeck(uploadReq(TOKEN, Buffer.from("هذا نص عادي وليس ملفًا", "utf8"), "deck.pdf"));
    check("محتوى غير ثنائي → 422 BAD_TYPE (البصمة حَكَم)", badTypeRes.status === 422 && (await env<never>(badTypeRes)).error?.code === "BAD_TYPE", `status=${badTypeRes.status}`);
    const reviewerRes = await uploadDeck(uploadReq(TOKEN_REVIEWER, pptxBuffer, "deck.pptx"));
    check("المراجع لا يرفع → 403 FORBIDDEN", reviewerRes.status === 403, `status=${reviewerRes.status}`);
    const noAuthUpload = await uploadDeck(uploadReq("short-token", pptxBuffer, "deck.pptx"));
    check("رفع بلا جلسة → 401", noAuthUpload.status === 401, `status=${noAuthUpload.status}`);

    // ————— [8] DELETE — تنظيف القاعدة والتخزين —————
    console.log("\n[8] DELETE /decks/[id] — حذف شامل");
    const delRes = await deleteDeck(
      req(`/api/v1/decks/${deck.id}`, { method: "DELETE" }),
      params({ id: deck.id }),
    );
    const delEnv = await env<{ deleted: boolean; deckId: string; versionsDeleted: number }>(delRes);
    check("حذف → 200 و3 نسخ", delRes.status === 200 && delEnv.data?.deleted === true && delEnv.data?.versionsDeleted === 3, `status=${delRes.status}`);
    check("العرض وكل نسخه حُذفت من القاعدة", (await prisma.deck.count({ where: { id: deck.id } })) === 0 && (await prisma.deckVersion.count({ where: { deckId: deck.id } })) === 0);
    check("الاقتراحات حُذفت بالتتالي", (await prisma.slideSuggestion.count({ where: { deckVersionId: { in: [v1.id, v2.id, v3.id] } } })) === 0);
    check(
      "AiRun.deckVersionId → SetNull",
      (await prisma.aiRun.findUniqueOrThrow({ where: { id: aiRun.id } })).deckVersionId === null,
    );
    check(
      "ملفات التخزين الثلاثة مُسحت",
      !existsSync(deckStoragePath(v1.id, "pdf")) && !existsSync(deckStoragePath(v2.id, "pdf")) && !existsSync(deckStoragePath(v3.id, "pptx")),
    );
    const delAudit = await prisma.auditLog.findFirst({
      where: { action: "DECK_DELETED", userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    check("audit DECK_DELETED (عدد النسخ)", delAudit !== null && (JSON.parse(delAudit.detailsJson) as { versionsDeleted?: number }).versionsDeleted === 3);
    const delIdor = await deleteDeck(
      reqAs(TOKEN2, `/api/v1/decks/${deck.id}`, { method: "DELETE" }),
      params({ id: deck.id }),
    );
    check("IDOR: حذف عرض الغير → 404", delIdor.status === 404, `status=${delIdor.status}`);
    const listAfterDel = await listDecks(req("/api/v1/decks"));
    const listAfterDelEnv = await env<DecksListData>(listAfterDel);
    check("بعد الحذف: لا عروض للملف (deckId=null)", listAfterDelRes_ok(listAfterDel, listAfterDelEnv));
  } finally {
    // ————— التنظيف —————
    await prisma.aiRun.deleteMany({ where: { userId: { in: [user.id, user2.id, reviewer.id] } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [user.id, user2.id, reviewer.id] } } });
    await prisma.session.deleteMany({ where: { userId: { in: [user.id, user2.id, reviewer.id] } } });
    await prisma.deck.deleteMany({ where: { profile: { userId: { in: [user.id, user2.id] } } } });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, user2.id, reviewer.id] } } });
    console.log("\n(نُظِّفت بيانات الفحص)");
  }

  console.log(`\nالنتيجة: ${passed} ناجح / ${failed} فاشل`);
  if (failed > 0) {
    console.error("DECKS CHECK FAILED");
    process.exit(1);
  }
  console.log("DECKS CHECK PASSED");
}

function listAfterDelRes_ok(res: Response, e: Envelope<DecksListData>): boolean {
  return res.status === 200 && e.data?.deckId === null && (e.data?.versions?.length ?? -1) === 0;
}

main()
  .catch((e: unknown) => {
    console.error("فشل تشغيل الفحص:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
