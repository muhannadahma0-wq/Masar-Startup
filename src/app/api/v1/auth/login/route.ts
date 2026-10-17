/**
 * Masar — POST /api/v1/auth/login (T9)
 * ---------------------------------------------------------------------------
 * التسلسل: assertSameOrigin → parseBody(LoginInput) → حد المحاولات →
 * verifyPassword (مقارنة زمن ثابت) → جلسة جديدة (token 32B، csrfToken 16B،
 * 7 أيام) + كوكي masar_session → audit LOGIN_SUCCESS / LOGIN_FAIL.
 *
 * حد المحاولات: خريطة في ذاكرة العملية (module-level Map) بريد →
 * { count, until }: بعد 5 محاولات فاشلة متتالية يُقفل البريد 15 دقيقة
 * (429 TOO_MANY_ATTEMPTS برسالة عربية). يُصفَّر العداد عند نجاح الدخول أو
 * بعد انتهاء مدة القفل (بداية نظيفة). تكيف البيئة: لا Redis هنا — الخريطة
 * لكل عملية، وقد تُصفَّر عند إعادة تشغيل الخدمة (مقبول وموثّق).
 *
 * الأمان: لا تُخزَّن كلمة المرور في أي سجل؛ تدقيق LOGIN_FAIL يحفظ البريد
 * وعدد المحاولة فقط. عند بريد غير موجود تُنفَّذ تجزئة وهمية بنفس الكلفة
 * لتوحيد زمن الاستجابة (مقاومة عدّ المستخدمين بالتوقيت).
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { LoginInput } from "@/lib/schemas";
import {
  ApiErrorClass,
  assertSameOrigin,
  audit,
  handleRouteError,
  ok,
  parseBody,
  prisma,
} from "@/lib/server/api";
import { hashPassword, verifyPassword } from "@/lib/server/password";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 أيام
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000; // 15 دقيقة

// بريد → { count: المحاولات الفاشلة المتتالية، until: وقت انتهاء القفل (0 = غير مقفل)
const attempts = new Map<string, { count: number; until: number }>();

// تجزئة وهمية بمعاملات مطابقة — لتوحيد زمن الاستجابة عندما لا وجود للمستخدم.
const DUMMY_HASH = hashPassword("masar-timing-equalizer");

/** تنظيف فرصة: منع نمو الخريطة بلا حد عند سبام بريد وهمي. */
function sweepAttempts(now: number): void {
  if (attempts.size < 1000) return;
  for (const [key, value] of attempts) {
    if (value.until <= now) attempts.delete(key);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(req);
    const { email: rawEmail, password } = await parseBody(req, LoginInput);
    const email = rawEmail.trim().toLowerCase();
    const now = Date.now();
    sweepAttempts(now);

    // القفل نشط؟
    const rec = attempts.get(email);
    if (rec && rec.until > now) {
      const minutes = Math.max(1, Math.ceil((rec.until - now) / 60_000));
      throw new ApiErrorClass(
        "TOO_MANY_ATTEMPTS",
        `محاولات دخول فاشلة كثيرة — الحساب مقفل مؤقتًا، أعد المحاولة بعد ${minutes} دقيقة`,
        429,
      );
    }
    if (rec) attempts.delete(email); // قفل منتهٍ/غير مقفل — عدّاد جديد

    const user = await prisma.user.findUnique({ where: { email } });

    let valid = false;
    if (user) {
      valid = verifyPassword(password, user.passwordHash);
    } else {
      verifyPassword(password, DUMMY_HASH); // توحيد الزمن — النتيجة تُهمل عمدًا
    }

    if (!user || !valid) {
      const count = (rec?.count ?? 0) + 1;
      attempts.set(email, {
        count,
        until: count >= MAX_ATTEMPTS ? now + LOCK_MS : 0,
      });
      // بلا كلمة المرور أبدًا — البريد وعدد المحاولة فقط
      await audit(user?.id ?? null, "LOGIN_FAIL", "User", user?.id ?? email, {
        attempt: count,
        locked: count >= MAX_ATTEMPTS,
      });
      throw new ApiErrorClass(
        "INVALID_CREDENTIALS",
        "البريد الإلكتروني أو كلمة المرور غير صحيحة",
        401,
      );
    }

    // نجاح — صفّر العداد وأنشئ جلسة جديدة
    attempts.delete(email);
    const token = randomBytes(32).toString("hex");
    const csrfToken = randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await prisma.session.create({
      data: { token, csrfToken, userId: user.id, expiresAt },
    });

    await audit(user.id, "LOGIN_SUCCESS", "User", user.id, {});

    const res = ok({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        locale: user.locale,
      },
      csrfToken,
    });
    res.cookies.set({
      name: "masar_session",
      value: token,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      expires: expiresAt,
      maxAge: Math.floor(SESSION_TTL_MS / 1000), // 7 أيام
    });
    return res;
  } catch (e) {
    return handleRouteError(e);
  }
}
