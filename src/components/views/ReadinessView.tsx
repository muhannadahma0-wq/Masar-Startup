"use client";
/**
 * Masar — T18: لوحة الجاهزية (ReadinessView)
 * =============================================================================
 * تجلب بنفسها: /matches + آخر نسخة عرض (GET /decks ثم GET /decks/[id]/versions/[v])
 * + /documents.
 *  - الأعلى: 4 StatCards (المؤهل / غير المحسوم / غير المؤهل / متوسط الملاءمة).
 *  - الأقسام: معايير التسعة + خريطة المستندات + الحقول الناقصة + أفضل 5 فرص
 *    مؤهلة بحقائبها (فجواتها ومستنداتها الناقصة).
 *  - EmptyState إن لا عرض: «ارفع عرضك لفعّل لوحة الجاهزية» + زر → deck.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { useI18n, formatDate, formatMoney, localizeServerMessage } from "@/components/app/i18n";
import {
  EmptyState,
  JudgmentBadge,
  ScoreBar,
  StatCard,
} from "@/components/app/badges";
import type {
  CriterionResult,
  GapReport,
  Judgment,
  ReadinessReport,
} from "@/lib/core/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ArrowLeft,
  CheckCircle2,
  CloudUpload,
  FileWarning,
  Info,
  Loader2,
} from "lucide-react";
import type { ViewProps } from "@/components/app/types";
import { cn } from "@/lib/utils";

// ————— قواميس محلية —————

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
  pitch_deck: { ar: "العرض التقديمي (Deck)", en: "Pitch deck" },
  financial_statements: { ar: "القوائم المالية", en: "Financial statements" },
  founder_id: { ar: "هوية المؤسس", en: "Founder ID" },
  business_plan: { ar: "خطة العمل", en: "Business plan" },
  tax_record: { ar: "السجل الضريبي", en: "Tax record" },
  bank_letter: { ar: "الخطاب البنكي", en: "Bank letter" },
  prototype_demo: { ar: "النموذج الأولي / عرض توضيحي", en: "Prototype / demo" },
  letters_of_support: { ar: "رسائل الدعم", en: "Letters of support" },
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

const LEVEL_CONF: Record<string, { ar: string; en: string; cls: string }> = {
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

// ————— أنواع دفاعية —————

interface MatchItem {
  opportunity: {
    id: string;
    title: string;
    orgName: string;
    type: string;
    amounts?: { min: number | null; max: number | null; currency: string };
    deadline?: string | null;
  };
  judgment: string;
  summary?: string;
  fit?: { total: number; factors?: unknown[] } | null;
  reliability?: { total: number; level: string; warningAr?: string };
}

interface DocumentRow {
  docType: string;
  status: string;
  source?: string | null;
  notes?: string | null;
}

interface DeckVersionLite {
  readiness: ReadinessReport | null;
  gap: GapReport | null;
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function toJudgment(s: unknown): Judgment {
  return s === "ELIGIBLE" || s === "NOT_ELIGIBLE" ? s : "UNCERTAIN";
}

function normalizeVersionLite(data: unknown): DeckVersionLite {
  const d = (data ?? {}) as Record<string, unknown>;
  const readinessRaw = (d.readiness ?? d.readinessReport ?? null) as
    | ReadinessReport
    | null;
  const gapRaw = (d.gap ?? d.gapReport ?? null) as GapReport | null;
  return {
    readiness: readinessRaw && typeof readinessRaw === "object" ? readinessRaw : null,
    gap: gapRaw && typeof gapRaw === "object" ? gapRaw : null,
  };
}

// ————— المكوّن —————

export default function ReadinessView({ onNavigate }: ViewProps) {
  const { t, lang } = useI18n();

  const [loading, setLoading] = useState(true);
  const [hasDeck, setHasDeck] = useState<boolean | null>(null);
  const [versionLite, setVersionLite] = useState<DeckVersionLite | null>(null);
  const [versionLabel, setVersionLabel] = useState<string>("");
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [warning, setWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setWarning(null);
    try {
      const [decksRes, matchesRes, docsRes] = await Promise.allSettled([
        api.get<unknown>("/decks"),
        api.get<unknown>("/matches"),
        api.get<unknown>("/documents"),
      ]);

      if (matchesRes.status === "fulfilled") {
        const md = matchesRes.value;
        setMatches(Array.isArray(md) ? (md as MatchItem[]) : arr<MatchItem>(md));
      }

      if (docsRes.status === "fulfilled") {
        const dd = (docsRes.value ?? {}) as Record<string, unknown>;
        setDocuments(
          Array.isArray(dd.documents)
            ? (dd.documents as DocumentRow[])
            : Array.isArray(docsRes.value)
              ? (docsRes.value as DocumentRow[])
              : [],
        );
      }

      if (decksRes.status === "rejected") {
        setHasDeck(null);
        setWarning(
          decksRes.reason instanceof Error
            ? decksRes.reason.message
            : t("تعذّر جلب العروض", "Failed to load decks"),
        );
        return;
      }

      // آخر نسخة عرض: أحدث عرض بأحدث نسخة
      const raw = (decksRes.value ?? {}) as Record<string, unknown>;
      const listRaw: unknown[] = Array.isArray(decksRes.value)
        ? (decksRes.value as unknown[])
        : Array.isArray(raw.decks)
          ? (raw.decks as unknown[])
          : Array.isArray(raw.items)
            ? (raw.items as unknown[])
            : [];
      const versions: Array<{
        deckId: string;
        versionNumber: number;
      }> = [];
      for (const item of listRaw) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        const deckId = String(rec.id ?? rec.deckId ?? "");
        const vs = Array.isArray(rec.versions)
          ? (rec.versions as Array<Record<string, unknown>>)
          : rec.latestVersion
            ? [rec.latestVersion as Record<string, unknown>]
            : [];
        for (const v of vs) {
          versions.push({
            deckId,
            versionNumber: Number(v.versionNumber ?? 0),
          });
        }
        if (vs.length === 0 && rec.versionNumber !== undefined) {
          versions.push({
            deckId,
            versionNumber: Number(rec.versionNumber ?? 0),
          });
        }
      }
      versions.sort((a, b) => b.versionNumber - a.versionNumber);

      if (versions.length === 0) {
        setHasDeck(false);
        setVersionLite(null);
        return;
      }
      setHasDeck(true);
      const latest = versions[0];
      setVersionLabel(`v${latest.versionNumber}`);
      try {
        const detail = await api.get<unknown>(
          `/decks/${latest.deckId}/versions/${latest.versionNumber}`,
        );
        setVersionLite(normalizeVersionLite(detail));
      } catch (e) {
        setVersionLite(null);
        setWarning(
          e instanceof Error
            ? e.message
            : t("تعذّر جلب نتيجة آخر نسخة", "Failed to load latest version result"),
        );
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // ————— إحصاءات —————
  const stats = useMemo(() => {
    const eligible = matches.filter((m) => m.judgment === "ELIGIBLE");
    const uncertain = matches.filter((m) => m.judgment === "UNCERTAIN");
    const notEligible = matches.filter((m) => m.judgment === "NOT_ELIGIBLE");
    const withFit = matches.filter((m) => typeof m.fit?.total === "number");
    const avgFit =
      withFit.length > 0
        ? Math.round(
            withFit.reduce((s, m) => s + (m.fit?.total ?? 0), 0) / withFit.length,
          )
        : null;
    return { eligible, uncertain, notEligible, avgFit };
  }, [matches]);

  // أفضل 5 فرص مؤهلة (مرتبة بالملاءمة كما رُتبت من الخادم)
  const topEligible = useMemo(
    () => stats.eligible.slice(0, 5),
    [stats.eligible],
  );

  const gapByOpp = useMemo(() => {
    const map = new Map<
      string,
      NonNullable<GapReport["perOpportunity"]>[number]
    >();
    for (const g of versionLite?.gap?.perOpportunity ?? []) {
      map.set(g.opportunityId, g);
    }
    return map;
  }, [versionLite]);

  const criteria: CriterionResult[] = useMemo(() => {
    const fromReport = versionLite?.readiness?.criteria ?? [];
    if (fromReport.length > 0) return fromReport;
    return Object.keys(CRITERIA_LABELS).map((key) => ({
      key,
      labelAr: CRITERIA_LABELS[key].ar,
      level: "missing" as const,
      evidenceAr: "",
      slides: [] as number[],
    }));
  }, [versionLite]);

  const counts = useMemo(() => {
    const c = { strong: 0, adequate: 0, weak: 0, missing: 0 } as Record<string, number>;
    for (const cr of criteria) c[cr.level] = (c[cr.level] ?? 0) + 1;
    return c;
  }, [criteria]);

  // ————— العرض —————

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (hasDeck === false) {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold">{t("لوحة الجاهزية", "Readiness board")}</h1>
        </header>
        <EmptyState
          iconAr="📤"
          title={t("ارفع عرضك لتفعيل لوحة الجاهزية", "Upload your deck to activate the readiness board")}
          hintAr={t(
            "لوحة الجاهزية تحتاج آخر نسخة عرض لتقييم معايير الشرائح التسعة وحساب الفجوات مقابل فرصك المطابقة.",
            "The readiness board needs your latest deck version to evaluate the 9 slide criteria and compute gaps against your matched opportunities.",
          )}
          action={
            <Button onClick={() => onNavigate("deck")} className="h-11">
              <CloudUpload className="size-4" aria-hidden />
              {t("ارفع عرضك التقديمي", "Upload your pitch deck")}
            </Button>
          }
        />
      </div>
    );
  }

  const docChipCls = (status: string) =>
    status === "available"
      ? "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      : status === "expired"
        ? "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
        : "border-border bg-muted text-muted-foreground";

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("لوحة الجاهزية", "Readiness board")}</h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "نظرة واحدة: أحكام أهليتك، معايير عرضك التسعة، مستنداتك، وحقائب أفضل الفرص المؤهلة — بلا درجة إجمالية واحدة.",
            "One glance: your eligibility verdicts, 9 deck criteria, documents, and the gaps of your best eligible opportunities — without a single overall score.",
          )}
          {versionLabel ? (
            <span className="ms-1" dir="ltr">
              ({versionLabel})
            </span>
          ) : null}
        </p>
      </header>

      {warning ? (
        <Alert>
          <FileWarning className="size-4 text-amber-600" aria-hidden />
          <AlertTitle>{t("تنبيه", "Notice")}</AlertTitle>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ) : null}

      {/* الإحصاءات */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          labelAr={t("مؤهل", "Eligible")}
          value={
            <span className="text-emerald-700 dark:text-emerald-400">
              {stats.eligible.length}
            </span>
          }
          sub={t("فرصة", "opportunities")}
        />
        <StatCard
          labelAr={t("غير محسوم", "Uncertain")}
          value={
            <span className="text-amber-700 dark:text-amber-400">
              {stats.uncertain.length}
            </span>
          }
          sub={t("فرصة", "opportunities")}
        />
        <StatCard
          labelAr={t("غير مؤهل", "Not eligible")}
          value={
            <span className="text-rose-700 dark:text-rose-400">
              {stats.notEligible.length}
            </span>
          }
          sub={t("فرصة", "opportunities")}
        />
        <StatCard
          labelAr={t("متوسط الملاءمة", "Average fit")}
          value={stats.avgFit === null ? "—" : `${stats.avgFit}٪`}
          sub={t("من 100 (للمؤهل وغير المحسوم)", "out of 100 (eligible & uncertain)")}
        />
      </div>

      {/* معايير التسعة */}
      <section aria-labelledby="rd-criteria" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="rd-criteria" className="text-lg font-bold">
            {t("معايير العرض التسعة", "The 9 deck criteria")}
          </h2>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Badge variant="outline">
              {t("قوي", "Strong")}: {counts.strong ?? 0}
            </Badge>
            <Badge variant="outline">
              {t("مقبول", "Adequate")}: {counts.adequate ?? 0}
            </Badge>
            <Badge variant="outline">
              {t("ضعيف", "Weak")}: {counts.weak ?? 0}
            </Badge>
            <Badge variant="outline">
              {t("غائب", "Missing")}: {counts.missing ?? 0}
            </Badge>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {criteria.map((c) => {
            const conf = LEVEL_CONF[c.level] ?? LEVEL_CONF.missing;
            return (
              <Card key={c.key} className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">
                    {lang === "ar" ? (c.labelAr ?? CRITERIA_LABELS[c.key]?.ar ?? c.key) : (c.labelEn ?? CRITERIA_LABELS[c.key]?.en ?? c.key)}
                  </h4>
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                      conf.cls,
                    )}
                  >
                    {t(conf.ar, conf.en)}
                  </span>
                </div>
                {(lang === "ar" ? c.evidenceAr : c.evidenceEn ?? "Evidence is not available in English for this older report.") ? (
                  <p className="mt-2 text-xs leading-6 text-muted-foreground">
                    {lang === "ar" ? c.evidenceAr : c.evidenceEn ?? "Evidence is not available in English for this older report."}
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
            );
          })}
        </div>
      </section>

      <Separator />

      {/* خريطة المستندات */}
      <section aria-labelledby="rd-docs" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="rd-docs" className="text-lg font-bold">
            {t("خريطة المستندات", "Documents map")}
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate("documents")}
            className="h-11"
          >
            {t("إدارة المستندات", "Manage documents")}
            <ArrowLeft className="size-4" aria-hidden />
          </Button>
        </div>
        <ul className="flex flex-wrap gap-2">
          {documents.map((d) => (
            <li key={d.docType}>
              <Badge variant="outline" className={cn("gap-1.5", docChipCls(d.status))}>
                {d.status === "available" ? (
                  <CheckCircle2 className="size-3.5" aria-hidden />
                ) : null}
                {DOC_LABELS[d.docType]?.[lang] ?? d.docType}
                <span className="text-xs opacity-80">
                  {d.status === "available"
                    ? t("متوفر", "available")
                    : d.status === "expired"
                      ? t("منتهٍ", "expired")
                      : t("ناقص", "missing")}
                </span>
              </Badge>
            </li>
          ))}
        </ul>
      </section>

      <Separator />

      {/* الحقول الناقصة */}
      <section aria-labelledby="rd-fields" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="rd-fields" className="text-lg font-bold">
            {t("الحقول الناقصة في ملفك", "Missing profile fields")}
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate("profile")}
            className="h-11"
          >
            {t("ملء الملف", "Fill the profile")}
            <ArrowLeft className="size-4" aria-hidden />
          </Button>
        </div>
        {(versionLite?.gap?.missingProfileFields ?? []).length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2
              className="size-4 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            />
            {t(
              "لا حقول ناقصة مرصودة في تقرير الفجوات الحالي.",
              "No missing fields detected in the current gap report.",
            )}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {(versionLite?.gap?.missingProfileFields ?? []).map((f) => (
              <li key={f}>
                <Badge
                  variant="outline"
                  className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                >
                  {FIELD_LABELS[f]?.[lang] ?? f}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Separator />

      {/* أفضل 5 فرص مؤهلة */}
      <section aria-labelledby="rd-top" className="space-y-3">
        <h2 id="rd-top" className="text-lg font-bold">
          {t("أفضل 5 فرص مؤهلة بحقائبها", "Top 5 eligible opportunities & their gaps")}
        </h2>
        {topEligible.length === 0 ? (
          <EmptyState
            iconAr="🌱"
            title={t("لا فرص مؤهلة حاليًّا", "No eligible opportunities yet")}
            hintAr={t(
              "أكمل ملفك وسُدّ الفجوات الظاهرة أعلاه — تُحدَّث الأحكام تلقائيًّا مع كل تغيير.",
              "Complete your profile and close the gaps shown above — verdicts refresh automatically with every change.",
            )}
            action={
              <Button
                variant="outline"
                onClick={() => onNavigate("matches")}
                className="h-11"
              >
                {t("عرض كل المطابقات", "View all matches")}
                <ArrowLeft className="size-4" aria-hidden />
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {topEligible.map((m) => {
              const g = gapByOpp.get(m.opportunity.id);
              const fitTotal = typeof m.fit?.total === "number" ? m.fit.total : null;
              return (
                <li key={m.opportunity.id}>
                  <Card className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="font-bold text-sm break-words">
                          {m.opportunity.title}
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          {m.opportunity.orgName}
                        </p>
                      </div>
                      <JudgmentBadge judgment={toJudgment(m.judgment)} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {m.opportunity.deadline ? (
                        <span>{formatDate(m.opportunity.deadline, lang)}</span>
                      ) : (
                        <span>{t("بلا موعد", "No deadline")}</span>
                      )}
                      {m.opportunity.amounts?.min != null ||
                      m.opportunity.amounts?.max != null ? (
                        <span dir="ltr">
                          {m.opportunity.amounts?.min != null
                            ? formatMoney(
                                m.opportunity.amounts.min,
                                m.opportunity.amounts.currency,
                                lang,
                              )
                            : "—"}
                          {" – "}
                          {m.opportunity.amounts?.max != null
                            ? formatMoney(
                                m.opportunity.amounts.max,
                                m.opportunity.amounts.currency,
                                lang,
                              )
                            : "—"}
                        </span>
                      ) : null}
                    </div>
                    {fitTotal !== null ? (
                      <div className="mt-3">
                        <ScoreBar
                          score={fitTotal}
                          max={100}
                          labelAr={t("الملاءمة", "Fit")}
                        />
                      </div>
                    ) : null}
                    {(lang === "ar" ? (g?.gapsAr ?? []) : (g?.gapsEn ?? (g?.gapsAr ?? []).map((x) => localizeServerMessage(x, lang)))).length > 0 ? (
                      <ul className="mt-3 space-y-1">
                        {(lang === "ar" ? (g?.gapsAr ?? []) : (g?.gapsEn ?? (g?.gapsAr ?? []).map((x) => localizeServerMessage(x, lang)))).map((gap, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 text-xs leading-6"
                          >
                            <span
                              className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-amber-500"
                              aria-hidden
                            />
                            {gap}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {(g?.missingDocs ?? []).length > 0 ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          {t("مستندات ناقصة", "Missing docs")}:
                        </span>
                        {g?.missingDocs.map((doc) => (
                          <Badge
                            key={doc}
                            variant="outline"
                            className="border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-300"
                          >
                            {DOC_LABELS[doc]?.ar ?? doc}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="flex items-start gap-2 text-xs leading-6 text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t(
          "لا توجد درجة إجمالية واحدة للجاهزية — كل معيار وكل حكم يُعرض بدليله كي تعرف ما الذي تصلحه أولًا.",
          "There is no single readiness score — each criterion and verdict is shown with its evidence so you know what to fix first.",
        )}
      </p>
    </div>
  );
}
