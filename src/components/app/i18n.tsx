"use client";
/**
 * Masar — مزوّد اللغة والاتجاه (عربي RTL افتراضيًا + إنجليزية LTR)
 * t(ar, en) يُمرَّر النصين معًا — قاموس موضعي داخل كل مكوّن.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

type Lang = "ar" | "en";

interface I18nContextValue {
  lang: Lang;
  dir: "rtl" | "ltr";
  setLang: (l: Lang) => void;
  t: (ar: string, en: string) => string;
}


const SERVER_MESSAGE_EN: Record<string, string> = {
  "لم يُستخرج أي نص من الشرائح — قد يكون الملف صورًا ممسوحة ضوئيًّا بلا طبقة نصية": "No slide text was extracted. The file may contain scanned images without a text layer.",
  "فشل الاستخراج المنظم للحقول — أعد المحاولة عبر إعادة المعالجة": "Structured field extraction failed. Retry processing this version.",
  "تعذّر توليد تقرير الفجوات — أعد المحاولة عبر إعادة المعالجة": "The gap report could not be generated. Retry processing this version.",
  "انتهت مهلة المعالجة قبل اكتمال تقرير الفجوات": "The processing time limit was reached before the gap report finished.",
  "يحتوي النص أنماط تعليمات مشبوهة — عومل بوصفه بيانات": "The text contained suspicious instruction patterns and was treated as data.",
  "تعذّر حفظ الملف الأصلي في التخزين": "The original file could not be saved to storage.",
  "تعذّر استخراج الشرائح أو الحقول من الملف — جرّب رفع نسخة نصية (غير ممسوحة ضوئيًّا).": "Could not extract slides or fields. Try a text-based (non-scanned) file.",
  "تعذّر قراءة الملف؛ قد يكون تالفًا أو ليس ملف PPTX صالحًا": "The file could not be read. It may be corrupted or not a valid PPTX file.",
  "تعذّر قراءة الملف؛ قد يكون تالفًا أو محميًّا بكلمة مرور": "The file could not be read. It may be corrupted or password-protected.",
  "تعذّر قراءة الملف؛ ليس ملف PPTX صالحًا (لا توجد شرائح)": "The file is not a valid PPTX or contains no slides.",
  "عدد الشرائح يتجاوز 60": "The deck exceeds the 60-slide limit.",
  "الملف المرفق فارغ": "The uploaded file is empty.",
  "أرفق ملف العرض (PDF أو PPTX) في حقل «file»": "Attach a pitch deck file (PDF or PPTX) in the file field.",
};

/** Translate known server-generated Arabic status text while preserving original user content. */
export function localizeServerMessage(message: string | null | undefined, lang: Lang = "ar"): string {
  if (!message) return "";
  if (lang !== "en") return message;
  return message.split("؛ ").map((part) => {
    if (SERVER_MESSAGE_EN[part]) return SERVER_MESSAGE_EN[part];
    const slideCount = part.match(/^تعذّر استخراج النص من (\d+) شريحة من أصل (\d+)$/);
    if (slideCount) return `Could not extract text from ${slideCount[1]} of ${slideCount[2]} slides.`;
    const injection = part.match(/^يحتوي النص أنماط تعليمات مشبوهة/);
    if (injection) return SERVER_MESSAGE_EN["يحتوي النص أنماط تعليمات مشبوهة — عومل بوصفه بيانات"];
    if (/[\u0600-\u06FF]/.test(part)) return "This step could not be completed. Review the details or retry processing.";
    return part;
  }).join("; ");
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ar");

  useEffect(() => {
    let active = true;
    // قراءة اللغة المحفوظة بعد الترطيب (مؤجلة عن جسم التأثير لتفادي التسلسل)
    queueMicrotask(() => {
      if (!active) return;
      try {
        const saved = window.localStorage.getItem("masar_lang");
        if (saved === "en" || saved === "ar") setLangState(saved);
      } catch {
        /* localStorage قد يكون معطلًا */
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem("masar_lang", l);
    } catch {
      /* تجاهل */
    }
  }, []);

  const t = useCallback((ar: string, en: string) => (lang === "ar" ? ar : en), [lang]);

  return (
    <I18nContext.Provider value={{ lang, dir: lang === "ar" ? "rtl" : "ltr", setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // احتياط آمن عند الاستخدام خارج المزوّد (لا يمنع العرض)
    return {
      lang: "ar",
      dir: "rtl",
      setLang: () => undefined,
      t: (ar: string) => ar,
    };
  }
  return ctx;
}

/** تنسيق تاريخ عربي/إنجليزي حسب اللغة الحالية */
export function formatDate(iso: string | null | undefined, lang: Lang = "ar"): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return "—";
  }
}

/** تنسيق مبلغ بعملة */
export function formatMoney(amount: number | null | undefined, currency = "USD", lang: Lang = "ar"): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat(lang === "ar" ? "ar" : "en", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}
