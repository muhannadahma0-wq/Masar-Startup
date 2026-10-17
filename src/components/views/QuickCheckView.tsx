"use client";

/**
 * Masar — T17: QuickCheckView — الفحص السريع للزوار (بلا حساب، شاشة عامة)
 * ---------------------------------------------------------------------------
 *  - استبيان خطوة واحدة ببطاقة (8 أسئلة): الإقامة، هل شركة مسجلة + بلد
 *    التسجيل، الوضع القانوني، القطاع الأول، المرحلة، المبلغ المطلوب تقريبًا
 *    (نطاقات)، لغة التقديم.
 *  - «اعرف فرصك» → POST /quick-check (بلا جلسة — الإجابات لا تُحفظ أبدًا).
 *  - العرض: أعلى 15 نتيجة: بطاقة لكل فرصة (العنوان، الجهة، JudgmentBadge
 *    الحكم المبدئي، summary، ScoreBar الملاءمة) + شارة بارزة «نتائج مبدئية —
 *    سجّل وأكمل ملفك لحكم كامل بالأدلة».
 *  - CTA أسفل النتائج: «أنشئ حسابًا لملف دائم وتتبع طلبات»
 *    → onNavigate("home", { openAuth: true }).
 */

import { useCallback, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AlertTriangle, EyeOff, Loader2, RotateCcw, Sparkles, UserPlus } from "lucide-react";

import { api } from "@/lib/api-client";
import { useI18n, formatDate, formatMoney } from "@/components/app/i18n";
import type { ViewProps } from "@/components/app/types";
import { COUNTRY_KEYS, LEGAL_STATUS_VALUES, REGION_VALUES, SECTOR_KEYS, STAGE_KEYS } from "@/lib/core/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import {
  COUNTRY_LABELS,
  CheckGrid,
  FieldShell,
  GEO_LABELS,
  JudgmentBadge,
  LANG_LABELS,
  LEGAL_STATUS_LABELS,
  OPP_TYPE_LABELS,
  REGION_LABELS,
  SCROLL_TW,
  SECTOR_LABELS,
  STAGE_LABELS,
  ScoreBar,
  SelectField,
  labelOf,
  type CompactOpportunity,
  type QuickMatchResponse,
} from "./ProfileView";

/** نطاقات المبلغ التقريبية — القيمة الممثِّلة تُرسل askAmountUSD. */
const ASK_RANGES: Array<{ key: string; label: { ar: string; en: string }; value: number }> = [
  { key: "lt10k", label: { ar: "أقل من 10 آلاف دولار", en: "Under $10K" }, value: 5000 },
  { key: "r10-25", label: { ar: "10 – 25 ألف دولار", en: "$10K – $25K" }, value: 17500 },
  { key: "r25-50", label: { ar: "25 – 50 ألف دولار", en: "$25K – $50K" }, value: 37500 },
  { key: "r50-100", label: { ar: "50 – 100 ألف دولار", en: "$50K – $100K" }, value: 75000 },
  { key: "r100-250", label: { ar: "100 – 250 ألف دولار", en: "$100K – $250K" }, value: 175000 },
  { key: "r250-500", label: { ar: "250 – 500 ألف دولار", en: "$250K – $500K" }, value: 375000 },
  { key: "r500-1m", label: { ar: "500 ألف – مليون دولار", en: "$500K – $1M" }, value: 750000 },
  { key: "gt1m", label: { ar: "أكثر من مليون دولار", en: "Over $1M" }, value: 2000000 },
];

/** تسمية نطاق مبالغ الفرصة (بعملة صريحة — §15). */
function amountsLabel(o: CompactOpportunity, lang: "ar" | "en", t: (ar: string, en: string) => string): string | null {
  const min = o.amounts.min;
  const max = o.amounts.max;
  const currency = o.amounts.currency || "USD";
  if (min === null && max === null) return null;
  if (min !== null && max !== null) {
    return `${formatMoney(min, currency, lang)} – ${formatMoney(max, currency, lang)}`;
  }
  if (min !== null) {
    return t(`من ${formatMoney(min, currency, lang)}`, `From ${formatMoney(min, currency, lang)}`);
  }
  return t(`حتى ${formatMoney(max, currency, lang)}`, `Up to ${formatMoney(max, currency, lang)}`);
}

