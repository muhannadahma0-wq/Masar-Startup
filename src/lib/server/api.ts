/**
 * Masar — مساعدات الخادم المشتركة (تُستعملها كل واجهات API)
 */
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { ZodError, ZodType } from "zod";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// ————— مغلف الاستجابة —————

export function ok<T>(data: T, init?: number): NextResponse {
  return NextResponse.json({ ok: true, data }, { status: init ?? 200 });
}

export function fail(code: string, message: string, status = 400, details?: unknown): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message, details } }, { status });
}

export class ApiErrorClass extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}

// ————— تحليل الجسم بمخطط Zod —————

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiErrorClass("BAD_JSON", "الجسم ليس JSON صالحًا", 400);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiErrorClass("VALIDATION", "بيانات غير صالحة", 422, zodDetails(result.error));
  }
  return result.data;
}

export function zodDetails(error: ZodError): unknown {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

// ————— الالتفاف على الأخطاء —————

export function handleRouteError(e: unknown): NextResponse {
  if (e instanceof ApiErrorClass) return fail(e.code, e.message, e.status, e.details);
  console.error("[api]", (e as Error)?.message ?? e);
  return fail("INTERNAL", "خطأ داخلي غير متوقع", 500);
}

// ————— الجلسة والمستخدم —————

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: "FOUNDER" | "REVIEWER" | "ADMIN";
  locale: string;
}

export function getSessionToken(req: NextRequest): string | null {
  const cookie = req.cookies.get("masar_session")?.value;
  return cookie && cookie.length > 10 ? cookie : null;
}

export async function requireUser(req: NextRequest): Promise<SessionUser> {
  const token = getSessionToken(req);
  if (!token) throw new ApiErrorClass("UNAUTHORIZED", "يجب تسجيل الدخول", 401);
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) {
    throw new ApiErrorClass("UNAUTHORIZED", "انتهت الجلسة، سجّل الدخول من جديد", 401);
  }
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role as "FOUNDER" | "REVIEWER" | "ADMIN",
    locale: session.user.locale,
  };
}

export async function requireRole(req: NextRequest, roles: Array<SessionUser["role"]>): Promise<SessionUser> {
  const user = await requireUser(req);
  if (!roles.includes(user.role)) {
    throw new ApiErrorClass("FORBIDDEN", "لا تملك صلاحية هذا الإجراء", 403);
  }
  return user;
}

// ————— تحقق CSRF: طلبات التغيير تمرّ من نفس الأصل —————

/**
 * ملاحظة بيئة النشر: خلف وكيل منصة المعاينة (space-z.ai) يُعاد كتابة رأس
 * Host إلى اسم داخلي (مثل ws-*.fcapp.run) ولا يُنقل النطاق العام في
 * X-Forwarded-Host — فالمقارنة المباشرة Origin×Host تفشل رغم أن الطلب
 * same-origin فعليًّا (الواجهة تستدعي مسارات نسبية بـcredentials: same-origin).
 * المعالجة ثلاثية الطبقات، وكلها تفترض أن Origin لا يُزوَّر من المتصفح:
 *   1) مطابقة Origin.host مع Host المباشر (تطوير محلي أو وكيل شفاف يمرر Host).
 *   2) مطابقة Origin.host مع أي قيمة في سلسلة X-Forwarded-Host (وكيل معياري).
 *   3) طلب مرّ عبر وكيل (له رؤوس X-Forwarded-*) وأصله من نطاق منصة المعاينة
 *      الموثوق (*.space-z.ai — نطاق يملكه مضيف التطبيق نفسه، لا يستطيع
 *      مهاجم خارجي الحصول على صفحة هناك، والمتصفح وحده يضبط Origin).
 * أي أصل آخر (موقع خارجي) يبقى مرفوضًا، والكوكي httpOnly + SameSite=Lax
 * يبقى طبقة حماية ثانية مستمرة (POST عبر المواقع الأخرى لا يحمل الكوكي أصلًا).
 */
const TRUSTED_PREVIEW_SUFFIX = ".space-z.ai";

export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  if (!origin) return; // عميل غير متصفح (curl/اختبارات) — الحماية الفعلية الكوكي SameSite
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return; // Origin غير قابل للتحليل — المتصفحات لا ترسل قيمًا فاسدة
  }

  // 1) Host المباشر
  const host = req.headers.get("host");
  if (host && o.host === host) return;

  // 2) سلسلة X-Forwarded-Host (قد تحمل قيمًا متعددة مفصولة بفواصل)
  const forwarded = req.headers.get("x-forwarded-host");
  if (
    forwarded &&
    forwarded.split(",").map((s) => s.trim()).includes(o.host)
  ) {
    return;
  }

  // 3) أصل من نطاق منصة المعاينة + طلب مرّ عبر وكيل (أُعيدت كتابة Host داخليًا)
  const proxied =
    req.headers.get("x-forwarded-for") !== null ||
    req.headers.get("x-real-ip") !== null ||
    req.headers.get("x-forwarded-proto") !== null;
  if (proxied && o.hostname.endsWith(TRUSTED_PREVIEW_SUFFIX)) return;

  throw new ApiErrorClass("CSRF", "أصل الطلب غير مسموح", 403);
}

// ————— مالك الملف —————

export async function requireProfile(userId: string) {
  const profile = await prisma.startupProfile.findUnique({ where: { userId } });
  if (!profile) throw new ApiErrorClass("NO_PROFILE", "أنشئ ملف الشركة أولًا", 409);
  return profile;
}

// ————— سجل التدقيق —————

export async function audit(
  userId: string | null, action: string, entityType: string, entityId: string, details?: unknown
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId, action, entityType, entityId,
      detailsJson: JSON.stringify(details ?? {}),
    },
  });
}

// ————— أدوات JSON للحقول المخزنة كنص والتحقق منها —————

export function parseJsonField<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
