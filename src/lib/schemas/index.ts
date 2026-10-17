/**
 * Masar — مخططات Zod المشتركة (packages/schemas في الخطة)
 * تُستعمل للتحقق من المدخلات والمخرجات في API ومن مخرجات النموذج اللغوي.
 */
import { z } from "zod";
import {
  PROFILE_FIELD_KEYS, CONDITION_OPS, SECTOR_KEYS, STAGE_KEYS,
  REGION_VALUES, LEGAL_STATUS_VALUES, DOC_TYPE_KEYS, COUNTRY_KEYS,
} from "@/lib/core/types";

// ————— بدائل مخصّصة (متوافقة مع zod v4) —————

const profileFieldKey = z.enum(PROFILE_FIELD_KEYS as unknown as [string, ...string[]]);
const sectorKey = z.enum(SECTOR_KEYS as unknown as [string, ...string[]]);
const stageKey = z.enum(STAGE_KEYS as unknown as [string, ...string[]]);
const regionValue = z.enum(REGION_VALUES as unknown as [string, ...string[]]);
const legalStatusValue = z.enum(LEGAL_STATUS_VALUES as unknown as [string, ...string[]]);
const docTypeKey = z.enum(DOC_TYPE_KEYS as unknown as [string, ...string[]]);
const countryKey = z.enum([...COUNTRY_KEYS, "none"] as unknown as [string, ...string[]]);
const conditionOp = z.enum(CONDITION_OPS as unknown as [string, ...string[]]);

// ————— الهوية —————

export const RegisterInput = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(2).max(80),
  role: z.enum(["FOUNDER", "REVIEWER"]).optional().default("FOUNDER"),
});
export type RegisterInputT = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});
export type LoginInputT = z.infer<typeof LoginInput>;

// ————— الملف —————

const ProfileValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);

export const ProfileFieldValueSchema = z.object({
  field: profileFieldKey,
  // Values may be scalar or primitive arrays (sectors, languages, documents, payment methods).
  // Keep this explicit: intersecting a scalar union with z.unknown() accidentally rejected arrays.
  value: ProfileValueSchema.optional(),
  source: z.enum(["manual", "deck"]).default("manual"),
  deckId: z.string().optional(),
  deckVersion: z.number().int().optional(),
  page: z.number().int().positive().optional(),
  quote: z.string().max(600).optional(),
  confirmedAt: z.string().datetime().optional(),
});

export const FounderInput = z.object({
  name: z.string().max(80).optional(),
  region: regionValue.optional(),
  nationality: countryKey.optional(),
  isPrimary: z.boolean().default(false),
});

// The profile editor uses null to clear a field; What-if overrides keep the
// original optional-only contract above.
const ProfileFounderInput = z.object({
  name: z.string().max(80).nullable().optional(),
  region: regionValue.nullable().optional(),
  nationality: countryKey.nullable().optional(),
  isPrimary: z.boolean().default(false),
});

const FoundersUpdateSchema = z.array(ProfileFounderInput).min(1).max(6).refine(
  (founders) => founders.filter((founder) => founder.isPrimary).length === 1,
  { message: "Exactly one primary founder is required" },
);

export const ProfileUpdateInput = z.object({
  fields: z.array(ProfileFieldValueSchema).max(40).default([]),
  // When supplied, this is the complete founder list, validated before replacement.
  founders: FoundersUpdateSchema.optional(),
});

// ————— الفرص والشروط —————

export const EvidenceSchema = z.object({
  url: z.string().url(),
  quote: z.string().min(5).max(1200),
  verifiedAt: z.string(), // ISO
});

export const ConditionInput = z.object({
  field: profileFieldKey,
  op: conditionOp,
  value: z.unknown(),
  mandatory: z.boolean().default(false),
  ambiguous: z.boolean().default(false),
  scope: z.enum(["any", "all"]).default("any"),
  sourceWording: z.string().max(1200).optional(),
  evidence: EvidenceSchema.optional(),
});

export const OpportunityCreateInput = z.object({
  title: z.string().min(3).max(160),
  orgName: z.string().min(2).max(120),
  description: z.string().max(4000).default(""),
  type: z.enum(["grant", "accelerator", "incubator", "competition", "fellowship", "loan"]).default("grant"),
  fundingType: z.enum(["equity", "non_equity", "convertible", "mixed"]).optional(),
  amountMin: z.number().nonnegative().optional(),
  amountMax: z.number().nonnegative().optional(),
  currency: z.string().length(3).default("USD"),
  sectors: z.array(sectorKey).min(1),
  stageMin: stageKey.optional(),
  stageMax: stageKey.optional(),
  geography: z.enum(["local", "regional", "international"]).default("local"),
  geoPriority: z.boolean().default(false),
  languages: z.array(z.enum(["ar", "en"])).min(1).default(["ar"]),
  applicationUrl: z.string().url(),
  sourceType: z.enum(["official", "trusted_aggregator", "other"]).default("official"),
  deadline: z.string().datetime().optional(), // ISO
  deadlineTz: z.string().default("Asia/Hebron"),
  requiresDocs: z.array(docTypeKey).default([]),
  conditions: z.array(ConditionInput).min(1).max(30),
});

export const OpportunityUpdateInput = z.object({
  reason: z.string().max(600).optional(),
  patch: OpportunityCreateInput.partial(),
});

export const DraftFromUrlInput = z.object({
  url: z.string().url(),
});

export const RejectInput = z.object({ reason: z.string().min(3).max(600) });

// ————— المطابقات —————

export const WhatIfInput = z.object({
  fields: z.array(ProfileFieldValueSchema).max(40),
  founderOverrides: z.array(FounderInput).max(6).optional(),
});

export const QuickCheckAnswers = z.object({
  region: regionValue,
  registrationCountry: countryKey.optional(),
  legalStatus: legalStatusValue.optional(),
  sectors: z.array(sectorKey).min(1).max(4),
  stage: stageKey,
  askAmountUSD: z.number().nonnegative().optional(),
  languages: z.array(z.enum(["ar", "en"])).min(1).default(["ar"]),
});

// ————— العروض —————

export const ConfirmProfileInput = z.object({
  fields: z.array(z.object({
    key: profileFieldKey,
    // Extractor supports enum arrays such as company.sectors/company.languages.
    value: ProfileValueSchema,
    page: z.number().int().positive(),
    quote: z.string().min(5).max(1200),
  })).min(1).max(40),
});

export const SuggestDecisionInput = z.object({
  decision: z.enum(["accepted", "edited", "rejected"]),
  editedText: z.string().max(2000).optional(),
});

export const CompareQuery = z.object({
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
});

// ————— التشغيل —————

export const ApplicationInput = z.object({
  opportunityId: z.string().min(1),
  status: z.enum(["INTERESTED", "PREPARING", "SUBMITTED", "REJECTED", "WITHDRAWN"]),
  notes: z.string().max(2000).optional(),
});

export const DocumentUpdateInput = z.object({
  status: z.enum(["available", "missing", "expired"]),
  source: z.string().max(200).optional(),
  notes: z.string().max(600).optional(),
});

// ————— مغلفات API —————

export const ApiError = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export const ApiEnvelope = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: ApiError.optional(),
});
