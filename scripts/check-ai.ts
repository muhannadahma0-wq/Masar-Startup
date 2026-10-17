/**
 * Masar — التحقق الذاتي لحزمة الذكاء T6 (bun scripts/check-ai.ts)
 * =====================================================
 * يشغّل مسار الطوارئ فقط (mock-replay) — بلا SDK — للتحقق الحتمي من:
 *   1) extractDeckFields: كل حقل مُعاد باقتباس حرفي وpage صالح، والحقول غير الموجودة null.
 *   2) تطبيق Citation Guard: الحقل الفاشل dropped + value=null + سبب عربي، والدمج بأول مارّة.
 *   3) generateSuggestion: الحارس يمر، لا أرقام جديدة، والأرقام الأصلية محفوظة حرفيًّا.
 *   4) ssrfGuard: العناوين الداخلية مرفوضة وhttps://example.org مسموح.
 *   5) draftOpportunityFromPage: مسودة mock باقتباسات حرفية.
 *   6) runLlm يسجل AiRun بلا أي نص خام (فحص الكناري).
 */
process.env.MASAR_AI_FORCE_FALLBACK = "1"; // مسار الطوارئ فقط — تخطَّ SDK (لن يعمل داخل سكربت عادي إن كان يحتاج بيئة Next)

import { extractDeckFields, applyCitationGuardAndMerge } from "@/lib/ai/extract";
import { generateSuggestion } from "@/lib/ai/suggest";
import { draftOpportunityFromPage, ssrfGuard } from "@/lib/ai/draft";
import { runLlm } from "@/lib/ai/adapter";
import { prisma } from "@/lib/server/api";
import type { Slide } from "@/lib/core/types";

let failures = 0;
let checks = 0;

function assert(cond: boolean, label: string, extra?: string): void {
  checks += 1;
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

// ————— أدوات تحقق مستقلة عن كود الحزمة (لا تستورد منطقها) —————

function toWesternDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}

const MULTIPLIERS: Record<string, number> = {
  k: 1e3, m: 1e6, b: 1e9, "ألف": 1e3, "آلاف": 1e3, "الف": 1e3, "مليون": 1e6, "مليار": 1e9,
};

function numericValues(text: string): number[] {
  const norm = toWesternDigits(text.toLowerCase());
  const out: number[] = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(k|m|b|ألف|آلاف|الف|مليون|مليار)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (isFinite(n)) out.push(n * (m[2] ? MULTIPLIERS[m[2].toLowerCase()] ?? 1 : 1));
  }
  return out;
}

function sentenceCount(text: string): number {
  return (text.match(/[^.!؟?\n]+/g) ?? []).filter((p) => p.trim().length > 0).length;
}

// ————— البيانات التجريبية: شرائح عربية/إنجليزية بأرقام (وأرقام هندية) —————

const SLIDES: Slide[] = [
  {
    index: 1,
    title: "الزراعة الذكية — نظرة عامة",
    text: "شركة نبتة تقدم منصة ري ذكية للمزارع. نسعى لجمع تمويل بقيمة $500,000 لتوسيع عملياتنا. يخدم المنصة ٥٠٠٠ مستخدم نشط. حققنا نموًّا بنسبة 40% في الاشتراكات الشهرية. فريقنا يتكون من 8 مؤسسين ومهندسين.",
  },
  {
    index: 2,
    title: "Traction and Ask",
    text: "Smart AgriTech platform with 30% monthly revenue growth. MRR reached $12,000. We are raising $250K in seed funding. 3,500 paying users. Team of 6 engineers. Revenue stage with working prototype.",
  },
  {
    index: 3,
    title: "الرؤية",
    text: "نؤمن بعالم تزرع فيه المدن غذاءها. شكرًا لاهتمامكم.",
  },
];

