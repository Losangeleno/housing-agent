import "dotenv/config";
import fs from "fs";
import axios from "axios";
import { requireEnvVars } from "./env.js";

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

requireEnvVars(["TEAMS_FLOW_URL"], "notify-teams");
const flowUrl = process.env.TEAMS_FLOW_URL;

const csvPath = "./outputs/positive_hits.csv";
const summaryPath = "./outputs/run_summary.json";
const allSitesCsvPath = "./outputs/all_sites_status.csv";
const availabilityReportPath = "./outputs/site_availability_report.csv";

function summarizeErrorBuckets(rows) {
  const buckets = { network: 0, timeout: 0, blocked: 0, parse: 0, unknown: 0 };
  for (const row of rows) {
    if (row.status !== "error") continue;
    const key = String(row.errorBucket || "unknown").toLowerCase();
    if (Object.hasOwn(buckets, key)) buckets[key] += 1;
    else buckets.unknown += 1;
  }
  return buckets;
}

function computeHealth(totalSites, errored) {
  if (!totalSites) return "red";
  const errorRate = errored / totalSites;
  if (errorRate <= 0.15) return "green";
  if (errorRate <= 0.4) return "yellow";
  return "red";
}

let rows = [];
if (fs.existsSync(csvPath)) {
  const raw = fs.readFileSync(csvPath, "utf8").trim();
  if (raw) {
    const lines = raw.split(/\r?\n/);
    if (lines.length > 1) {
      const headers = parseCsvLine(lines[0]);
      rows = lines.slice(1).filter(Boolean).map((line) => {
        const cols = parseCsvLine(line);
        return Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? ""]));
      });
    }
  }
}

const newest = rows
  .slice(-5)
  .reverse()
  .map((listing, i) => {
    const title = listing.title || "Untitled listing";
    const org = listing.org || "Unknown org";
    const score = listing.matchScore || "n/a";
    const location = listing.locations || "Unknown location";
    const rent = listing.pay || "Not listed";
    const beds = listing.bedrooms || "n/a";
    const url = listing.url || listing.id || "";
    return `${i + 1}. ${title}\n   Org: ${org}\n   Score: ${score}\n   Location: ${location}\n   Rent: ${rent}\n   Beds: ${beds}\n   Link: ${url}`;
  });

let siteSummaryLines = [];
let health = "unknown";
let criteriaLines = [];
let runQueryLines = [];
if (fs.existsSync(summaryPath)) {
  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    const checked = Number(summary.checked || 0);
    const positives = Number(summary.positives || 0);
    const newSaved = Number(summary.newSaved || 0);
    const threshold = Number(summary.threshold || 0);
    const minHits = Number(summary.minProfileKeywordHits || 0);
    const maxRent = Number(summary.maxRent || 0);
    const minBedrooms = Number(summary.minBedrooms || 0);
    const queries = Array.isArray(summary.queries) ? summary.queries : [];

    criteriaLines = [
      `Criteria stats: checked=${checked}, matched=${positives}, new_saved=${newSaved}`,
      `Criteria settings: score_threshold=${threshold}, min_profile_keyword_hits=${minHits}, max_rent=${maxRent || "off"}, min_bedrooms=${minBedrooms || "off"}`
    ];

    if (queries.length) {
      runQueryLines = [`Queries used: ${queries.join(", ")}`];
    }
  } catch {
    criteriaLines = [];
    runQueryLines = [];
  }
}

if (fs.existsSync(allSitesCsvPath)) {
  const statusRaw = fs.readFileSync(allSitesCsvPath, "utf8").trim();
  if (statusRaw) {
    const statusLines = statusRaw.split(/\r?\n/);
    const statusHeaders = parseCsvLine(statusLines[0] || "");
    const statusRows = statusLines.slice(1).filter(Boolean).map((line) => {
      const cols = parseCsvLine(line);
      return Object.fromEntries(statusHeaders.map((h, i) => [h, cols[i] ?? ""]));
    });
    const totalSites = statusRows.length;
    const withJobs = statusRows.filter((r) => Number(r.jobCount || 0) > 0).length;
    const errored = statusRows.filter((r) => r.status === "error").length;
    const noOpenPositions = statusRows.filter((r) => r.status !== "error" && Number(r.jobCount || 0) === 0).length;
    health = computeHealth(totalSites, errored);
    const buckets = summarizeErrorBuckets(statusRows);
    const topErrors = statusRows
      .filter((r) => r.status === "error")
      .slice(0, 5)
      .map((r) => `- ${r.org}: ${r.error}`);
    const activeSites = statusRows
      .filter((r) => Number(r.jobCount || 0) > 0)
      .slice(0, 10)
      .map((r) => `- ${r.org}: ${r.jobCount} job(s)`);

    siteSummaryLines = [
      `Run health: ${health.toUpperCase()}`,
      `All requested sites: checked ${totalSites}, with jobs ${withJobs}, errors ${errored}`,
      `Sites with no open positions: ${noOpenPositions}`,
      `Error buckets: network=${buckets.network}, timeout=${buckets.timeout}, blocked=${buckets.blocked}, parse=${buckets.parse}, unknown=${buckets.unknown}`,
      ...(activeSites.length ? ["Sites with jobs:", ...activeSites] : []),
      ...(topErrors.length ? ["Top site errors:", ...topErrors] : []),
    ];
  }
} else if (fs.existsSync(summaryPath)) {
  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    const totalSites = Number(summary.boardsChecked || 0);
    const sourceStats = Array.isArray(summary.sourceStats) ? summary.sourceStats : [];
    const errorSites = Array.isArray(summary.boardErrors) ? summary.boardErrors : [];
    const sitesWithJobs = sourceStats.filter((s) => Number(s.count || 0) > 0).length;
    const errored = errorSites.length;
    health = summary.health || computeHealth(totalSites, errored);
    const b = summary.errorBuckets || {};
    const topErrors = errorSites.slice(0, 5).map((e) => `- ${e.org}: ${e.error}`);

    siteSummaryLines = [
      `Run health: ${String(health).toUpperCase()}`,
      `All requested sites: checked ${totalSites}, with jobs ${sitesWithJobs}, errors ${errored}`,
      `Error buckets: network=${Number(b.network || 0)}, timeout=${Number(b.timeout || 0)}, blocked=${Number(b.blocked || 0)}, parse=${Number(b.parse || 0)}, unknown=${Number(b.unknown || 0)}`,
      ...(topErrors.length ? ["Top site errors:", ...topErrors] : [])
    ];
  } catch {
    siteSummaryLines = [];
  }
}

const text = [
  `Housing Agent: ${newest.length} new criteria-aligned listing(s)`,
  ...(criteriaLines.length ? ["", ...criteriaLines] : []),
  ...(runQueryLines.length ? ["", ...runQueryLines] : []),
  ...(siteSummaryLines.length ? ["", ...siteSummaryLines] : []),
  ...(newest.length ? ["", ...newest] : ["", "No new criteria-aligned listings in this run."]),
].join("\n\n");

const payload = { text };
if (fs.existsSync(availabilityReportPath)) {
  const bytes = fs.readFileSync(availabilityReportPath);
  payload.attachment = {
    fileName: "site_availability_report.csv",
    mimeType: "text/csv",
    base64: bytes.toString("base64")
  };
}

await axios.post(flowUrl, payload, { timeout: 30000 });
console.log("Sent to Power Automate/Teams.");
