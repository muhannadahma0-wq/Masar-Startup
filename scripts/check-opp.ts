/**
 * Masar — T10 تحقق ذاتي: منطق الفرص النقي + loadRuleConditions على القاعدة
 * =============================================================================
 * تشغيل: bun scripts/check-opp.ts  (من جذر المشروع)
 * يطبع «OPP CHECK PASSED» عند نجاح كل الفحوص، ويخرج برمز 1 عند أي فشل.
 *
 * النطاق (نص المهمة): اختبار منطقي نقي فقط —
 *  - بنية loadRuleConditions على فرصة تُنشأ عبر prisma داخل السكربت (إنشاء →
 *    تحميل → تنظيف كامل بعده).
 *  - تصنيف changeType بدالة مساعدة (classifyChange) وبناء الفرق (buildOppDiff)
 *    وتوقيع الشروط الإلزامية (mandatoryConditionsChanged) والتلخيص العربي
 *    ومؤشر الموثوقية الحي (reliabilityForOpp).
 * مسارات HTTP يتحقق منها المنسّق لاحقًا (لا fetch هنا).
 * لا يستورد notify (ملف T14) — هذا فحص منطق T10 فقط.
 */
import { prisma } from "../src/lib/server/api";
import {
  loadRuleConditions,
  reliabilityForOpp,
  buildOppDiff,
  classifyChange,
  mandatoryConditionsChanged,
  summarizeDiffAr,
  summarizeConditionsAr,
  conditionsDiffEntry,
  type OpportunityScalarSnapshot,
  type ConditionBrief,
} from "../src/lib/server/conditions";
import type { OpportunityChange, ReliabilityResult } from "../src/lib/core/types";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

function makeSnap(o: Partial<OpportunityScalarSnapshot> = {}): OpportunityScalarSnapshot {
  return {
    title: "برنامج منح الزراعة الذكية",
    orgName: "مؤسسة الأفق لتمويل المشاريع",
    description: "وصف",
    type: "grant",
    fundingType: null,
    amountMin: null,
    amountMax: null,
    currency: "USD",
    sectors: ["agritech"],
    stageMin: null,
    stageMax: null,
    geography: "local",
    geoPriority: false,
    languages: ["ar"],
    applicationUrl: "https://example.com/apply",
    sourceType: "official",
    deadline: new Date("2026-09-01T00:00:00.000Z"),
    deadlineTz: "Asia/Hebron",
    requiresDocs: [],
    ...o,
  };
}

const d = (entry: { field: string; oldValue?: unknown; newValue?: unknown }): OpportunityChange => ({
  field: entry.field,
  oldValue: entry.oldValue ?? null,
  newValue: entry.newValue ?? null,
});

const brief = (o: Partial<ConditionBrief> = {}): ConditionBrief => ({
  field: "company.sectors",
  op: "in",
  value: ["agritech"],
  mandatory: true,
  scope: "any",
  ambiguous: false,
  ...o,
});

