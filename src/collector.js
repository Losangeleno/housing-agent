import "dotenv/config";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { loadResumeText, extractKeywords } from "./resume.js";
import { fetchHousingListings } from "./sources.js";
import { scoreListing, isAlignedWithProfile } from "./scoring.js";
import { ensureDir, appendRowsCsv, loadSeenIds, saveSeenIds } from "./storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const outDir = path.join(root, "outputs");
const positiveCsv = path.join(outDir, "positive_hits.csv");
const allSitesCsv = path.join(outDir, "all_sites_status.csv");
const siteAvailabilityCsv = path.join(outDir, "site_availability_report.csv");
const seenFile = path.join(outDir, "seen_ids.json");
const runSummaryFile = path.join(outDir, "run_summary.json");
const sitesFile = path.join(root, "data", "housing-sites.json");
const allCitiesFile = path.join(root, "data", "all-county-cities.json");
ensureDir(outDir);

const scoreThreshold = Number(process.env.POSITIVE_SCORE_MIN || 50);
const minKeywordHits = Number(process.env.MIN_PROFILE_KEYWORD_HITS || 1);

function summarizeErrorBuckets(errors = []) {
  const buckets = { network: 0, timeout: 0, blocked: 0, parse: 0, unknown: 0 };
  for (const err of errors) {
    const key = String(err?.errorBucket || "unknown").toLowerCase();
    if (Object.hasOwn(buckets, key)) buckets[key] += 1;
    else buckets.unknown += 1;
  }
  return buckets;
}

function computeHealth({ boardsChecked, boardErrors }) {
  if (!boardsChecked) return "red";
  const errorRate = boardErrors.length / boardsChecked;
  if (errorRate <= 0.15) return "green";
  if (errorRate <= 0.4) return "yellow";
  return "red";
}

function makeSiteKey(source, org) {
  return `${String(source || "").trim()}::${String(org || "").trim()}`;
}

