/**
 * Masar — T7: استخراج نص PPTX شريحةً شريحة عبر jszip.
 * يقرأ ppt/slides/slide{N}.xml بترتيب رقمي (slide2 قبل slide10 — لا ترتيب معجمي)،
 * حد 60 شريحة. من كل XML تُستخرج نصوص عناصر <a:t> بالترتيب: كل فقرة <a:p> سطر،
 * وruns الفقرة تُجمع معًا. العنوان: نص أول placeholder من نوع title/ctrTitle إن
 * أمكن، وإلا أول سطر غير فارغ (≤80 محرفًا)، وإلا «شريحة N».
 * الفشل (ليس pptx صالحًا رغم بصمة PK) → Error عربي واضح.
 */

import JSZip from "jszip";
import type { Slide } from "@/lib/core/types";

/** الحد الأقصى لعدد الشرائح (§10). */
export const MAX_PPTX_SLIDES = 60;

/** مسار شريحة داخل الحزمة: ppt/slides/slide{N}.xml. */
const SLIDE_PATH_RE = /^ppt\/slides\/slide(\d+)\.xml$/;

const ERR_CORRUPT_AR = "تعذّر قراءة الملف؛ قد يكون تالفًا أو ليس ملف PPTX صالحًا";
const ERR_NOT_PPTX_AR = "تعذّر قراءة الملف؛ ليس ملف PPTX صالحًا (لا توجد شرائح)";
const ERR_TOO_MANY_SLIDES_AR = "عدد الشرائح يتجاوز 60";

/** فقرة DrawingML: <a:p> ... </a:p>. */
const PARAGRAPH_RE = /<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g;
/** عنصر نص DrawingML: <a:t> ... </a:t> (المحتوى قد يضم كيانات XML). */
const TEXT_RUN_RE = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
/** شكل Shape داخل الشريحة: <p:sp> ... </p:sp>. */
const SHAPE_RE = /<p:sp(?:\s[^>]*)?>([\s\S]*?)<\/p:sp>/g;
/** placeholder عنوان (type="title" أو "ctrTitle") بأي ترتيب سمات. */
const TITLE_PH_RE = /<p:ph\b[^>]*\btype\s*=\s*["'](title|ctrTitle)["']/;

/** فك كيانات XML في نص <a:t> (&amp; &lt; … وكيانات رقمية). */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "\ufffd";
  }
}

/** نص فقرة واحدة: جمع كل <a:t> فيها بالترتيب ثم طبّ المسافات. */
function paragraphToLine(fragment: string): string {
  let out = "";
  let m: RegExpExecArray | null;
  TEXT_RUN_RE.lastIndex = 0;
  while ((m = TEXT_RUN_RE.exec(fragment)) !== null) {
    out += decodeXmlEntities(m[1]);
  }
  return out.replace(/\s+/g, " ").trim();
}

/** أسطر الشريحة: فقرة لكل سطر (غير الفارغ). إن غابت <a:p> نجمع <a:t> مباشرة. */
function extractLines(xml: string): string[] {
  const lines: string[] = [];
  let m: RegExpExecArray | null;
  PARAGRAPH_RE.lastIndex = 0;
  while ((m = PARAGRAPH_RE.exec(xml)) !== null) {
    const line = paragraphToLine(m[1]);
    if (line.length > 0) lines.push(line);
  }
  if (lines.length > 0) return lines;
  // مسار احتياطي لملفات شاذة بلا فقرات: أول عنصر نص لكل سطر.
  TEXT_RUN_RE.lastIndex = 0;
  const fallback: string[] = [];
  while ((m = TEXT_RUN_RE.exec(xml)) !== null) {
    const line = decodeXmlEntities(m[1]).replace(/\s+/g, " ").trim();
    if (line.length > 0) fallback.push(line);
  }
  return fallback;
}

/** نص أول placeholder عنوان (أول فقرة في أول شكل title/ctrTitle). */
function findTitleText(xml: string): string | null {
  let m: RegExpExecArray | null;
  SHAPE_RE.lastIndex = 0;
  while ((m = SHAPE_RE.exec(xml)) !== null) {
    const shapeXml = m[1];
    if (TITLE_PH_RE.test(shapeXml)) {
      const firstParagraph = /<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/.exec(shapeXml);
      if (firstParagraph) {
        const title = paragraphToLine(firstParagraph[1]);
        if (title.length > 0) return title;
      }
    }
  }
  return null;
}

/** اقتطاع إلى 80 محرفًا (آمنًا للمحارف المركّبة). */
function truncateTitle(line: string, maxChars = 80): string {
  const chars = Array.from(line);
  if (chars.length <= maxChars) return line;
  return chars.slice(0, maxChars).join("");
}

/** بناء شريحة من XML شريحة واحدة. */
function slideXmlToSlide(index: number, xml: string): Slide {
  const lines = extractLines(xml);
  const titleCandidate = findTitleText(xml) ?? (lines.length > 0 ? lines[0] : "");
  const title = truncateTitle(titleCandidate);
  return {
    index,
    title: title.length > 0 ? title : `شريحة ${index}`,
    // شريحة بلا نص → "" وتبقى ضمن العدد
    text: lines.join("\n"),
  };
}

/**
 * استخراج شرائح PPTX من بصمة الحزمة (Buffer).
 * يرمي Error عربيًّا عند: حزمة غير صالحة، لا شرائح، أو تجاوز 60 شريحة.
 */
export async function extractPptxSlides(buf: Buffer): Promise<Slide[]> {
  // فتح الحزمة (بصمة PK صحيحة لكن المحتوى قد يكون غير zip أصلًا).
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new Error(ERR_CORRUPT_AR);
  }

  // جمع ملفات الشرائح الموجودة وترتيبها رقميًّا (slide2 قبل slide10).
  const entries: Array<{ n: number; path: string; file: JSZip.JSZipObject }> = [];
  zip.forEach((path, file) => {
    if (file.dir) return;
    const match = SLIDE_PATH_RE.exec(path);
    if (match) {
      entries.push({ n: parseInt(match[1], 10), path, file });
    }
  });
  entries.sort((a, b) => a.n - b.n);

  if (entries.length === 0) {
    // zip سليم لكن ليس عرضًا (docx/xlsx…) — يُرفض هنا بوضوح.
    throw new Error(ERR_NOT_PPTX_AR);
  }
  if (entries.length > MAX_PPTX_SLIDES) {
    throw new Error(ERR_TOO_MANY_SLIDES_AR);
  }

  const slides: Slide[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let xml: string;
    try {
      xml = await entry.file.async("string");
    } catch {
      throw new Error(ERR_CORRUPT_AR);
    }
    // الفهرس ترتيبي 1..M (يتطابق مع رقم الشريحة في العروض السليمة بلا فجوات).
    slides.push(slideXmlToSlide(i + 1, xml));
  }
  return slides;
}
