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
const latestListingsPath = "./outputs/latest_listings.csv";
const currentSuggestionsPath = "./outputs/current_suggestions.csv";
const siteListingDetailsPath = "./outputs/site_listing_details.csv";
const newSinceRefreshPath = "./outputs/new_since_last_refresh.csv";
const removedSinceRefreshPath = "./outputs/removed_since_last_refresh.csv";

function readCsvRows(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  if (lines.length <= 1) return [];
  const headers = parseCsvLine(lines[0] || "");
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = parseCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? ""]));
  });
}

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
let topAvailabilityLines = [];
let currentSuggestionLines = [];
let siteDetailLines = [];
let freshListingLines = [];
let removedListingCount = 0;
if (fs.existsSync(summaryPath)) {
  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    const checked = Number(summary.checked || 0);
    const positives = Number(summary.positives || 0);
    const newSaved = Number(summary.newSaved || 0);
    const threshold = Number(summary.threshold || 0);
    const minHits = Number(summary.minProfileKeywordHits || 0);
    const minRent = Number(summary.minRent || 0);
    const maxRent = Number(summary.maxRent || 0);
    const minBedrooms = Number(summary.minBedrooms || 0);
    const maxBedrooms = Number(summary.maxBedrooms || 0);
    const minBathrooms = Number(summary.minBathrooms || 0);
    const maxBathrooms = Number(summary.maxBathrooms || 0);
    const requireRent = Boolean(summary.requireRent);
    const queries = Array.isArray(summary.queries) ? summary.queries : [];

    const newSinceLastRefresh = Number(summary.newSinceLastRefresh ?? newSaved);
    const stillActive = Number(summary.stillActive || 0);
    const removedSinceLastRefresh = Number(summary.removedSinceLastRefresh || 0);

    criteriaLines = [
      `Criteria stats: checked=${checked}, current_matches=${positives}, new_since_last_refresh=${newSinceLastRefresh}, still_active=${stillActive}, removed_or_no_longer_found=${removedSinceLastRefresh}`,
      `Criteria settings: Arcata/Humboldt, studio_or_1br, rent_range=${minRent || "off"}-${maxRent || "off"}, require_visible_rent=${requireRent}, apartments/condos/houses, score_threshold=${threshold}, min_profile_keyword_hits=${minHits}, min_bedrooms=${minBedrooms || "off"}, max_bedrooms=${maxBedrooms || "off"}, min_bathrooms=${minBathrooms || "off"}, max_bathrooms=${maxBathrooms || "off"}`
    ];

    if (queries.length) {
      runQueryLines = [`Queries used: ${queries.join(", ")}`];
    }
  } catch {
    criteriaLines = [];
    runQueryLines = [];
  }
}

const freshListings = readCsvRows(newSinceRefreshPath);
freshListingLines = freshListings.slice(0, 10).map((l, i) => {
  const title = l.title || "Untitled availability";
  const org = l.org || "Unknown org";
  const listingType = l.listingType || "Housing";
  const location = l.locations || "Arcata / Humboldt County";
  const rent = l.rentValue ? `$${l.rentValue}` : "n/a";
  const beds = l.bedrooms || "studio/unknown";
  const baths = l.bathrooms || "n/a";
  const score = l.matchScore || "n/a";
  const url = l.url || "";
  return `${i + 1}. ${title}\n   Type: ${listingType}\n   Org: ${org}\n   Score: ${score}\n   Location: ${location}\n   Rent: ${rent}\n   Beds: ${beds}\n   Baths: ${baths}\n   Link: ${url}`;
});
removedListingCount = readCsvRows(removedSinceRefreshPath).length;

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
      .map((r) => `- ${r.org}: ${r.jobCount} availabilities`);

    siteSummaryLines = [
      `Run health: ${health.toUpperCase()}`,
      `All requested sites: checked ${totalSites}, with availabilities ${withJobs}, errors ${errored}`,
      `Sites with no open positions: ${noOpenPositions}`,
      `Error buckets: network=${buckets.network}, timeout=${buckets.timeout}, blocked=${buckets.blocked}, parse=${buckets.parse}, unknown=${buckets.unknown}`,
      ...(activeSites.length ? ["Sites with availabilities:", ...activeSites] : []),
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
      `All requested sites: checked ${totalSites}, with availabilities ${sitesWithJobs}, errors ${errored}`,
      `Error buckets: network=${Number(b.network || 0)}, timeout=${Number(b.timeout || 0)}, blocked=${Number(b.blocked || 0)}, parse=${Number(b.parse || 0)}, unknown=${Number(b.unknown || 0)}`,
      ...(topErrors.length ? ["Top site errors:", ...topErrors] : [])
    ];
  } catch {
    siteSummaryLines = [];
  }
}

