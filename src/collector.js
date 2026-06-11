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
const latestListingsCsv = path.join(outDir, "latest_listings.csv");
const currentSuggestionsCsv = path.join(outDir, "current_suggestions.csv");
const siteListingDetailsCsv = path.join(outDir, "site_listing_details.csv");
const allSitesCsv = path.join(outDir, "all_sites_status.csv");
const siteAvailabilityCsv = path.join(outDir, "site_availability_report.csv");
const seenFile = path.join(outDir, "seen_ids.json");
const freshnessFile = path.join(outDir, "housing_freshness.json");
const newSinceRefreshCsv = path.join(outDir, "new_since_last_refresh.csv");
const removedSinceRefreshCsv = path.join(outDir, "removed_since_last_refresh.csv");
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

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function writeCsv(filePath, headers, rows) {
  const csv = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(","))
  ];
  fs.writeFileSync(filePath, csv.join("\n") + "\n", "utf8");
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8") || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function loadFreshness(filePath) {
  const data = readJsonFile(filePath, { listings: {} });
  return {
    version: Number(data.version || 1),
    listings: data.listings && typeof data.listings === "object" ? data.listings : {}
  };
}

function saveFreshness(filePath, state) {
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function getListingKey(listing) {
  const stableParts = [
    listing.source,
    listing.org,
    listing.title,
    listing.locations,
    listing.rentValue,
    listing.bedrooms,
    listing.bathrooms
  ].map(normalizeText);
  const stable = stableParts.filter(Boolean).join("|");
  return stable || normalizeText(listing.id || listing.url);
}

async function runCollector() {
  const profilePath = process.env.PROFILE_PATH || process.env.RESUME_PATH || "";

  const baseQuery = process.env.HOUSING_QUERY || "Arcata studio one bedroom apartment condo house rental";
  const defaultQueries = [
    "studio",
    "one bedroom",
    "1 bedroom",
    "1br",
    "apartment",
    "condo",
    "house",
    "Arcata",
    "Eureka",
    "McKinleyville",
    "Humboldt",
    "affordable housing",
    "low income housing",
    "section 8",
    "voucher",
    "waitlist open"
  ];
  const envExtra = (process.env.HOUSING_QUERIES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const queries = Array.from(new Set([baseQuery, ...defaultQueries, ...envExtra]));
  const cities = fs.existsSync(allCitiesFile) ? JSON.parse(fs.readFileSync(allCitiesFile, "utf8")) : ["Arcata"];
  const sites = fs.existsSync(sitesFile) ? JSON.parse(fs.readFileSync(sitesFile, "utf8")) : [];

  const minRent = Number(process.env.MIN_RENT || 500);
  const maxRent = Number(process.env.MAX_RENT || 1000);
  const minBedrooms = Number(process.env.MIN_BEDROOMS || 0);
  const maxBedrooms = Number(process.env.MAX_BEDROOMS || 1);
  const minBathrooms = Number(process.env.MIN_BATHROOMS || 0);
  const maxBathrooms = Number(process.env.MAX_BATHROOMS || 0);
  const requireRent = String(process.env.REQUIRE_RENT || "1").toLowerCase() !== "0";

  const profileText = profilePath ? await loadResumeText(profilePath) : "";
  const profileKeywords = extractKeywords(profileText);

  const { listings, errors, sourceStats, boardsChecked } = await fetchHousingListings({ queries, cities, sites });
  const scored = listings.map((l) => scoreListing(l, profileText, profileKeywords, {
    queries,
    minRent,
    maxRent,
    minBedrooms,
    maxBedrooms,
    minBathrooms,
    maxBathrooms
  }));
  const positives = scored.filter((l) => l.matchScore >= scoreThreshold && isAlignedWithProfile(l, minKeywordHits, {
    minRent,
    maxRent,
    minBedrooms,
    maxBedrooms,
    minBathrooms,
    maxBathrooms,
    requireRent
  }));

  const uniquePositives = [];
  const uniqueIds = new Set();
  for (const listing of positives) {
    const key = String(listing.id || listing.url || "").trim();
    if (!key || uniqueIds.has(key)) continue;
    uniqueIds.add(key);
    uniquePositives.push(listing);
  }
  const now = new Date().toISOString();
  const seen = loadSeenIds(seenFile);
  const previousFreshness = loadFreshness(freshnessFile);
  const nextFreshness = {
    version: 1,
    updatedAt: now,
    listings: {}
  };

  const currentIds = new Set();
  const newSinceLastRefresh = [];
  const stillActive = [];
  const trackedPositives = uniquePositives.map((listing) => {
    const id = getListingKey(listing);
    currentIds.add(id);
    seen.add(id);
    const previous = previousFreshness.listings[id];
    const firstSeenAt = previous?.firstSeenAt || now;
    const freshnessStatus = previous?.firstSeenAt ? "still_active" : "new_since_last_refresh";
    const tracked = {
      ...listing,
      id,
      firstSeenAt,
      lastSeenAt: now,
      freshnessStatus,
      seenCount: Number(previous?.seenCount || 0) + 1
    };
    nextFreshness.listings[id] = {
      id,
      source: listing.source,
      org: listing.org,
      title: listing.title,
      locations: listing.locations,
      url: listing.url,
      rentValue: listing.rentValue || "",
      bedrooms: listing.bedrooms || "",
      bathrooms: listing.bathrooms || "",
      firstSeenAt,
      lastSeenAt: now,
      status: "active",
      seenCount: tracked.seenCount
    };
    if (freshnessStatus === "new_since_last_refresh") newSinceLastRefresh.push(tracked);
    else stillActive.push(tracked);
    return tracked;
  });

  const removedSinceLastRefresh = Object.values(previousFreshness.listings)
    .filter((listing) => listing?.status === "active" && !currentIds.has(String(listing.id)))
    .map((listing) => {
      const removed = {
        ...listing,
        status: "removed",
        removedAt: now,
        freshnessStatus: "removed_since_last_refresh"
      };
      nextFreshness.listings[String(listing.id)] = removed;
      return removed;
    });

  const fresh = newSinceLastRefresh;

  const headers = [
    "capturedAt", "source", "id", "title", "org", "listingType", "locations", "url",
    "matchScore", "matchedKeywords", "rentValue", "bedrooms", "bathrooms", "pay",
    "firstSeenAt", "lastSeenAt", "freshnessStatus"
  ];
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
    bathrooms: l.bathrooms || "",
    pay: l.pay || "",
    firstSeenAt: l.firstSeenAt,
    lastSeenAt: l.lastSeenAt,
    freshnessStatus: l.freshnessStatus
  }));

  if (rows.length) appendRowsCsv(positiveCsv, headers, rows);
  saveSeenIds(seenFile, seen);
  saveFreshness(freshnessFile, nextFreshness);

  const latestHeaders = ["capturedAt", "source", "org", "title", "listingType", "locations", "url", "rentValue", "bedrooms", "bathrooms", "matchScore", "firstSeenAt", "lastSeenAt", "freshnessStatus"];
  const suggestionRows = trackedPositives
    .slice()
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 50)
    .map((l) => ({
      capturedAt: now,
      source: l.source,
      org: l.org,
      title: l.title,
      listingType: l.listingType || "",
      locations: l.locations || "",
      url: l.url || "",
      rentValue: l.rentValue || "",
      bedrooms: l.bedrooms || "",
      bathrooms: l.bathrooms || "",
      matchScore: l.matchScore || 0,
      firstSeenAt: l.firstSeenAt || "",
      lastSeenAt: l.lastSeenAt || "",
      freshnessStatus: l.freshnessStatus || ""
    }));
  const latestRows = scored
    .slice()
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 50)
    .map((l) => ({
      capturedAt: now,
      source: l.source,
      org: l.org,
      title: l.title,
      listingType: l.listingType || "",
      locations: l.locations || "",
      url: l.url || "",
      rentValue: l.rentValue || "",
      bedrooms: l.bedrooms || "",
      bathrooms: l.bathrooms || "",
      matchScore: l.matchScore || 0,
      firstSeenAt: "",
      lastSeenAt: "",
      freshnessStatus: ""
    }));
  const suggestionCsvLines = [
    latestHeaders.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(","),
    ...suggestionRows.map((row) => latestHeaders.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(","))
  ];
  fs.writeFileSync(currentSuggestionsCsv, suggestionCsvLines.join("\n") + "\n", "utf8");
  const latestCsvLines = [
    latestHeaders.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(","),
    ...latestRows.map((row) => latestHeaders.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(","))
  ];
  fs.writeFileSync(latestListingsCsv, latestCsvLines.join("\n") + "\n", "utf8");

  writeCsv(newSinceRefreshCsv, latestHeaders, suggestionRows.filter((row) => row.freshnessStatus === "new_since_last_refresh"));
  writeCsv(removedSinceRefreshCsv, [
    "id", "source", "org", "title", "locations", "url", "rentValue", "bedrooms", "bathrooms",
    "firstSeenAt", "lastSeenAt", "removedAt", "freshnessStatus"
  ], removedSinceLastRefresh);

  const detailHeaders = ["capturedAt", "source", "org", "title", "locations", "url", "rentValue", "bedrooms", "bathrooms", "matchScore"];
  const detailRows = scored
    .slice()
    .sort((a, b) => {
      const orgCmp = String(a.org || "").localeCompare(String(b.org || ""));
      if (orgCmp !== 0) return orgCmp;
      return String(a.title || "").localeCompare(String(b.title || ""));
    })
    .map((l) => ({
      capturedAt: now,
      source: l.source,
      org: l.org,
      title: l.title || "",
      locations: l.locations || "",
      url: l.url || "",
      rentValue: l.rentValue || "",
      bedrooms: l.bedrooms || "",
      bathrooms: l.bathrooms || "",
      matchScore: l.matchScore || 0
    }));
  const detailCsvLines = [
    detailHeaders.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(","),
    ...detailRows.map((row) => detailHeaders.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(","))
  ];
  fs.writeFileSync(siteListingDetailsCsv, detailCsvLines.join("\n") + "\n", "utf8");

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
  for (const listing of trackedPositives) {
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
    newSinceLastRefresh: newSinceLastRefresh.length,
    stillActive: stillActive.length,
    removedSinceLastRefresh: removedSinceLastRefresh.length,
    file: positiveCsv,
    freshnessFile,
    newSinceLastRefreshFile: newSinceRefreshCsv,
    removedSinceLastRefreshFile: removedSinceRefreshCsv,
    allSitesFile: allSitesCsv,
    siteAvailabilityFile: siteAvailabilityCsv,
    latestListingsFile: latestListingsCsv,
    currentSuggestionsFile: currentSuggestionsCsv,
    siteListingDetailsFile: siteListingDetailsCsv,
    threshold: scoreThreshold,
    minProfileKeywordHits: minKeywordHits,
    minRent,
    maxRent,
    minBedrooms,
    maxBedrooms,
    minBathrooms,
    maxBathrooms,
    requireRent
  };
  fs.writeFileSync(runSummaryFile, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify(summary, null, 2));
}

runCollector().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
