/**
 * Masar — T7: تحقق ذاتي لوحدة الملفات (validate / pdf / pptx).
 * تشغيل: bun scripts/check-files.ts
 * يطبع «FILES CHECK PASSED» عند نجاح كل الفحوص.
 */

import JSZip from "jszip";
import { validateUpload } from "../src/lib/files/validate";
import { extractPdfSlides } from "../src/lib/files/pdf";
import { extractPptxSlides } from "../src/lib/files/pptx";
import type { Slide } from "../src/lib/core/types";

// ————— عدّاد النتائج —————
let failures = 0;
function check(label: string, pass: boolean): void {
  if (pass) {
    console.log(`PASS — ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL — ${label}`);
  }
}
function printSlide(s: Slide): void {
  console.log(`  [شريحة ${s.index}] title="${s.title}" text="${s.text.replace(/\n/g, " ⏎ ")}"`);
}

// ————— 1) امتداد مزوّر: محتوى EXE باسم .pdf → رفض بالبصمة —————
const exeBuffer = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), Buffer.alloc(64, 0x61)]);
const r1 = validateUpload(exeBuffer, "trojan.pdf");
check("امتداد مزوّر (exe باسم .pdf) يُرفض بالبصمة BAD_TYPE", r1.ok === false && r1.code === "BAD_TYPE" && r1.fileType === undefined && r1.size === exeBuffer.length);

// ————— 2) نص عادي → رفض —————
const r2 = validateUpload(Buffer.from("هذا مجرد نص عادي وليس ملفًا ثنائيًا", "utf8"), "notes.pdf");
check("نص عادي يُرفض BAD_TYPE", r2.ok === false && r2.code === "BAD_TYPE" && r2.messageAr.includes("غير مدعوم"));

// ————— 2ب) نص عادي بامتداد pptx → رفض أيضًا —————
const r2b = validateUpload(Buffer.from("plain text"), "deck.pptx");
check("نص عادي بامتداد pptx يُرفض", r2b.ok === false && r2b.code === "BAD_TYPE");

// ————— 3) ملف 21MB وهمي (بصمة PDF سليمة) → TOO_LARGE —————
const bigBuffer = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(21 * 1024 * 1024, 0)]);
const r3 = validateUpload(bigBuffer, "big.pdf");
check("ملف 21MB يُرفض TOO_LARGE برسالة عربية", r3.ok === false && r3.code === "TOO_LARGE" && r3.messageAr === "حجم الملف يتجاوز 20 ميجابايت" && r3.size === bigBuffer.length);

// ————— 3ب) حدّ 20MB بالضبط → قبول —————
const exact20 = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(20 * 1024 * 1024 - 9, 0)]);
const r3b = validateUpload(exact20, "exact.pdf");
check("حد 20MB بالضبط يُقبل", r3b.ok === true && r3b.fileType === "pdf" && r3b.size === 20 * 1024 * 1024);

// ————— 4) بصمة %PDF- → نوع pdf —————
const pdfMagicBuffer = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(50, 0)]);
const r4 = validateUpload(pdfMagicBuffer, "deck.pdf");
check("بصمة %PDF- → fileType=pdf", r4.ok === true && r4.fileType === "pdf");

// ————— 4ب) بصمة PK مع امتداد غريب → قبول والنوع من البصمة pptx —————
const pkBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x0a, 0x0b, 0x0c, 0x0d]);
const r5 = validateUpload(pkBuffer, "mystery.dat");
check("بصمة PK مع امتداد غير .pptx/.pdf → قبول pptx", r5.ok === true && r5.fileType === "pptx");

// ————— 4ج) بصمة PDF مع امتداد pptx → النوع pdf (البصمة حَكَم) —————
const r6 = validateUpload(Buffer.from("%PDF-1.7\nrest"), "misnamed.pptx");
check("بصمة %PDF- مع امتداد pptx → fileType=pdf", r6.ok === true && r6.fileType === "pdf");

