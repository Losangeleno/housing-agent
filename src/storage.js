import fs from "fs";

export function ensureDir(path) {
  if (!fs.existsSync(path)) fs.mkdirSync(path, { recursive: true });
}

export function toCsvValue(v) {
  const s = String(v ?? "").replace(/"/g, '""');
  return `"${s}"`;
}

export function appendRowsCsv(path, headers, rows) {
  const hasFile = fs.existsSync(path);
  const lines = [];
  if (!hasFile) lines.push(headers.map(toCsvValue).join(","));
  for (const row of rows) {
    lines.push(headers.map(h => toCsvValue(row[h])).join(","));
  }
  fs.appendFileSync(path, lines.join("\n") + "\n", "utf8");
}

export function loadSeenIds(path) {
  if (!fs.existsSync(path)) return new Set();
  const txt = fs.readFileSync(path, "utf8");
  const arr = JSON.parse(txt || "[]");
  return new Set(arr);
}

export function saveSeenIds(path, setObj) {
  fs.writeFileSync(path, JSON.stringify(Array.from(setObj), null, 2), "utf8");
}
