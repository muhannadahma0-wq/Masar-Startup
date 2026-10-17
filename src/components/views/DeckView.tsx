"use client";
/**
 * Masar — T18: وحدة العروض (DeckView)
 * =============================================================================
 * المسار الكامل: رفع الملف ← استخراج ← تأكيد المؤسس ← الفجوات.
 *  - الرفع: منطقة إفلات (Drag&Drop + اختيار ملف) PDF/PPTX ≤ 20MB مع رسائل
 *    عربية/إنجليزية عبر رمز الخطأ، ونتيجة التحليل ومراجعة الوكلاء في تبويب مستقل.
 *  - قائمة النسخ: الرقم/الحالة/النوع/عدد الشرائح/التاريخ + عرض النتيجة + حذف
 *    بتأكيد (AlertDialog → DELETE /decks/[id]).
 *  - شاشة النتيجة (Tabs): الاستخراج والتأكيد / الجاهزية (9 معايير) / الفجوات /
 *    الادعاءات والتعارضات / الشرائح والصياغة (تفتح SlideCorrectionView في
 *    Dialog) / مقارنة نسختين (from/to → GET /decks/[id]/compare).
 *  - FAILED_EXTRACTION: بطاقة خطأ برسالة الحالة + زر إعادة الرفع.
 *
 * ملاحظة أشكال الاستجابات: مسارات T12/T13 لم تكن مكتملة لحظة التنفيذ؛ كل
 * القراءة هنا دفاعية عبر موحّدات تتقبل الأسماء المتوقعة من المخطط والعقد.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { useI18n, formatDate, localizeServerMessage } from "@/components/app/i18n";
import {
  JudgmentBadge,
  EmptyState,
  ScoreBar,
  StatCard,
} from "@/components/app/badges";
import type { PitchAgentReview } from "@/lib/ai/agent-types";
import type {
  ClaimItem,
  CriterionResult,
  ExtractedField,
  GapReport,
  ReadinessReport,
  Slide,
} from "@/lib/core/types";
import SlideCorrectionView, {
  type SuggestionRecord,
} from "@/components/views/SlideCorrectionView";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  CloudUpload,
  FileSpreadsheet,
  FileText,
  GitCompareArrows,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import type { ViewProps } from "@/components/app/types";
import { cn } from "@/lib/utils";

// ————— قواميس محلية (ثنائية) —————

const FIELD_LABELS: Record<string, { ar: string; en: string }> = {
  "company.name": { ar: "اسم الشركة", en: "Company name" },
  "company.sectors": { ar: "القطاعات", en: "Sectors" },
  "company.stage": { ar: "مرحلة الشركة", en: "Company stage" },
  "company.registrationCountry": { ar: "بلد التسجيل", en: "Registration country" },
  "company.legalStatus": { ar: "الوضع القانوني", en: "Legal status" },
  "company.ageMonths": { ar: "عمر الشركة (شهرًا)", en: "Company age (months)" },
  "company.teamSize": { ar: "حجم الفريق", en: "Team size" },
  "company.womenLed": { ar: "قيادة نسائية", en: "Women-led" },
  "company.monthlyRevenueUSD": { ar: "الإيراد الشهري (USD)", en: "Monthly revenue (USD)" },
  "company.tractionUsers": { ar: "عدد المستخدمين", en: "Traction users" },
  "company.askAmountUSD": { ar: "المبلغ المطلوب (USD)", en: "Ask amount (USD)" },
  "company.askType": { ar: "نوع التمويل المطلوب", en: "Ask type" },
  "company.languages": { ar: "لغات الفريق", en: "Team languages" },
  "company.requiredDocs": { ar: "المستندات المتوفرة", en: "Required docs" },
  "founder.region": { ar: "منطقة المؤسس", en: "Founder region" },
  "founder.nationality": { ar: "جنسية المؤسس", en: "Founder nationality" },
  "founder.hasBankAccount": { ar: "حساب بنكي", en: "Bank account" },
  "founder.paymentMethods": { ar: "طرق استلام التمويل", en: "Payment methods" },
};

const DOC_LABELS: Record<string, { ar: string; en: string }> = {
  registration_cert: { ar: "شهادة تسجيل الشركة", en: "Registration certificate" },
  pitch_deck: { ar: "عرض تقديمي (Deck)", en: "Pitch deck" },
  financial_statements: { ar: "قوائم مالية", en: "Financial statements" },
  founder_id: { ar: "هوية المؤسس", en: "Founder ID" },
  business_plan: { ar: "خطة عمل", en: "Business plan" },
  tax_record: { ar: "سجل ضريبي", en: "Tax record" },
  bank_letter: { ar: "خطاب بنكي", en: "Bank letter" },
  prototype_demo: { ar: "نموذج أولي/عرض توضيحي", en: "Prototype demo" },
  letters_of_support: { ar: "رسائل دعم", en: "Letters of support" },
};

const CRITERIA_LABELS: Record<string, { ar: string; en: string }> = {
  problem: { ar: "المشكلة وحاجتها", en: "Problem & need" },
  customer: { ar: "العميل المستهدف", en: "Target customer" },
  solution: { ar: "الحل والمنتج", en: "Solution & product" },
  market: { ar: "السوق وحجمه", en: "Market & size" },
  business_model: { ar: "نموذج العمل والإيرادات", en: "Business model" },
  traction: { ar: "الجرّب والتحقق", en: "Traction & validation" },
  team: { ar: "الفريق", en: "Team" },
  competition: { ar: "المنافسة والتمييز", en: "Competition" },
  ask_clarity: { ar: "وضوح الطلب التمويلي", en: "Ask clarity" },
};

const LEVEL_CONF: Record<
  string,
  { ar: string; en: string; cls: string }
> = {
  strong: {
    ar: "قوي",
    en: "Strong",
    cls: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  adequate: {
    ar: "مقبول",
    en: "Adequate",
    cls: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  },
  weak: {
    ar: "ضعيف",
    en: "Weak",
    cls: "border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300",
  },
  missing: {
    ar: "غائب",
    en: "Missing",
    cls: "border-border bg-muted text-muted-foreground",
  },
};

const DECK_STATUS_CONF: Record<string, { ar: string; en: string; cls: string }> = {
  READY: {
    ar: "جاهزة",
    en: "Ready",
    cls: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  PARTIAL: {
    ar: "استخراج جزئي",
    en: "Partial",
    cls: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  PROCESSING: {
    ar: "قيد المعالجة",
    en: "Processing",
    cls: "border-border bg-muted text-muted-foreground",
  },
  FAILED_EXTRACTION: {
    ar: "فشل الاستخراج",
    en: "Failed extraction",
    cls: "border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300",
  },
};

const EXTRACTION_STATUS_CONF: Record<string, { ar: string; en: string; cls: string }> = {
  pending: {
    ar: "بانتظار تأكيدك",
    en: "Awaiting your confirmation",
    cls: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  confirmed: {
    ar: "مؤكد",
    en: "Confirmed",
    cls: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  rejected: {
    ar: "مرفوض",
    en: "Rejected",
    cls: "border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300",
  },
  dropped: {
    ar: "سقط بحارس الاقتباس",
    en: "Dropped by citation guard",
    cls: "border-border bg-muted text-muted-foreground",
  },
};

const CLAIM_TYPE_LABELS: Record<string, { ar: string; en: string }> = {
  revenue: { ar: "إيرادات", en: "Revenue" },
  growth: { ar: "نمو", en: "Growth" },
  market_size: { ar: "حجم سوق", en: "Market size" },
  users: { ar: "مستخدمون", en: "Users" },
  funding_ask: { ar: "طلب تمويل", en: "Funding ask" },
  other: { ar: "أخرى", en: "Other" },
};

const SCROLL_CLS =
  "max-h-96 overflow-y-auto pe-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border";

const MAX_SIZE = 20 * 1024 * 1024;

// ————— أنواع العميل (أشكال متوقعة — دفاعية) —————

interface DeckVersionSummary {
  versionNumber: number;
  status: string;
  fileType: string;
  slideCount: number;
  createdAt: string | null;
  fileName?: string | null;
  statusMessage?: string | null;
}

interface DeckListItem {
  id: string;
  currentVersion: number;
  versions: DeckVersionSummary[];
}

interface UploadResult {
  deckId: string;
  versionNumber: number;
  status: string;
  slideCount: number;
  statusMessage: string | null;
}

interface DeckVersionDetail {
  versionNumber: number;
  status: string;
  statusMessage: string | null;
  fileName: string;
  fileType: string;
  slideCount: number;
  fields: ExtractedField[];
  slides: Slide[];
  claims: ClaimItem[];
  contradictions: Array<{ ar: string; pages: number[] }>;
  readiness: ReadinessReport | null;
  gap: GapReport | null;
  agentReview: PitchAgentReview | null;
  suggestions: SuggestionRecord[];
  createdAt: string | null;
}

interface CompareEntry {
  key: string;
  from: unknown;
  to: unknown;
}

interface CompareData {
  fields: CompareEntry[];
  criteria: CompareEntry[];
  claimsAdded: ClaimItem[];
  claimsRemoved: ClaimItem[];
  notesAr: string[];
}

// ————— موحّدات دفاعية —————

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function fieldLabel(key: string): string {
  const c = FIELD_LABELS[key];
  return c ? `${c.ar}` : key;
}

function normalizeVersionSummary(
  item: Record<string, unknown>,
): DeckVersionSummary {
  return {
    versionNumber: Number(item.versionNumber ?? 1),
    status: String(item.status ?? "PROCESSING"),
    fileType: String(item.fileType ?? item.type ?? ""),
    slideCount: Number(item.slideCount ?? 0),
    createdAt: (item.createdAt ?? null) as string | null,
    fileName: (item.fileName ?? null) as string | null,
    statusMessage: (item.statusMessage ?? null) as string | null,
  };
}

function normalizeDecks(data: unknown): DeckListItem[] {
  const root = (data ?? {}) as Record<string, unknown>;
  let listRaw: unknown[] = [];
  if (Array.isArray(data)) {
    listRaw = data as unknown[];
  } else {
    // أسماء محتملة للحزمة: decks / items / versions — وإلا مصفوفة مسطحة من النسخ
    for (const key of ["decks", "items", "versions"]) {
      if (Array.isArray(root[key])) {
        listRaw = root[key] as unknown[];
        break;
      }
    }
    if (listRaw.length === 0 && typeof root.versionNumber !== "undefined") {
      listRaw = [root];
    }
  }

  const decks = new Map<string, DeckListItem>();
  for (const raw of listRaw) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const deckId = String(item.id ?? item.deckId ?? "");
    if (!deckId) continue;
    const versionsRaw = Array.isArray(item.versions)
      ? (item.versions as unknown[])
      : item.latestVersion
        ? [item.latestVersion]
        : null;

    const existing = decks.get(deckId) ?? {
      id: deckId,
      currentVersion: 0,
      versions: [],
    };

    if (versionsRaw) {
      for (const v of versionsRaw) {
        if (!v || typeof v !== "object") continue;
        const s = normalizeVersionSummary(v as Record<string, unknown>);
        existing.versions.push(s);
      }
      existing.currentVersion = Math.max(
        existing.currentVersion,
        Number(item.currentVersion ?? 0),
      );
    } else if (item.versionNumber !== undefined) {
      // عنصر مسطّح = نسخة واحدة من عرض
      existing.versions.push(normalizeVersionSummary(item));
    }
    decks.set(deckId, existing);
  }

  const result: DeckListItem[] = [];
  for (const d of decks.values()) {
    const seen = new Set<number>();
    const versions = d.versions
      .filter((v) => {
        if (seen.has(v.versionNumber)) return false;
        seen.add(v.versionNumber);
        return true;
      })
      .sort((a, b) => b.versionNumber - a.versionNumber);
    result.push({
      id: d.id,
      currentVersion: Math.max(
        d.currentVersion,
        ...versions.map((v) => v.versionNumber),
      ),
      versions,
    });
  }
  return result.sort((a, b) => b.currentVersion - a.currentVersion);
}

function normalizeExtractedFields(v: unknown): ExtractedField[] {
  const VALID: ExtractedField["status"][] = ["pending", "confirmed", "rejected", "dropped"];
  return arr<Record<string, unknown>>(v).map((f) => {
    const rawStatus = String(f.status ?? "pending") as ExtractedField["status"];
    return {
      key: String(f.key ?? f.field ?? ""),
      value: (f.value ?? null) as unknown,
      page: Number(f.page ?? f.slide ?? 1),
      quote: String(f.quote ?? ""),
      confidence: Number(f.confidence ?? 0),
      status: VALID.includes(rawStatus) ? rawStatus : "pending",
      droppedReason: (f.droppedReason ?? f.dropped_reason ?? undefined) as
        | string
        | undefined,
    };
  });
}

function normalizeVersionDetail(
  data: unknown,
  versionNumber: number,
): DeckVersionDetail {
  const d = (data ?? {}) as Record<string, unknown>;
  const readinessRaw = (d.readiness ?? d.readinessReport ?? null) as
    | ReadinessReport
    | null;
  const gapRaw = (d.gap ?? d.gapReport ?? null) as GapReport | null;
  const contradictionRaw = arr<Record<string, unknown>>(
    d.contradictions ?? d.possibleContradictions ?? d.claimConflicts ?? [],
  ).map((c) => ({
    ar: String(c.ar ?? c.messageAr ?? c.message ?? ""),
    pages: arr<unknown>(c.pages).map((p) => Number(p)),
  }));
  const suggestions: SuggestionRecord[] = arr<Record<string, unknown>>(
    d.suggestions ?? d.slideSuggestions ?? [],
  ).map((s) => ({
    id: typeof s.id === "string" ? s.id : undefined,
    slideIndex: Number(s.slideIndex ?? 0),
    suggestedText: String(s.suggestedText ?? ""),
    reason: (s.reasonAr ?? s.reason ?? null) as string | null,
    guard: (s.guard ?? s.guardReport ?? null) as SuggestionRecord["guard"],
    decision: String(s.decision ?? "pending"),
    editedText: (s.editedText ?? null) as string | null,
    decidedAt: (s.decidedAt ?? null) as string | null,
    createdAt: (s.createdAt ?? null) as string | null,
  }));
  return {
    versionNumber: Number(d.versionNumber ?? versionNumber),
    status: String(d.status ?? "PROCESSING"),
    statusMessage: (d.statusMessage ?? null) as string | null,
    fileName: String(d.fileName ?? ""),
    fileType: String(d.fileType ?? ""),
    slideCount: Number(d.slideCount ?? 0),
    fields: normalizeExtractedFields(
      d.fields ?? d.extraction ?? d.extractedFields ?? [],
    ),
    slides: arr<Slide>(d.slides ?? d.slidesList ?? []),
    claims: arr<ClaimItem>(d.claims ?? d.claimItems ?? []),
    contradictions: contradictionRaw,
    readiness: readinessRaw && typeof readinessRaw === "object" ? readinessRaw : null,
    gap: gapRaw && typeof gapRaw === "object" ? gapRaw : null,
    agentReview: d.agentReview && typeof d.agentReview === "object" ? d.agentReview as PitchAgentReview : null,
    suggestions,
    createdAt: (d.createdAt ?? null) as string | null,
  };
}

function normalizeCompare(data: unknown): CompareData {
  const d = (data ?? {}) as Record<string, unknown>;
  const mapEntries = (v: unknown): CompareEntry[] =>
    arr<Record<string, unknown>>(v).map((e) => ({
      key: String(e.key ?? e.field ?? e.criterion ?? ""),
      from: (e.from ?? e.oldValue ?? e.oldLevel ?? e.before ?? e.old ?? null) as unknown,
      to: (e.to ?? e.newValue ?? e.newLevel ?? e.after ?? e.new ?? null) as unknown,
    }));
  const claimsRaw = (d.claims ?? null) as Record<string, unknown> | null;
  return {
    fields: mapEntries(
      d.fields ?? d.fieldChanges ?? d.fieldsDiff ?? d.diffFields ?? [],
    ),
    criteria: mapEntries(
      d.criteria ?? d.readinessChanges ?? d.criteriaChanges ?? d.diffCriteria ?? [],
    ),
    claimsAdded: arr<ClaimItem>(
      d.claimsAdded ?? claimsRaw?.added ?? d.addedClaims ?? [],
    ),
    claimsRemoved: arr<ClaimItem>(
      d.claimsRemoved ?? claimsRaw?.removed ?? d.removedClaims ?? [],
    ),
    notesAr: arr<string>(d.notesAr ?? d.notes ?? []),
  };
}

function normalizeUpload(data: unknown): UploadResult {
  const d = (data ?? {}) as Record<string, unknown>;
  const nested = (d.version ?? d.deckVersion ?? null) as
    | Record<string, unknown>
    | null;
  const src = (nested ?? d) as Record<string, unknown>;
  return {
    deckId: String(d.deckId ?? d.id ?? nested?.deckId ?? ""),
    versionNumber: Number(
      d.versionNumber ?? nested?.versionNumber ?? 1,
    ),
    status: String(d.status ?? nested?.status ?? "PROCESSING"),
    slideCount: Number(d.slideCount ?? nested?.slideCount ?? 0),
    statusMessage: (d.statusMessage ?? nested?.statusMessage ?? null) as
      | string
      | null,
  };
}

function formatFieldValue(
  value: unknown,
  t: (a: string, e: string) => string,
): string {
  if (value === null || value === undefined) return t("غير مذكور", "Not stated");
  if (Array.isArray(value)) return value.map((v) => String(v)).join("، ");
  if (typeof value === "boolean")
    return value ? t("نعم", "Yes") : t("لا", "No");
  return String(value);
}

// ————— المكوّن —————

export default function DeckView({ onNavigate }: ViewProps) {
  const { t, lang } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // قائمة العروض
  const [decks, setDecks] = useState<DeckListItem[] | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // الرفع
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);

  // النسخة المحددة
  const [selected, setSelected] = useState<{
    deckId: string;
    version: number;
  } | null>(null);
  const [detail, setDetail] = useState<DeckVersionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // تأكيد الحقول
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<string>>(
    new Set(),
  );
  const [confirming, setConfirming] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // حذف
  const [deleteTarget, setDeleteTarget] = useState<DeckListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // شاشة التصحيح
  const [slideDialogIndex, setSlideDialogIndex] = useState<number | null>(null);

  // المقارنة
  const [compareFrom, setCompareFrom] = useState<string>("");
  const [compareTo, setCompareTo] = useState<string>("");
  const [compareData, setCompareData] = useState<CompareData | null>(null);
  const [comparing, setComparating] = useState(false);

  // ————— جلب القائمة —————
  const loadDecks = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const data = await api.get<unknown>("/decks");
      setDecks(normalizeDecks(data));
    } catch (e) {
      setListError(
        e instanceof Error
          ? e.message
          : t("تعذّر جلب قائمة العروض", "Failed to load decks"),
      );
      setDecks([]);
    } finally {
      setListLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadDecks();
  }, [loadDecks]);

  // ————— جلب تفاصيل النسخة —————
  const loadDetail = useCallback(
    async (deckId: string, version: number) => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const data = await api.get<unknown>(
          `/decks/${deckId}/versions/${version}`,
        );
        setDetail(normalizeVersionDetail(data, version));
        setSelectedFieldIds(new Set());
      } catch (e) {
        setDetailError(
          e instanceof Error
            ? e.message
            : t("تعذّر جلب نتيجة النسخة", "Failed to load version result"),
        );
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (selected) void loadDetail(selected.deckId, selected.version);
  }, [selected, loadDetail]);

  // ————— الرفع —————
  const handleFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      const name = file.name.toLowerCase();
      const ext = name.split(".").pop() ?? "";
      if (ext !== "pdf" && ext !== "pptx") {
        toast.error(
          t(
            "نوع الملف غير مدعوم — يُقبل PDF أو PPTX فقط",
            "Unsupported file type — only PDF or PPTX are accepted",
          ),
        );
        return;
      }
      if (file.size > MAX_SIZE) {
        toast.error(
          t(
            "حجم الملف يتجاوز الحد المسموح (20 ميجابايت)",
            "File exceeds the 20MB limit",
          ),
        );
        return;
      }
      setUploading(true);
      setUploadFileName(file.name);
      try {
        const result = normalizeUpload(await api.upload<unknown>("/decks", file));
        if (!result.deckId) {
          toast.error(
            t(
              "تعذّرت معالجة العرض — أعد المحاولة",
              "Could not process the deck — try again",
            ),
          );
          return;
        }
        toast.success(
          t(
            `رُفع العرض — النسخة ${result.versionNumber} (${result.slideCount} شريحة)`,
            `Deck uploaded — version ${result.versionNumber} (${result.slideCount} slides)`,
          ),
        );
        await loadDecks();
        setSelected({
          deckId: result.deckId,
          version: result.versionNumber,
        });
      } catch (e) {
        // رسالة الخادم العربية (TOO_LARGE / BAD_TYPE / FAILED_EXTRACTION...)
        toast.error(
          e instanceof Error && e.message
            ? e.message
            : t("فشل رفع العرض", "Deck upload failed"),
        );
        await loadDecks();
      } finally {
        setUploading(false);
        setUploadFileName(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [loadDecks, t],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      void handleFile(file);
    },
    [handleFile],
  );

  // ————— تأكيد المختارة —————
  const confirmSelected = useCallback(async () => {
    if (!selected || !detail) return;
    const chosen = detail.fields
      .map((f, i) => ({ f, id: `f-${i}-${f.key}-${f.page}` }))
      .filter(
        ({ f, id }) =>
          f.status === "pending" &&
          selectedFieldIds.has(id) &&
          (typeof f.value === "string" ||
            typeof f.value === "number" ||
            typeof f.value === "boolean" ||
            f.value === null),
      );
    if (chosen.length === 0) {
      toast.info(
        t(
          "حدّد حقلًا واحدًا على الأقل (بعيدًا عن القوائم والقيم المسقطة)",
          "Select at least one field (excluding lists and dropped values)",
        ),
      );
      return;
    }
    setConfirming(true);
    try {
      await api.post<unknown>(
        `/decks/${selected.deckId}/versions/${selected.version}/confirm-profile`,
        {
          fields: chosen.map(({ f }) => ({
            key: f.key,
            value: f.value,
            page: f.page,
            quote: f.quote,
          })),
        },
      );
      toast.success(
        t("حُدّث ملفك بالحقول المؤكدة", "Your profile was updated with confirmed fields"),
      );
      await loadDetail(selected.deckId, selected.version);
    } catch (e) {
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t("تعذّر تأكيد الحقول", "Could not confirm fields"),
      );
    } finally {
      setConfirming(false);
    }
  }, [selected, detail, selectedFieldIds, loadDetail, t]);

  // ————— إعادة المحاولة (PARTIAL) —————
  const retryExtraction = useCallback(async () => {
    if (!selected) return;
    setRetrying(true);
    try {
      await api.post<unknown>(
        `/decks/${selected.deckId}/versions/${selected.version}/retry`,
      );
      toast.success(
        t(
          "أُعيدت معالجة الحقول الفاشلة — تُحدَّث النتيجة الآن",
          "Failed fields reprocessed — refreshing results",
        ),
      );
      await loadDetail(selected.deckId, selected.version);
    } catch (e) {
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t("تعذّرت إعادة المحاولة", "Retry failed"),
      );
    } finally {
      setRetrying(false);
    }
  }, [selected, loadDetail, t]);

  // ————— الحذف —————
  const deleteDeck = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.del<unknown>(`/decks/${deleteTarget.id}`);
      toast.success(t("حُذف العرض وجميع نسخه", "Deck and all versions deleted"));
      if (selected?.deckId === deleteTarget.id) {
        setSelected(null);
        setDetail(null);
      }
      await loadDecks();
    } catch (e) {
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t("تعذّر حذف العرض", "Could not delete the deck"),
      );
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, selected, loadDecks, t]);

  // ————— المقارنة —————
  const runCompare = useCallback(async () => {
    if (!selected) return;
    const from = Number(compareFrom);
    const to = Number(compareTo);
    if (!from || !to) return;
    setComparating(true);
    setCompareData(null);
    try {
      const data = await api.get<unknown>(
        `/decks/${selected.deckId}/compare?from=${from}&to=${to}`,
      );
      setCompareData(normalizeCompare(data));
    } catch (e) {
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t("تعذّرت المقارنة", "Comparison failed"),
      );
    } finally {
      setComparating(false);
    }
  }, [selected, compareFrom, compareTo, t]);

  // نسخ العرض الحالي (للمقارنة)
  const currentDeck = useMemo(
    () => decks?.find((d) => d.id === selected?.deckId) ?? null,
    [decks, selected],
  );

  useEffect(() => {
    if (currentDeck && currentDeck.versions.length >= 2) {
      const sorted = [...currentDeck.versions].sort(
        (a, b) => a.versionNumber - b.versionNumber,
      );
      setCompareFrom(String(sorted[0].versionNumber));
      setCompareTo(String(sorted[sorted.length - 1].versionNumber));
    }
  }, [currentDeck]);

  // ————— عناصر مشتركة —————

  const statusBadge = (status: string) => {
    const conf = DECK_STATUS_CONF[status] ?? {
      ar: status,
      en: status,
      cls: "border-border bg-muted text-muted-foreground",
    };
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
          conf.cls,
        )}
      >
        {t(conf.ar, conf.en)}
      </span>
    );
  };

  const levelBadge = (level: string) => {
    const conf = LEVEL_CONF[level] ?? LEVEL_CONF.missing;
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
          conf.cls,
        )}
      >
        {t(conf.ar, conf.en)}
      </span>
    );
  };

  const fileTypeLabel = (ft: string) =>
    ft.toLowerCase() === "pdf"
      ? "PDF"
      : ft.toLowerCase() === "pptx"
        ? "PPTX"
        : ft || "—";

  // ————— عرض شاشة النتيجة —————

  const renderVersionScreen = () => {
    if (detailLoading) {
      return (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    if (detailError) {
      return (
        <EmptyState
          iconAr="⚠️"
          title={t("تعذّر جلب نتيجة النسخة", "Failed to load version result")}
          hintAr={detailError}
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  selected && void loadDetail(selected.deckId, selected.version)
                }
                className="h-11"
              >
                <RefreshCw className="size-4" aria-hidden />
                {t("إعادة المحاولة", "Retry")}
              </Button>
              <Button variant="ghost" onClick={() => setSelected(null)} className="h-11">
                {t("عودة للقائمة", "Back to list")}
              </Button>
            </div>
          }
        />
      );
    }
    if (!detail || !selected) return null;

    // بطاقة رأس النسخة
    const header = (
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold break-words">
                {detail.fileName || t("عرض تقديمي", "Pitch deck")}
              </h3>
              <Badge variant="secondary" className="tabular-nums" dir="ltr">
                v{detail.versionNumber}
              </Badge>
              {statusBadge(detail.status)}
              <Badge variant="outline" dir="ltr">
                {fileTypeLabel(detail.fileType)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("عدد الشرائح", "Slides")}:{" "}
              <span className="tabular-nums" dir="ltr">
                {detail.slideCount}
              </span>
              {detail.createdAt
                ? ` — ${formatDate(detail.createdAt, lang)}`
                : ""}
            </p>
            {detail.statusMessage ? (
              <p className="text-sm text-muted-foreground">
                {localizeServerMessage(detail.statusMessage, lang)}
              </p>
            ) : null}
          </div>
          <Button variant="outline" onClick={() => setSelected(null)} className="h-11">
            <ChevronLeft className="size-4" aria-hidden />
            {t("عودة إلى قائمة العروض", "Back to decks")}
          </Button>
        </div>
      </Card>
    );

    // حالة فشل الاستخراج الكامل
    if (detail.status === "FAILED_EXTRACTION") {
      return (
        <div className="space-y-4">
          {header}
          <Alert variant="destructive">
            <XCircle className="size-4" aria-hidden />
            <AlertTitle>
              {t("فشل استخراج العرض", "Deck extraction failed")}
            </AlertTitle>
            <AlertDescription>
              {detail.statusMessage
                ? localizeServerMessage(detail.statusMessage, lang)
                : t(
                    "تعذّر استخراج الشرائح أو الحقول من الملف — جرّب رفع نسخة نصية (غير ممسوحة ضوئيًّا).",
                    "Could not extract slides or fields — try a text-based (non-scanned) file.",
                  )}
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setSelected(null);
                setDetail(null);
                setTimeout(() => fileInputRef.current?.click(), 0);
              }}
              className="h-11"
            >
              <UploadCloud className="size-4" aria-hidden />
              {t("إعادة الرفع", "Re-upload")}
            </Button>
            <Button variant="ghost" onClick={() => setSelected(null)} className="h-11">
              {t("عودة إلى قائمة العروض", "Back to decks")}
            </Button>
          </div>
        </div>
      );
    }

    const pendingFields = detail.fields.filter((f) => f.status === "pending");
    const hasTwoVersions =
      currentDeck && currentDeck.versions.length >= 2 ? true : false;

    return (
      <div className="space-y-4">
        {header}

        <Tabs defaultValue="extraction" dir={lang === "ar" ? "rtl" : "ltr"}>
          <TabsList className="h-auto w-full flex-wrap gap-1 p-1">
            <TabsTrigger value="extraction" className="h-11 flex-1 min-w-32 text-xs sm:text-sm">
              {t("الاستخراج والتأكيد", "Extraction & confirm")}
            </TabsTrigger>
            <TabsTrigger value="readiness" className="h-11 flex-1 min-w-32 text-xs sm:text-sm">
              {t("الجاهزية (9 معايير)", "Readiness (9 criteria)")}
            </TabsTrigger>
            <TabsTrigger value="gaps" className="h-11 flex-1 min-w-32 text-xs sm:text-sm">
              {t("الفجوات", "Gaps")}
            </TabsTrigger>
            <TabsTrigger value="claims" className="h-11 flex-1 min-w-32 text-xs sm:text-sm">
              {t("الادعاءات", "Claims")}
            </TabsTrigger>
            <TabsTrigger value="agents" className="h-11 flex-1 min-w-36 text-xs sm:text-sm">
              {t("مراجعة 20 وكيلًا", "20-agent review")}
            </TabsTrigger>
            <TabsTrigger value="slides" className="h-11 flex-1 min-w-32 text-xs sm:text-sm">
              {t("الشرائح والصياغة", "Slides & wording")}
            </TabsTrigger>
            {hasTwoVersions ? (
              <TabsTrigger value="compare" className="h-11 flex-1 min-w-32 text-xs sm:text-sm">
                {t("مقارنة نسختين", "Compare versions")}
              </TabsTrigger>
            ) : null}
          </TabsList>

          {/* ——— تبويب الاستخراج والتأكيد ——— */}
          <TabsContent value="extraction" className="space-y-4 mt-4">
            {detail.status === "PARTIAL" ? (
              <Alert>
                <AlertTriangle className="size-4 text-amber-600" aria-hidden />
                <AlertTitle>
                  {t("استخراج جزئي", "Partial extraction")}
                </AlertTitle>
                <AlertDescription className="space-y-2">
                  <span>
                    {detail.statusMessage
                      ? localizeServerMessage(detail.statusMessage, lang)
                      : t(
                          "فشل استخراج بعض الحقول — يمكنك إعادة المحاولة لمعالجة الفاشل فقط.",
                          "Some fields failed to extract — retry processes the failed ones only.",
                        )}
                  </span>
                  <span className="block">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void retryExtraction()}
                      disabled={retrying}
                      className="h-11"
                    >
                      {retrying ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <RefreshCw className="size-4" aria-hidden />
                      )}
                      {t("إعادة المحاولة", "Retry")}
                    </Button>
                  </span>
                </AlertDescription>
              </Alert>
            ) : null}

            {detail.fields.length === 0 ? (
              <EmptyState
                iconAr="📋"
                title={t("لا حقول مستخرجة في هذه النسخة", "No extracted fields in this version")}
                hintAr={t(
                  "لم يُستخرج أي حقل بصفحة واقتباس صحيحين — ارفع نسخة أوضح أو أعد المحاولة.",
                  "No field passed the citation guard — upload a clearer version or retry.",
                )}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "راجع كل حقل مع اقتباسه، وحدّد ما تؤكده ليُضاف إلى ملفك — لا يدخل الملف شيء إلا بعد تأكيدك.",
                      "Review each field with its quote; confirm what should enter your profile — nothing enters before your confirmation.",
                    )}
                  </p>
                  <Button
                    onClick={() => void confirmSelected()}
                    disabled={confirming || pendingFields.length === 0}
                    className="h-11"
                  >
                    {confirming ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <CheckCircle2 className="size-4" aria-hidden />
                    )}
                    {t(
                      `تأكيد المختارة (${selectedFieldIds.size})`,
                      `Confirm selected (${selectedFieldIds.size})`,
                    )}
                  </Button>
                </div>

                <div className={cn("space-y-3", SCROLL_CLS)}>
                  {detail.fields.map((f, i) => {
                    const id = `f-${i}-${f.key}-${f.page}`;
                    const conf =
                      EXTRACTION_STATUS_CONF[f.status] ??
                      EXTRACTION_STATUS_CONF.pending;
                    const canConfirm =
                      f.status === "pending" &&
                      (typeof f.value === "string" ||
                        typeof f.value === "number" ||
                        typeof f.value === "boolean" ||
                        f.value === null);
                    const isListValue = Array.isArray(f.value);
                    return (
                      <Card
                        key={id}
                        className={cn(
                          "p-4",
                          f.status === "dropped" && "opacity-70",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            {f.status === "pending" ? (
                              <Checkbox
                                id={id}
                                checked={selectedFieldIds.has(id)}
                                disabled={!canConfirm}
                                onCheckedChange={(c) =>
                                  setSelectedFieldIds((prev) => {
                                    const next = new Set(prev);
                                    if (c) next.add(id);
                                    else next.delete(id);
                                    return next;
                                  })
                                }
                                className="mt-1 size-5"
                                aria-label={fieldLabel(f.key)}
                              />
                            ) : (
                              <span
                                className={cn(
                                  "mt-1 inline-flex size-5 items-center justify-center rounded-full border",
                                  conf.cls,
                                )}
                                aria-hidden
                              >
                                {f.status === "confirmed" ? (
                                  <CheckCircle2 className="size-3.5" />
                                ) : f.status === "rejected" ? (
                                  <XCircle className="size-3.5" />
                                ) : (
                                  <ShieldAlert className="size-3.5" />
                                )}
                              </span>
                            )}
                            <div className="min-w-0">
                              <label
                                htmlFor={f.status === "pending" ? id : undefined}
                                className="font-semibold"
                              >
                                {fieldLabel(f.key)}
                              </label>
                              <p className="mt-0.5 text-sm break-words text-foreground">
                                {formatFieldValue(f.value, t)}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {t("الشريحة", "Slide")}{" "}
                                <span className="tabular-nums" dir="ltr">
                                  {f.page}
                                </span>
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                                conf.cls,
                              )}
                            >
                              {f.status === "dropped" && f.droppedReason
                                ? t(
                                    `سقط بحارس الاقتباس: ${f.droppedReason}`,
                                    `Dropped by citation guard: ${f.droppedReason}`,
                                  )
                                : t(conf.ar, conf.en)}
                            </span>
                            {isListValue ? (
                              <span className="text-xs text-muted-foreground">
                                {t(
                                  "قائمة — تُدار من الملف",
                                  "List — managed in profile",
                                )}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        {f.quote ? (
                          <blockquote
                            dir="rtl"
                            className="mt-3 rounded-e-lg border-s-4 border-teal-400 bg-muted/60 p-3 text-sm italic leading-6 text-foreground"
                          >
                            «{f.quote}»
                          </blockquote>
                        ) : null}

                        <div className="mt-3 max-w-56">
                          <ScoreBar
                            score={Math.round((f.confidence ?? 0) * 100)}
                            max={100}
                            labelAr={t("الثقة", "Confidence")}
                          />
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </>
            )}
          </TabsContent>

          {/* ——— تبويب الجاهزية ——— */}
          <TabsContent value="readiness" className="space-y-4 mt-4">
            <ReadinessCriteriaSection
              readiness={detail.readiness}
              levelBadge={levelBadge}
              t={t}
              lang={lang}
            />
          </TabsContent>

          {/* ——— تبويب الفجوات ——— */}
          <TabsContent value="gaps" className="space-y-4 mt-4">
            <GapSection
              gap={detail.gap}
              onNavigate={onNavigate}
              t={t}
              lang={lang}
            />
          </TabsContent>

          {/* ——— مراجعة متعددة الوكلاء ——— */}
          <TabsContent value="agents" className="space-y-4 mt-4">
            {!detail.agentReview ? (
              <Alert>
                <Sparkles className="size-4" aria-hidden />
                <AlertTitle>{t("لا توجد مراجعة للوكلاء لهذه النسخة", "No agent review is stored for this version")}</AlertTitle>
                <AlertDescription>
                  {t("قد تكون هذه نسخة أقدم من ميزة المراجعة. ارفع نسخة جديدة لتشغيل المهام المتخصصة بالتوازي.", "This version may predate the agent review feature. Upload a new version to run the specialist tasks in parallel.")}
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-4">
                <Card className="p-4 sm:p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">{t("ملخص المراجعة متعددة المهام", "Multi-agent review summary")}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{t("مهام مكتملة", "Completed tasks")}: <span dir="ltr" className="tabular-nums">{detail.agentReview.completedAgents}/{detail.agentReview.totalAgents}</span></p>
                    </div>
                    <Badge variant={detail.agentReview.status === "completed" ? "default" : detail.agentReview.status === "partial" ? "secondary" : "outline"}>
                      {detail.agentReview.status === "completed" ? t("اكتملت", "Completed") : detail.agentReview.status === "partial" ? t("جزئية", "Partial") : t("غير متاحة", "Unavailable")}
                    </Badge>
                  </div>
                  <p className="text-sm leading-7">{lang === "ar" ? detail.agentReview.summaryAr : detail.agentReview.summaryEn}</p>
                  {((lang === "ar" ? detail.agentReview.prioritiesAr : detail.agentReview.prioritiesEn) ?? []).length > 0 ? (
                    <div className="space-y-2">
                      <h4 className="font-semibold text-sm">{t("أولويات المراجعة", "Review priorities")}</h4>
                      <ul className="list-disc space-y-1.5 ps-5 text-sm text-muted-foreground">
                        {(lang === "ar" ? detail.agentReview.prioritiesAr : detail.agentReview.prioritiesEn).map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </Card>
                {detail.agentReview.status === "unavailable" ? (
                  <Alert>
                    <ShieldAlert className="size-4" aria-hidden />
                    <AlertTitle>{t("يلزم إعداد مزوّد الذكاء الاصطناعي", "An AI provider must be configured")}</AlertTitle>
                    <AlertDescription>{t("أضف OPENAI_API_KEY إلى متغيرات بيئة الخادم لتفعيل نماذج المراجعة، أو أعد ضبط مزوّد GLM. لم تُنشأ نتائج وهمية بديلة.", "Set OPENAI_API_KEY in the server environment to enable the review models, or configure the GLM provider. No fake findings were substituted.")}</AlertDescription>
                  </Alert>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2">
                  {detail.agentReview.agents.map((agent) => (
                    <Card key={agent.id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h4 className="font-semibold text-sm">{lang === "ar" ? agent.nameAr : agent.nameEn}</h4>
                          <p className="mt-1 text-xs text-muted-foreground">{lang === "ar" ? agent.summaryAr : agent.summaryEn}</p>
                        </div>
                        <Badge variant={agent.status === "completed" ? "secondary" : "outline"} className="shrink-0">
                          {agent.status === "completed" ? t("اكتمل", "Done") : agent.status === "unavailable" ? t("غير متاح", "Unavailable") : t("خطأ", "Error")}
                        </Badge>
                      </div>
                      {(lang === "ar" ? agent.strengthsAr : agent.strengthsEn).length > 0 ? (
                        <div className="text-xs text-muted-foreground">
                          <b className="text-foreground">{t("نقاط إيجابية", "Strengths")}</b>
                          <ul className="list-disc space-y-1 ps-4 pt-1">{(lang === "ar" ? agent.strengthsAr : agent.strengthsEn).map((item, i) => <li key={`${i}-${item}`}>{item}</li>)}</ul>
                        </div>
                      ) : null}
                      {agent.findings.map((finding) => (
                        <div key={finding.id} className="rounded-md border p-3 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-sm">{lang === "ar" ? finding.titleAr : finding.titleEn}</span>
                            <Badge variant="outline" className={finding.severity === "critical" || finding.severity === "high" ? "border-red-300 text-red-700 dark:text-red-300" : ""}>
                              {t(({critical:"حرجة",high:"مرتفعة",medium:"متوسطة",low:"منخفضة"} as const)[finding.severity], ({critical:"Critical",high:"High",medium:"Medium",low:"Low"} as const)[finding.severity])}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{lang === "ar" ? finding.detailsAr : finding.detailsEn}</p>
                          <p className="text-sm">{lang === "ar" ? finding.recommendationAr : finding.recommendationEn}</p>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {finding.slideIndex !== null ? <span>{t("الشريحة", "Slide")} <b dir="ltr">{finding.slideIndex}</b></span> : null}
                            <span>{finding.evidenceStatus === "supported" ? t("اقتباس متحقق", "Quote verified") : finding.evidenceStatus === "missing" ? t("الدليل مفقود", "Evidence missing") : finding.evidenceStatus === "contradictory" ? t("دليل متعارض", "Conflicting evidence") : t("يحتاج تحققًا", "Needs verification")}</span>
                          </div>
                          {finding.evidenceQuote ? <blockquote className="border-s-2 ps-3 text-xs text-muted-foreground">“{finding.evidenceQuote}”</blockquote> : null}
                        </div>
                      ))}
                      {(lang === "ar" ? agent.missingEvidenceAr : agent.missingEvidenceEn).length > 0 ? (
                        <div className="text-xs text-muted-foreground"><b className="text-foreground">{t("أدلة ناقصة", "Missing evidence")}</b><ul className="list-disc ps-4 pt-1">{(lang === "ar" ? agent.missingEvidenceAr : agent.missingEvidenceEn).map((item, i) => <li key={`${i}-${item}`}>{item}</li>)}</ul></div>
                      ) : null}
                    </Card>
                  ))}
                </div>
                <p className="text-xs leading-6 text-muted-foreground">{lang === "ar" ? detail.agentReview.disclaimerAr : detail.agentReview.disclaimerEn}</p>
              </div>
            )}
          </TabsContent>

          {/* ——— تبويب الادعاءات ——— */}
          <TabsContent value="claims" className="space-y-4 mt-4">
            {detail.claims.length === 0 && detail.contradictions.length === 0 ? (
              <EmptyState
                iconAr="📈"
                title={t("لا ادعاءات رقمية في هذا العرض", "No numeric claims in this deck")}
                hintAr={t(
                  "لم تُستخرج ادعاءات رقمية (إيرادات، نمو، أحجام سوق...) من الشرائح.",
                  "No numeric claims (revenue, growth, market sizes...) were extracted.",
                )}
              />
            ) : (
              <>
                {detail.claims.length > 0 ? (
                  <section className="space-y-2" aria-labelledby="claims-h">
                    <h4 id="claims-h" className="font-semibold">
                      {t(
                        `الادعاءات المستخرجة (${detail.claims.length})`,
                        `Extracted claims (${detail.claims.length})`,
                      )}
                    </h4>
                    <ul className={cn("space-y-2", SCROLL_CLS)}>
                      {detail.claims.map((c, i) => {
                        const typeConf =
                          CLAIM_TYPE_LABELS[c.type] ?? CLAIM_TYPE_LABELS.other;
                        return (
                          <li key={c.id ?? i}>
                            <Card className="p-4">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <Badge variant="secondary">
                                  {t(typeConf.ar, typeConf.en)}
                                </Badge>
                                <span className="font-bold tabular-nums" dir="ltr">
                                  {c.value}
                                  {c.unit ? ` ${c.unit}` : ""}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {t("الشريحة", "Slide")}{" "}
                                  <span className="tabular-nums" dir="ltr">
                                    {c.page}
                                  </span>
                                </span>
                                {c.status === "dropped" ? (
                                  <Badge variant="outline">
                                    {t("سقط", "Dropped")}
                                  </Badge>
                                ) : null}
                              </div>
                              {c.quote ? (
                                <blockquote
                                  dir="rtl"
                                  className="mt-2 rounded-e-lg border-s-4 border-muted-foreground/40 bg-muted/60 p-2.5 text-sm italic leading-6"
                                >
                                  «{c.quote}»
                                </blockquote>
                              ) : null}
                            </Card>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ) : null}

                {detail.contradictions.length > 0 ? (
                  <section
                    className="space-y-2"
                    aria-labelledby="contradictions-h"
                  >
                    <h4 id="contradictions-h" className="font-semibold">
                      {t("تعارضات محتملة", "Possible contradictions")}
                    </h4>
                    <ul className="space-y-2">
                      {detail.contradictions.map((c, i) => (
                        <li key={i}>
                          <Alert className="border-amber-300 bg-amber-50/80 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                            <AlertTriangle className="size-4" aria-hidden />
                            <AlertDescription>
                              {c.ar}
                              {c.pages?.length ? (
                                <span className="ms-1 text-xs">
                                  (
                                  {t("الشرائح", "Slides")}:{" "}
                                  <span className="tabular-nums" dir="ltr">
                                    {c.pages.join(", ")}
                                  </span>
                                  )
                                </span>
                              ) : null}
                            </AlertDescription>
                          </Alert>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </>
            )}
          </TabsContent>

          {/* ——— تبويب الشرائح والصياغة ——— */}
          <TabsContent value="slides" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">
              {t(
                "انقر شريحة لطلب اقتراح صياغة أوضح — الأصل محفوظ ولا يتغير، والقرار لك (قبول/تعديل/رفض).",
                "Click a slide to request a clearer wording — the original never changes; the decision is yours.",
              )}
            </p>
            {detail.slides.length === 0 ? (
              <EmptyState
                iconAr="📄"
                title={t("لا شرائح في هذه النسخة", "No slides in this version")}
              />
            ) : (
              <ul className={cn("space-y-2", SCROLL_CLS)}>
                {detail.slides.map((s) => (
                  <li key={s.index}>
                    <button
                      type="button"
                      onClick={() => setSlideDialogIndex(s.index)}
                      className="w-full rounded-xl border p-4 text-start transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring min-h-11"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 font-semibold">
                          <FileText
                            className="size-4 text-teal-700 dark:text-teal-400"
                            aria-hidden
                          />
                          <span className="tabular-nums" dir="ltr">
                            #{s.index}
                          </span>
                          <span className="break-words">
                            {s.title || t("(بلا عنوان)", "(untitled)")}
                          </span>
                        </span>
                        <Sparkles
                          className="size-4 shrink-0 text-amber-600"
                          aria-hidden
                        />
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground leading-6">
                        {s.text || t("(نص فارغ)", "(empty text)")}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          {/* ——— تبويب مقارنة نسختين ——— */}
          {hasTwoVersions && currentDeck ? (
            <TabsContent value="compare" className="space-y-4 mt-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cmp-from">{t("من النسخة", "From version")}</Label>
                  <Select
                    value={compareFrom}
                    onValueChange={(v) => setCompareFrom(v)}
                  >
                    <SelectTrigger id="cmp-from" className="h-11 w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {currentDeck.versions.map((v) => (
                        <SelectItem key={v.versionNumber} value={String(v.versionNumber)}>
                          <span dir="ltr">v{v.versionNumber}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <GitCompareArrows
                  className="size-5 text-muted-foreground"
                  aria-hidden
                />
                <div className="space-y-1.5">
                  <Label htmlFor="cmp-to">{t("إلى النسخة", "To version")}</Label>
                  <Select value={compareTo} onValueChange={(v) => setCompareTo(v)}>
                    <SelectTrigger id="cmp-to" className="h-11 w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {currentDeck.versions.map((v) => (
                        <SelectItem key={v.versionNumber} value={String(v.versionNumber)}>
                          <span dir="ltr">v{v.versionNumber}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => void runCompare()}
                  disabled={comparing || !compareFrom || !compareTo}
                  className="h-11"
                >
                  {comparing ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <GitCompareArrows className="size-4" aria-hidden />
                  )}
                  {t("قارن", "Compare")}
                </Button>
              </div>

              {compareData ? (
                <CompareResultView
                  data={compareData}
                  t={t}
                  levelBadge={levelBadge}
                  lang={lang}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t(
                    "اختر النسختين ثم اضغط «قارن» لعرض الفروق (الحقول، المعايير، الادعاءات المضافة/المحذوفة).",
                    "Pick two versions then hit Compare to see the differences.",
                  )}
                </p>
              )}
            </TabsContent>
          ) : null}
        </Tabs>

        {/* شاشة تصحيح الشريحة داخل Dialog */}
        <Dialog
          open={slideDialogIndex !== null}
          onOpenChange={(o) => !o && setSlideDialogIndex(null)}
        >
          <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {t("تصحيح الشريحة", "Slide correction")}
                {slideDialogIndex !== null ? (
                  <span className="tabular-nums" dir="ltr"> #{slideDialogIndex}</span>
                ) : null}
              </DialogTitle>
              <DialogDescription>
                {t(
                  "الأصل محفوظ ولا يتغير — اقبل المقترح أو عدّله أو ارفضه.",
                  "The original is preserved — accept, edit, or reject the suggestion.",
                )}
              </DialogDescription>
            </DialogHeader>
            {slideDialogIndex !== null && selected ? (
              <SlideCorrectionView
                deckId={selected.deckId}
                version={selected.version}
                slideIndex={slideDialogIndex}
                onClose={() => setSlideDialogIndex(null)}
                slides={detail?.slides}
                readiness={detail?.readiness ?? null}
                suggestions={detail?.suggestions ?? []}
              />
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    );
  };

  // ————— عرض القائمة + الرفع —————

  const renderListScreen = () => (
    <div className="space-y-6">
      {/* منطقة الرفع */}
      <section aria-labelledby="deck-upload-h">
        <h2 id="deck-upload-h" className="mb-3 text-lg font-bold">
          {t("رفع العرض التقديمي", "Upload your pitch deck")}
        </h2>
        <div
          role="button"
          tabIndex={0}
          aria-label={t(
            "اسحب ملف العرض هنا أو اختَر ملفًا (PDF أو PPTX حتى 20 ميجابايت)",
            "Drop your deck here or choose a file (PDF or PPTX up to 20MB)",
          )}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-6 text-center transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            dragging
              ? "border-teal-500 bg-teal-50/60 dark:bg-teal-950/40"
              : "border-border bg-card hover:bg-accent",
            uploading && "pointer-events-none opacity-80",
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0])}
            aria-hidden
            tabIndex={-1}
          />
          {uploading ? (
            <>
              <Loader2
                className="size-10 animate-spin text-teal-700 dark:text-teal-400"
                aria-hidden
              />
              <p className="font-semibold">
                {t(
                  "جارٍ استخراج الشرائح والحقول...",
                  "Extracting slides and fields...",
                )}
              </p>
              {uploadFileName ? (
                <p className="text-sm text-muted-foreground break-all" dir="ltr">
                  {uploadFileName}
                </p>
              ) : null}
              <Progress value={75} className="w-64 max-w-full" />
            </>
          ) : (
            <>
              <CloudUpload
                className="size-10 text-teal-700 dark:text-teal-400"
                aria-hidden
              />
              <p className="font-semibold">
                {t(
                  "اسحب ملف العرض هنا أو اختَر ملفًا",
                  "Drag your deck here or choose a file",
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("PDF أو PPTX — حتى 20 ميجابايت و60 صفحة", "PDF or PPTX — up to 20MB and 60 pages")}
              </p>
              <Button
                variant="outline"
                className="h-11"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                <UploadCloud className="size-4" aria-hidden />
                {t("اختيار ملف", "Choose file")}
              </Button>
            </>
          )}
        </div>
      </section>

      {/* قائمة العروض */}
      <section aria-labelledby="deck-list-h" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="deck-list-h" className="text-lg font-bold">
            {t("نسخ العرض", "Deck versions")}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadDecks()}
            disabled={listLoading}
            className="h-11"
            aria-label={t("تحديث القائمة", "Refresh list")}
          >
            <RefreshCw
              className={cn("size-4", listLoading && "animate-spin")}
              aria-hidden
            />
          </Button>
        </div>

        {listLoading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : listError ? (
          <EmptyState
            iconAr="⚠️"
            title={t("تعذّر جلب قائمة العروض", "Failed to load decks")}
            hintAr={listError}
            action={
              <Button variant="outline" onClick={() => void loadDecks()} className="h-11">
                <RefreshCw className="size-4" aria-hidden />
                {t("إعادة المحاولة", "Retry")}
              </Button>
            }
          />
        ) : !decks || decks.length === 0 ? (
          <EmptyState
            iconAr="📭"
            title={t("لم ترفع أي عرض بعد", "No decks uploaded yet")}
            hintAr={t(
              "ارفع عرضك (PDF/PPTX) ليُستخرج ملف شركتك من الشرائح مع الاقتباسات، وتُحسب الجاهزية والفجوات.",
              "Upload your deck (PDF/PPTX) to extract your profile fields with quotes, plus readiness and gaps.",
            )}
            action={
              <Button onClick={() => fileInputRef.current?.click()} className="h-11">
                <UploadCloud className="size-4" aria-hidden />
                {t("ارفع أول عرض", "Upload your first deck")}
              </Button>
            }
          />
        ) : (
          <div className={cn("space-y-3", SCROLL_CLS)}>
            {decks.map((d) => (
              <Card key={d.id} className="p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet
                      className="size-5 text-teal-700 dark:text-teal-400"
                      aria-hidden
                    />
                    <h3 className="font-bold">
                      {t("عرض", "Deck")}{" "}
                      <span className="tabular-nums" dir="ltr">
                        {d.id.slice(-6)}
                      </span>
                    </h3>
                    <Badge variant="secondary">
                      {t(
                        `${d.versions.length} نسخة/نسخ`,
                        `${d.versions.length} version(s)`,
                      )}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteTarget(d)}
                    className="h-11 text-rose-700 hover:text-rose-800 dark:text-rose-400"
                    aria-label={t("حذف العرض", "Delete deck")}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
                <ul className="mt-3 space-y-2">
                  {d.versions.map((v) => (
                    <li
                      key={v.versionNumber}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                        <Badge variant="outline" className="tabular-nums" dir="ltr">
                          v{v.versionNumber}
                        </Badge>
                        {statusBadge(v.status)}
                        <Badge variant="outline" dir="ltr">
                          {fileTypeLabel(v.fileType)}
                        </Badge>
                        <span className="text-muted-foreground">
                          {t("الشرائح", "Slides")}:{" "}
                          <span className="tabular-nums" dir="ltr">
                            {v.slideCount}
                          </span>
                        </span>
                        <span className="text-muted-foreground">
                          {formatDate(v.createdAt, lang)}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        onClick={() =>
                          setSelected({ deckId: d.id, version: v.versionNumber })
                        }
                        className="h-11"
                      >
                        {t("عرض النتيجة", "View result")}
                        <ChevronLeft className="size-4" aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );

  return (
    <div className="space-y-6">
      <Toaster richColors closeButton position="top-center" dir={lang === "ar" ? "rtl" : "ltr"} />
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">
          {t("تحليل العرض التقديمي", "Pitch deck analysis")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "ارفع عرضك ليُستخرج ملف شركتك شريحةً بشريحة — لا يدخل الملف شيء إلا بعد تأكيدك، وكل قيمة بلا اقتباس صحيح تُسقط.",
            "Upload your deck to extract your profile slide by slide — nothing enters your profile without confirmation, and values without a valid quote are dropped.",
          )}
        </p>
      </header>
      {selected ? renderVersionScreen() : renderListScreen()}

      {/* حوار تأكيد الحذف */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("حذف العرض وجميع نسخه؟", "Delete this deck and all its versions?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "سيُحذف العرض وكل نسخه ونتائج استخراجه نهائيًا — لا يمكن التراجع عن هذا الإجراء. ملفك الحالي لا يتأثر.",
                "The deck, all its versions, and extraction results will be permanently deleted. Your current profile is not affected.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("إلغاء", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void deleteDeck();
              }}
              disabled={deleting}
              className="h-11 bg-rose-600 text-white hover:bg-rose-700"
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="size-4" aria-hidden />
              )}
              {t("نعم، احذف", "Yes, delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ————— قسم معايير الجاهزية (يُشارك مع ReadinessView بأسلوبه المحلي) —————

function ReadinessCriteriaSection({
  readiness,
  levelBadge,
  t,
  lang,
}: {
  readiness: ReadinessReport | null;
  levelBadge: (level: string) => React.ReactNode;
  t: (ar: string, en: string) => string;
  lang: "ar" | "en";
}) {
  const criteria: CriterionResult[] =
    readiness?.criteria && readiness.criteria.length > 0
      ? readiness.criteria
      : Object.entries(CRITERIA_LABELS).map(([key, c]) => ({
          key,
          labelAr: c.ar,
          labelEn: c.en,
          level: "missing" as const,
          evidenceAr: "",
          evidenceEn: "",
          slides: [] as number[],
        }));
  const counts = { strong: 0, adequate: 0, weak: 0, missing: 0 } as Record<
    string,
    number
  >;
  for (const c of criteria) counts[c.level] = (counts[c.level] ?? 0) + 1;

  return (
    <div className="space-y-4">
      {readiness?.overallSummaryAr ? (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm leading-6">
          {lang === "ar" ? readiness.overallSummaryAr : readiness.overallSummaryEn ?? "The readiness summary is only available in Arabic for this older report."}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          labelAr={t("قوي", "Strong")}
          value={<span className="text-emerald-700 dark:text-emerald-400">{counts.strong ?? 0}</span>}
        />
        <StatCard
          labelAr={t("مقبول", "Adequate")}
          value={<span className="text-amber-700 dark:text-amber-400">{counts.adequate ?? 0}</span>}
        />
        <StatCard
          labelAr={t("ضعيف", "Weak")}
          value={<span className="text-rose-700 dark:text-rose-400">{counts.weak ?? 0}</span>}
        />
        <StatCard labelAr={t("غائب", "Missing")} value={counts.missing ?? 0} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {criteria.map((c) => (
          <Card key={c.key} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-semibold text-sm">
                {lang === "ar"
                  ? (c.labelAr ?? CRITERIA_LABELS[c.key]?.ar ?? c.key)
                  : (c.labelEn ?? CRITERIA_LABELS[c.key]?.en ?? c.key)}
              </h4>
              {levelBadge(c.level)}
            </div>
            {(lang === "ar" ? c.evidenceAr : c.evidenceEn) ? (
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                {lang === "ar" ? c.evidenceAr : c.evidenceEn}
              </p>
            ) : null}
            {Array.isArray(c.slides) && c.slides.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("الشرائح", "Slides")}:{" "}
                <span className="tabular-nums" dir="ltr">
                  {c.slides.join(", ")}
                </span>
              </p>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ————— قسم الفجوات —————

function GapSection({
  gap,
  onNavigate,
  t,
  lang,
}: {
  gap: GapReport | null;
  onNavigate: ViewProps["onNavigate"];
  t: (ar: string, en: string) => string;
  lang: "ar" | "en";
}) {
  if (!gap) {
    return (
      <EmptyState
        iconAr="❓"
        title={t("لا يوجد تقرير فجوات لهذه النسخة", "No gap report for this version")}
        hintAr={t(
          "يُبنى تقرير الفجوات بعد اكتمال الاستخراج ووجود مطابقات لملفك.",
          "The gap report is built once extraction completes and matches exist for your profile.",
        )}
      />
    );
  }
  const missingFields = gap.missingProfileFields ?? [];
  const missingCriteria = gap.missingCriteria ?? [];
  const perOpp = gap.perOpportunity ?? [];
  const notes = lang === "ar" ? (gap.notesAr ?? []) : (gap.notesEn ?? (gap.notesAr ?? []).map((note) => localizeServerMessage(note, lang)));

  if (
    missingFields.length === 0 &&
    missingCriteria.length === 0 &&
    perOpp.length === 0 &&
    notes.length === 0
  ) {
    return (
      <EmptyState
        iconAr="✅"
        title={t("لا فجوات مرصودة", "No gaps detected")}
        hintAr={t(
          "ملفك ومعايير عرضك تغطي ما تحتاجه الفرص ذات الصلة حاليًّا.",
          "Your profile and deck criteria currently cover the related opportunities.",
        )}
      />
    );
  }

  return (
    <div className="space-y-5">
      {missingFields.length > 0 ? (
        <section className="space-y-2" aria-labelledby="gap-fields">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 id="gap-fields" className="font-semibold">
              {t(
                `حقول الملف الناقصة (${missingFields.length})`,
                `Missing profile fields (${missingFields.length})`,
              )}
            </h4>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onNavigate("profile")}
              className="h-11"
            >
              {t("ملء الملف", "Fill the profile")}
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          </div>
          <ul className="flex flex-wrap gap-2">
            {missingFields.map((f) => (
              <li key={f}>
                <Badge variant="outline">{fieldLabel(f)}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {missingCriteria.length > 0 ? (
        <section className="space-y-2" aria-labelledby="gap-criteria">
          <h4 id="gap-criteria" className="font-semibold">
            {t(
              `معايير العرض الناقصة (${missingCriteria.length})`,
              `Missing deck criteria (${missingCriteria.length})`,
            )}
          </h4>
          <ul className="flex flex-wrap gap-2">
            {missingCriteria.map((c) => (
              <li key={c}>
                <Badge variant="outline">
                  {lang === "ar" ? (CRITERIA_LABELS[c]?.ar ?? c) : (CRITERIA_LABELS[c]?.en ?? c)}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {perOpp.length > 0 ? (
        <section className="space-y-2" aria-labelledby="gap-opps">
          <h4 id="gap-opps" className="font-semibold">
            {t(
              "فجوات الفرص ذات الصلة",
              "Gaps for related opportunities",
            )}
          </h4>
          <ul className={cn("space-y-2", SCROLL_CLS)}>
            {perOpp.map((o) => (
              <li key={o.opportunityId}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h5 className="font-semibold text-sm">{o.title}</h5>
                    <JudgmentBadge judgment={o.judgment} />
                  </div>
                  {(lang === "ar" ? (o.gapsAr ?? []) : (o.gapsEn ?? (o.gapsAr ?? []).map((x) => localizeServerMessage(x, lang)))).length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {(lang === "ar" ? (o.gapsAr ?? []) : (o.gapsEn ?? (o.gapsAr ?? []).map((x) => localizeServerMessage(x, lang)))).map((g, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-sm leading-6"
                        >
                          <span
                            className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-amber-500"
                            aria-hidden
                          />
                          {g}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {(o.missingDocs ?? []).length > 0 ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        {t("مستندات ناقصة", "Missing docs")}:
                      </span>
                      {o.missingDocs.map((doc) => (
                        <Badge
                          key={doc}
                          variant="outline"
                          className="border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-300"
                        >
                          {DOC_LABELS[doc]?.[lang] ?? doc}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {notes.length > 0 ? (
        <section className="space-y-2" aria-labelledby="gap-notes">
          <h4 id="gap-notes" className="font-semibold">
            {t("ملاحظات عامة", "General notes")}
          </h4>
          <ul className="space-y-1.5">
            {notes.map((n, i) => (
              <li key={i} className="text-sm leading-6 text-muted-foreground">
                • {n}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// ————— عرض نتيجة المقارنة —————

function CompareResultView({
  data,
  t,
  levelBadge,
  lang,
}: {
  data: CompareData;
  t: (ar: string, en: string) => string;
  levelBadge: (level: string) => React.ReactNode;
  lang: "ar" | "en";
}) {
  const empty =
    data.fields.length === 0 &&
    data.criteria.length === 0 &&
    data.claimsAdded.length === 0 &&
    data.claimsRemoved.length === 0;
  if (empty) {
    return (
      <EmptyState
        iconAr="⚖️"
        title={t("لا فروق بين النسختين", "No differences between the versions")}
        hintAr={t(
          "الحقول والمعايير والادعاءات متطابقة بين النسختين المحددتين.",
          "Fields, criteria, and claims are identical between the selected versions.",
        )}
      />
    );
  }
  return (
    <div className="space-y-5">
      {data.fields.length > 0 ? (
        <section className="space-y-2" aria-labelledby="cmp-fields">
          <h4 id="cmp-fields" className="font-semibold">
            {t("الحقول المتغيرة", "Changed fields")}
          </h4>
          <ul className="space-y-2">
            {data.fields.map((f, i) => (
              <li key={`${f.key}-${i}`}>
                <Card className="p-3">
                  <p className="text-sm font-semibold">{fieldLabel(f.key)}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
                      {formatFieldValue(f.from, t)}
                    </span>
                    <span aria-hidden>←</span>
                    <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      {formatFieldValue(f.to, t)}
                    </span>
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.criteria.length > 0 ? (
        <section className="space-y-2" aria-labelledby="cmp-criteria">
          <h4 id="cmp-criteria" className="font-semibold">
            {t("المعايير المتغيرة", "Changed criteria")}
          </h4>
          <ul className="space-y-2">
            {data.criteria.map((c, i) => (
              <li key={`${c.key}-${i}`}>
                <Card className="p-3">
                  <p className="text-sm font-semibold">
                    {CRITERIA_LABELS[c.key]?.ar ?? c.key}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2">
                    {levelBadge(String(c.from ?? "missing"))}
                    <span aria-hidden>←</span>
                    {levelBadge(String(c.to ?? "missing"))}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.claimsAdded.length > 0 ? (
        <section className="space-y-2" aria-labelledby="cmp-added">
          <h4 id="cmp-added" className="font-semibold">
            {t(
              `ادعاءات مضافة (${data.claimsAdded.length})`,
              `Added claims (${data.claimsAdded.length})`,
            )}
          </h4>
          <ul className="space-y-1.5">
            {data.claimsAdded.map((c, i) => (
              <li
                key={i}
                className="rounded-lg border border-emerald-300 bg-emerald-50/60 p-2.5 text-sm dark:border-emerald-800 dark:bg-emerald-950/30"
              >
                <span className="font-semibold tabular-nums" dir="ltr">
                  {c.value}
                  {c.unit ? ` ${c.unit}` : ""}
                </span>{" "}
                — {lang === "ar" ? (CLAIM_TYPE_LABELS[c.type]?.ar ?? c.type) : (CLAIM_TYPE_LABELS[c.type]?.en ?? c.type)} —{" "}
                {t("الشريحة", "Slide")}{" "}
                <span className="tabular-nums" dir="ltr">
                  {c.page}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.claimsRemoved.length > 0 ? (
        <section className="space-y-2" aria-labelledby="cmp-removed">
          <h4 id="cmp-removed" className="font-semibold">
            {t(
              `ادعاءات محذوفة (${data.claimsRemoved.length})`,
              `Removed claims (${data.claimsRemoved.length})`,
            )}
          </h4>
          <ul className="space-y-1.5">
            {data.claimsRemoved.map((c, i) => (
              <li
                key={i}
                className="rounded-lg border border-rose-300 bg-rose-50/60 p-2.5 text-sm line-through decoration-rose-400/70 dark:border-rose-800 dark:bg-rose-950/30"
              >
                <span className="font-semibold tabular-nums" dir="ltr">
                  {c.value}
                  {c.unit ? ` ${c.unit}` : ""}
                </span>{" "}
                — {lang === "ar" ? (CLAIM_TYPE_LABELS[c.type]?.ar ?? c.type) : (CLAIM_TYPE_LABELS[c.type]?.en ?? c.type)} —{" "}
                {t("الشريحة", "Slide")}{" "}
                <span className="tabular-nums" dir="ltr">
                  {c.page}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.notesAr.length > 0 ? (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {data.notesAr.map((n, i) => (
            <li key={i}>• {n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
