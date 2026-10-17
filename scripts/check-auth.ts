/**
 * Masar — التحقق الذاتي لوحدة المصادقة (T9) — منطق password.ts فقط
 * ---------------------------------------------------------------------------
 * التشغيل من جذر المشروع: bun scripts/check-auth.ts
 * (اختبار مسارات HTTP كاملًا خارج نطاق T9 — يفحصها المنسّق بالمتصفح.)
 *
 * يغطي:
 *  1. صيغة السلسلة المخزنة وثبات أطوالها (scrypt$ + ملح 32 hex + تجزئة 128 hex).
 *  2. أملاح مختلفة لكل استدعاء + تحقق التجزئتين لنفس كلمة المرور.
 *  3. التحقق: صحيح / خاطئ / فارغ / عربي / محارف $ / طول الحد الأقصى 128.
 *  4. سلاسل مخزنة تالفة بكل الأشكال → false بلا استثناء أبدًا.
 *  5. سرعة scrypt (تجزئة + تحقق) ضمن حد مقبول.
 *  6. مدخلات غير نصية (null/undefined/كائن) → false بلا استثناء.
 * النجاح الكامل يطبع «AUTH CHECK PASSED».
 */

import { hashPassword, verifyPassword } from "../src/lib/server/password";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    const line = `  ✗ ${name}${detail ? ` — ${detail}` : ""}`;
    failures.push(line);
    console.log(line);
  }
}

function section(title: string): void {
  console.log(`\n— ${title}`);
}

const PW = "Masar#2026";

// ————— 1) الصيغة والأطوال —————
section("صيغة السلسلة المخزنة وأطوالها");
const h1 = hashPassword(PW);
const parts1 = h1.split("$");
check("الصيغة scrypt$salt$hash (ثلاثة أجزاء بمحدد $)", parts1.length === 3 && parts1[0] === "scrypt", h1);
check("الملح 16 بايت = 32 محرفًا hex صغيرة", /^[0-9a-f]{32}$/.test(parts1[1] ?? ""), parts1[1]);
check("التجزئة 64 بايت = 128 محرفًا hex صغيرة", /^[0-9a-f]{128}$/.test(parts1[2] ?? ""), (parts1[2] ?? "").length.toString());
check("الطول الكلي 6 + 1 + 32 + 1 + 128 = 168 محرفًا", h1.length === 168, h1.length.toString());
check("لا محارف غير hex خارج المحددات", /^[a-z0-9$]+$/.test(h1));

// ————— 2) أملاح مختلفة —————
section("ملح مختلف لكل استدعاء");
const h2 = hashPassword(PW);
const h3 = hashPassword(PW);
check("تجزئتان لنفس كلمة المرور مختلفتان (ملح عشوائي)", h1 !== h2 && h2 !== h3 && h1 !== h3);
check("الأملاح الثلاثة مختلفة", new Set([parts1[1], h2.split("$")[1], h3.split("$")[1]]).size === 3);
check("كلتا التجزئتين تتحققان لنفس كلمة المرور", verifyPassword(PW, h1) === true && verifyPassword(PW, h2) === true);

// ————— 3) التحقق صحيح/خاطئ —————
section("التحقق من كلمة المرور");
check("كلمة مرور صحيحة → true", verifyPassword(PW, h1) === true);
check("كلمة مرور خاطئة → false", verifyPassword("Wrong#2026", h1) === false);
check("فرق حرف واحد → false", verifyPassword("Masar#2027", h1) === false);
check("كلمة مرور فارغة → false", verifyPassword("", h1) === false);
check("حالة الأحرف مهمة → false", verifyPassword("masar#2026", h1) === false);

// سلاسل خاصة
const pwArabic = "كلمة المرور العربية ٢٠٢٦";
const hAr = hashPassword(pwArabic);
check("كلمة مرور عربية بأرقام هندية (دورة كاملة)", verifyPassword(pwArabic, hAr) === true);
check("الكلمة العربية بنفس النص بعد الأرقام الغربية → false", verifyPassword("كلمة المرور العربية 2026", hAr) === false);
const pwDollar = "pa$$word$with$dollars$2026";
const hDollar = hashPassword(pwDollar);
check("كلمة مرور تحوي محارف $ (لا تتأثر بالمحددات)", verifyPassword(pwDollar, hDollar) === true && verifyPassword("pa$$word", hDollar) === false);
const pwMax = "A".repeat(128);
const hMax = hashPassword(pwMax);
check("كلمة مرور بطول الحد الأقصى 128 (حد المخطط)", verifyPassword(pwMax, hMax) === true);
check("طول 127 بعد 128 → false", verifyPassword("A".repeat(127), hMax) === false);

// ميكانيكا خالصة (السياسة min(8) مفروضة في المخطط لا هنا):
check("(ميكانيكا) تجزئة سلسلة فارغة تتحقق على نفسها", verifyPassword("", hashPassword("")) === true);

