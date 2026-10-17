/**
 * Masar — التحقق الذاتي لواجهات المطابقات T11 (bun scripts/check-matches.ts)
 * ============================================================================
 * ينشئ بيانات وهمية عبر Prisma (مستخدم + ملف + فرصتان PUBLISHED بشروط: واحدة
 * مستوفاة وأخرى بشرط إلزامي مخالف بدليل ok)، ثم:
 *   1) buildMatchesForProfile: الأحكام (ELIGIBLE/NOT_ELIGIBLE) + الملاءمة
 *      (73/100 لعواملها السبعة) + الموثوقية (100/high) + الترتيب
 *      (NOT_ELIGIBLE أخيرًا؛ ضمن الباقي بالملاءمة تنازليًّا).
 *   2) صيغ الرد المختصرة (toMatchResponse / toQuickMatchResponse) وأدلة الشرط.
 *   3) «ماذا لو» في الذاكرة فقط: founderOverrides تقلب الحكمين (changed)، وحقول
 *      askAmountUSD/teamSize تستبدل في الذاكرة (الملاءمة تتغير بلا كتابة).
 *   4) عدم الكتابة: fieldsJson كما هو، ولا AuditLog/Session/Notification/AiRun
 *      لمستخدم الفحص، ولا شروط/طلبات جديدة.
 *   5) الفحص السريع للزوار: quickProfileFromAnswers → مطابقات بلا حفظ (حد 15).
 *   6) الحتمية: نفس (الملف، الفرص، now) ⇒ نفس المخرجات حرفيًّا.
 *   7) التنظيف: deleteMany في النهاية (حتى مع الفشل — finally) مع تحقّق الإزالة.
 *
 * كل القيم المتوقعة محسوبة يدويًّا من عوامل T4 الحرفية:
 *   الفرصة A: قطاع 8.33 + مرحلة 10 + تمويل 20 + أولوية جغرافية 10 +
 *             مستندات 10 (pitch_deck معلن ومتوفر) + وقت 10 + لغة 5 = 73.33 → 73.
 *   ماذا لو (مبلغ 200000): تمويل 6 بدل 20 → 59.33 → 59.
 *   الفحص السريع A: قطاع 12.5 + مستندات 0 (pitch_deck مطلوب وغير معلن للزائر) +
 *                   … = 67.5 → 68.
 *   B بعد «ماذا لو الشتات»: 12.5 + 15 + 12 + 0 + 10 + 10 + 5 = 64.5 → 65.
 */
import { ApiErrorClass, prisma } from "@/lib/server/api";
import {
  buildMatchesForProfile,
  buildMatchesForSnapshot,
  buildMatchesForWhatIf,
  diffJudgments,
  rankMatches,
  toMatchResponse,
  toQuickMatchResponse,
} from "@/lib/server/matches";
import { quickProfileFromAnswers } from "@/lib/core/engine";
import type { MatchEntry } from "@/lib/server/matches";

// ————— أدوات الفحص —————

let failures = 0;
let checks = 0;