async function testLoadRuleConditions(): Promise<void> {
  console.log("— القسم F: loadRuleConditions على القاعدة (إنشاء → تحميل → تنظيف)");
  const stamp = Date.now();
  const url = `https://t10-check-${stamp}.example/opp`;
  const evidenceDate = new Date("2026-05-10T12:00:00.000Z");

  let oppId = "";
  let evidenceIds: string[] = [];
  try {
    const opp = await prisma.opportunity.create({
      data: {
        title: `فرصة تحقق T10 ${stamp}`,
        orgName: "جهة التحقق",
        description: "",
        status: "DRAFT",
        applicationUrl: url,
        normalizedUrl: url,
        conditions: {
          create: [
            {
              field: "company.sectors",
              op: "in",
              valueJson: JSON.stringify(["agritech", "fintech"]),
              mandatory: true,
              ambiguous: false,
              scope: "any",
              evidence: {
                create: { url: `https://t10-check-${stamp}.example/e1`, quote: "القطاعات المشمولة: الزراعة والتقنية المالية", verifiedAt: evidenceDate },
              },
            },
            {
              field: "founder.region",
              op: "eq",
              valueJson: JSON.stringify("west_bank"),
              mandatory: false,
              ambiguous: true,
              scope: "all",
              sourceWording: "«سكان القدس ومحافظاتها» — صياغة غير محددة",
            },
            {
              field: "company.ageMonths",
              op: "gte",
              valueJson: "{not-valid-json",
              mandatory: true,
              ambiguous: false,
              scope: "any",
            },
          ],
        },
      },
    });
    oppId = opp.id;
    const rows = await prisma.condition.findMany({ where: { opportunityId: oppId }, select: { evidenceId: true } });
    evidenceIds = rows.map((r) => r.evidenceId).filter((x): x is string => x !== null);

    const conds = await loadRuleConditions(oppId);
    check("عدد الشروط = 3", conds.length === 3, conds.length);

    // البحث بالحقل (لا نفترض ترتيب الإدراج)
    const c0 = conds.find((c) => c.field === "company.sectors");
    check("c0 field/op", c0?.op === "in");
    check("c0 value محلول JSON (مصفوفة)", JSON.stringify(c0?.value) === JSON.stringify(["agritech", "fintech"]), c0?.value);
    check("c0 mandatory=true وscope=any", c0?.mandatory === true && c0?.scope === "any");
    check(
      "c0 evidence → { url, quote, verifiedAt: ISO }",
      c0?.evidence?.url === `https://t10-check-${stamp}.example/e1` &&
        c0?.evidence?.quote === "القطاعات المشمولة: الزراعة والتقنية المالية" &&
        c0?.evidence?.verifiedAt === evidenceDate.toISOString(),
      c0?.evidence
    );
    check("c0 id من القاعدة", typeof c0?.id === "string" && (c0?.id ?? "").length > 0);

    const c1 = conds.find((c) => c.field === "founder.region");
    check("c1 غير إلزامي وscope=all", c1?.mandatory === false && c1?.scope === "all");
    check("c1 ambiguous=true", c1?.ambiguous === true);
    check("c1 sourceWording كما ورد", c1?.sourceWording === "«سكان القدس ومحافظاتها» — صياغة غير محددة", c1?.sourceWording);
    check("c1 بلا دليل → evidence=null", c1?.evidence === null || c1?.evidence === undefined, c1?.evidence);

    const c2 = conds.find((c) => c.field === "company.ageMonths");
    check("c2 valueJson غير القابل للتحليل → null (لا تخمين)", c2?.value === null, c2?.value);

    check("معرف فارغ → []", (await loadRuleConditions("")).length === 0);
    check("معرف غير موجود → []", (await loadRuleConditions(`no-such-${stamp}`)).length === 0);

    // مؤشر الموثوقية الحي على بيانات القاعدة نفسها (official + دليل 1/2 إلزامي)
    const oppRow = await prisma.opportunity.findUnique({ where: { id: oppId }, include: { conditions: { include: { evidence: true } } } });
    const rel = reliabilityForOpp(
      { sourceType: oppRow?.sourceType ?? "official", verifiedAt: oppRow?.verifiedAt ?? null, linkCheckState: oppRow?.linkCheckState ?? "ok" },
      oppRow?.conditions ?? []
    );
    check(
      "reliability من القاعدة: 40 (رسمي) + 0 (لا verifiedAt) + 12.5 (أدلة 1/2) + 10 (رابط) → 63 medium",
      rel.total === 63 && rel.level === "medium",
      rel
    );
  } finally {
    if (oppId) {
      await prisma.opportunity.delete({ where: { id: oppId } }); // يحذف الشروط تتابعيًا
    }
    if (evidenceIds.length > 0) {
      await prisma.evidence.deleteMany({ where: { id: { in: evidenceIds } } });
    }
    const leftover = await prisma.opportunity.count({ where: { title: { contains: `فرصة تحقق T10 ${stamp}` } } });
    check("تنظيف كامل (لا بقايا)", leftover === 0, leftover);
  }
}