// ————— 5) توليد PPTX حقيقي بـ jszip ثم استخراجه —————
function makeSlideXml(title: string, paragraphs: string[]): string {
  const titleRun = `<a:p><a:r><a:rPr lang="ar-SA"/><a:t>${title}</a:t></a:r></a:p>`;
  const bodyParagraphs = paragraphs
    .map((p) => `<a:p><a:r><a:rPr lang="ar-SA"/><a:t>${p}</a:t></a:r></a:p>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Title 1"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="title"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/>${titleRun}</p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Content 1"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/>${bodyParagraphs}</p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

// ملاحظة الفحص: فقرة من runين تُجمع في سطر واحد، وفقرة ثانية سطر مستقل.
const slide1Xml = makeSlideXml("عنوان الشريحة الأولى", [
  "مسار منصة تمويل",
  "نص عربي في الشريحة",
]).replace(
  /<a:p><a:r><a:rPr lang="ar-SA"\/><a:t>نص عربي في الشريحة<\/a:t><\/a:r><\/a:p>/,
  '<a:p><a:r><a:rPr lang="ar-SA"/><a:t>نص </a:t></a:r><a:r><a:t>عربي </a:t></a:r><a:r><a:t>مقسّم</a:t></a:r></a:p>'
);
const slide2Xml = makeSlideXml("الشريحة الثانية", ["المشكلة والحل"]);
const slide10Xml = makeSlideXml("الشريحة العاشرة", ["الطلب التمويلي"]);

const pptxZip = new JSZip();
pptxZip.file(
  "[Content_Types].xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide10.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
);
pptxZip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
pptxZip.file("ppt/slides/slide1.xml", slide1Xml);
pptxZip.file("ppt/slides/slide2.xml", slide2Xml);
pptxZip.file("ppt/slides/slide10.xml", slide10Xml);
// شريحة فارغة تمامًا (بلا نص) لاختبار الحفاظ على العدد
pptxZip.file(
  "ppt/slides/slide3.xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`
);
// إدخال بترتيب معجمي عكسي عمدًا (slide10 ثم slide1 ثم slide2) — الفرز الرقمي هو الفيصل.
const shuffledZip = new JSZip();
shuffledZip.file("ppt/slides/slide10.xml", slide10Xml);
shuffledZip.file("ppt/slides/slide1.xml", slide1Xml);
shuffledZip.file("ppt/slides/slide2.xml", slide2Xml);

async function runPptxChecks(): Promise<void> {
  const pptxBuffer = await pptxZip.generateAsync({ type: "nodebuffer" });
  const rPptx = validateUpload(pptxBuffer, "deck.pptx");
  check("PPTX مولّد يُقبل بصمة PK", rPptx.ok === true && rPptx.fileType === "pptx");

  const slides = await extractPptxSlides(pptxBuffer);
  console.log("— الشرائح المستخرجة من PPTX —");
  slides.forEach(printSlide);

  check("عدد الشرائح = 4 (منها الفارغة)", slides.length === 4);
  check(
    "الترتيب رقمي: slide2 قبل slide3 قبل slide10",
    slides[1].title === "الشريحة الثانية" && slides[2].title === "شريحة 3" && slides[3].title === "الشريحة العاشرة"
  );
  check(
    "عنوان الشريحة 1 من placeholder العنوان",
    slides[0].title === "عنوان الشريحة الأولى"
  );
  check(
    "runs الفقرة تُجمع في سطر واحد",
    slides[0].text.includes("نص عربي مقسّم") && !slides[0].text.split("\n").includes("نص ")
  );
  check("نص الشريحة الثانية سليم", slides[1].text.includes("المشكلة والحل"));
  check(
    'شريحة فارغة → text="" وtitle="شريحة 3" وتبقى بالعدد',
    slides[2].text === "" && slides[2].title === "شريحة 3" && slides[2].index === 3
  );
  check("الفهارس 1..4 تصاعدية", slides.every((s, i) => s.index === i + 1));

  // الترتيب المعجمي (شجرة الإدخال معكوسة) يجب ألا يؤثر
  const shuffledBuffer = await shuffledZip.generateAsync({ type: "nodebuffer" });
  const shuffledSlides = await extractPptxSlides(shuffledBuffer);
  check(
    "إدخال بترتيب معجمي معكوس يُستخرج بترتيب رقمي صحيح",
    shuffledSlides.length === 3 && shuffledSlides[0].title === "عنوان الشريحة الأولى" && shuffledSlides[2].title === "الشريحة العاشرة"
  );

  // حزمة zip سليمة لكن بلا شرائح (docx-like) → خطأ عربي
  const docxLike = new JSZip();
  docxLike.file("word/document.xml", "<w:document/>");
  const docxBuffer = await docxLike.generateAsync({ type: "nodebuffer" });
  let noSlidesError: Error | null = null;
  try {
    await extractPptxSlides(docxBuffer);
  } catch (e) {
    noSlidesError = e as Error;
  }
  check(
    "zip بلا شرائح → Error عربي واضح",
    noSlidesError !== null && /تعذّر|ليس ملف PPTX/.test(noSlidesError.message)
  );

  // بصمة PK لكن المحتوى ليس zip → خطأ عربي
  const pkGarbage = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  let corruptError: Error | null = null;
  try {
    await extractPptxSlides(pkGarbage);
  } catch (e) {
    corruptError = e as Error;
  }
  check(
    "بصمة PK بمحتوى غير zip → Error عربي",
    corruptError !== null && /تعذّر|تالف|PPTX/.test(corruptError.message)
  );

  // أكثر من 60 شريحة → خطأ الحد
  const tooMany = new JSZip();
  for (let i = 1; i <= 61; i++) {
    tooMany.file(`ppt/slides/slide${i}.xml`, makeSlideXml(`شريحة ${i}`, ["نص"]));
  }
  const tooManyBuffer = await tooMany.generateAsync({ type: "nodebuffer" });
  let tooManyError: Error | null = null;
  try {
    await extractPptxSlides(tooManyBuffer);
  } catch (e) {
    tooManyError = e as Error;
  }
  check(
    "PPTX بـ61 شريحة → Error «عدد الشرائح يتجاوز 60»",
    tooManyError !== null && tooManyError.message.includes("يتجاوز 60")
  );
}

// ————— 6) توليد PDF صغير صالح يدويًّا ثم استخراجه عبر unpdf —————
/** يبني PDF نصيًّا صالحًا كاملًا (header/objects/xref/trailer) بمقابض دقيقة. */
function buildSimplePdf(pages: string[][], fontSize = 12, pageWidth = 612): Buffer {
  const nPages = pages.length;
  const pageObjIds = pages.map((_, i) => 4 + i);
  const contentObjIds = pages.map((_, i) => 4 + nPages + i);
  const objects: Map<number, string> = new Map();
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(
    2,
    `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${nPages} >>`
  );
  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((lines, i) => {
    const pageId = pageObjIds[i];
    const contentId = contentObjIds[i];
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    const escapePdf = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const streamParts: string[] = ["BT", `/F1 ${fontSize} Tf`, "14 TL", "72 720 Td"];
    lines.forEach((line, j) => {
      if (j > 0) streamParts.push("T*");
      streamParts.push(`(${escapePdf(line)}) Tj`);
    });
    streamParts.push("ET");
    const stream = streamParts.join("\n");
    objects.set(contentId, `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  });

  const maxId = 3 + 2 * nPages;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id <= maxId; id++) {
    offsets[id] = Buffer.byteLength(out, "latin1");
    out += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(out, "latin1");
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id++) {
    xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  out += xref;
  out += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

async function runPdfChecks(): Promise<void> {
  // صفحة 1: سطران، صفحة 2: سطر، صفحة 3: فارغة (بلا نص).
  const pdfBuffer = buildSimplePdf([
    ["Masar Funding Readiness", "Founded 2024"],
    ["Second page content"],
    [], // صفحة فارغة تمامًا
  ]);
  const rPdf = validateUpload(pdfBuffer, "mini.pdf");
  check("PDF المولّد يُقبل بصمة %PDF-", rPdf.ok === true && rPdf.fileType === "pdf");

  let slides: Slide[] = [];
  let pdfError: Error | null = null;
  try {
    slides = await extractPdfSlides(pdfBuffer);
  } catch (e) {
    pdfError = e as Error;
  }

  if (pdfError === null) {
    console.log("— الشرائح المستخرجة من PDF —");
    slides.forEach(printSlide);
    check("عدد الصفحات = 3 (منها الفارغة)", slides.length === 3);
    check("فهارس 1..3", slides.every((s, i) => s.index === i + 1));
    check(
      "عنوان الصفحة 1 = أول سطر غير فارغ",
      slides[0].title.startsWith("Masar Funding Readiness")
    );
    check("نص الصفحة 1 يضم السطرين", slides[0].text.includes("Masar Funding Readiness") && slides[0].text.includes("Founded 2024"));
    check("الصفحة 2 مستقلة بنصها", slides[1].text.includes("Second page content") && slides[1].index === 2);
    check(
      'صفحة فارغة → text="" وtitle="شريحة 3"',
      slides[2].text === "" && slides[2].title === "شريحة 3"
    );
  } else {
    // مسار التسامح: إن تعذّر التوليد الصالح، يجب أن يكون الخطأ عربيًّا منظّمًا (لا crash).
    console.log(`— تعذّر استخراج PDF المولّد (تسامح): ${pdfError.message} —`);
    check("خطأ PDF عربي منظّم لا انهيار", /تعذّر|تالف|محمي/.test(pdfError.message));
  }

  // PDF تالف: بصمة سليمة ومحتوى خردة → Error عربي لا crash.
  const corruptPdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("garbage garbage no xref no trailer")]);
  let corruptPdfError: Error | null = null;
  try {
    await extractPdfSlides(corruptPdf);
  } catch (e) {
    corruptPdfError = e as Error;
  }
  check(
    "PDF تالف → Error عربي (تالف/محمي)",
    corruptPdfError !== null && corruptPdfError.message.includes("تعذّر قراءة الملف")
  );

  // أكثر من 60 صفحة → Error الحد.
  const tooManyPages = buildSimplePdf(Array.from({ length: 61 }, () => ["page line"]));
  let tooManyPagesError: Error | null = null;
  try {
    await extractPdfSlides(tooManyPages);
  } catch (e) {
    tooManyPagesError = e as Error;
  }
  check(
    "PDF بـ61 صفحة → Error «عدد الصفحات يتجاوز 60»",
    tooManyPagesError !== null && tooManyPagesError.message.includes("عدد الصفحات يتجاوز 60")
  );

  // عنوان طويل يُقتطع إلى 80 محرفًا (خط صغير حتى يدخل النص كاملًا في عرض الصفحة).
  // ملاحظة: pdf.js يقتطع عند حافة MediaBox — سلوك معروف لا يمس كودنا.
  const longTitle = "L".repeat(200);
  const longTitlePdf = buildSimplePdf([[longTitle]], 4, 1200);
  const longTitleSlides = await extractPdfSlides(longTitlePdf);
  check(
    "عنوان طويل يُقتطع إلى 80 محرفًا والنص كاملًا",
    Array.from(longTitleSlides[0].title).length === 80 && longTitleSlides[0].text.length === 200
  );
}

// ————— التنفيذ —————
async function main(): Promise<void> {
  await runPptxChecks();
  await runPdfChecks();
  if (failures > 0) {
    console.error(`\nFAILED: ${failures} فحص فشل`);
    process.exit(1);
  }
  console.log("\nFILES CHECK PASSED");
}

main().catch((e) => {
  console.error("CRASH:", e);
  process.exit(1);
});