export default function QuickCheckView({ onNavigate }: ViewProps) {
  const { t, lang, dir } = useI18n();
  const [region, setRegion] = useState("");
  const [registered, setRegistered] = useState("");
  const [country, setCountry] = useState("");
  const [legalStatus, setLegalStatus] = useState("");
  const [sector, setSector] = useState("");
  const [stage, setStage] = useState("");
  const [amountKey, setAmountKey] = useState("");
  const [languages, setLanguages] = useState<string[]>(["ar"]);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<QuickMatchResponse[] | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const regionOptions = REGION_VALUES.map((k) => ({ key: k, label: labelOf(REGION_LABELS, k, lang) }));
  const countryOptions = COUNTRY_KEYS.map((k) => ({ key: k, label: labelOf(COUNTRY_LABELS, k, lang) }));
  const legalOptions = LEGAL_STATUS_VALUES.map((k) => ({
    key: k,
    label: labelOf(LEGAL_STATUS_LABELS, k, lang),
  }));
  const sectorOptions = SECTOR_KEYS.map((k) => ({ key: k, label: labelOf(SECTOR_LABELS, k, lang) }));
  const stageOptions = STAGE_KEYS.map((k) => ({ key: k, label: labelOf(STAGE_LABELS, k, lang) }));
  const amountOptions = ASK_RANGES.map((r) => ({ key: r.key, label: r.label[lang] }));
  const langOptions = (["ar", "en"] as const).map((k) => ({
    key: k,
    label: labelOf(LANG_LABELS, k, lang),
  }));
  const yesNoOptions = [
    { key: "yes", label: t("نعم، لديّ شركة مسجلة", "Yes, I have a registered company") },
    { key: "no", label: t("لا، مشروع أو فكرة بلا شركة مسجلة", "No, a project/idea without a registered company") },
  ];
  const unsetLabel = t("غير محدد", "Unspecified");

  const onRegisteredChange = (v: string) => {
    setRegistered(v);
    // «لا» → الوضع القانوني غير مسجلة تلقائيًا (يبقى قابلًا للتغيير)
    if (v === "no" && legalStatus === "") setLegalStatus("not_registered");
    if (v === "yes" && legalStatus === "not_registered") setLegalStatus("");
  };

  const submit = useCallback(
    async (e?: FormEvent) => {
      if (e) e.preventDefault();
      if (region === "") {
        toast.error(t("اختر إقامتك أولًا", "Select your residence first"));
        formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (registered === "") {
        toast.error(t("أجب عن سؤال الشركة المسجلة", "Answer the registered-company question"));
        formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (sector === "") {
        toast.error(t("اختر قطاعك الأول", "Select your primary sector"));
        formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (stage === "") {
        toast.error(t("اختر مرحلة مشروعك", "Select your stage"));
        formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (languages.length === 0) {
        toast.error(t("اختر لغة تقديم واحدة على الأقل", "Pick at least one language"));
        return;
      }

      const body: Record<string, unknown> = {
        region,
        sectors: [sector],
        stage,
        languages: [...languages],
      };
      if (registered === "no") {
        body.registrationCountry = "none";
        if (legalStatus === "") body.legalStatus = "not_registered";
      } else {
        if (country !== "") body.registrationCountry = country;
      }
      if (legalStatus !== "") body.legalStatus = legalStatus;
      const range = ASK_RANGES.find((r) => r.key === amountKey);
      if (range) body.askAmountUSD = range.value;

      setSubmitting(true);
      setSubmitError(null);
      try {
        const data = await api.post<{ matches: QuickMatchResponse[] }>("/quick-check", body);
        setResults(data.matches);
        toast.success(
          t("جاهز — نتائج مبدئية من القواعد نفسها", "Done — preliminary results from the same rules"),
        );
        window.setTimeout(() => {
          resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSubmitError(message);
        toast.error(message);
      } finally {
        setSubmitting(false);
      }
    },
    [region, registered, country, legalStatus, sector, stage, amountKey, languages, t],
  );

  const resetAnswers = () => {
    setResults(null);
    setSubmitError(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const toaster = <Toaster richColors position="top-center" dir={dir} closeButton />;

  return (
    <div className="flex flex-col gap-6">
      {toaster}

      {/* البطاقة التعريفية */}
      <header className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold leading-tight">
          <Sparkles className="size-6 text-primary" aria-hidden="true" />
          {t("الفحص السريع — اعرف فرصك في دقيقتين", "Quick check — discover your opportunities in two minutes")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "أجب عن 8 أسئلة قصيرة وستحصل على أحكام مبدئية بالقواعد نفسها التي يستخدمها الموقع للمؤسسين المسجلين.",
            "Answer 8 short questions and get preliminary judgments from the same deterministic rules used for registered founders.",
          )}
        </p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <EyeOff className="size-3.5" aria-hidden="true" />
          {t("بلا حساب — إجاباتك لا تُحفظ ولا تُسجَّل", "No account needed — your answers are never stored")}
        </p>
      </header>

      {/* الاستبيان — خطوة واحدة */}
      <div ref={formRef}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("أسئلة الفحص", "Check questions")}</CardTitle>
            <CardDescription>
              {t("8 أسئلة — كلها مطلوبة إلا البلد والوضع القانوني والمبلغ", "8 questions — all required except country, legal status and amount")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-5" onSubmit={(e) => void submit(e)} noValidate>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <FieldShell
                  label={`1. ${t("أين تقيم؟", "Where do you reside?")}`}
                  htmlFor="qc-region"
                >
                  <SelectField
                    id="qc-region"
                    value={region}
                    placeholder={t("اختر الإقامة", "Select residence")}
                    options={regionOptions}
                    unsetLabel={t("اختر للبدء", "Pick to start")}
                    onChange={setRegion}
                  />
                </FieldShell>

                <FieldShell
                  label={`2. ${t("هل لديك شركة مسجلة؟", "Do you have a registered company?")}`}
                  htmlFor="qc-registered"
                >
                  <SelectField
                    id="qc-registered"
                    value={registered}
                    placeholder={t("اختر إجابة", "Choose an answer")}
                    options={yesNoOptions}
                    unsetLabel={t("اختر للبدء", "Pick to start")}
                    onChange={onRegisteredChange}
                  />
                </FieldShell>

                {registered === "yes" ? (
                  <FieldShell
                    label={`3. ${t("في أي بلد مسجلة شركتك؟", "Where is your company registered?")}`}
                    htmlFor="qc-country"
                  >
                    <SelectField
                      id="qc-country"
                      value={country}
                      placeholder={t("اختر البلد", "Select country")}
                      options={countryOptions}
                      unsetLabel={unsetLabel}
                      onChange={setCountry}
                    />
                  </FieldShell>
                ) : null}

                <FieldShell
                  label={`4. ${t("الوضع القانوني للشركة", "Company legal status")}`}
                  htmlFor="qc-legal"
                >
                  <SelectField
                    id="qc-legal"
                    value={legalStatus}
                    placeholder={t("اختر الوضع", "Select status")}
                    options={legalOptions}
                    unsetLabel={unsetLabel}
                    onChange={setLegalStatus}
                  />
                </FieldShell>

                <FieldShell label={`5. ${t("ما قطاعك الأول؟", "What is your primary sector?")}`} htmlFor="qc-sector">
                  <SelectField
                    id="qc-sector"
                    value={sector}
                    placeholder={t("اختر القطاع", "Select sector")}
                    options={sectorOptions}
                    unsetLabel={t("اختر للبدء", "Pick to start")}
                    onChange={setSector}
                  />
                </FieldShell>

                <FieldShell label={`6. ${t("في أي مرحلة مشروعك؟", "What stage are you at?")}`} htmlFor="qc-stage">
                  <SelectField
                    id="qc-stage"
                    value={stage}
                    placeholder={t("اختر المرحلة", "Select stage")}
                    options={stageOptions}
                    unsetLabel={t("اختر للبدء", "Pick to start")}
                    onChange={setStage}
                  />
                </FieldShell>

                <FieldShell
                  label={`7. ${t("كم المبلغ الذي تحتاجه تقريبًا؟", "How much funding do you need, roughly?")}`}
                  htmlFor="qc-amount"
                >
                  <SelectField
                    id="qc-amount"
                    value={amountKey}
                    placeholder={t("اختر نطاقًا", "Pick a range")}
                    options={amountOptions}
                    unsetLabel={t("غير محدد بعد", "Not decided yet")}
                    onChange={setAmountKey}
                  />
                </FieldShell>

                <FieldShell
                  label={`8. ${t("بأي لغة تستطيع التقديم؟", "Which languages can you apply in?")}`}
                  hint={t("اختر لغة واحدة على الأقل", "Select at least one language")}
                >
                  <CheckGrid
                    idPrefix="qc-lang"
                    options={langOptions}
                    values={languages}
                    onChange={setLanguages}
                  />
                </FieldShell>
              </div>

              <div className="flex flex-col gap-2">
                <Button type="submit" className="h-11 w-full text-base sm:w-auto sm:self-start" disabled={submitting}>
                  {submitting ? (
                    <Loader2 className="me-2 size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="me-2 size-4" aria-hidden="true" />
                  )}
                  {t("اعرف فرصك", "Discover your opportunities")}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "الحساب يعتمده محرك القواعد وحده (ثلاثي القيم) — لا تنبؤ ولا تخمين.",
                    "Judgments come from the deterministic rules engine alone (three-valued) — no prediction, no guessing.",
                  )}
                </p>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* حالة التحميل */}
      {submitting ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : null}

      {/* خطأ */}
      {submitError && !submitting ? (
        <Card className="p-4" role="alert">
          <div className="flex flex-wrap items-center gap-3">
            <AlertTriangle className="size-5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-sm leading-relaxed">{submitError}</p>
            <Button variant="outline" className="h-11" onClick={() => void submit()}>
              {t("إعادة المحاولة", "Retry")}
            </Button>
          </div>
        </Card>
      ) : null}

      {/* النتائج */}
      {results && !submitting ? (
        <div ref={resultsRef} className="flex flex-col gap-4">
          {/* شارة النتائج المبدئية (إلزامية) */}
          <Card className="border-amber-300/80 bg-amber-50/70 p-4 dark:border-amber-700/70 dark:bg-amber-950/40" role="note">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
              <p className="text-sm font-semibold leading-relaxed text-amber-900 dark:text-amber-200">
                {t(
                  "نتائج مبدئية — سجّل وأكمل ملفك لحكم كامل بالأدلة",
                  "Preliminary results — sign up and complete your profile for a full, evidence-backed judgment",
                )}
              </p>
            </div>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">
              {t(`أعلى ${results.length} ${results.length === 1 ? "نتيجة" : "نتائج"}`, `Top ${results.length} ${results.length === 1 ? "result" : "results"}`)}
            </h2>
            <Button variant="outline" className="h-11" onClick={resetAnswers}>
              <RotateCcw className="me-2 size-4" aria-hidden="true" />
              {t("تعديل الإجابات", "Edit answers")}
            </Button>
          </div>

          {results.length === 0 ? (
            <Card className="border-dashed p-4">
              <p className="text-sm text-muted-foreground">
                {t(
                  "لا فرص متاحة حاليًا تطابق إجاباتك — عاود لاحقًا أو عدّل الإجابات.",
                  "No available opportunities match your answers yet — check back later or edit your answers.",
                )}
              </p>
            </Card>
          ) : (
            <div className={cn("flex max-h-[34rem] flex-col gap-3 pe-1", SCROLL_TW)}>
              {results.map((m, i) => {
                const amounts = amountsLabel(m.opportunity, lang, t);
                return (
                  <Card
                    key={m.opportunity.id}
                    className="animate-in fade-in-50 slide-in-from-bottom-1 p-4 duration-300"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="flex items-center gap-2 text-sm font-semibold leading-snug">
                          <span className="text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
                          <span className="truncate">{m.opportunity.title}</span>
                        </h3>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {m.opportunity.orgName}
                        </p>
                      </div>
                      <JudgmentBadge judgment={m.judgment} className="shrink-0" />
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-[11px]">
                        {labelOf(OPP_TYPE_LABELS, m.opportunity.type, lang)}
                      </Badge>
                      <Badge variant="secondary" className="text-[11px]">
                        {labelOf(GEO_LABELS, m.opportunity.geography, lang)}
                      </Badge>
                      {amounts ? (
                        <Badge variant="outline" className="text-[11px] tabular-nums">
                          {amounts}
                        </Badge>
                      ) : null}
                      {m.opportunity.deadline ? (
                        <Badge variant="outline" className="text-[11px]">
                          {t("الموعد", "Deadline")}: {formatDate(m.opportunity.deadline, lang)}
                        </Badge>
                      ) : null}
                    </div>

                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{lang === "ar" ? m.summary : m.summaryEn ?? (m.judgment === "ELIGIBLE" ? "Mandatory criteria appear satisfied under the current rules. Verify the official source before applying." : m.judgment === "NOT_ELIGIBLE" ? "A documented mandatory criterion is not met. Review the source and criterion below." : "Eligibility is not yet confirmed. Review missing profile details and evidence.")}</p>

                    {m.judgment === "UNCERTAIN" && m.uncertainReasons.length > 0 ? (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        {t(
                          `${m.uncertainReasons.length} ${
                            m.uncertainReasons.length === 1 ? "سبب يمنع الجزم" : "أسباب تمنع الجزم"
                          } — أهمها: ${m.uncertainReasons[0]}`,
                          `${m.uncertainReasons.length} ${
                            m.uncertainReasons.length === 1 ? "reason blocks certainty" : "reasons block certainty"
                          } — first: ${(m.uncertainReasonsEn ?? ["Review the missing required profile data or evidence."])[0]}`,
                        )}
                      </p>
                    ) : null}

                    <div className="mt-3">
                      <ScoreBar
                        total={m.fit ? m.fit.total : null}
                        judgment={m.judgment}
                        label={t("الملاءمة المبدئية", "Preliminary fit")}
                      />
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* CTA — إنشاء حساب */}
          <Card className="border-emerald-300/70 bg-emerald-50/50 p-5 dark:border-emerald-800/70 dark:bg-emerald-950/30">
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-emerald-900 dark:text-emerald-200">
                  {t("أنشئ حسابًا لملف دائم وتتبع طلبات", "Create an account for a lasting profile and application tracking")}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-emerald-800/90 dark:text-emerald-300/90">
                  {t(
                    "ملف محفوظ بمصادر موثقة + رفع عرضك التقديمي + متتبع طلبات وإشعارات بلا تكرار.",
                    "A saved profile with documented sources + pitch deck analysis + application tracker with no duplicate notifications.",
                  )}
                </p>
              </div>
              <Button
                className="h-11 shrink-0"
                onClick={() => onNavigate("home", { openAuth: true })}
              >
                <UserPlus className="me-2 size-4" aria-hidden="true" />
                {t("إنشاء حساب", "Create account")}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {/* ملاحظة قبل النتائج */}
      {!results && !submitting && !submitError ? (
        <Card className="border-dashed p-4">
          <div className="flex min-h-16 items-center gap-3">
            <Sparkles className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {t(
                "أجب عن الأسئلة أعلاه ثم اضغط «اعرف فرصك» — ستظهر لك أفضل 15 فرصة بحسب الملاءمة.",
                "Answer the questions above, then hit “Discover your opportunities” — the top 15 by fit will appear.",
              )}
            </p>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