async function checkExtraction(): Promise<void> {
  console.log("\n[1] extractDeckFields — مسار الطوارئ (محلل regex حتمي)");
  const { fields, provider, model } = await extractDeckFields(SLIDES, ["company.askAmountUSD", "company.stage"]);

  assert(provider === "mock-replay" && model.length > 0, "المزوّد = mock-replay");

  // كل حقل مُعاد: اقتباس حرفي + صفحة صالحة
  for (const f of fields) {
    if (f.status === "pending") {
      const slide = SLIDES.find((s) => s.index === f.page);
      assert(
        !!slide,
        `صفحة صالحة للحقل ${f.key} (page=${f.page})`
      );
      assert(
        !!slide && (slide.text.includes(f.quote) || slide.title.includes(f.quote)),
        `اقتباس حرفي للحقل ${f.key}`
      );
      assert(f.value !== null && f.value !== undefined, `قيمة غير فارغة للحقل ${f.key}`);
    } else {
      assert(f.value === null, `حقل مسقط ${f.key} قيمته null`);
      assert(!!f.droppedReason && f.droppedReason.length > 3, `سبب إسقاط عربي للحقل ${f.key}`);
    }
  }

  const pending = fields.filter((f) => f.status === "pending");
  assert(pending.length >= 6, `عدد الحقول المستخرجة ≥ 6 (فعلي: ${pending.length})`);

  const byKey = (k: string) => pending.find((f) => f.key === k);
  assert(byKey("company.askAmountUSD")?.value === 500000, "طلب التمويل = 500000$");
  assert(byKey("company.monthlyRevenueUSD")?.value === 12000, "الإيراد الشهري = 12000$");
  assert(byKey("company.tractionUsers")?.value === 5000, "المستخدمون = 5000 (أرقام هندية ٥٠٠٠)");
  assert(byKey("company.teamSize")?.value === 8, "حجم الفريق = 8");
  assert(byKey("claim.growth")?.value === 40, "نسبة النمو = 40%");
  assert(byKey("company.stage")?.value === "early_revenue", "المرحلة = early_revenue");
  assert(
    Array.isArray(byKey("company.sectors")?.value) && (byKey("company.sectors")?.value as string[]).includes("agritech"),
    "القطاعات تتضمن agritech (ذكر حرفي)"
  );

  // الحقول غير الموجودة: لا قيمة غير null لأي حقل غائب (لا تخمين)
  const wl = fields.filter((f) => f.key === "company.womenLed");
  assert(wl.length === 0 || wl.every((f) => f.value === null), "الحقول غير الموجودة null (womenLed)");
  assert(!pending.some((f) => f.key === "company.name"), "لا اسم شركة من محلل الطوارئ (خارج نطاقه)");
  // الشريحة الثالثة بلا أرقام: لا حقول منها
  assert(!pending.some((f) => f.page === 3), "لا حقول من شريحة بلا بيانات قابلة للاستخراج");
}

async function checkCitationGuard(): Promise<void> {
  console.log("\n[2] تطبيق Citation Guard والدمج (أول واحدة تمرّ)");
  const guarded = await applyCitationGuardAndMerge(SLIDES, [
    { key: "company.teamSize", value: 99, page: 1, quote: "هذا الاقتباس ليس موجودًا في أي شريحة على الإطلاق" }, // مختلق
    { key: "company.teamSize", value: 8, page: 1, quote: "فريقنا يتكون من 8 مؤسسين ومهندسين." }, // صحيح
    { key: "company.womenLed", value: true, page: 99, quote: "نؤمن بعالم تزرع فيه المدن غذاءها." }, // صفحة خارج النطاق
    { key: "not.a.key", value: "x", page: 1, quote: "شركة نبتة تقدم منصة ري ذكية للمزارع." }, // مفتاح غير مسموح
  ]);

  const team = guarded.filter((f) => f.key === "company.teamSize");
  assert(team.length === 1 && team[0].status === "pending" && team[0].value === 8, "الدمج: أول نسخة مارّة تفوز (8 لا 99)");

  const women = guarded.find((f) => f.key === "company.womenLed");
  assert(
    !!women && women.status === "dropped" && women.value === null,
    "صفحة خارج النطاق → dropped وvalue=null"
  );
  assert(!!women && (women.droppedReason ?? "").includes("الاقتباس غير موجود"), "سبب الإسقاط: الاقتباس غير موجود في الشريحة");

  const unknown = guarded.find((f) => f.key === "not.a.key");
  assert(
    !!unknown && unknown.status === "dropped" && unknown.value === null && (unknown.droppedReason ?? "").includes("القائمة المسموحة"),
    "مفتاح خارج القائمة → dropped مع سبب"
  );
}

