import fs from "fs";
import pdfParse from "pdf-parse";

export async function loadResumeText(path) {
  if (!path || !fs.existsSync(path)) return "";
  const buff = fs.readFileSync(path);
  const data = await pdfParse(buff);
  return (data.text || "").replace(/\s+/g, " ").trim();
}

export function extractKeywords(text) {
  const seed = [
    "downtown", "north park", "city heights", "chula vista", "la mesa",
    "2 bedroom", "1 bedroom", "studio", "pet friendly", "parking",
    "laundry", "in-unit", "voucher", "section 8", "accessible", "transit"
  ];
  const lower = (text || "").toLowerCase();
  return seed.filter(k => lower.includes(k));
}