function assert(cond: boolean, label: string, extra?: string): void {
  checks += 1;
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${extra !== undefined ? ` — ${extra}` : ""}`);
  }
}

const DAY = 86_400_000;
/** لحظة ثابتة (حقن now) — كل التواريخ المزروعة والمتوقعات نسبة إليها. */
const NOW = new Date("2026-06-15T12:00:00.000Z");

const EMAIL = "t11-check@masar.demo";
const A_URL = "https://t11-check.example.org/agri-grant";
const B_URL = "https://t11-check.example.org/diaspora";
const A_TITLE = "منحة الزراعة الذكية — فحص T11";
const B_TITLE = "تسريع الشتات التقني — فحص T11";

const FIELDS_JSON = JSON.stringify([
  { field: "company.name", value: "الزراعة الذكية — فحص T11", source: "manual" },
  { field: "company.sectors", value: ["agritech", "software"], source: "manual" },
  { field: "company.stage", value: "prototype", source: "manual" },
  { field: "company.registrationCountry", value: "ps", source: "manual" },
  { field: "company.legalStatus", value: "registered_local", source: "manual" },
  { field: "company.askAmountUSD", value: 50000, source: "manual" },
  { field: "company.askType", value: "non_equity", source: "manual" },
  { field: "company.languages", value: ["ar", "en"], source: "manual" },
  { field: "company.requiredDocs", value: ["pitch_deck"], source: "manual" },
  { field: "founder.region", value: "west_bank", source: "manual" },
  { field: "founder.hasBankAccount", value: false, source: "manual" },
]);

/** خاصية الترتيب (مقارن مستقل عن كود الترتيب): كل زوج متجاور غير معكوس. */
function orderingOk(list: MatchEntry[]): boolean {
  for (let i = 0; i + 1 < list.length; i++) {
    const a = list[i];
    const b = list[i + 1];
    const ra = a.eligibility.judgment === "NOT_ELIGIBLE" ? 1 : 0;
    const rb = b.eligibility.judgment === "NOT_ELIGIBLE" ? 1 : 0;
    if (ra !== rb) {
      if (ra > rb) return false;
      continue;
    }
    const fa = a.fit ? a.fit.total : -1;
    const fb = b.fit ? b.fit.total : -1;
    if (fa !== fb) {
      if (fa < fb) return false;
      continue;
    }
    const ta = String(a.opportunity?.title ?? "");
    const tb = String(b.opportunity?.title ?? "");
    if (ta !== tb) {
      if (ta > tb) return false;
      continue;
    }
    if (String(a.opportunity?.id ?? "") > String(b.opportunity?.id ?? "")) return false;
  }
  return true;
}

// ————— هويات البذرة (للتنظيف) —————

let userId: string | null = null;
let profileId: string | null = null;
let oppAId: string | null = null;
let oppBId: string | null = null;
let evidenceIds: string[] = [];

/** تنظيف وقائي (بقايا تشغيل سابق فاشل). */
async function preClean(): Promise<void> {
  const oldOpps = await prisma.opportunity.findMany({
    where: { normalizedUrl: { in: [A_URL, B_URL] } },
    select: { id: true },
  });
  for (const o of oldOpps) {
    await prisma.condition.deleteMany({ where: { opportunityId: o.id } });
    await prisma.opportunity.deleteMany({ where: { id: o.id } });
  }
  await prisma.evidence.deleteMany({ where: { url: { in: [A_URL, B_URL] } } });
  const oldUser = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (oldUser) await prisma.user.deleteMany({ where: { id: oldUser.id } }); // تتالي: ملف/مؤسسون/مستندات
}

/** التنظيف النهائي (deleteMany) — يستدعى في finally دائمًا. */
async function cleanup(): Promise<boolean> {
  const oppIds = [oppAId, oppBId].filter((x): x is string => x !== null);
  if (oppIds.length > 0) {
    await prisma.condition.deleteMany({ where: { opportunityId: { in: oppIds } } });
    await prisma.opportunity.deleteMany({ where: { id: { in: oppIds } } });
  }
  if (evidenceIds.length > 0) {
    await prisma.evidence.deleteMany({ where: { id: { in: evidenceIds } } });
  }
  if (profileId) {
    await prisma.companyDocument.deleteMany({ where: { profileId } });
    await prisma.founder.deleteMany({ where: { profileId } });
    await prisma.startupProfile.deleteMany({ where: { id: profileId } });
  }
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  // تحقق الإزالة
  const left =
    (await prisma.opportunity.count({ where: { id: { in: oppIds } } })) +
    (await prisma.evidence.count({ where: { id: { in: evidenceIds } } })) +
    (await prisma.startupProfile.count({ where: { id: profileId ?? "none" } })) +
    (await prisma.user.count({ where: { id: userId ?? "none" } })) +
    (await prisma.condition.count({ where: { opportunityId: { in: oppIds } } }));
  return left === 0;
}

// ————— البذر —————

async function seed(): Promise<{ oppAId: string; oppBId: string }> {
  const user = await prisma.user.create({
    data: { email: EMAIL, name: "فحص T11", passwordHash: "not-used", role: "FOUNDER", locale: "ar" },
  });
  userId = user.id;
  const profile = await prisma.startupProfile.create({
    data: { userId: user.id, fieldsJson: FIELDS_JSON },
  });
  profileId = profile.id;
  await prisma.founder.create({
    data: { profileId, name: "مؤسِّسة الفحص", region: "west_bank", nationality: "ps", isPrimary: true },
  });
  await prisma.companyDocument.create({
    data: { profileId, docType: "pitch_deck", status: "available", source: "يدوي — فحص T11" },
  });

  // أدلة موثّقة حديثة نسبة إلى NOW (حالة ok)
  const evA1 = await prisma.evidence.create({
    data: { url: A_URL, quote: "متاحة للمقيمين في الضفة الغربية والقدس الشرقية", verifiedAt: new Date(NOW.getTime() - 5 * DAY) },
  });
  const evA2 = await prisma.evidence.create({
    data: { url: A_URL, quote: "البرنامج يستهدف مرحلتي النموذج الأولي والإيرادات الأولية", verifiedAt: new Date(NOW.getTime() - 5 * DAY) },
  });
  const evB1 = await prisma.evidence.create({
    data: { url: B_URL, quote: "البرنامج مخصص للمؤسسين المقيمين في الشتات فقط", verifiedAt: new Date(NOW.getTime() - 10 * DAY) },
  });
  evidenceIds = [evA1.id, evA2.id, evB1.id];

  // الفرصة A: شرطاها الإلزاميان مستوفيان بأدلة ok → ELIGIBLE (الملاءمة 73)
  const oppA = await prisma.opportunity.create({
    data: {
      title: A_TITLE,
      orgName: "مؤسسة الفحص الزراعية",
      description: "فرصة بذر لفحص المطابقات — T11",
      status: "PUBLISHED",
      type: "grant",
      fundingType: "non_equity",
      amountMin: 10000,
      amountMax: 100000,
      currency: "USD",
      sectorsJson: JSON.stringify(["agritech", "food"]),
      stageMin: "prototype",
      stageMax: "early_revenue",
      geography: "local",
      geoPriority: true,
      languagesJson: JSON.stringify(["ar", "en"]),
      requiresDocsJson: JSON.stringify(["pitch_deck"]),
      applicationUrl: A_URL,
      normalizedUrl: A_URL,
      sourceType: "official",
      linkCheckState: "ok",
      deadline: new Date(NOW.getTime() + 60 * DAY),
      verifiedAt: new Date(NOW.getTime() - 5 * DAY),
      currentVersion: 2,
    },
  });
  oppAId = oppA.id;
  await prisma.condition.create({
    data: {
      opportunityId: oppA.id,
      field: "founder.region",
      op: "in",
      valueJson: JSON.stringify(["west_bank", "east_jerusalem"]),
      mandatory: true,
      ambiguous: false,
      scope: "any",
      sourceWording: "متاحة للمقيمين في الضفة الغربية والقدس الشرقية",
      evidenceId: evA1.id,
    },
  });
  await prisma.condition.create({
    data: {
      opportunityId: oppA.id,
      field: "company.stage",
      op: "in",
      valueJson: JSON.stringify(["prototype", "early_revenue"]),
      mandatory: true,
      ambiguous: false,
      scope: "any",
      sourceWording: "يستهدف مرحلتي النموذج الأولي والإيرادات الأولية",
      evidenceId: evA2.id,
    },
  });
  await prisma.condition.create({
    data: {
      opportunityId: oppA.id,
      field: "company.sectors",
      op: "in",
      valueJson: JSON.stringify(["agritech", "food"]),
      mandatory: false,
      ambiguous: false,
      scope: "any",
    },
  });

  // الفرصة B: شرط إلزامي مخالف بدليل ok → NOT_ELIGIBLE مؤكد
  const oppB = await prisma.opportunity.create({
    data: {
      title: B_TITLE,
      orgName: "مركز فحص الشتات",
      description: "فرصة بذر ثانية لفحص المطابقات — T11",
      status: "PUBLISHED",
      type: "accelerator",
      fundingType: "equity",
      amountMin: null,
      amountMax: null,
      currency: "USD",
      sectorsJson: JSON.stringify(["software"]),
      stageMin: "idea",
      stageMax: "scaling",
      geography: "international",
      geoPriority: false,
      languagesJson: JSON.stringify(["en"]),
      applicationUrl: B_URL,
      normalizedUrl: B_URL,
      sourceType: "official",
      linkCheckState: "ok",
      deadline: new Date(NOW.getTime() + 90 * DAY),
      verifiedAt: new Date(NOW.getTime() - 10 * DAY),
      currentVersion: 1,
    },
  });
  oppBId = oppB.id;
  await prisma.condition.create({
    data: {
      opportunityId: oppB.id,
      field: "founder.region",
      op: "in",
      valueJson: JSON.stringify(["diaspora"]),
      mandatory: true,
      ambiguous: false,
      scope: "any",
      sourceWording: "مخصص للمؤسسين المقيمين في الشتات فقط",
      evidenceId: evB1.id,
    },
  });
  await prisma.condition.create({
    data: {
      opportunityId: oppB.id,
      field: "company.teamSize",
      op: "gte",
      valueJson: "3",
      mandatory: false,
      ambiguous: false,
      scope: "any",
    },
  });

  return { oppAId: oppA.id, oppBId: oppB.id };
}

// ————— الفحوص —————

async function runChecks(ids: { oppAId: string; oppBId: string }): Promise<void> {
  console.log("— 1) buildMatchesForProfile: الأحكام والدرجات —");
  const matches = await buildMatchesForProfile(profileId as string, NOW);
  assert(Array.isArray(matches) && matches.length >= 2, "أُعيدت مطابقتان على الأقل", `طول: ${matches.length}`);

  const a = matches.find((m) => m.opportunity?.id === ids.oppAId);
  const b = matches.find((m) => m.opportunity?.id === ids.oppBId);
  assert(!!a, "الفرصة A موجودة في المطابقات");
  assert(!!b, "الفرصة B موجودة في المطابقات");
  if (!a || !b) return;

  // الأحكام
  assert(a.eligibility.judgment === "ELIGIBLE", "A: الحكم ELIGIBLE", a.eligibility.judgment);
  assert(
    a.eligibility.blockingReasons.length === 0 && a.eligibility.uncertainReasons.length === 0,
    "A: لا عوائق ولا أسباب عدم جزم"
  );
  assert(a.eligibility.summary.includes("مؤهل"), "A: الملخص يفسر الأهلية", a.eligibility.summary);
  assert(b.eligibility.judgment === "NOT_ELIGIBLE", "B: الحكم NOT_ELIGIBLE", b.eligibility.judgment);
  assert(b.eligibility.blockingReasons.length === 1, "B: سبب رفض مؤكد واحد", String(b.eligibility.blockingReasons.length));
  assert(b.eligibility.summary.includes("غير مؤهل"), "B: الملخص يفسر الرفض", b.eligibility.summary);

  // الدرجات
  assert(a.fit !== null && a.fit.total === 73, "A: الملاءمة 73/100", a.fit ? String(a.fit.total) : "null");
  assert(a.fit !== null && a.fit.factors.length === 7, "A: سبعة عوامل ملاءمة");
  assert(a.reliability.total === 100 && a.reliability.level === "high", "A: الموثوقية 100/high", `${a.reliability.total}/${a.reliability.level}`);
  assert(a.reliability.warningAr === undefined, "A: لا تحذير موثوقية للمستوى المرتفع");
  assert(b.fit === null, "B: الملاءمة null للحكم NOT_ELIGIBLE", b.fit === null ? "null" : String(b.fit.total));
  assert(b.reliability.total === 100 && b.reliability.level === "high", "B: الموثوقية 100/high", `${b.reliability.total}/${b.reliability.level}`);

  // عوائق التنفيذ (hasBankAccount=false → ملاحظة لا تغيّر الحكم)
  assert(
    a.eligibility.executionNotes.length === 1 && a.eligibility.executionNotes[0].includes("طريقة صرف"),
    "A: ملاحظة تنفيذ واحدة (بلا حساب بنكي)",
    JSON.stringify(a.eligibility.executionNotes)
  );

  console.log("— 2) الترتيب —");
  const idxA = matches.findIndex((m) => m.opportunity?.id === ids.oppAId);
  const idxB = matches.findIndex((m) => m.opportunity?.id === ids.oppBId);
  assert(idxA >= 0 && idxB >= 0 && idxA < idxB, "A (مؤهلة) قبل B (غير مؤهلة)", `${idxA} مقابل ${idxB}`);
  assert(orderingOk(matches), "خاصية الترتيب العامة: NOT_ELIGIBLE أخيرًا + الملاءمة تنازليًّا + كسر تعادل حتمي");
  const reranked = rankMatches(matches);
  assert(JSON.stringify(reranked) === JSON.stringify(matches), "rankMatches مستقرة/حتمية (إعادة الترتيب لا تغيّر شيئًا)");

  console.log("— 3) صيغة الرد المختصرة —");
  const aResp = toMatchResponse(a);
  const aOpp = aResp.opportunity;
  assert(
    aOpp.id === ids.oppAId && aOpp.title === A_TITLE && aOpp.orgName === "مؤسسة الفحص الزراعية" &&
      aOpp.type === "grant" && aOpp.amounts.min === 10000 && aOpp.amounts.max === 100000 &&
      aOpp.amounts.currency === "USD" && JSON.stringify(aOpp.sectors) === JSON.stringify(["agritech", "food"]) &&
      aOpp.geography === "local" && aOpp.deadline === new Date(NOW.getTime() + 60 * DAY).toISOString() &&
      aOpp.verifiedAt === new Date(NOW.getTime() - 5 * DAY).toISOString() &&
      aOpp.applicationUrl === A_URL && aOpp.currentVersion === 2,
    "A: الفرصة المختصرة (id/title/orgName/type/amounts/sectors/geography/deadline/verifiedAt/applicationUrl/currentVersion)"
  );
  assert(aResp.judgment === "ELIGIBLE" && Array.isArray(aResp.blockingReasons) && Array.isArray(aResp.uncertainReasons), "A: شكل الرد العام");
  assert(aResp.conditions.length === 3, "A: ثلاثة شروط مختصرة", String(aResp.conditions.length));
  const aCond1 = aResp.conditions.find((c) => c.field === "founder.region");
  assert(
    !!aCond1 && aCond1.op === "in" && aCond1.mandatory === true && aCond1.status === "SATISFIED" &&
      aCond1.evidenceState === "ok" && aCond1.evidence?.url === A_URL &&
      aCond1.evidence?.quote === "متاحة للمقيمين في الضفة الغربية والقدس الشرقية" &&
      aCond1.evidence?.verifiedAt === new Date(NOW.getTime() - 5 * DAY).toISOString() &&
      aCond1.expected.length > 0 && aCond1.actual.length > 0 && aCond1.sourceWording !== undefined,
    "A: شرط المنطقة (SATISFIED/ok بدليل كامل)"
  );
  assert(aResp.fit !== null && aResp.fit.total === 73 && aResp.fit.factors.length === 7, "A: fit { total, factors[] }");
  assert(aResp.reliability.total === 100 && aResp.reliability.level === "high" && !("warningAr" in aResp.reliability), "A: reliability { total, level }");

  const bResp = toMatchResponse(b);
  assert(bResp.judgment === "NOT_ELIGIBLE" && bResp.fit === null, "B: الحكم وfit null");
  const bCond1 = bResp.conditions.find((c) => c.field === "founder.region");
  assert(
    !!bCond1 && bCond1.status === "NOT_SATISFIED" && bCond1.evidenceState === "ok" && !!bCond1.evidence,
    "B: الشرط الإلزامي المخالف بدليل ok (يرفض مؤكدًا)"
  );
  const bCond2 = bResp.conditions.find((c) => c.field === "company.teamSize");
  assert(
    !!bCond2 && bCond2.status === "UNRESOLVED" && bCond2.unresolvedReason === "MISSING_PROFILE_DATA" &&
      bCond2.mandatory === false,
    "B: الشرط غير الإلزامي الناقص UNRESOLVED/MISSING_PROFILE_DATA (لا يمنع)"
  );

  console.log("— 4) «ماذا لو» في الذاكرة فقط —");
  // (أ) founderOverrides → قلب الحكمين
  const wi1 = await buildMatchesForWhatIf(
    profileId as string,
    { founderOverrides: [{ region: "diaspora", isPrimary: true }] },
    NOW
  );
  const wi1A = wi1.find((m) => m.opportunity?.id === ids.oppAId);
  const wi1B = wi1.find((m) => m.opportunity?.id === ids.oppBId);
  assert(!!wi1A && wi1A.eligibility.judgment === "NOT_ELIGIBLE" && wi1A.fit === null, "ماذا لو: A تصبح NOT_ELIGIBLE");
  assert(
    !!wi1B && wi1B.eligibility.judgment === "ELIGIBLE" && wi1B.fit !== null && wi1B.fit.total === 65,
    "ماذا لو: B تصبح ELIGIBLE بملاءمة 65",
    wi1B?.fit ? String(wi1B.fit.total) : "null"
  );
  const changed1 = diffJudgments(matches, wi1);
  const chA = changed1.find((c) => c.opportunityId === ids.oppAId);
  const chB = changed1.find((c) => c.opportunityId === ids.oppBId);
  assert(
    !!chA && chA.title === A_TITLE && chA.oldJudgment === "ELIGIBLE" && chA.newJudgment === "NOT_ELIGIBLE",
    "changed: A (ELIGIBLE → NOT_ELIGIBLE) بالحكمين والاسم"
  );
  assert(
    !!chB && chB.title === B_TITLE && chB.oldJudgment === "NOT_ELIGIBLE" && chB.newJudgment === "ELIGIBLE",
    "changed: B (NOT_ELIGIBLE → ELIGIBLE) بالحكمين والاسم"
  );
  assert(changed1.every((c) => c.oldJudgment !== c.newJudgment), "changed: كل العناصر تغيّر حكمها فعلًا");

  // (ب) استبدال حقول في الذاكرة: المبلغ يغيّر الملاءمة بلا تغيير حكم
  const wi2 = await buildMatchesForWhatIf(
    profileId as string,
    { fields: [
      { field: "company.askAmountUSD", value: 200000 },
      { field: "company.teamSize", value: 5 },
    ] },
    NOW
  );
  const wi2A = wi2.find((m) => m.opportunity?.id === ids.oppAId);
  const wi2B = wi2.find((m) => m.opportunity?.id === ids.oppBId);
  assert(
    !!wi2A && wi2A.eligibility.judgment === "ELIGIBLE" && wi2A.fit !== null && wi2A.fit.total === 59,
    "ماذا لو: استبدال المبلغ → الملاءمة 59 (عامل التمويل 6 بدل 20)",
    wi2A?.fit ? String(wi2A.fit.total) : "null"
  );
  assert(!!wi2B && wi2B.eligibility.judgment === "NOT_ELIGIBLE", "ماذا لو: B يبقى NOT_ELIGIBLE");
  const wi2Bteam = wi2B?.eligibility.conditions.find((c) => c.field === "company.teamSize");
  assert(
    !!wi2Bteam && wi2Bteam.status === "SATISFIED",
    "ماذا لو: teamSize=5 استُبدل في الذاكرة فاستُوفي الشرط غير الإلزامي",
    wi2Bteam?.status
  );
  const changed2 = diffJudgments(matches, wi2);
  assert(
    !changed2.some((c) => c.opportunityId === ids.oppAId || c.opportunityId === ids.oppBId),
    "ماذا لو: لا تغيّر حكم لـ A/B عند تغيير قيم لا تمس شروطهما الإلزامية"
  );

  // (ج) لا كتابة في القاعدة ولا في السجلات
  const profileAfter = await prisma.startupProfile.findUnique({ where: { id: profileId as string } });
  assert(profileAfter !== null && profileAfter.fieldsJson === FIELDS_JSON, "ماذا لو: fieldsJson لم يُمسّ (لا حفظ)");
  assert(
    (await prisma.auditLog.count({ where: { userId: userId as string } })) === 0,
    "ماذا لو: لا سجل تدقيق"
  );
  assert((await prisma.session.count({ where: { userId: userId as string } })) === 0, "ماذا لو: لا جلسات");
  assert((await prisma.notification.count({ where: { userId: userId as string } })) === 0, "ماذا لو: لا إشعارات");
  assert((await prisma.aiRun.count({ where: { userId: userId as string } })) === 0, "ماذا لو: لا استدعاءات نموذج");
  assert(
    (await prisma.condition.count({ where: { opportunityId: { in: [ids.oppAId, ids.oppBId] } } })) === 5,
    "ماذا لو: لم تُضف شروط ولا عدّلت"
  );

  console.log("— 5) ملف غير موجود —");
  let thrown: unknown = null;
  try {
    await buildMatchesForProfile("t11-nonexistent-profile");
  } catch (e) {
    thrown = e;
  }
  assert(
    thrown instanceof ApiErrorClass && thrown.code === "NO_PROFILE" && thrown.status === 404,
    "NO_PROFILE برسالة عربية لملف غير موجود"
  );

  console.log("— 6) الفحص السريع للزوار (بلا حفظ) —");
  const answers = {
    region: "west_bank" as const,
    registrationCountry: "ps" as const,
    legalStatus: "registered_local" as const,
    sectors: ["agritech"] as string[],
    stage: "prototype" as const,
    askAmountUSD: 50000,
    languages: ["ar" as const, "en" as const],
  };
  const qsnap = quickProfileFromAnswers(answers);
  const quickAll = await buildMatchesForSnapshot(qsnap, NOW);
  const qA = quickAll.find((m) => m.opportunity?.id === ids.oppAId);
  const qB = quickAll.find((m) => m.opportunity?.id === ids.oppBId);
  assert(
    !!qA && qA.eligibility.judgment === "ELIGIBLE" && qA.eligibility.uncertainReasons.length === 0 &&
      qA.fit !== null && qA.fit.total === 68,
    "الفحص السريع: A مؤهلة بملاءمة 68 (بلا مستندات معلنة → عامل المستندات 0)",
    qA?.fit ? String(qA.fit.total) : "null"
  );
  assert(!!qB && qB.eligibility.judgment === "NOT_ELIGIBLE" && qB.fit === null, "الفحص السريع: B غير مؤهلة");
  assert(orderingOk(quickAll), "الفحص السريع: نفس خاصية الترتيب");
  const limited = rankMatches(quickAll).slice(0, 15).map(toQuickMatchResponse);
  assert(limited.length <= 15, "الفحص السريع: الحد 15 فرصة", String(limited.length));
  const qResp = limited.find((m) => m.opportunity.id === ids.oppAId);
  assert(
    !!qResp && qResp.judgment === "ELIGIBLE" && qResp.fit !== null && qResp.fit.total === 68 &&
      Array.isArray(qResp.uncertainReasons) && typeof qResp.summary === "string" &&
      !("conditions" in qResp) && !("reliability" in qResp) && !("blockingReasons" in qResp),
    "الفحص السريع: الشكل المختصر (opportunity/judgment/summary/uncertainReasons/fit فقط)"
  );
  // الإجابات لا تُخزَّن أبدًا: لا صفوف جديدة لأي جدول يخص الزائر
  assert(
    (await prisma.startupProfile.count()) === (await prisma.startupProfile.count({ where: { id: profileId as string } })),
    "الفحص السريع: لم يُنشأ أي ملف للزائر"
  );

  console.log("— 7) الحتمية —");
  const again = await buildMatchesForProfile(profileId as string, NOW);
  assert(JSON.stringify(again) === JSON.stringify(matches), "نفس المدخلات ⇒ نفس المخرجات (الملف)");
  const quickAgain = await buildMatchesForSnapshot(qsnap, NOW);
  assert(JSON.stringify(quickAgain) === JSON.stringify(quickAll), "نفس المدخلات ⇒ نفس المخرجات (الفحص السريع)");
  const wi1Again = await buildMatchesForWhatIf(
    profileId as string,
    { founderOverrides: [{ region: "diaspora", isPrimary: true }] },
    NOW
  );
  assert(JSON.stringify(wi1Again) === JSON.stringify(wi1), "نفس المدخلات ⇒ نفس المخرجات (ماذا لو)");
}

// ————— التشغيل —————

async function main(): Promise<void> {
  console.log("بدء التحقق الذاتي لمطابقات T11 (NOW ثابتة: 2026-06-15T12:00:00Z)…");
  await preClean();
  let ids: { oppAId: string; oppBId: string } | null = null;
  try {
    ids = await seed();
    await runChecks(ids);
  } catch (e) {
    failures += 1;
    console.error("  ✗ خطأ غير متوقع أثناء التشغيل:", e);
  } finally {
    const cleaned = await cleanup();
    assert(cleaned, "التنظيف: أُزيلت كل البيانات الوهمية (deleteMany)");
  }
  console.log(`النتيجة: ${checks - failures}/${checks} فحوص ناجحة`);
  if (failures > 0) {
    console.error(`فشلت ${failures} فحوص — MATCHES CHECK FAILED`);
    process.exitCode = 1;
    return;
  }
  console.log("MATCHES CHECK PASSED");
}

main()
  .catch((e) => {
    console.error("خطأ قاتل:", e);
    process.exitCode = 1;
  })
  .finally(() => {
    return prisma.$disconnect();
  });
