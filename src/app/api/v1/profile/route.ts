/**
 * Masar — T14: واجهة الملف الشخصي GET/PUT /api/v1/profile
 *
 * GET  : profile { fields (محلولة من fieldsJson مع source/page/quote/confirmedAt لكل حقل)،
 *        founders، documents }
 * PUT  : assertSameOrigin أولًا ثم requireUser(FOUNDER) + requireProfile + parseBody(ProfileUpdateInput)
 *        دمج: الحقول الجديدة تستبدل القديمة بنفس الاسم — المصدر "manual" إلا إذا حملت source
 *        "deck" مع page/quote (يُسمح بالاثنين). أي حقل لم يُرسَل لا يُمَسّ (يبقى مصدره
 *        القادم من العرض كما هو). confirmedAt للحقول اليدوية = الآن.
 *        audit PROFILE_UPDATED بعدد الحقول فقط (بلا قيم).
 */
import type { NextRequest } from "next/server";
import type { CompanyDocument, Founder } from "@prisma/client";
import {
  ok,
  parseBody,
  handleRouteError,
  requireRole,
  requireProfile,
  assertSameOrigin,
  audit,
  parseJsonField,
  ApiErrorClass,
  prisma,
} from "@/lib/server/api";
import { ProfileUpdateInput } from "@/lib/schemas";

// ————— أشكال العرض —————

/** الحقل المخزن في fieldsJson (مطابق لتعليق مخطط Prisma) */
interface StoredProfileField {
  field: string;
  value: unknown;
  source: "manual" | "deck";
  deckId?: string;
  deckVersion?: number;
  page?: number;
  quote?: string;
  confirmedAt?: string;
}

interface FounderView {
  id: string;
  name: string | null;
  region: string | null;
  nationality: string | null;
  isPrimary: boolean;
}

interface DocumentView {
  docType: string;
  status: "available" | "missing" | "expired";
  source: string | null;
  notes: string | null;
  updatedAt: string;
}

function shapeFounder(f: Founder): FounderView {
  return {
    id: f.id,
    name: f.name,
    region: f.region,
    nationality: f.nationality,
    isPrimary: f.isPrimary,
  };
}

function shapeDocument(d: CompanyDocument): DocumentView {
  return {
    docType: d.docType,
    status: d.status as DocumentView["status"],
    source: d.source,
    notes: d.notes,
    updatedAt: d.updatedAt.toISOString(),
  };
}

function resolveFields(raw: string): StoredProfileField[] {
  const parsed = parseJsonField<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (f): f is StoredProfileField =>
      typeof f === "object" && f !== null && typeof (f as { field?: unknown }).field === "string",
  );
}

/** بناء حمولة الاستجابة (نفس شكل GET و PUT — «رد كـ GET») */
async function buildProfilePayload(profileId: string): Promise<{
  profile: {
    id: string;
    fields: StoredProfileField[];
    founders: FounderView[];
    documents: DocumentView[];
    updatedAt: string;
  };
}> {
  const profile = await prisma.startupProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw new ApiErrorClass("NO_PROFILE", "أنشئ ملف الشركة أولًا", 409);
  const [founders, documents] = await Promise.all([
    prisma.founder.findMany({ where: { profileId }, orderBy: { isPrimary: "desc" } }),
    prisma.companyDocument.findMany({ where: { profileId }, orderBy: { docType: "asc" } }),
  ]);
  return {
    profile: {
      id: profile.id,
      fields: resolveFields(profile.fieldsJson),
      founders: founders.map(shapeFounder),
      documents: documents.map(shapeDocument),
      updatedAt: profile.updatedAt.toISOString(),
    },
  };
}

// ————— المعالجات —————

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const user = await requireRole(req, ["FOUNDER"]);
    const profile = await requireProfile(user.id);
    return ok(await buildProfilePayload(profile.id));
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PUT(req: NextRequest): Promise<Response> {
  try {
    // القيد: assertSameOrigin أولًا ثم requireUser/requireRole
    assertSameOrigin(req);
    const user = await requireRole(req, ["FOUNDER"]);
    const profile = await requireProfile(user.id);
    const body = await parseBody(req, ProfileUpdateInput);

    // ————— الدمج —————
    // خريطة تحفظ ترتيب الحقول القديمة (المُحدَّث في موضعه) وتُلحق الجديدة في النهاية.
    const byKey = new Map<string, StoredProfileField>();
    for (const f of resolveFields(profile.fieldsJson)) byKey.set(f.field, f);
    const nowIso = new Date().toISOString();

    for (const inc of body.fields) {
      // source "deck" مقبول فقط مع page و quote صالحين — ما عداه يُعامل "manual"
      const isDeck =
        inc.source === "deck" &&
        typeof inc.page === "number" &&
        inc.page > 0 &&
        typeof inc.quote === "string" &&
        inc.quote.trim().length > 0;
      const merged: StoredProfileField = {
        field: inc.field,
        value: inc.value === undefined ? null : inc.value,
        source: isDeck ? "deck" : "manual",
      };
      if (isDeck) {
        if (typeof inc.deckId === "string" && inc.deckId.length > 0) merged.deckId = inc.deckId;
        if (typeof inc.deckVersion === "number") merged.deckVersion = inc.deckVersion;
        merged.page = inc.page;
        merged.quote = inc.quote;
        // حقل العرض: confirmedAt إن أُرسل فقط (التأكيد مسار confirm-profile لدى T12)
        if (typeof inc.confirmedAt === "string") merged.confirmedAt = inc.confirmedAt;
      } else {
        // الحقل اليدوي الجديد يُعتبَر مؤكدًا الآن
        merged.confirmedAt = nowIso;
      }
      byKey.set(inc.field, merged);
    }

    // Save field values and founder records together. The confirmed primary founder
    // record is used by the eligibility engine, so keep it synchronized with fieldsJson.
    await prisma.$transaction(async (tx) => {
      if (body.fields.length > 0) {
        await tx.startupProfile.update({
          where: { id: profile.id },
          data: { fieldsJson: JSON.stringify(Array.from(byKey.values())) },
        });
      }
      if (body.founders) {
        await tx.founder.deleteMany({ where: { profileId: profile.id } });
        await tx.founder.createMany({
          data: body.founders.map((founder) => ({
            profileId: profile.id,
            name: founder.name?.trim() || null,
            region: founder.region || null,
            nationality: founder.nationality || null,
            isPrimary: founder.isPrimary,
          })),
        });
      }
    });

    // التدقيق: counts only — no field values, founder names, or profile contents.
    await audit(user.id, "PROFILE_UPDATED", "StartupProfile", profile.id, {
      fieldsCount: body.fields.length,
      foundersUpdated: Boolean(body.founders),
      foundersCount: body.founders?.length ?? undefined,
    });

    return ok(await buildProfilePayload(profile.id));
  } catch (e) {
    return handleRouteError(e);
  }
}