async function checkSuggestion(): Promise<void> {
  console.log("\n[3] generateSuggestion — مسار الطوارئ (إعادة صياغة قالبية)");
  const slide: Slide = {
    index: 4,
    title: "الفرصة",
    text: "نحن نسعى جاهدين لتقديم أفضل خدمة لعملائنا. نطلب تمويلًا بقيمة $500,000 لتوسيع التغطية. حققنا إيرادات شهرية تبلغ $12,000 ونموًّا بنسبة 40%. فريقنا المميز يعمل بلا كلل.",
  };
  const sg = await generateSuggestion(slide, ["ركّز على أرقام التمويل والإيرادات"], []);

  assert(sg.guard.passed === true, "حارس الاقتراح يمر");
  assert(sg.suggestedText.length > 0, "اقتراح غير فارغ");
  assert(sg.provider === "mock-replay", "المزوّد = mock-replay");

  const originalNums = numericValues(slide.text);
  const suggNums = numericValues(sg.suggestedText);
  const newNums = suggNums.filter((n) => !originalNums.includes(n));
  assert(newNums.length === 0, `لا أرقام جديدة في الاقتراح${newNums.length ? ` (جديدة: ${newNums.join(",")})` : ""}`);
  for (const n of [500000, 12000, 40]) {
    assert(suggNums.includes(n), `الرقم الأصلي محفوظ: ${n}`);
  }
  assert(sg.suggestedText.length <= 320, `الطول ≤ 320 حرفًا (فعلي: ${sg.suggestedText.length})`);
  assert(sentenceCount(sg.suggestedText) <= 3, `عدد الجمل ≤ 3 (فعلي: ${sentenceCount(sg.suggestedText)})`);
  assert(!/أفضل|الأفضل|ثوري/.test(sg.suggestedText), "صيغة التفوق الأصلية أُزيلت");
  assert(!/<[a-z][\s\S]*>/i.test(sg.suggestedText), "نص خام بلا HTML");
}

function checkSsrf(): void {
  console.log("\n[4] ssrfGuard");
  assert(ssrfGuard("http://127.0.0.1/x").allowed === false, "127.0.0.1 مرفوض");
  assert(ssrfGuard("http://10.0.0.1").allowed === false, "10.0.0.1 مرفوض");
  assert(ssrfGuard("https://example.org").allowed === true, "https://example.org مسموح");
  assert(ssrfGuard("http://192.168.1.5/admin").allowed === false, "192.168.* مرفوض");
  assert(ssrfGuard("http://172.16.0.5").allowed === false, "172.16.* مرفوض");
  assert(ssrfGuard("http://172.31.9.9").allowed === false, "172.31.* مرفوض");
  assert(ssrfGuard("http://172.32.1.1").allowed === true, "172.32.* (عام) مسموح");
  assert(ssrfGuard("http://169.254.169.254/latest/meta-data").allowed === false, "169.254.* (metadata) مرفوض");
  assert(ssrfGuard("http://localhost:3000/api").allowed === false, "localhost مرفوض");
  assert(ssrfGuard("https://api.service.internal/v1").allowed === false, "‎*.internal مرفوض");
  assert(ssrfGuard("http://db.cluster.local").allowed === false, "‎*.local مرفوض");
  assert(ssrfGuard("file:///etc/passwd").allowed === false, "file:// مرفوض");
  assert(ssrfGuard("ftp://example.org/file").allowed === false, "ftp:// مرفوض");
  assert(ssrfGuard("https://example.org:8080/app").allowed === false, "منفذ 8080 مرفوض");
  assert(ssrfGuard("https://example.org:443/app").allowed === true, "منفذ 443 مسموح");
  assert(ssrfGuard("http://example.org:80/app").allowed === true, "منفذ 80 مسموح");
  assert(ssrfGuard("http://[::1]/").allowed === false, "IPv6 ::1 مرفوض");
  assert(ssrfGuard("http://0.0.0.0/").allowed === false, "0.0.0.0 مرفوض");
  assert(ssrfGuard("http://[fe80::1]/").allowed === false, "IPv6 رابط محلي مرفوض");
  assert(ssrfGuard("https://" + "a".repeat(2100)).allowed === false, "رابط أطول من 2000 محرف مرفوض");
  assert(ssrfGuard("ليس رابطًا").allowed === false, "نص ليس رابطًا مرفوض");
}