async function main(): Promise<void> {
  // ————— القسم A: تصنيف changeType —————
  console.log("— القسم A: classifyChange (جوهري/غير جوهري + الفئة)");
  check("فرق فارغ → non_substantive بلا فئة", classifyChange([]).changeType === "non_substantive" && classifyChange([]).changeCategory === null);
  check("العنوان فقط → non_substantive/other", classifyChange([d({ field: "title", oldValue: "أ", newValue: "ب" })]).changeType === "non_substantive" && classifyChange([d({ field: "title" })]).changeCategory === "other");
  check("الموعد → substantive/deadline", classifyChange([d({ field: "deadline" })]).changeType === "substantive" && classifyChange([d({ field: "deadline" })]).changeCategory === "deadline");
  check("amountMin → substantive/amount", classifyChange([d({ field: "amountMin", oldValue: 0, newValue: 5000 })]).changeCategory === "amount");
  check("amountMax → substantive/amount", classifyChange([d({ field: "amountMax" })]).changeCategory === "amount");
  check("currency → substantive/amount", classifyChange([d({ field: "currency", oldValue: "USD", newValue: "EUR" })]).changeCategory === "amount");
  check("fundingType → substantive/amount", classifyChange([d({ field: "fundingType", oldValue: null, newValue: "equity" })]).changeCategory === "amount");
  check("requiresDocs → substantive/documents", classifyChange([d({ field: "requiresDocs", oldValue: [], newValue: ["pitch_deck"] })]).changeCategory === "documents");
  check("status → substantive/status", classifyChange([d({ field: "status", oldValue: "PUBLISHED", newValue: "ARCHIVED" })]).changeCategory === "status");
  const condEntry = conditionsDiffEntry([brief(), brief({ mandatory: false })], [brief({ value: ["fintech"] })]);
  check("شروط (افتراضي: إلزامية تغيّرت) → substantive/conditions", classifyChange([condEntry]).changeType === "substantive" && classifyChange([condEntry]).changeCategory === "conditions");
  const condOnlyNonMandatory = conditionsDiffEntry([brief({ mandatory: false })], [brief({ mandatory: false, field: "company.languages" })]);
  check(
    "شروط غير إلزامية فقط + mandatoryConditionsChanged=false → non_substantive/conditions",
    classifyChange([condOnlyNonMandatory], { mandatoryConditionsChanged: false }).changeType === "non_substantive" &&
      classifyChange([condOnlyNonMandatory], { mandatoryConditionsChanged: false }).changeCategory === "conditions"
  );
  check(
    "أولوية الفئات: deadline يتفوق على amount/documents/other",
    classifyChange([d({ field: "amountMax" }), d({ field: "deadline" }), d({ field: "title" })]).changeCategory === "deadline"
  );
  check(
    "أولوية الفئات: conditions قبل amount",
    classifyChange([d({ field: "amountMin" }), condEntry]).changeCategory === "conditions"
  );
  check(
    "mix جوهري: موعد + عنوان → substantive (الفئة deadline)",
    classifyChange([d({ field: "deadline" }), d({ field: "title" })]).changeType === "substantive"
  );

  // ————— القسم B: بناء الفرق —————
  console.log("— القسم B: buildOppDiff");
  check("لا تغييرات → فرق فارغ", buildOppDiff(makeSnap(), makeSnap()).length === 0);
  const diffDl = buildOppDiff(makeSnap(), makeSnap({ deadline: new Date("2026-10-15T00:00:00.000Z") }));
  check("تغيير الموعد → مدخل واحد بقيم ISO", diffDl.length === 1 && diffDl[0]?.field === "deadline" && diffDl[0]?.oldValue === "2026-09-01T00:00:00.000Z" && diffDl[0]?.newValue === "2026-10-15T00:00:00.000Z", diffDl);
  const diffSectors = buildOppDiff(makeSnap(), makeSnap({ sectors: ["agritech", "water"] }));
  check("تغيير القطاعات → مدخل بمصفوفتين", diffSectors.length === 1 && JSON.stringify(diffSectors[0]?.oldValue) === '["agritech"]' && JSON.stringify(diffSectors[0]?.newValue) === '["agritech","water"]', diffSectors);
  const diffFunding = buildOppDiff(makeSnap(), makeSnap({ fundingType: "equity" }));
  check("null → equity → مدخل", diffFunding.length === 1 && diffFunding[0]?.oldValue === null && diffFunding[0]?.newValue === "equity", diffFunding);
  const diffDocs = buildOppDiff(makeSnap(), makeSnap({ requiresDocs: ["pitch_deck", "founder_id"] }));
  check("تغيير requiresDocs → مدخل", diffDocs.length === 1 && diffDocs[0]?.field === "requiresDocs");
  const diffMulti = buildOppDiff(makeSnap(), makeSnap({ title: "عنوان جديد", amountMax: 250000 }));
  check("تغييران (عنوان+مبلغ) → مدخلان", diffMulti.length === 2 && new Set(diffMulti.map((x) => x.field)).size === 2, diffMulti);

  // ————— القسم C: توقيع الشروط الإلزامية —————
  console.log("— القسم C: mandatoryConditionsChanged");
  check("نفس المجموعة → false", mandatoryConditionsChanged([brief()], [brief()]) === false);
  check(
    "إعادة ترتيب → false (التوقيع مرتّب)",
    mandatoryConditionsChanged([brief(), brief({ field: "founder.region", op: "eq", value: "west_bank" })], [brief({ field: "founder.region", op: "eq", value: "west_bank" }), brief()]) === false
  );
  check("تغيّر قيمة شرط إلزامي → true", mandatoryConditionsChanged([brief()], [brief({ value: ["fintech"] })]) === true);
  check("إضافة شرط إلزامي → true", mandatoryConditionsChanged([brief()], [brief(), brief({ field: "company.stage", op: "eq", value: "prototype" })]) === true);
  check("حذف شرط إلزامي → true", mandatoryConditionsChanged([brief(), brief({ field: "company.stage", op: "eq", value: "prototype" })], [brief()]) === true);
  check("تغيير إلزامية فقط (mandatory true→false) → true", mandatoryConditionsChanged([brief()], [brief({ mandatory: false })]) === true);
  check("تغيير شرط غير إلزامي فقط → false", mandatoryConditionsChanged([brief({ mandatory: false })], [brief({ mandatory: false, value: ["water"] })]) === false);
  check("مجموعتان فارغتان → false", mandatoryConditionsChanged([], []) === false);

  // ————— القسم D: التلخيص العربي —————
  console.log("— القسم D: summarizeDiffAr / summarizeConditionsAr");
  const s1 = summarizeDiffAr([d({ field: "deadline", oldValue: "2026-09-01T00:00:00.000Z", newValue: "2026-10-15T00:00:00.000Z" })]);
  check("الملخص يذكر الحقل العربية والقيم", s1.includes("الموعد النهائي") && s1.includes("2026-09-01") && s1.includes("2026-10-15"), s1);
  const s2 = summarizeDiffAr([d({ field: "geoPriority", oldValue: false, newValue: true })]);
  check("الملخص يعرّب البولياني", s2.includes("لا") && s2.includes("نعم"), s2);
  const s3 = summarizeDiffAr([d({ field: "sectors", oldValue: ["agritech"], newValue: [] })]);
  check("مصفوفة فارغة → «بلا قيمة»", s3.includes("بلا قيمة"), s3);
  const longDiff: OpportunityChange[] = Array.from({ length: 30 }, (_, i) => d({ field: "title", oldValue: `قيمة قديمة طويلة رقم ${i}`, newValue: `قيمة جديدة طويلة جدًّا رقم ${i}` }));
  check("سقف طول الملخص 600", summarizeDiffAr(longDiff).length <= 600, summarizeDiffAr(longDiff).length);
  const condSummary = summarizeConditionsAr([brief(), brief({ mandatory: false, field: "company.languages" })]);
  check("موجز الشروط: العدد والإلزامية والقائمة", condSummary.includes("2 شروط (1 إلزامية)") && condSummary.includes("company.sectors in (إلزامي)") && condSummary.includes("company.languages in"), condSummary);
  const condEntry2 = conditionsDiffEntry([brief(), brief()], [brief({ value: ["water"] })]);
  check("مدخل فرق الشروط بصيغة قديمة/جديدة", condEntry2.field === "conditions" && String(condEntry2.oldValue).includes("2 شروط") && String(condEntry2.newValue).includes("1 شروط"), condEntry2);

  // ————— القسم E: الموثوقية الحية —————
  console.log("— القسم E: reliabilityForOpp (حساب حي)");
  const now = new Date("2026-06-01T00:00:00.000Z");
  const full = reliabilityForOpp(
    { sourceType: "official", verifiedAt: now, linkCheckState: "ok" },
    [
      { mandatory: true, evidence: { url: "https://a.example", quote: "اقتباس" } },
      { mandatory: true, evidence: { url: "https://b.example", quote: "اقتباس" } },
      { mandatory: false, evidence: null },
    ],
    now
  );
  const fullOk: ReliabilityResult = full;
  check("رسمي+حديث+أدلة كاملة+رابط سليم = 100 high بلا تحذير", fullOk.total === 100 && fullOk.level === "high" && fullOk.warningAr === undefined, fullOk);
  check("أربع إشارات", fullOk.signals.length === 4, fullOk.signals?.length);
  const stale = reliabilityForOpp(
    { sourceType: "other", verifiedAt: new Date("2025-06-01T00:00:00.000Z"), linkCheckState: "fail_twice" },
    [
      { mandatory: true, evidence: null },
      { mandatory: true, evidence: { url: "", quote: "" } },
    ],
    now
  );
  check("غير رسمي+قديم+بلا أدلة+رابط فاشل = 0 low مع تحذير", stale.total === 0 && stale.level === "low" && stale.warningAr !== undefined, stale);
  const partial = reliabilityForOpp(
    { sourceType: "trusted_aggregator", verifiedAt: now, linkCheckState: "fail_once" },
    [
      { mandatory: true, evidence: { url: "https://a.example", quote: "اقتباس" } },
      { mandatory: true, evidence: null },
    ],
    now
  );
  check("وسيط موثوق + أدلة 1/2 + fail_once = 20+25+12.5+5 → 63 medium", partial.total === 63 && partial.level === "medium", partial);
  const weird = reliabilityForOpp({ sourceType: "weird", verifiedAt: null, linkCheckState: "weird" }, [], now);
  check("قيم enum غريبة: غير رسمي 0 + لا تاريخ 0 + لا شروط 25 + رابط مجهول 0 = 25 low مع تحذير", weird.total === 25 && weird.level === "low" && weird.warningAr !== undefined, weird);

  // ————— القسم F: القاعدة —————
  await testLoadRuleConditions();

  console.log(`\nالنتيجة: ${passed} ناجح، ${failed} فاشل`);
  if (failed > 0) {
    console.error("OPP CHECK FAILED");
    process.exitCode = 1;
  } else {
    console.log("OPP CHECK PASSED");
  }
}

main()
  .catch((e) => {
    console.error("OPP CHECK FAILED (استثناء):", e);
    process.exitCode = 1;
  })
  .finally(() => {
    prisma.$disconnect().catch(() => undefined);
  });
