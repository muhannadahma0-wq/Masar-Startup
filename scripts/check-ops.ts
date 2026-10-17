/**
 * Masar — T14 تحقق ذاتي (إلزامي): الإشعارات الفريدة + دمج الملف + upsert المستندات
 * تشغيل: bun scripts/check-ops.ts  (من جذر المشروع)
 * يطبع «OPS CHECK PASSED» عند نجاح كل الفحوص، ويخرج برمز 1 عند أي فشل.
 *
 * المنهج: إعداد البيانات عبر prisma مباشرة (مستخدمون/جلسات/ملفات/فرص) ثم استدعاء
 * معالجات المسارات فعليًا عبر NextRequest مُصنَّع يحمل كوكي جلسة حقيقية من القاعدة —
 * فيغطي الفحص المصادقة والدمج والتدقيق وكل منطق المسارات دون تشغيل الخادم.
 * البيانات كلها خاصة بالفحص (بريد *.test) وتُنظَّف في finally.
 */
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/server/api";
import { notifyByIdempotent, payloadArFromJson } from "../src/lib/server/notify";
import { GET as getProfile, PUT as putProfile } from "../src/app/api/v1/profile/route";
import {
  GET as listApplications,
  POST as postApplication,
} from "../src/app/api/v1/applications/route";
import { PATCH as patchApplication } from "../src/app/api/v1/applications/[id]/route";
import { GET as listDocuments } from "../src/app/api/v1/documents/route";
import { PUT as putDocument } from "../src/app/api/v1/documents/[type]/route";
import { GET as listNotifications } from "../src/app/api/v1/notifications/route";
import { PATCH as patchNotification } from "../src/app/api/v1/notifications/[id]/route";
import { DOC_TYPE_KEYS } from "../src/lib/core/types";

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
  error?: { code: string; message: string };
}

async function env<T>(res: Response): Promise<Envelope<T>> {
  try {
    return (await res.json()) as Envelope<T>;
  } catch {
    return { ok: false, error: { code: "NO_JSON", message: "الاستجابة بلا جسم JSON" } };
  }
}

const BASE = "http://localhost:3000";
const TOKEN = "t14-ops-check-session-token-1";
const TOKEN2 = "t14-ops-check-session-token-2";
const MS_DAY = 86_400_000;

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
function params<T extends Record<string, string>>(p: T): { params: Promise<T> } {
  return { params: Promise.resolve(p) };
}

// ————— أشكال البيانات المتوقعة —————

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

interface ProfileData {
  profile: {
    id: string;
    fields: StoredField[];
    founders: Array<{ id: string; isPrimary: boolean }>;
    documents: Array<{ docType: string; status: string }>;
    updatedAt: string;
  };
}

interface DocView {
  docType: string;
  status: string;
  source: string | null;
  notes: string | null;
  updatedAt: string | null;
}

interface ApplicationData {
  applications?: AppView[];
  application?: AppView;
}

interface AppView {
  id: string;
  status: string;
  notes: string | null;
  deadline: string | null;
  deadlineIsPast: boolean;
  opportunity: { id: string; title: string; orgName: string } | null;
}

interface NotificationData {
  unreadOnly: boolean;
  notifications: Array<{
    id: string;
    eventType: string;
    opportunity: { id: string; title: string } | null;
    payloadAr: string;
    readAt: string | null;
    createdAt: string;
  }>;
}

// ————— التنفيذ —————

