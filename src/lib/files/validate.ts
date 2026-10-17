/**
 * Masar — T7: فحص ملفات الرفع بالبصمة الثنائية (magic bytes) لا بالامتداد.
 * القواعد (§10 من العقد):
 *  - الحجم > 20MB → TOO_LARGE.
 *  - بصمة PDF: يبدأ الملف بـ `%PDF-` (25 50 44 46 2D).
 *  - بصمة PPTX/OOXML (zip): يبدأ بـ PK (50 4B 03 04 / 50 4B 05 06 / 50 4B 07 08).
 *  - غير ذلك → BAD_TYPE. الامتداد المزوّر يُرفض تلقائيًّا لأن القرار للمحتوى.
 *  - بصمة صحيحة مع امتداد غريب → قبول، والنوع من البصمة.
 */

/** الحد الأقصى لحجم الرفع: 20 ميجابايت (بايتات). */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** بصمة رأس ملف PDF: `%PDF-` = 25 50 44 46 2D. */
const PDF_MAGIC: readonly number[] = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** بصمات ترويسات أرشيف ZIP (PPTX/OOXML حاوية zip): 50 4B 03 04 / 05 06 / 07 08. */
const ZIP_MAGICS: ReadonlyArray<readonly number[]> = [
  [0x50, 0x4b, 0x03, 0x04], // Local File Header (الحالة الشائعة)
  [0x50, 0x4b, 0x05, 0x06], // End of Central Directory (أرشيف فارغ)
  [0x50, 0x4b, 0x07, 0x08], // Spanning / Data Descriptor
];

function startsWithBytes(buf: Buffer, magic: readonly number[]): boolean {
  if (buf.length < magic.length) return false;
  return magic.every((byte, i) => buf[i] === byte);
}

/** نوع الملف من البصمة الثنائية: pdf | pptx | null (غير مدعوم). */
function detectFileTypeByMagic(buf: Buffer): "pdf" | "pptx" | null {
  if (startsWithBytes(buf, PDF_MAGIC)) return "pdf";
  if (ZIP_MAGICS.some((magic) => startsWithBytes(buf, magic))) return "pptx";
  return null;
}

/**
 * تحقق واحد نهائي من ملف الرفع: الحجم ثم البصمة الثنائية.
 * ملاحظة: `fileName` مقبول عمدًا في التوقيع (عقد §5) لكنه لا يشارك في القرار —
 * النوع يُحدد بمحتوى الملف لا بالامتداد (مقاومة الامتداد المزوّر).
 */
export function validateUpload(
  buf: Buffer,
  fileName: string
): { ok: boolean; code?: string; messageAr: string; fileType?: "pdf" | "pptx"; size: number } {
  void fileName; // الامتداد لا يُستخدم في القرار — البصمة هي الحَكَم
  const size = buf.length;

  // 1) الحجم أولًا: ملف ضخم يُرفض قبل أي فحص محتوى.
  if (size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      code: "TOO_LARGE",
      messageAr: "حجم الملف يتجاوز 20 ميجابايت",
      size,
    };
  }

  // 2) البصمة الثنائية تحدد النوع (pdf/pptx) أو ترفض.
  const fileType = detectFileTypeByMagic(buf);
  if (fileType === "pdf") {
    return {
      ok: true,
      messageAr: "ملف PDF صالح",
      fileType: "pdf",
      size,
    };
  }
  if (fileType === "pptx") {
    return {
      ok: true,
      messageAr: "ملف PPTX صالح",
      fileType: "pptx",
      size,
    };
  }

  // 3) لا بصمة معروفة (نص/EXE/غيره) — الرفض حتى لو الامتداد سليم.
  return {
    ok: false,
    code: "BAD_TYPE",
    messageAr:
      "نوع الملف غير مدعوم؛ PDF أو PPTX فقط (النوع يُحدد بمحتوى الملف لا الامتداد)",
    size,
  };
}
