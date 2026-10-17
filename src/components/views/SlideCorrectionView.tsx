"use client";
/**
 * Masar — T18: شاشة تصحيح الشريحة (SlideCorrectionView)
 * =============================================================================
 * props (عقد المهمة): { deckId, version, slideIndex, onClose } — تُعرض داخل
 * Dialog من DeckView. تُضاف بيانات النسخة اختياريًا (slides/readiness/
 * suggestions) لتفادي إعادة الجلب؛ وإن غابت تجلبها الشاشة بنفسها
 * (GET /decks/[id]/versions/[v]).
 *
 * المبادئ الملزِمة (§10): الأصل محفوظ ولا يُعدَّل؛ الاقتراح عند الطلب فقط؛
 * القرار accepted/edited/rejected عبر PATCH؛ suggestedText يُعرض نصًّا خامًّا
 * (XSS-safe: لا HTML إطلاقًا — whitespace-pre-wrap فقط).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { useI18n, formatDate } from "@/components/app/i18n";
import { EmptyState } from "@/components/app/badges";
import type { ReadinessReport, Slide } from "@/lib/core/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  FileText,
  ListChecks,
  Loader2,
  Lock,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ————— أنواع محلية (أشكال متوقعة من مسارات T12/T13 — دفاعية) —————

export interface GuardFlagLite {
  rule?: string;
  detailAr?: string;
  detail?: string;
}

export interface SuggestionGuardLite {
  passed?: boolean;
  verdict?: string;
  flags?: GuardFlagLite[];
}

export interface SuggestionRecord {
  id?: string;
  slideIndex: number;
  suggestedText: string;
  reason?: string | null;
  reasonAr?: string | null;
  guard?: SuggestionGuardLite | null;
  decision: string; // pending | accepted | edited | rejected
  editedText?: string | null;
  decidedAt?: string | null;
  createdAt?: string | null;
}

interface SuggestResponse {
  suggestedText?: string;
  reasonAr?: string | null;
  reason?: string | null;
  guard?: SuggestionGuardLite | null;
  provider?: string;
  suggestion?: {
    suggestedText?: string;
    reasonAr?: string | null;
    reason?: string | null;
    guard?: SuggestionGuardLite | null;
  };
}

export interface SlideCorrectionProps {
  deckId: string;
  version: number;
  slideIndex: number;
  onClose: () => void;
  /** تمرير اختياري من DeckView (تفادي إعادة الجلب) */
  slides?: Slide[];
  readiness?: ReadinessReport | null;
  suggestions?: SuggestionRecord[];
}

// ————— مساعدات دفاعية —————

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function extractSuggestions(data: unknown): SuggestionRecord[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const raw =
    d.suggestions ?? d.slideSuggestions ?? d.history ?? d.suggestionLog ?? [];
  return arr<Record<string, unknown>>(raw)
    .map((s) => ({
      id: typeof s.id === "string" ? s.id : undefined,
      slideIndex: Number(s.slideIndex ?? 0),
      suggestedText: String(s.suggestedText ?? s.text ?? ""),
      reason: (s.reasonAr ?? s.reason ?? null) as string | null,
      guard: (s.guard ?? s.guardReport ?? null) as SuggestionGuardLite | null,
      decision: String(s.decision ?? "pending"),
      editedText: (s.editedText ?? null) as string | null,
      decidedAt: (s.decidedAt ?? null) as string | null,
      createdAt: (s.createdAt ?? null) as string | null,
    }))
    .filter((s) => s.suggestedText !== "");
}

function normalizeSuggestResponse(data: unknown): {
  suggestedText: string;
  reasonAr: string | null;
  guard: SuggestionGuardLite | null;
} {
  const d = (data ?? {}) as Record<string, unknown>;
  const nested = (d.suggestion ?? null) as Record<string, unknown> | null;
  return {
    suggestedText: String(
      (nested?.suggestedText ?? d.suggestedText ?? d.text ?? "") || "",
    ),
    reasonAr: ((nested?.reasonAr ?? nested?.reason ?? d.reasonAr ?? d.reason ?? null) as string | null),
    guard: ((nested?.guard ?? nested?.guardReport ?? d.guard ?? d.guardReport ?? null) as SuggestionGuardLite | null),
  };
}

