"use client";
/**
 * Masar — T18: مستندات الشركة (DocumentsView)
 * =============================================================================
 * GET /documents → جدول الأنواع التسعة: الاسم العربي، الحالة (متوفر أخضر/
 * ناقص رمادي/منتهٍ كهرماني — Select بتغيير فوري PUT /documents/[type])،
 * المصدر (input)، الملاحظات — مع حفظ صفّي وشريح توضيحية:
 * «قارن هذه القائمة بمتطلبات الفرص في تقرير الفجوات».
 */

import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { useI18n, formatDate } from "@/components/app/i18n";
import { EmptyState } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Toaster } from "@/components/ui/sonner";
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  Loader2,
  RefreshCw,
  Save,
} from "lucide-react";
import type { ViewProps } from "@/components/app/types";
import { cn } from "@/lib/utils";

// ————— قواميس محلية —————

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

const STATUS_OPTIONS: Array<{ value: string; ar: string; en: string; cls: string }> = [
  {
    value: "available",
    ar: "متوفر",
    en: "Available",
    cls: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  {
    value: "missing",
    ar: "ناقص",
    en: "Missing",
    cls: "border-border bg-muted text-muted-foreground",
  },
  {
    value: "expired",
    ar: "منتهٍ",
    en: "Expired",
    cls: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
];

// ————— الأنواع —————

interface DocumentRow {
  docType: string;
  status: "available" | "missing" | "expired" | string;
  source: string | null;
  notes: string | null;
  updatedAt: string | null;
}

interface Draft {
  source: string;
  notes: string;
}

// ————— المكوّن —————

export default function DocumentsView(_props: ViewProps) {
  const { t, lang } = useI18n();

  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busyType, setBusyType] = useState<string | null>(null);

  const applyRows = useCallback((rows: DocumentRow[]) => {
    setDocs(rows);
    setDrafts(
      Object.fromEntries(
        rows.map((d) => [d.docType, { source: d.source ?? "", notes: d.notes ?? "" }]),
      ),
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ documents?: DocumentRow[] }>("/documents");
      const rows = Array.isArray((data as Record<string, unknown>)?.documents)
        ? ((data as Record<string, unknown>).documents as DocumentRow[])
        : Array.isArray(data)
          ? (data as DocumentRow[])
          : [];
      applyRows(rows);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("تعذّر جلب المستندات", "Failed to load documents"),
      );
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [applyRows, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const putDocument = useCallback(
    async (docType: string, body: { status: string; source?: string; notes?: string }) => {
      setBusyType(docType);
      try {
        await api.put<unknown>(`/documents/${docType}`, body);
        setDocs((cur) =>
          (cur ?? []).map((d) =>
            d.docType === docType
              ? {
                  ...d,
                  status: body.status as DocumentRow["status"],
                  source: body.source ?? null,
                  notes: body.notes ?? null,
                  updatedAt: new Date().toISOString(),
                }
              : d,
          ),
        );
        setDrafts((cur) => ({
          ...cur,
          [docType]: {
            source: body.source ?? cur[docType]?.source ?? "",
            notes: body.notes ?? cur[docType]?.notes ?? "",
          },
        }));
        return true;
      } catch (e) {
        toast.error(
          e instanceof Error && e.message
            ? e.message
            : t("تعذّر تحديث المستند", "Could not update the document"),
        );
        return false;
      } finally {
        setBusyType(null);
      }
    },
    [t],
  );

  // تغيير الحالة — فوري
  const changeStatus = useCallback(
    async (docType: string, status: string) => {
      const draft = drafts[docType];
      const ok = await putDocument(docType, {
        status,
        source: draft?.source?.trim() || undefined,
        notes: draft?.notes?.trim() || undefined,
      });
      if (ok) {
        toast.success(
          t(
            `حُدّثت حالة «${DOC_LABELS[docType]?.ar ?? docType}» إلى «${STATUS_OPTIONS.find((s) => s.value === status)?.ar ?? status}»`,
            `Updated "${docType}" status to "${status}"`,
          ),
        );
      }
    },
    [drafts, putDocument, t],
  );

  // حفظ المصدر/الملاحظات
  const saveRow = useCallback(
    async (docType: string) => {
      const draft = drafts[docType];
      const doc = (docs ?? []).find((d) => d.docType === docType);
      if (!draft || !doc) return;
      const ok = await putDocument(docType, {
        status: doc.status,
        source: draft.source.trim() || undefined,
        notes: draft.notes.trim() || undefined,
      });
      if (ok) toast.success(t("حُفظ المستند", "Document saved"));
    },
    [drafts, docs, putDocument, t],
  );

  const statusOpt = (status: string) =>
    STATUS_OPTIONS.find((s) => s.value === status) ?? STATUS_OPTIONS[1];

  const renderRows = () =>
    (docs ?? []).map((d) => {
      const draft = drafts[d.docType] ?? { source: "", notes: "" };
      const opt = statusOpt(d.status);
      const dirty =
        draft.source !== (d.source ?? "") || draft.notes !== (d.notes ?? "");
      return (
        <TableRow key={d.docType}>
          <TableCell className="font-medium">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex size-2.5 shrink-0 rounded-full",
                  d.status === "available"
                    ? "bg-emerald-500"
                    : d.status === "expired"
                      ? "bg-amber-500"
                      : "bg-muted-foreground/40",
                )}
                aria-hidden
              />
              <span className="whitespace-nowrap">
                {DOC_LABELS[d.docType]?.ar ?? d.docType}
              </span>
            </div>
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "hidden rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap md:inline-flex",
                  opt.cls,
                )}
              >
                {t(opt.ar, opt.en)}
              </span>
              <Select
                value={d.status}
                onValueChange={(v) => void changeStatus(d.docType, v)}
                disabled={busyType === d.docType}
              >
                <SelectTrigger
                  className="h-11 w-32"
                  aria-label={t(
                    `حالة ${DOC_LABELS[d.docType]?.ar ?? d.docType}`,
                    `${d.docType} status`,
                  )}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value} className="h-11">
                      {t(s.ar, s.en)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </TableCell>
          <TableCell>
            <Input
              dir="auto"
              value={draft.source}
              maxLength={200}
              placeholder={t("رابط أو وصف مصدر", "Link or source description")}
              onChange={(e) =>
                setDrafts((prev) => ({
                  ...prev,
                  [d.docType]: { ...draft, source: e.target.value },
                }))
              }
              aria-label={t(
                `مصدر ${DOC_LABELS[d.docType]?.ar ?? d.docType}`,
                `${d.docType} source`,
              )}
              className="h-11 w-44 md:w-56"
            />
          </TableCell>
          <TableCell>
            <Input
              dir="rtl"
              value={draft.notes}
              maxLength={600}
              placeholder={t("ملاحظات", "Notes")}
              onChange={(e) =>
                setDrafts((prev) => ({
                  ...prev,
                  [d.docType]: { ...draft, notes: e.target.value },
                }))
              }
              aria-label={t(
                `ملاحظات ${DOC_LABELS[d.docType]?.ar ?? d.docType}`,
                `${d.docType} notes`,
              )}
              className="h-11 w-44 md:w-56"
            />
          </TableCell>
          <TableCell>
            <div className="flex items-center justify-between gap-2">
              <time className="text-xs text-muted-foreground whitespace-nowrap">
                {d.updatedAt ? formatDate(d.updatedAt, lang) : "—"}
              </time>
              <Button
                size="sm"
                variant={dirty ? "default" : "ghost"}
                disabled={!dirty || busyType === d.docType}
                onClick={() => void saveRow(d.docType)}
                className="h-11"
                aria-label={t("حفظ الصف", "Save row")}
              >
                {busyType === d.docType ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-4" aria-hidden />
                )}
                <span className="sr-only">{t("حفظ", "Save")}</span>
              </Button>
            </div>
          </TableCell>
        </TableRow>
      );
    });

  const availableCount = (docs ?? []).filter((d) => d.status === "available").length;

  return (
    <div className="space-y-6">
      <Toaster richColors closeButton position="top-center" dir={lang === "ar" ? "rtl" : "ltr"} />
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">
          {t("مستندات الشركة", "Company documents")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "قارن هذه القائمة بمتطلبات الفرص في تقرير الفجوات — فجوة المستندات تُخفض درجة الملاءمة وتُبقي الأهلية معلَّقة عند النقص.",
            "Compare this list with opportunity requirements in the gap report — a document gap lowers the fit score and keeps eligibility pending when missing.",
          )}
        </p>
      </header>

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : error ? (
        <EmptyState
          iconAr="⚠️"
          title={t("تعذّر جلب المستندات", "Failed to load documents")}
          hintAr={error}
          action={
            <Button variant="outline" onClick={() => void load()} className="h-11">
              <RefreshCw className="size-4" aria-hidden />
              {t("إعادة المحاولة", "Retry")}
            </Button>
          }
        />
      ) : !docs || docs.length === 0 ? (
        <EmptyState
          iconAr="🗂️"
          title={t("لا مستندات بعد", "No documents yet")}
          hintAr={t(
            "حدّد حالة كل مستند ومصدره لتسريع تقييم أهليتك للفرص المشروطة بالمستندات.",
            "Set each document's status and source to speed up eligibility checks for document-conditioned opportunities.",
          )}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Badge
              variant="outline"
              className="border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300"
            >
              <CheckCircle2 className="size-3.5" aria-hidden />
              {t(
                `${availableCount} متوفر من ${docs.length}`,
                `${availableCount} available of ${docs.length}`,
              )}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void load()}
              className="h-11"
              aria-label={t("تحديث", "Refresh")}
            >
              <RefreshCw className="size-4" aria-hidden />
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">
                    {t("المستند", "Document")}
                  </TableHead>
                  <TableHead className="text-start">
                    {t("الحالة", "Status")}
                  </TableHead>
                  <TableHead className="text-start">
                    {t("المصدر", "Source")}
                  </TableHead>
                  <TableHead className="text-start">
                    {t("ملاحظات", "Notes")}
                  </TableHead>
                  <TableHead className="text-start">
                    {t("آخر تحديث / حفظ", "Updated / save")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{renderRows()}</TableBody>
            </Table>
          </div>

          <p className="flex items-start gap-2 text-xs leading-6 text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            {t(
              "«منتهٍ» يعني أن المستند موجود لكن صلاحيته انتهت — جهّز بديلًا محدّثًا قبل التقديم. لا يُطلب رفع الملفات هنا؛ القائمة لمتابعة الجاهزية فقط.",
              "“Expired” means the document exists but its validity ended — prepare an updated replacement before applying. No file uploads here; this list tracks readiness only.",
            )}
          </p>
          <p className="flex items-start gap-2 text-xs leading-6 text-muted-foreground">
            <FileCheck2 className="mt-0.5 size-4 shrink-0 text-teal-700 dark:text-teal-400" aria-hidden />
            {t(
              "تذكير: مستندات عرضك التقديمي (Pitch deck) تُدار من وحدة تحليل العرض، وهذه القائمة لمستندات الشركة الرسمية.",
              "Note: pitch-deck documents are managed in the deck analysis module; this list is for official company documents.",
            )}
          </p>
        </>
      )}
    </div>
  );
}