async function main(): Promise<void> {
  const suffix = `${Date.now()}`;

  // إعداد: مستخدمان (مؤسسان) + جلسات + ملفان + فرصة منشورة بموعد منقضٍ + فرصة مسودة
  const user = await prisma.user.create({
    data: {
      email: `t14-ops-a-${suffix}@masar.test`,
      name: "فاحص التشغيل أ",
      passwordHash: "not-a-real-hash",
      role: "FOUNDER",
    },
  });
  const user2 = await prisma.user.create({
    data: {
      email: `t14-ops-b-${suffix}@masar.test`,
      name: "فاحص التشغيل ب",
      passwordHash: "not-a-real-hash",
      role: "FOUNDER",
    },
  });
  await prisma.session.createMany({
    data: [
      { token: TOKEN, csrfToken: "t14-csrf-1", userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
      { token: TOKEN2, csrfToken: "t14-csrf-2", userId: user2.id, expiresAt: new Date(Date.now() + 3_600_000) },
    ],
  });
  const profile = await prisma.startupProfile.create({
    data: {
      userId: user.id,
      fieldsJson: JSON.stringify([
        { field: "company.name", value: "شركة الزراعة الذكية", source: "manual", confirmedAt: "2025-01-01T00:00:00.000Z" },
        { field: "company.stage", value: "early_revenue", source: "deck", deckId: "deck_t14", deckVersion: 1, page: 3, quote: "الشركة تحقق إيرادات أولية" },
      ] satisfies StoredField[]),
    },
  });
  const profile2 = await prisma.startupProfile.create({ data: { userId: user2.id, fieldsJson: "[]" } });
  const opp = await prisma.opportunity.create({
    data: {
      title: "فرصة فحص التشغيل",
      orgName: "جهة الفحص",
      status: "PUBLISHED",
      deadline: new Date(Date.now() - 2 * MS_DAY), // موعد منقضٍ قصدًا — لفحص isPast
      verifiedAt: new Date(),
    },
  });
  const oppDraft = await prisma.opportunity.create({
    data: { title: "فرصة مسودة الفحص", orgName: "جهة الفحص", status: "DRAFT" },
  });

  try {
    // ————— [1] الإشعار بمفتاح فريد: نفس المفتاح مرتين —————
    console.log("\n[1] notifyByIdempotent — نفس المفتاح مرتين");
    const key = {
      userId: user.id,
      opportunityId: opp.id,
      eventType: "SUBSTANTIVE_CHANGE",
      versionNumber: 7,
      payloadAr: "تحديث جوهري: تغيّر الموعد النهائي للفرصة.",
    };
    const first = await notifyByIdempotent(key);
    const second = await notifyByIdempotent(key);
    check("النداء الأول → true (أُرسل)", first === true);
    check("النداء الثاني بنفس المفتاح → false (مكرر — لم يُرسل)", second === false);
    const cntSameKey = await prisma.notification.count({
      where: { userId: user.id, opportunityId: opp.id, eventType: key.eventType, versionNumber: 7 },
    });
    check("صف واحد فقط في القاعدة للمفتاح المكرر", cntSameKey === 1, `count=${cntSameKey}`);
    const row7 = await prisma.notification.findFirst({ where: { userId: user.id, versionNumber: 7 } });
    check(
      "الحمولة العربية محفوظة وتُسترجع كما هي",
      row7 !== null && payloadArFromJson(row7.payloadJson) === key.payloadAr,
    );

    // ————— [2] مفاتيح مختلفة (versionNumber مختلف) → كلاهما true —————
    console.log("\n[2] مفاتيح مختلفة (versionNumber مختلف) → كلاهما true");
    const v8 = await notifyByIdempotent({ ...key, versionNumber: 8, payloadAr: "تغيير في الشروط الإلزامية." });
    const v9 = await notifyByIdempotent({ ...key, versionNumber: 9, payloadAr: "تغيير في المبلغ الأقصى." });
    check("الإصدار 8 → true", v8 === true);
    check("الإصدار 9 → true", v9 === true);

    // ————— [3] GET/PUT /profile — منطق الدمج —————
    console.log("\n[3] GET/PUT /profile — منطق الدمج");
    const gRes = await getProfile(req("/api/v1/profile"));
    const gEnv = await env<ProfileData>(gRes);
    check("GET /profile → 200 ok", gRes.status === 200 && gEnv.ok === true, `status=${gRes.status}`);
    const gFields = gEnv.data?.profile.fields ?? [];
    check("GET يعيد الحقلين محلولين من fieldsJson", gFields.length === 2, `len=${gFields.length}`);
    const nameBefore = gFields.find((f) => f.field === "company.name");
    const stageBefore = gFields.find((f) => f.field === "company.stage");
    check(
      "حقل العرض بمصدره وصفحته واقتباسه (مصدر كل حقل Must)",
      stageBefore?.source === "deck" &&
        stageBefore?.page === 3 &&
        stageBefore?.quote === "الشركة تحقق إيرادات أولية" &&
        stageBefore?.deckId === "deck_t14" &&
        stageBefore?.confirmedAt === undefined,
    );
    check("الحقل اليدوي يحمل confirmedAt الأصلي", nameBefore?.confirmedAt === "2025-01-01T00:00:00.000Z");

    const tBefore = Date.now();
    const pRes = await putProfile(
      req("/api/v1/profile", {
        method: "PUT",
        body: JSON.stringify({ fields: [{ field: "company.name", value: "شركة الزراعة الذكية — الاسم الجديد" }] }),
      }),
    );
    const pEnv = await env<ProfileData>(pRes);
    check("PUT /profile → 200 ok", pRes.status === 200 && pEnv.ok === true, `status=${pRes.status}`);
    const pFields = pEnv.data?.profile.fields ?? [];
    const nameAfter = pFields.find((f) => f.field === "company.name");
    const stageAfter = pFields.find((f) => f.field === "company.stage");
    check("الحقل المُرسل تغيّرت قيمته", nameAfter?.value === "شركة الزراعة الذكية — الاسم الجديد");
    check(
      "confirmedAt للحقل اليدوي المحدَّث = الآن",
      nameAfter?.confirmedAt !== undefined && new Date(nameAfter.confirmedAt).getTime() >= tBefore,
    );
    check(
      "الحقل الذي لم يُرسل لم يُمَسّ (مصدر deck واقتباسه وصفحته وقيمته كما هي)",
      stageAfter?.source === "deck" &&
        stageAfter?.page === 3 &&
        stageAfter?.quote === "الشركة تحقق إيرادات أولية" &&
        stageAfter?.value === "early_revenue" &&
        stageAfter?.confirmedAt === undefined,
    );
    check("ما زال لدينا حقلان فقط", pFields.length === 2, `len=${pFields.length}`);

    // حقل بمصدر deck صريح مع page/quote → يبقى deck (يُسمح بالاثنين)
    const dRes = await putProfile(
      req("/api/v1/profile", {
        method: "PUT",
        body: JSON.stringify({
          fields: [{ field: "company.teamSize", value: 8, source: "deck", page: 5, quote: "فريق من 8 موظفين" }],
        }),
      }),
    );
    const dEnv = await env<ProfileData>(dRes);
    const team = dEnv.data?.profile.fields.find((f) => f.field === "company.teamSize");
    check(
      "حقل بمصدر deck مع page/quote يبقى deck",
      team?.source === "deck" && team?.page === 5 && team?.quote === "فريق من 8 موظفين" && team?.confirmedAt === undefined,
    );
    // مصدر deck بلا page/quote → يُعامل manual مع confirmedAt
    const mRes = await putProfile(
      req("/api/v1/profile", {
        method: "PUT",
        body: JSON.stringify({ fields: [{ field: "company.womenLed", value: true, source: "deck" }] }),
      }),
    );
    const mEnv = await env<ProfileData>(mRes);
    const women = mEnv.data?.profile.fields.find((f) => f.field === "company.womenLed");
    check(
      "deck بلا page/quote يُعامل manual مع confirmedAt",
      women?.source === "manual" && women?.confirmedAt !== undefined,
    );
    // التدقيق: عدد الحقول فقط بلا قيم
    const auditRow = await prisma.auditLog.findFirst({
      where: { action: "PROFILE_UPDATED", userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    const auditDetails = auditRow ? (JSON.parse(auditRow.detailsJson) as { fieldsCount?: number }) : null;
    check(
      "audit PROFILE_UPDATED (عدد الحقول فقط بلا قيم)",
      auditDetails?.fieldsCount === 1,
      `details=${auditRow?.detailsJson ?? "لا سجل"}`,
    );
    // CSRF + مصادقة
    const csrfRes = await putProfile(
      req("/api/v1/profile", {
        method: "PUT",
        origin: "http://evil.example",
        body: JSON.stringify({ fields: [] }),
      }),
    );
    const csrfEnv = await env<ProfileData>(csrfRes);
    check("PUT من أصل مختلف → 403 CSRF", csrfRes.status === 403 && csrfEnv.error?.code === "CSRF", `status=${csrfRes.status}`);
    const noAuthRes = await putProfile(
      reqAs("short-token", "/api/v1/profile", { method: "PUT", body: JSON.stringify({ fields: [] }) }),
    );
    check("PUT بلا جلسة صالحة → 401", noAuthRes.status === 401, `status=${noAuthRes.status}`);

    // ————— [4] upsert المستندات —————
    console.log("\n[4] PUT /documents/[type] — upsert");
    const doc1Res = await putDocument(
      req("/api/v1/documents/pitch_deck", {
        method: "PUT",
        body: JSON.stringify({ status: "available", source: "جهاز المؤسس" }),
      }),
      params({ type: "pitch_deck" }),
    );
    const doc1Env = await env<{ document: DocView }>(doc1Res);
    check(
      "PUT مستند جديد → 200 available بمصدره",
      doc1Res.status === 200 && doc1Env.data?.document.status === "available" && doc1Env.data?.document.source === "جهاز المؤسس",
      `status=${doc1Res.status}`,
    );
    const doc2Res = await putDocument(
      req("/api/v1/documents/pitch_deck", {
        method: "PUT",
        body: JSON.stringify({ status: "missing", notes: "قيد التحديث" }),
      }),
      params({ type: "pitch_deck" }),
    );
    const doc2Env = await env<{ document: DocView }>(doc2Res);
    check(
      "PUT ثانٍ يحدّث الصف نفسه",
      doc2Res.status === 200 && doc2Env.data?.document.status === "missing" && doc2Env.data?.document.notes === "قيد التحديث",
    );
    const docCount = await prisma.companyDocument.count({
      where: { profileId: profile.id, docType: "pitch_deck" },
    });
    check("upsert لا يكرر الصفوف (صف واحد)", docCount === 1, `count=${docCount}`);
    const badTypeRes = await putDocument(
      req("/api/v1/documents/secret_doc", {
        method: "PUT",
        body: JSON.stringify({ status: "available" }),
      }),
      params({ type: "secret_doc" }),
    );
    check("نوع غير قياسي → 422", badTypeRes.status === 422, `status=${badTypeRes.status}`);
    // GET /documents — دمج الأنواع القياسية الغائبة
    const listDocsRes = await listDocuments(req("/api/v1/documents"));
    const listDocsEnv = await env<{ documents: DocView[] }>(listDocsRes);
    const docs = listDocsEnv.data?.documents ?? [];
    check("GET /documents يدمج الأنواع القياسية التسعة", docs.length === DOC_TYPE_KEYS.length, `len=${docs.length}`);
    check("الترتيب قياسي", docs.every((d, i) => d.docType === DOC_TYPE_KEYS[i]));
    check(
      "pitch_deck محدَّث والغائب missing بمصدر null",
      docs
        .filter((d) => d.docType !== "pitch_deck")
        .every((d) => d.status === "missing" && d.source === null && d.updatedAt === null) &&
        docs.find((d) => d.docType === "pitch_deck")?.status === "missing",
    );
    const docAudit = await prisma.auditLog.findFirst({
      where: { action: "DOCUMENT_UPDATED", userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    check("audit DOCUMENT_UPDATED مسجَّل", docAudit !== null);

    // ————— [5] متتبع الطلبات —————
    console.log("\n[5] /applications — التتبع والتكرار والملكية");
    const post1Res = await postApplication(
      req("/api/v1/applications", {
        method: "POST",
        body: JSON.stringify({ opportunityId: opp.id, status: "INTERESTED" }),
      }),
    );
    const post1Env = await env<ApplicationData>(post1Res);
    check("POST طلب → 201", post1Res.status === 201 && post1Env.data?.application?.status === "INTERESTED", `status=${post1Res.status}`);
    const pastDeadlineIso = opp.deadline ? opp.deadline.toISOString() : null;
    check(
      "deadline معلَّم isPast لتاريخ منقضٍ",
      post1Env.data?.application?.deadline === pastDeadlineIso && post1Env.data?.application?.deadlineIsPast === true,
    );
    check(
      "الفرصة compact مرفقة",
      post1Env.data?.application?.opportunity?.id === opp.id && post1Env.data?.application?.opportunity?.title === "فرصة فحص التشغيل",
    );
    const post2Res = await postApplication(
      req("/api/v1/applications", {
        method: "POST",
        body: JSON.stringify({ opportunityId: opp.id, status: "PREPARING" }),
      }),
    );
    const post2Env = await env<ApplicationData>(post2Res);
    check("تكرار التتبع → 409 ALREADY_TRACKING", post2Res.status === 409 && post2Env.error?.code === "ALREADY_TRACKING", `status=${post2Res.status}`);
    const post3Res = await postApplication(
      req("/api/v1/applications", {
        method: "POST",
        body: JSON.stringify({ opportunityId: oppDraft.id, status: "INTERESTED" }),
      }),
    );
    check("فرصة غير منشورة → 404", post3Res.status === 404, `status=${post3Res.status}`);

    const appRow = await prisma.application.findFirstOrThrow({
      where: { profileId: profile.id, opportunityId: opp.id },
    });
    const patch1Res = await patchApplication(
      req(`/api/v1/applications/${appRow.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "PREPARING", notes: "جمع المستندات" }),
      }),
      params({ id: appRow.id }),
    );
    const patch1Env = await env<ApplicationData>(patch1Res);
    check(
      "PATCH يحدّث الحالة والملاحظات",
      patch1Res.status === 200 && patch1Env.data?.application?.status === "PREPARING" && patch1Env.data?.application?.notes === "جمع المستندات",
      `status=${patch1Res.status}`,
    );
    const idorRes = await patchApplication(
      reqAs(TOKEN2, `/api/v1/applications/${appRow.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "SUBMITTED" }),
      }),
      params({ id: appRow.id }),
    );
    check("IDOR: طلب الغير → 404 (لا يُكشف وجوده)", idorRes.status === 404, `status=${idorRes.status}`);
    const listAppsRes = await listApplications(req("/api/v1/applications"));
    const listAppsEnv = await env<ApplicationData>(listAppsRes);
    check(
      "GET /applications يعيد طلب الملف مع فرصته",
      listAppsRes.status === 200 && (listAppsEnv.data?.applications?.length ?? -1) === 1,
    );

    // ————— [6] واجهة الإشعارات —————
    console.log("\n[6] /notifications — القائمة والقراءة");
    const notifRes = await listNotifications(req("/api/v1/notifications"));
    const notifEnv = await env<NotificationData>(notifRes);
    const items = notifEnv.data?.notifications ?? [];
    check("GET /notifications → 3 إشعارات", notifRes.status === 200 && items.length === 3, `len=${items.length}`);
    check("مرتبة بالأحدث أولًا", items.length === 3 && items[0].createdAt >= items[2].createdAt);
    const expectedPayloads = [key.payloadAr, "تغيير في الشروط الإلزامية.", "تغيير في المبلغ الأقصى."].sort();
    const gotPayloads = items.map((n) => n.payloadAr).sort();
    check("payloadAr سليم عبر الجولات", JSON.stringify(gotPayloads) === JSON.stringify(expectedPayloads));
    check(
      "opportunity {id,title} مرفقة",
      items.every((n) => n.opportunity?.id === opp.id && n.opportunity?.title === "فرصة فحص التشغيل"),
    );
    const unreadRes = await listNotifications(req("/api/v1/notifications?unread=true"));
    const unreadEnv = await env<NotificationData>(unreadRes);
    check(
      "?unread=true → غير المقروء فقط (3)",
      unreadRes.status === 200 && (unreadEnv.data?.notifications?.length ?? -1) === 3,
    );
    const nid = items[0].id;
    const readRes = await patchNotification(
      req(`/api/v1/notifications/${nid}`, { method: "PATCH" }),
      params({ id: nid }),
    );
    const readEnv = await env<{ notification: { id: string; readAt: string | null } }>(readRes);
    check("PATCH تعليم مقروء → readAt مضبوط", readRes.status === 200 && readEnv.data?.notification?.readAt != null);
    const read2Res = await patchNotification(
      req(`/api/v1/notifications/${nid}`, { method: "PATCH" }),
      params({ id: nid }),
    );
    const read2Env = await env<{ notification: { id: string; readAt: string | null } }>(read2Res);
    check(
      "PATCH مرة أخرى idempotent (نفس readAt)",
      read2Res.status === 200 && read2Env.data?.notification?.readAt === readEnv.data?.notification?.readAt,
    );
    const unread2Res = await listNotifications(req("/api/v1/notifications?unread=true"));
    const unread2Env = await env<NotificationData>(unread2Res);
    check("غير المقروء أصبح 2", (unread2Env.data?.notifications?.length ?? -1) === 2);
    const idorNotifRes = await patchNotification(
      reqAs(TOKEN2, `/api/v1/notifications/${nid}`, { method: "PATCH" }),
      params({ id: nid }),
    );
    check("IDOR: إشعار الغير → 404", idorNotifRes.status === 404, `status=${idorNotifRes.status}`);
  } finally {
    // ————— التنظيف —————
    await prisma.auditLog.deleteMany({ where: { userId: { in: [user.id, user2.id] } } });
    await prisma.notification.deleteMany({ where: { userId: { in: [user.id, user2.id] } } });
    await prisma.session.deleteMany({ where: { userId: { in: [user.id, user2.id] } } });
    await prisma.startupProfile.deleteMany({ where: { id: { in: [profile.id, profile2.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, user2.id] } } });
    await prisma.opportunity.deleteMany({ where: { id: { in: [opp.id, oppDraft.id] } } });
    console.log("\n(نُظِّفت بيانات الفحص)");
  }

  console.log(`\nالنتيجة: ${passed} ناجح / ${failed} فاشل`);
  if (failed > 0) {
    console.error("OPS CHECK FAILED");
    process.exit(1);
  }
  console.log("OPS CHECK PASSED");
}

main()
  .catch((e: unknown) => {
    console.error("فشل تشغيل الفحص:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
