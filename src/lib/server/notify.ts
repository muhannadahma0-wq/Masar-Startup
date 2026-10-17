/**
 * Masar — T14: الإشعارات بمفتاح فريد (بلا تكرار)
 *
 * العقد (AGENT_CONTRACT §5/§11):
 *   notifyByIdempotent({ userId, opportunityId, eventType, versionNumber, payloadAr, payloadEn? }) → boolean
 *   - true  = أُدرج إشعار داخل التطبيق في قاعدة البيانات؛ لا يعني إرسال بريد
 *   - false = مكرر — لم يُدرج إشعار جديد
 *
 * الضمانة ضد التكرار:
 * إعادة تشغيل المهمة بعد عطل لن تكرر الإشعار لأن القيد UNIQUE على
 * (userId, opportunityId, eventType, versionNumber) في القاعدة يمنع الإدراج الثاني:
 * أي نداء ثانٍ بنفس المفتاح يفشل الإدراج برمز خطأ Prisma P2002 (كود القيود الفريدة)
 * فنُرجِع false دون رفع استثناء — فلا يُنشأ إشعار داخل التطبيق مكرر.
 *
 * ملاحظة إصدار: لا يوجد مزوّد بريد مدمج بعد. هذه الدالة تحفظ إشعارًا داخل التطبيق فقط؛
 * لا يجوز عرض نجاحها للمستخدم على أنه إرسال بريد إلكتروني.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/api";

export interface NotifyIdempotentParams {
  userId: string;
  opportunityId: string;
  eventType: string;
  versionNumber: number;
  payloadAr: string;
  payloadEn?: string;
}

/** هل الخطأ هو خرق قيد فريد (كود Prisma P2002)؟ */
function isUniqueViolation(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return true;
  // شبكة أمان إن عاد الخطأ ملفوفًا (بعض مسارات prisma قد يغلّفه)
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

/** تخزين الحمولة العربية بصيغة JSON قياسية داخل payloadJson */
export function payloadArToJson(payloadAr: string, payloadEn?: string): string {
  return JSON.stringify({ ar: payloadAr, ...(payloadEn ? { en: payloadEn } : {}) });
}

/** استرجاع النص العربي من payloadJson (يتسامح مع نص خام ليس JSON) */
export function payloadArFromJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { ar?: unknown };
    if (parsed && typeof parsed === "object" && typeof parsed.ar === "string") return parsed.ar;
  } catch {
    // ليس JSON — أعد النص كما هو
  }
  return raw;
}


/** English twin of the in-app notification payload, with a conservative legacy fallback. */
export function payloadEnFromJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { en?: unknown };
    if (parsed && typeof parsed === "object" && typeof parsed.en === "string") return parsed.en;
  } catch { /* raw legacy payload */ }
  return "An update was made. Open the related opportunity to review the latest details.";
}

/**
 * إنشاء إشعار بمفتاح فريد (userId, opportunityId, eventType, versionNumber).
 * لا يكرر أبدًا لنفس المفتاح — النداء المكرر يعيد false بهدوء.
 */
export async function notifyByIdempotent(p: NotifyIdempotentParams): Promise<boolean> {
  try {
    await prisma.notification.create({
      data: {
        userId: p.userId,
        opportunityId: p.opportunityId,
        eventType: p.eventType,
        versionNumber: p.versionNumber,
        payloadJson: payloadArToJson(p.payloadAr, p.payloadEn),
      },
    });
    return true;
  } catch (e) {
    if (isUniqueViolation(e)) return false; // مكرر — لم يُرسل
    throw e; // خطأ آخر حقيقي — يُرفع ليُعالَج بـ handleRouteError في المسار
  }
}
