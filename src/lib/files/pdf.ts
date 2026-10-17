/**
 * Masar — T7: استخراج نص PDF صفحةً صفحة عبر unpdf (pdf.js serverless).
 * كل صفحة = شريحة (Slide): index من 1، title = أول سطر غير فارغ (≤80 محرفًا)
 * أو «شريحة N»، text = النص الكامل مطبوع المسافات وأسطره بـ \n.
 * الأخطاء تُرمى Error برسالة عربية واضحة (المستدعي في T12 يحولها إلى
 * FAILED_EXTRACTION بمغلف ok/fail — ليس 500 خامًا).
 */

import { extractText, getDocumentProxy } from "unpdf";
import type { Slide } from "@/lib/core/types";

/** الحد الأقصى لعدد الصفحات (§10). */
export const MAX_PDF_PAGES = 60;

/** رسالة الفشل الموحّدة لملف غير مقروء (تالف/محمي/مشفّر). */
const ERR_UNREADABLE_AR = "تعذّر قراءة الملف؛ قد يكون تالفًا أو محميًّا بكلمة مرور";
/** رسالة تجاوز حد الصفحات. */
const ERR_TOO_MANY_PAGES_AR = "عدد الصفحات يتجاوز 60";

/** طويّ المسافات داخل السطر وإزالة الفراغ الطرفي. */
function normalizeLine(line: string): string {
  return line.replace(/[ \t\u00a0\u200f\u200e]+/g, " ").trim();
}

/** تقسيم نص الصفحة إلى أسطر غير فارغة مطبوعة المسافات. */
function toNormalizedLines(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/\r\n|\r|\n/)
    .map(normalizeLine)
    .filter((line) => line.length > 0);
}

/** اقتطاع إلى 80 محرفًا (آمنًا للمحارف المركّبة). */
function truncateTitle(line: string, maxChars = 80): string {
  const chars = Array.from(line);
  if (chars.length <= maxChars) return line;
  return chars.slice(0, maxChars).join("");
}

/** بناء شريحة من نص صفحة خام. */
function pageToSlide(index: number, raw: string): Slide {
  const lines = toNormalizedLines(raw);
  const firstLine = lines.length > 0 ? lines[0] : "";
  const title = truncateTitle(firstLine);
  return {
    index,
    title: title.length > 0 ? title : `شريحة ${index}`,
    // صفحة فارغة → نص "" وتبقى ضمن العدد
    text: lines.join("\n"),
  };
}

/**
 * استخراج شرائح PDF: صفحة لكل شريحة.
 * يرمي Error عربيًّا عند: ملف تالف/محمي، أو تجاوز 60 صفحة.
 */
export async function extractPdfSlides(buf: Buffer): Promise<Slide[]> {
  // فتح المستند — هنا تُكتشف التلف/كلمة المرور (PasswordException/InvalidPDF).
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buf));
  } catch {
    throw new Error(ERR_UNREADABLE_AR);
  }

  // حد الصفحات قبل الاستخراج (توفيرًا للعمل).
  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new Error(ERR_TOO_MANY_PAGES_AR);
  }

  // استخراج نص كل صفحة على حدة (mergePages: false → مصفوفة نصوص).
  let result: { totalPages: number; text: string[] };
  try {
    result = await extractText(pdf, { mergePages: false });
  } catch {
    throw new Error(ERR_UNREADABLE_AR);
  }

  // حماية من اختلاف طول المصفوفة عن عدد الصفحات: نعتمد الأطول ليستمر الفهرس صحيحًا.
  const pageTexts = Array.isArray(result.text) ? result.text : [result.text];
  const count = Math.max(pdf.numPages, pageTexts.length);
  if (count > MAX_PDF_PAGES) {
    throw new Error(ERR_TOO_MANY_PAGES_AR);
  }

  const slides: Slide[] = [];
  for (let i = 0; i < count; i++) {
    slides.push(pageToSlide(i + 1, pageTexts[i] ?? ""));
  }
  return slides;
}