async function checkDraft(): Promise<void> {
  console.log("\n[5] draftOpportunityFromPage — مسار الطوارئ");
  const pageText = [
    "برنامج انطلاقة للريادة",
    "مؤسسة الابتكار تقدم منحًا تصل إلى $500,000 للشركات الناشئة.",
    "آخر موعد للتقديم 2026-05-31.",
    "يستهدف البرنامج شركات agritech وfintech في مرحلة مبكرة.",
  ].join("\n");
  const dr = await draftOpportunityFromPage(pageText, "https://example.org/program");

  assert(dr.provider === "mock-replay", "المزوّد = mock-replay");
  const envelope = dr.draft as { needsManualFix?: boolean; data?: { sectors?: string[]; amountMax?: number; orgName?: string } };
  assert(envelope.needsManualFix === false, "مسودة متحققة (needsManualFix=false)");
  assert(Array.isArray(envelope.data?.sectors) && envelope.data!.sectors!.includes("agritech"), "القطاعات مستخرجة حرفيًّا");
  assert(envelope.data?.amountMax === 500000, "سقف المبلغ = 500000$");
  assert(Array.isArray(dr.quotes) && dr.quotes.length >= 3, "اقتباسات موجودة");
  for (const q of dr.quotes) {
    assert(pageText.includes(q.quote), `اقتباس حرفي من الصفحة: «${q.quote.slice(0, 40)}…»`);
    assert(q.url === "https://example.org/program", "الرابط مصاحب للاقتباس");
  }
  // رابط داخلي: مرفوض قبل أي معالجة
  const blocked = await draftOpportunityFromPage("نص صفحة", "http://10.0.0.1/panel");
  const be = blocked.draft as { needsManualFix?: boolean; issuesAr?: string[] };
  assert(be.needsManualFix === true && (be.issuesAr?.[0] ?? "").includes("SSRF"), "رابط SSRF مرفوض داخل المسودة");
}

async function checkAiRunNoRawText(): Promise<void> {
  console.log("\n[6] runLlm → AiRun بلا نص خام");
  const canary = "CANARY_RAW_XYZ_987654321";
  const before = await prisma.aiRun.count();
  const rr = await runLlm({
    purpose: "SUGGESTION",
    systemPrompt: `اختبار المحوّل ${canary}`,
    userPayload: `حمولة تجريبية تحتوي ${canary} ولا يجب أن تُخزَّن أبدًا`,
  });
  const after = await prisma.aiRun.count();

  assert(rr.usedFallback === true && !!rr.errorCode, "مسار الطوارئ مفعّل مع errorCode");
  assert(after === before + 1, "سجل AiRun أُنشئ (سجل واحد)");

  const row = await prisma.aiRun.findFirst({ where: { purpose: "SUGGESTION" }, orderBy: { createdAt: "desc" } });
  assert(!!row, "آخر سجل AiRun (SUGGESTION) موجود");
  const serialized = JSON.stringify(row ?? {});
  assert(!serialized.includes(canary), "لا كناري (نص خام) في AiRun");
  assert(row?.provider === "mock-replay" && row?.success === false && !!row?.errorCode, "حقول الطوارئ مسجلة");
  assert(typeof row?.promptFingerprint === "string" && /^[0-9a-f]{16}$/.test(row?.promptFingerprint ?? ""), "بصمة الموجّه sha256/16 محرفًا");
  assert(row?.latencyMs !== null && (row?.latencyMs ?? -1) >= 0, "زمن الاستجابة مسجل");
  assert(row?.inputTokens === null && row?.outputTokens === null, "بلا عدّادات رموز في مسار الطوارئ");
  // قائمة بيضاء للأعمدة: لا عمود يحتمل نصًّا خامًا
  const whitelist = ["id", "purpose", "provider", "model", "modelVersion", "promptFingerprint", "inputTokens", "outputTokens", "latencyMs", "success", "errorCode", "deckVersionId", "userId", "createdAt"];
  const keys = Object.keys(row ?? {});
  assert(keys.every((k) => whitelist.includes(k)), "أعمدة AiRun من القائمة البيضاء فقط");
}

async function main(): Promise<void> {
  console.log("=== Masar T6 — التحقق الذاتي لحزمة الذكاء (مسار الطوارئ + الحراس) ===");
  try {
    await checkExtraction();
    await checkCitationGuard();
    await checkSuggestion();
    checkSsrf();
    await checkDraft();
    await checkAiRunNoRawText();
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\nالمجموع: ${checks} فحصًا، الإخفاقات: ${failures}`);
  if (failures === 0) {
    console.log("AI CHECK PASSED");
    process.exitCode = 0;
  } else {
    console.error("AI CHECK FAILED");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("AI CHECK FAILED (استثناء):", e);
  process.exitCode = 1;
});
