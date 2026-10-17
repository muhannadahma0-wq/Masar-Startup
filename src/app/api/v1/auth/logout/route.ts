/**
 * Masar — POST /api/v1/auth/logout (T9)
 * ---------------------------------------------------------------------------
 * التسلسل: assertSameOrigin → requireUser (الجلسة نفسها هي مصدر الملكية —
 * لا معاملات معرّف من العميل، فلا IDOR) → حذف الجلسة من القاعدة (مقيّد
 * بالرمز ومالك الجلسة) → مسح الكوكي (maxAge=0) → audit LOGOUT.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  audit,
  getSessionToken,
  handleRouteError,
  ok,
  prisma,
  requireUser,
  assertSameOrigin,
} from "@/lib/server/api";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(req);
    const user = await requireUser(req);

    // حذف الجلسة الحالية فقط (الرمز من الكوكي + ملكية userId دفاعًا)
    const token = getSessionToken(req);
    if (token) {
      await prisma.session.deleteMany({ where: { token, userId: user.id } });
    }

    await audit(user.id, "LOGOUT", "User", user.id, {});

    const res = ok({ loggedOut: true });
    res.cookies.set({
      name: "masar_session",
      value: "",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0, // مسح فوري
      expires: new Date(0),
    });
    return res;
  } catch (e) {
    return handleRouteError(e);
  }
}