async function runCollector() {
  const profilePath = process.env.PROFILE_PATH || process.env.RESUME_PATH || "";

  const baseQuery = process.env.HOUSING_QUERY || "affordable housing";
  const defaultQueries = ["affordable housing", "apartment", "rental", "waitlist open", "voucher"];
  const envExtra = (process.env.HOUSING_QUERIES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const queries = Array.from(new Set([baseQuery, ...defaultQueries, ...envExtra]));
  const cities = fs.existsSync(allCitiesFile) ? JSON.parse(fs.readFileSync(allCitiesFile, "utf8")) : ["San Diego"];
  const sites = fs.existsSync(sitesFile) ? JSON.parse(fs.readFileSync(sitesFile, "utf8")) : [];

  const maxRent = Number(process.env.MAX_RENT || 0);
  const minBedrooms = Number(process.env.MIN_BEDROOMS || 0);

  const profileText = profilePath ? await loadResumeText(profilePath) : "";
  const profileKeywords = extractKeywords(profileText);

  const { listings, errors, sourceStats, boardsChecked } = await fetchHousingListings({ queries, cities, sites });
  const scored = listings.map((l) => scoreListing(l, profileText, profileKeywords, { queries, maxRent, minBedrooms }));
  const positives = scored.filter((l) => l.matchScore >= scoreThreshold && isAlignedWithProfile(l, minKeywordHits, { maxRent, minBedrooms }));

  const uniquePositives = [];
  const uniqueIds = new Set();
  for (const listing of positives) {
    const key = String(listing.id || listing.url || "").trim();
    if (!key || uniqueIds.has(key)) continue;
    uniqueIds.add(key);
    uniquePositives.push(listing);
  }
  const seen = loadSeenIds(seenFile);

  const fresh = uniquePositives.filter((listing) => {
    const id = String(listing.id || listing.url || "").trim();
    if (!id) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const headers = [
    "capturedAt", "source", "id", "title", "org", "listingType", "locations", "url",
    "matchScore", "matchedKeywords", "rentValue", "bedrooms", "pay"
  ];
  const now = new Date().toISOString();
  const rows = fresh.map((l) => ({
    capturedAt: now,
    source: l.source,
    id: l.id,
    title: l.title,
    org: l.org,
    listingType: l.listingType || "",
    locations: l.locations,
    url: l.url,
    matchScore: l.matchScore,
    matchedKeywords: (l.matchedKeywords || []).join(" | "),
    rentValue: l.rentValue || "",
    bedrooms: l.bedrooms || "",
    pay: l.pay || ""
  }));

  if (rows.length) appendRowsCsv(positiveCsv, headers, rows);
  saveSeenIds(seenFile, seen);

  const runAt = new Date().toISOString();
  const statusHeaders = ["capturedAt", "source", "org", "status", "jobCount", "error", "errorBucket"];
  const statusRows = sourceStats.map((s) => ({
    capturedAt: runAt,
    source: s.source,
    org: s.org,
    status: s.error ? "error" : "ok",
    jobCount: s.count ?? 0,
    error: s.error || "",
    errorBucket: s.errorBucket || ""
  }));
  const statusCsvLines = [
    statusHeaders.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(","),
    ...statusRows.map((row) => statusHeaders.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(","))
  ];
  fs.writeFileSync(allSitesCsv, statusCsvLines.join("\n") + "\n", "utf8");

  const positiveCountBySite = new Map();
  const newSavedCountBySite = new Map();
  for (const listing of uniquePositives) {
    const key = makeSiteKey(listing.source, listing.org);
    positiveCountBySite.set(key, (positiveCountBySite.get(key) || 0) + 1);
  }
  for (const row of rows) {
    const key = makeSiteKey(row.source, row.org);
    newSavedCountBySite.set(key, (newSavedCountBySite.get(key) || 0) + 1);
  }

  const siteMetaByKey = new Map();
  for (const site of sites) {
    siteMetaByKey.set(makeSiteKey(site.source, site.org), site);
  }

  const availabilityHeaders = [
    "capturedAt", "source", "org", "listingType", "siteUrl", "siteStatus",
    "openListingsFound", "criteriaMatchedListings", "newSavedListings", "errorBucket", "error"
  ];
  const availabilityRows = statusRows.map((s) => {
    const key = makeSiteKey(s.source, s.org);
    const meta = siteMetaByKey.get(key) || {};
    const openListings = Number(s.jobCount || 0);
    const matchedListings = Number(positiveCountBySite.get(key) || 0);
    const newSavedListings = Number(newSavedCountBySite.get(key) || 0);
    const siteStatus = s.status === "error" ? "ERROR" : (openListings > 0 ? "HAS_OPEN_LISTINGS" : "NO_OPEN_LISTINGS");
    return {
      capturedAt: runAt,
      source: s.source,
      org: s.org,
      listingType: meta.listingType || "",
      siteUrl: meta.siteUrl || "",
      siteStatus,
      openListingsFound: openListings,
      criteriaMatchedListings: matchedListings,
      newSavedListings,
      errorBucket: s.errorBucket || "",
      error: s.error || ""
    };
  });
  const availabilityCsvLines = [
    availabilityHeaders.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(","),
    ...availabilityRows.map((row) => availabilityHeaders.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(","))
  ];
  fs.writeFileSync(siteAvailabilityCsv, availabilityCsvLines.join("\n") + "\n", "utf8");

  const errorBuckets = summarizeErrorBuckets(errors);
  const health = computeHealth({ boardsChecked, boardErrors: errors });
  const summary = {
    ok: true,
    capturedAt: runAt,
    query: baseQuery,
    queries,
    cityCount: cities.length,
    siteCount: sites.length,
    boardsChecked,
    sourceStats,
    boardErrors: errors,
    errorBuckets,
    health,
    checked: scored.length,
    positives: uniquePositives.length,
    newSaved: rows.length,
    file: positiveCsv,
    allSitesFile: allSitesCsv,
    siteAvailabilityFile: siteAvailabilityCsv,
    threshold: scoreThreshold,
    minProfileKeywordHits: minKeywordHits,
    maxRent,
    minBedrooms
  };
  fs.writeFileSync(runSummaryFile, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify(summary, null, 2));
}

runCollector().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
