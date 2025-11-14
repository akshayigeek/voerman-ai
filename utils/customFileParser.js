const mammoth = require("mammoth");
const xlsx = require("xlsx");
const { convert } = require("html-to-text");
const textract = require("textract"); // fallback for many format)
const { simpleParser } = require("mailparser");
const pdf = require("pdf-extraction");
const Excel = require("exceljs");

// --- PDF ---
const extractPdfText = async (buffer) => {
  const data = await pdf(buffer);
  return data.text;
};

// --- DOCX ---
const extractDocxText = async (buffer) => {
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
};

// --- TXT / MD ---
const extractPlainText = async (buffer) => buffer.toString("utf-8");

// --- CSV / TSV ---
const extractCsvText = async (buffer) => buffer.toString("utf-8");

// --- XLSX / ODS ---
const extractExcelText = async (buffer) => {
  const wb = xlsx.read(buffer, { type: "buffer" });
  return wb.SheetNames.map((name) =>
    xlsx.utils.sheet_to_csv(wb.Sheets[name])
  ).join("\n");
};

// --- HTML / HTM ---
const extractHtmlText = async (buffer) => {
  const html = buffer.toString("utf-8");
  return convert(html, {
    wordwrap: false,
    selectors: [{ selector: "img", format: "skip" }], // skip images
  });
};

// --- Fallback (PPT, ODP, RTF, EPUB, MOBI, AZW, KEY, etc.) ---
const extractWithTextract = async (buffer, originalName) =>
  new Promise((resolve, reject) => {
    textract.fromBufferWithName(originalName, buffer, (err, text) => {
      if (err) reject(err);
      else resolve(text);
    });
  });

const extractEmlContent = async (buffer) => {
  const parsed = await simpleParser(buffer);
  const response = `From: ${parsed.from?.text || ""}/nTo: ${
    parsed.to?.text || ""
  }/nSubject: ${parsed.subject || ""}/nDate: ${parsed.date || ""}/n/n${
    parsed.text || parsed.html || ""
  }`;
  return response;
};

// --- Universal Parser ---
const extractText = async (originalName, buffer) => {
  const ext = originalName.split(".").pop().toLowerCase();

  switch (ext) {
    case "pdf":
      return await extractPdfText(buffer);
    case "docx":
      return await extractDocxText(buffer);
    case "txt":
    case "md":
      return await extractPlainText(buffer);
    case "csv":
    case "tsv":
      return await extractCsvText(buffer);
    case "xls":
    case "xlsx":
    case "ods":
      return await extractExcelText(buffer);
    case "html":
    case "htm":
      return await extractHtmlText(buffer);
    default:
      // fallback for ppt, odp, rtf, epub, mobi, azw, key, etc.
      return await extractWithTextract(buffer, originalName);
  }
};

async function parseExcelFile(fileUrl) {
  // 1. Fetch the file as ArrayBuffer
  const response = await fetch(fileUrl);
  const buffer = await response.arrayBuffer();

  // 2. Read workbook
  const workbook = xlsx.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // 3. Convert sheet → array of arrays
  const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

  if (!data || !data.length) {
    return { headers: [], rows: [] };
  }

  const headers = data[0];
  const rows = data.slice(1);

  return { headers, rows };
}

module.exports = {
  extractEmlContent,
  extractText,
  parseExcelFile,
};