if (fs.existsSync(currentSuggestionsPath)) {
  const raw = fs.readFileSync(currentSuggestionsPath, "utf8").trim();
  if (raw) {
    const lines = raw.split(/\r?\n/);
    const headers = parseCsvLine(lines[0] || "");
    const listings = lines.slice(1).filter(Boolean).map((line) => {
      const cols = parseCsvLine(line);
      return Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? ""]));
    });
    currentSuggestionLines = listings.slice(0, 10).map((l, i) => {
      const title = l.title || "Untitled availability";
      const org = l.org || "Unknown org";
      const listingType = l.listingType || "Housing";
      const location = l.locations || "Arcata / Humboldt County";
      const rent = l.rentValue ? `$${l.rentValue}` : "n/a";
      const beds = l.bedrooms || "studio/unknown";
      const baths = l.bathrooms || "n/a";
      const score = l.matchScore || "n/a";
      const url = l.url || "";
      return `${i + 1}. ${title}\n   Type: ${listingType}\n   Org: ${org}\n   Score: ${score}\n   Location: ${location}\n   Rent: ${rent}\n   Beds: ${beds}\n   Baths: ${baths}\n   Link: ${url}`;
    });
  }
}

if (fs.existsSync(latestListingsPath)) {
  const raw = fs.readFileSync(latestListingsPath, "utf8").trim();
  if (raw) {
    const lines = raw.split(/\r?\n/);
    const headers = parseCsvLine(lines[0] || "");
    const listings = lines.slice(1).filter(Boolean).map((line) => {
      const cols = parseCsvLine(line);
      return Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? ""]));
    });
    topAvailabilityLines = listings.slice(0, 10).map((l, i) => {
      const title = l.title || "Untitled availability";
      const org = l.org || "Unknown org";
      const rent = l.rentValue ? `$${l.rentValue}` : "n/a";
      const beds = l.bedrooms || "n/a";
      const baths = l.bathrooms || "n/a";
      const url = l.url || "";
      return `${i + 1}. ${title}\n   Org: ${org}\n   Rent: ${rent}\n   Beds: ${beds}\n   Baths: ${baths}\n   Link: ${url}`;
    });

    const preferredOrgs = [
      "Craigslist Humboldt Housing",
      "Craigslist Arcata Targeted Map Search",
      "Zillow Arcata Rentals",
      "Apartments.com Arcata",
      "Realtor.com Arcata Rentals",
      "HotPads Arcata",
      "AffordableHousing.com Humboldt County"
    ];
    const grouped = new Map();
    for (const listing of listings) {
      const org = listing.org || "Unknown org";
      if (!grouped.has(org)) grouped.set(org, []);
      grouped.get(org).push(listing);
    }
    const orgsWithData = [
      ...preferredOrgs.filter((org) => grouped.has(org)),
      ...Array.from(grouped.keys()).filter((org) => !preferredOrgs.includes(org))
    ];
    const detailBlocks = [];
    for (const org of orgsWithData.slice(0, 6)) {
      const items = grouped.get(org) || [];
      if (!items.length) continue;
      detailBlocks.push(`- ${org} (${items.length} availabilities):`);
      const itemLines = items.map((l, i) => {
        const title = l.title || "Untitled availability";
        const rent = l.rentValue ? `$${l.rentValue}` : "n/a";
        const beds = l.bedrooms || "n/a";
        const baths = l.bathrooms || "n/a";
        const url = l.url || "";
        return `  ${i + 1}. ${title} | Rent: ${rent} | Beds: ${beds} | Baths: ${baths} | ${url}`;
      });
      detailBlocks.push(...itemLines);
    }
    siteDetailLines = detailBlocks;
  }
}

const text = [
  `Housing Agent: weekly Arcata/Humboldt studio and 1-bedroom rentals, $500-$1,000/month`,
  ...(criteriaLines.length ? ["", ...criteriaLines] : []),
  ...(runQueryLines.length ? ["", ...runQueryLines] : []),
  ...(siteSummaryLines.length ? ["", ...siteSummaryLines] : []),
  ...(freshListingLines.length ? ["", "New since last refresh:", ...freshListingLines] : ["", "New since last refresh: none."]),
  ...(currentSuggestionLines.length ? ["", "Current recommendations this run:", ...currentSuggestionLines] : ["", "No current recommendations matched the full criteria in this run."]),
  ...(removedListingCount ? ["", `Removed or no longer found this refresh: ${removedListingCount}`] : []),
  ...(siteDetailLines.length ? ["", "Detailed availabilities by site:", ...siteDetailLines] : []),
  ...(topAvailabilityLines.length ? ["", "Top availabilities found this run:", ...topAvailabilityLines] : []),
  ...(newest.length ? ["", "New since last run:", ...newest] : ["", "No newly discovered criteria-aligned availabilities since the previous run."]),
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
if (fs.existsSync(siteListingDetailsPath)) {
  const bytes = fs.readFileSync(siteListingDetailsPath);
  payload.listingDetailsAttachment = {
    fileName: "site_listing_details.csv",
    mimeType: "text/csv",
    base64: bytes.toString("base64")
  };
}

await axios.post(flowUrl, payload, { timeout: 30000 });
console.log("Sent to Power Automate/Teams.");