// ————— 4) سلاسل مخزنة تالفة → false بلا استثناء —————
section("سلاسل مخزنة تالفة — false لا استثناء");
const corrupted: Array<[string, string]> = [
  ["سلسلة فارغة", ""],
  ["مسافات فقط", "   "],
  ["مخطط بلا معاملات", "scrypt"],
  ["جزء واحد بعد المخطط", "scrypt$abc"],
  ["جزءان فحسب (بلا تجزئة)", `scrypt$${"ab".repeat(16)}`],
  ["أجزاء زائدة", `scrypt$${"ab".repeat(16)}$${"ab".repeat(64)}$extra`],
  ["خوارزمية أخرى", `bcrypt$${"ab".repeat(16)}$${"ab".repeat(64)}`],
  ["اسم مخطط بحالة كبيرة", `SCRYPT$${"ab".repeat(16)}$${"ab".repeat(64)}`],
  ["ملح غير hex", `scrypt$${"zz".repeat(16)}$${"ab".repeat(64)}`],
  ["تجزئة غير hex", `scrypt$${"ab".repeat(16)}$${"zz".repeat(64)}`],
  ["ملح قصير (8 بايت)", `scrypt$${"ab".repeat(8)}$${"ab".repeat(64)}`],
  ["ملح طويل (24 بايت)", `scrypt$${"ab".repeat(24)}$${"ab".repeat(64)}`],
  ["تجزئة قصيرة (63 بايت)", `scrypt$${"ab".repeat(16)}$${"ab".repeat(63)}`],
  ["تجزئة طويلة (65 بايت)", `scrypt$${"ab".repeat(16)}$${"ab".repeat(65)}`],
  ["ملح فارغ", `scrypt$$${"ab".repeat(64)}`],
  ["تجزئة فارغة", `scrypt$${"ab".repeat(16)}$`],
  ["ملح فردي الطول (hex مبتور)", `scrypt$abc$${"ab".repeat(64)}`],
  ["نص عربي كليًا", "تجزئة تالفة تمامًا"],
  ["newlines داخل السلسلة", "scrypt\nab\nab"],
  ["null literal داخل النص", "scrypt$null$null"],
];
for (const [name, bad] of corrupted) {
  let result: unknown = "THREW";
  let threw = false;
  try {
    result = verifyPassword(PW, bad);
  } catch {
    threw = true;
  }
  check(`${name} → false بلا استثناء`, !threw && result === false, threw ? "رمى استثناءً" : `أعاد ${String(result)}`);
}
// صيغة سليمة لكن التجزئة لا تطابق (كلها أصفار)
check("صيغة سليمة بتجزئة أصفار → false (مقارنة زمن ثابت)", verifyPassword(PW, `scrypt$${"00".repeat(16)}$${"00".repeat(64)}`) === false);
check("صيغة سليمة بتجزئة ffff → false", verifyPassword(PW, `scrypt$${"ab".repeat(16)}$${"ff".repeat(64)}`) === false);

// ————— 5) مدخلات غير نصية (دفاعي) —————
section("مدخلات غير نصية (دفاعي)");
for (const [name, bad] of [
  ["stored = undefined", undefined],
  ["stored = null", null],
  ["stored = 12345", 12345],
  ["stored = كائن", {}],
] as Array<[string, unknown]>) {
  let threw = false;
  let result: unknown = "THREW";
  try {
    result = verifyPassword(PW, bad as string);
  } catch {
    threw = true;
  }
  check(`${name} → false بلا استثناء`, !threw && result === false, threw ? "رمى استثناءً" : `أعاد ${String(result)}`);
}

// ————— 6) سرعة scrypt —————
section("سرعة scrypt (N=16384, r=8, p=1)");
const N_ROUNDS = 5;
const t0 = Date.now();
for (let i = 0; i < N_ROUNDS; i++) {
  const hh = hashPassword(`${PW}#${i}`);
  verifyPassword(`${PW}#${i}`, hh);
}
const elapsed = Date.now() - t0;
console.log(`  ℹ ${N_ROUNDS} × (تجزئة + تحقق) استغرقت ${elapsed}ms`);
check(`${N_ROUNDS} دورات تجزئة+تحقق أسرع من 5 ثوانٍ`, elapsed < 5000, `${elapsed}ms`);
check("تجزئة واحدة ليست فورية (عمل scrypt حقيقي ≥ 10ms)", (() => { const s = Date.now(); hashPassword(PW); return Date.now() - s >= 10; })());

// ————— الخلاصة —————
console.log(`\nالنتيجة: ${passed} ناجح، ${failed} فاشل من ${passed + failed} فحصًا.`);
if (failed > 0) {
  console.log("الإخفاقات:");
  for (const f of failures) console.log(f);
  console.log("AUTH CHECK FAILED");
  process.exit(1);
}
console.log("AUTH CHECK PASSED");
