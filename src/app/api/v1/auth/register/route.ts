/**
 * Masar — POST /api/v1/auth/register (T9)
 * ---------------------------------------------------------------------------
 * التسجيل العام. التسلسل: assertSameOrigin → parseBody(RegisterInput) →
 * فرادة البريد (409 EMAIL_TAKEN عند التكرار) → إنشاء User + StartupProfile
 * (fieldsJson "[]") + Founder أساسي isPrimary + Session (token 32B hex،
 * csrfToken 16B hex، صلاحية 7 أيام) → كوكي masar_session → audit REGISTER.
 *
 * ⚠️ سياسة الأدوار (مقصودة): حقل `role` في الجسم **يُتجاهل تمامًا** — التسجيل
 * العام ينشئ FOUNDER حصرًا. حسابات REVIEWER/ADMIN لا تُنشأ عبر الويب إطلاقًا:
 * تُنشأ بالبذر (scripts/seed.ts — T19) أو عبر متغيرات بيئة يشغّلها المشرف
 * عند النشر. (ملاحظة: القيم خارج نطاق مخطط RegisterInput المشترك ترفض
 * مسبقًا بـ VALIDATION 422 من المخطط نفسه؛ القيم داخل النطاق تمر لكن تُتجاهل.)
 *
 * الأمان: كلمة المرور لا تُخزَّن ولا تُسجَّل — يُخزَّن تجزئة scrypt فقط؛
 * رمز الجلسة لا يدخل أي سجل (AuditLog يخزن البريد والدور فقط).
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { RegisterInput } from "@/lib/schemas";
import {
  ApiErrorClass,
  assertSameOrigin,
  audit,
  handleRouteError,
  ok,
  parseBody,
  prisma,
} from "@/lib/server/api";
import { hashPassword } from "@/lib/server/password";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 أيام

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(req);
    // حقل role يُتجاهل عمدًا — انظر «سياسة الأدوار» في رأس الملف.
    const { email, password, name } = await parseBody(req, RegisterInput);
    const emailNorm = email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({
      where: { email: emailNorm },
      select: { id: true },
    });
    if (existing) {
      throw new ApiErrorClass("EMAIL_TAKEN", "هذا البريد الإلكتروني مسجّل مسبقًا", 409);
    }

    // الأسرار تُحسب قبل المعاملة (scrypt متزامن ~عشرات المللي) لتقصيرها.
    const passwordHash = hashPassword(password);
    const token = randomBytes(32).toString("hex");
    const csrfToken = randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    // ذرّية: مستخدم + ملف شركة فارغ + مؤسس أساسي + جلسة في معاملة واحدة.
    // (سباق فرادة البريد رغم الفحص أعلاه يلتقطه القيد الفريد P2002.)
    const user = await prisma
      .$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            email: emailNorm,
            name,
            passwordHash,
            role: "FOUNDER", // ثابت — لا يُقرأ من المدخلات أبدًا
            locale: "ar",
          },
        });
        await tx.startupProfile.create({
          data: {
            userId: u.id,
            fieldsJson: "[]",
            founders: {
              // مؤسس أساسي يبدأ باسم صاحب الحساب؛ يُحرَّر لاحقًا عبر /profile (T14)
              create: [{ name, isPrimary: true }],
            },
          },
        });
        await tx.session.create({
          data: { token, csrfToken, userId: u.id, expiresAt },
        });
        return u;
      })
      .catch((e: unknown) => {
        if ((e as { code?: string })?.code === "P2002") {
          throw new ApiErrorClass("EMAIL_TAKEN", "هذا البريد الإلكتروني مسجّل مسبقًا", 409);
        }
        throw e;
      });

    await audit(user.id, "REGISTER", "User", user.id, {
      email: emailNorm,
      role: "FOUNDER",
    });

    const res = ok(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          locale: user.locale,
        },
        csrfToken,
      },
      201,
    );
    setSessionCookie(res, token, expiresAt);
    return res;
  } catch (e) {
    return handleRouteError(e);
  }
}

/** كوكي الجلسة: httpOnly + sameSite=lax + path=/ + secure في الإنتاج فقط. */
function setSessionCookie(res: NextResponse, token: string, expiresAt: Date): void {
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
}