// ————— مستويات وألوان —————

const READINESS_LEVEL_AR: Record<string, { ar: string; en: string; cls: string }> = {
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

const DECISION_CONF: Record<string, { ar: string; en: string; icon: React.ReactNode; cls: string }> = {
  accepted: {
    ar: "قُبل المقترح",
    en: "Accepted",
    icon: <CheckCircle2 className="size-3.5" aria-hidden />,
    cls: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  edited: {
    ar: "اعتُمد معدَّلًا",
    en: "Edited",
    icon: <Pencil className="size-3.5" aria-hidden />,
    cls: "border-teal-300 bg-teal-100 text-teal-800 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300",
  },
  rejected: {
    ar: "رُفض",
    en: "Rejected",
    icon: <XCircle className="size-3.5" aria-hidden />,
    cls: "border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300",
  },
  pending: {
    ar: "بانتظار قرارك",
    en: "Pending",
    icon: <ListChecks className="size-3.5" aria-hidden />,
    cls: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
};

/** قائمة أزرار التمرير المخصصة (شريط أنحف وأنيق) */
const SCROLL_CLS =
  "max-h-96 overflow-y-auto pe-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border";

// ————— المكوّن —————

export default function SlideCorrectionView({
  deckId,
  version,
  slideIndex,
  onClose,
  slides: slidesProp,
  readiness: readinessProp,
  suggestions: suggestionsProp,
}: SlideCorrectionProps) {
  const { t, lang } = useI18n();

  const [slides, setSlides] = useState<Slide[] | undefined>(slidesProp);
  const [readiness, setReadiness] = useState<ReadinessReport | null>(
    readinessProp ?? null,
  );
  const [suggestions, setSuggestions] = useState<SuggestionRecord[]>(
    suggestionsProp ?? [],
  );
  const [selfLoading, setSelfLoading] = useState(false);
  const [selfError, setSelfError] = useState<string | null>(null);

  // المقترح الحالي (من زر الاقتراح)
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<{
    suggestedText: string;
    reasonAr: string | null;
    guard: SuggestionGuardLite | null;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editedDraft, setEditedDraft] = useState("");
  const [deciding, setDeciding] = useState<string | null>(null);
  const [decided, setDecided] = useState<string | null>(null);

  // جلب بيانات النسخة إن لم تُمرَّر
  useEffect(() => {
    if (slidesProp !== undefined) return;
    let cancelled = false;
    setSelfLoading(true);
    setSelfError(null);
    api
      .get<unknown>(`/decks/${deckId}/versions/${version}`)
      .then((data) => {
        if (cancelled) return;
        const d = (data ?? {}) as Record<string, unknown>;
        setSlides(arr<Slide>(d.slides ?? d.slidesList ?? []));
        const rd = (d.readiness ?? d.readinessReport ?? null) as
          | ReadinessReport
          | null;
        setReadiness(rd && typeof rd === "object" ? rd : null);
        setSuggestions(extractSuggestions(d));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setSelfError(
          e instanceof Error
            ? e.message
            : t("تعذّر جلب بيانات النسخة", "Failed to load version"),
        );
      })
      .finally(() => {
        if (!cancelled) setSelfLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deckId, version, slidesProp]);

  const slide = useMemo(() => {
    if (!slides || slides.length === 0) return null;
    return (
      slides.find((s) => s?.index === slideIndex) ??
      slides[slideIndex - 1] ??
      null
    );
  }, [slides, slideIndex]);

  // ملاحظات التقييم: معايير تشمل هذه الشريحة في أرقام شرائحها
  const relevantCriteria = useMemo(() => {
    if (!readiness?.criteria) return [];
    return readiness.criteria.filter((c) =>
      Array.isArray(c.slides) && c.slides.includes(slideIndex),
    );
  }, [readiness, slideIndex]);

  // سجل القرارات السابقة لهذه الشريحة (الأحدث أولًا)
  const history = useMemo(() => {
    return [...suggestions]
      .filter((s) => s.slideIndex === slideIndex)
      .sort((a, b) =>
        String(b.decidedAt ?? b.createdAt ?? "").localeCompare(
          String(a.decidedAt ?? a.createdAt ?? ""),
        ),
      );
  }, [suggestions, slideIndex]);

  // ————— طلب اقتراح (عند الطلب فقط — لا تلقائيًّا) —————
  const requestSuggestion = useCallback(async () => {
    setSuggesting(true);
    setEditing(false);
    setDecided(null);
    try {
      const data = await api.post<unknown>(
        `/decks/${deckId}/versions/${version}/slides/${slideIndex}/suggest`,
      );
      const norm = normalizeSuggestResponse(data);
      if (!norm.suggestedText) {
        toast.error(
          t("تعذّر توليد اقتراح آمن", "Could not generate a safe suggestion"),
        );
        return;
      }
      setSuggestion(norm);
      setEditedDraft(norm.suggestedText);
    } catch (e) {
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t("تعذّر توليد اقتراح آمن", "Could not generate a safe suggestion"),
      );
    } finally {
      setSuggesting(false);
    }
  }, [deckId, version, slideIndex, t]);

  // ————— إرسال القرار —————
  const decide = useCallback(
    async (decision: "accepted" | "edited" | "rejected", editedText?: string) => {
      setDeciding(decision);
      try {
        await api.patch<unknown>(
          `/decks/${deckId}/versions/${version}/slides/${slideIndex}/suggestion`,
          { decision, ...(decision === "edited" ? { editedText } : {}) },
        );
        setDecided(decision);
        setEditing(false);
        toast.success(
          t("سُجّل قرارك — الأصل كما هو", "Decision saved — original intact"),
        );
        // تحديث السجل محليًّا (إدراج القرار أعلى القائمة دون إعادة جلب كاملة)
        setSuggestions((prev) => [
          {
            slideIndex,
            suggestedText: suggestion?.suggestedText ?? "",
            reason: suggestion?.reasonAr ?? null,
            guard: suggestion?.guard ?? null,
            decision,
            editedText: decision === "edited" ? (editedText ?? null) : null,
            decidedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
      } catch (e) {
        toast.error(
          e instanceof Error && e.message
            ? e.message
            : t("تعذّر تسجيل القرار", "Could not save the decision"),
        );
      } finally {
        setDeciding(null);
      }
    },
    [deckId, version, slideIndex, suggestion, t],
  );

  const guardPassed = suggestion?.guard?.passed ?? true;
  const guardFlags = suggestion?.guard?.flags ?? [];

  // ————— العرض —————

  if (selfLoading) {
    return (
      <div className="space-y-4 p-1" aria-busy="true">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (selfError) {
    return (
      <div className="space-y-4">
        <EmptyState
          iconAr="⚠️"
          title={t("تعذّر جلب بيانات النسخة", "Failed to load version")}
          hintAr={selfError}
          action={
            <Button variant="outline" onClick={onClose} className="h-11">
              {t("إغلاق", "Close")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* رأس الشاشة */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="size-5 text-teal-700 dark:text-teal-400" aria-hidden />
          <h3 className="text-base font-bold">
            {t("تصحيح الشريحة", "Slide correction")}{" "}
            <span className="tabular-nums" dir="ltr">#{slideIndex}</span>
          </h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label={t("إغلاق", "Close")}
          className="size-11"
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      {!slide ? (
        <EmptyState
          iconAr="📄"
          title={t("لم تُوجد هذه الشريحة في النسخة", "Slide not found in this version")}
          hintAr={t(
            "قد تكون قائمة الشرائح فارغة أو الفهرس خارج النطاق.",
            "The slide list may be empty or the index is out of range.",
          )}
        />
      ) : (
        <>
          {/* النص الأصلي — محفوظ ولا يتغير */}
          <section aria-labelledby="sc-original" className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 id="sc-original" className="text-sm font-semibold">
                {t("النص الأصلي", "Original text")}
              </h4>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="size-3.5" aria-hidden />
                {t("الأصل محفوظ ولا يتغير", "Original is preserved and never changes")}
              </span>
            </div>
            <div
              dir="rtl"
              className="max-h-64 overflow-y-auto rounded-lg border bg-muted/60 p-4 text-sm leading-7 whitespace-pre-wrap text-foreground"
            >
              {slide.title ? (
                <p className="mb-2 font-semibold">{slide.title}</p>
              ) : null}
              <p>{slide.text || t("(نص فارغ)", "(empty text)")}</p>
            </div>
          </section>

          {/* ملاحظات التقييم */}
          <section aria-labelledby="sc-notes" className="space-y-2">
            <h4 id="sc-notes" className="text-sm font-semibold">
              {t("ملاحظات التقييم", "Evaluation notes")}
            </h4>
            {relevantCriteria.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  "لا معايير جاهزية تشمل هذه الشريحة في أدلتها.",
                  "No readiness criteria reference this slide in their evidence.",
                )}
              </p>
            ) : (
              <ul className="space-y-2">
                {relevantCriteria.map((c) => {
                  const lv = READINESS_LEVEL_AR[c.level] ?? READINESS_LEVEL_AR.missing;
                  return (
                    <li
                      key={c.key}
                      className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="inline-block size-2 shrink-0 rounded-full bg-amber-400"
                          aria-hidden
                        />
                        <span className="font-medium">{lang === "ar" ? c.labelAr : ((c as typeof c & { labelEn?: string }).labelEn ?? c.labelAr)}</span>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-xs font-medium",
                            lv.cls,
                          )}
                        >
                          {t(lv.ar, lv.en)}
                        </span>
                      </div>
                      {(lang === "ar" ? c.evidenceAr : ((c as typeof c & { evidenceEn?: string }).evidenceEn ?? null)) ? (
                        <p className="mt-1 text-muted-foreground">{lang === "ar" ? c.evidenceAr : ((c as typeof c & { evidenceEn?: string }).evidenceEn ?? c.evidenceAr)}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <Separator />

          {/* المقترح */}
          <section aria-labelledby="sc-suggest" className="space-y-3">
            <h4 id="sc-suggest" className="text-sm font-semibold">
              {t("المقترح", "Suggestion")}
            </h4>

            {!suggestion ? (
              <div className="space-y-2">
                <Button
                  onClick={requestSuggestion}
                  disabled={suggesting}
                  className="h-11"
                >
                  {suggesting ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Sparkles className="size-4" aria-hidden />
                  )}
                  {suggesting
                    ? t("جارٍ توليد الاقتراح...", "Generating suggestion...")
                    : t("اقترح صياغة أوضح", "Suggest a clearer wording")}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "يُولَّد الاقتراح عند الطلب فقط، ويمرّ بحارس الاقتراح قبل العرض.",
                    "The suggestion is generated on demand and passes the suggestion guard before display.",
                  )}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* النص المقترح — خام (لا HTML) */}
                <div className="rounded-lg border border-emerald-300 bg-emerald-50/80 p-4 dark:border-emerald-800 dark:bg-emerald-950/40">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
                        guardPassed
                          ? "border-emerald-400 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                          : "border-rose-400 bg-rose-100 text-rose-800 dark:border-rose-700 dark:bg-rose-900 dark:text-rose-300",
                      )}
                    >
                      {guardPassed ? (
                        <ShieldCheck className="size-3.5" aria-hidden />
                      ) : (
                        <ShieldAlert className="size-3.5" aria-hidden />
                      )}
                      {guardPassed
                        ? t("مرّ بحارس الاقتراح", "Passed the suggestion guard")
                        : t("رُفض بحارس الاقتراح", "Rejected by the suggestion guard")}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="size-3" aria-hidden />
                      {t("نص خام — لا يُنفَّذ أي HTML", "Raw text — no HTML is executed")}
                    </span>
                  </div>
                  <p
                    dir="rtl"
                    className="text-sm leading-7 whitespace-pre-wrap text-foreground"
                  >
                    {suggestion.suggestedText}
                  </p>
                  {suggestion.reasonAr ? (
                    <p className="mt-3 border-t border-emerald-200 pt-2 text-xs leading-6 text-muted-foreground dark:border-emerald-800">
                      {t("السبب: ", "Reason: ")}
                      {lang === "ar" ? suggestion.reasonAr : (suggestion.reason && !/[\u0600-\u06FF]/.test(suggestion.reason) ? suggestion.reason : "Review this proposed wording and check that every factual claim is supported by the deck or another source.")}
                    </p>
                  ) : null}
                  {guardFlags.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {guardFlags.map((f, i) => (
                        <li
                          key={i}
                          className="text-xs text-amber-800 dark:text-amber-300"
                        >
                          • {f.rule ?? ""} — {lang === "ar" ? (f.detailAr ?? f.detail ?? "") : (f.detail && !/[\u0600-\u06FF]/.test(f.detail) ? f.detail : "Review this validation flag before accepting the suggested text.")}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                {/* أزرار القرار الثلاثة */}
                {decided ? (
                  <div className="flex items-center gap-2 rounded-lg border p-3">
                    {(() => {
                      const conf = DECISION_CONF[decided] ?? DECISION_CONF.pending;
                      return (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold",
                            conf.cls,
                          )}
                        >
                          {conf.icon}
                          {t(conf.ar, conf.en)}
                        </span>
                      );
                    })()}
                    <span className="text-sm text-muted-foreground">
                      {t(
                        "حُسم القرار لهذا الاقتراح — الأصل كما هو.",
                        "This suggestion has been decided — original intact.",
                      )}
                    </span>
                  </div>
                ) : editing ? (
                  <div className="space-y-2">
                    <Textarea
                      dir="rtl"
                      value={editedDraft}
                      onChange={(e) => setEditedDraft(e.target.value)}
                      maxLength={2000}
                      rows={5}
                      aria-label={t("النص المعدَّل", "Edited text")}
                      className="leading-7"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        onClick={() => decide("edited", editedDraft)}
                        disabled={
                          deciding !== null || editedDraft.trim().length === 0
                        }
                        className="h-11"
                      >
                        {deciding === "edited" ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <CheckCircle2 className="size-4" aria-hidden />
                        )}
                        {t("اعتماد المعدَّل", "Approve edited version")}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setEditing(false)}
                        disabled={deciding !== null}
                        className="h-11"
                      >
                        {t("رجوع", "Back")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={() => decide("accepted")}
                      disabled={deciding !== null}
                      className="h-11"
                    >
                      {deciding === "accepted" ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <CheckCircle2 className="size-4" aria-hidden />
                      )}
                      {t("قبول", "Accept")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setEditing(true)}
                      disabled={deciding !== null}
                      className="h-11"
                    >
                      <Pencil className="size-4" aria-hidden />
                      {t("تعديل", "Edit")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => decide("rejected")}
                      disabled={deciding !== null}
                      className="h-11 text-rose-700 hover:text-rose-800 dark:text-rose-400"
                    >
                      {deciding === "rejected" ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <XCircle className="size-4" aria-hidden />
                      )}
                      {t("رفض", "Reject")}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>

          <Separator />

          {/* سجل القرارات السابقة */}
          <section aria-labelledby="sc-history" className="space-y-2">
            <h4 id="sc-history" className="text-sm font-semibold">
              {t("القرارات السابقة لهذه الشريحة", "Previous decisions for this slide")}
            </h4>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  "لا قرارات سابقة — أول اقتراح وقرار ستظهران هنا.",
                  "No previous decisions — the first suggestion and decision will appear here.",
                )}
              </p>
            ) : (
              <ul className={cn("space-y-2", SCROLL_CLS)}>
                {history.map((h, i) => {
                  const conf =
                    DECISION_CONF[h.decision] ?? DECISION_CONF.pending;
                  return (
                    <li
                      key={h.id ?? `${h.createdAt ?? i}-${i}`}
                      className="rounded-lg border p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
                            conf.cls,
                          )}
                        >
                          {conf.icon}
                          {t(conf.ar, conf.en)}
                        </span>
                        <time className="text-xs text-muted-foreground tabular-nums">
                          {formatDate(h.decidedAt ?? h.createdAt ?? null, lang)}
                        </time>
                      </div>
                      <p
                        dir="rtl"
                        className="mt-2 line-clamp-3 text-sm leading-6 text-foreground"
                      >
                        {h.editedText ?? h.suggestedText}
                      </p>
                      {h.decision === "edited" && h.editedText ? (
                        <p className="mt-1 text-xs text-teal-700 dark:text-teal-400">
                          {t("اعتُمد هذا النص المعدَّل", "This edited text was approved")}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
