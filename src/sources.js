import axios from "axios";

const RETRY_ATTEMPTS = Number(process.env.HTTP_RETRY_ATTEMPTS || 3);
const RETRY_BASE_MS = Number(process.env.HTTP_RETRY_BASE_MS || 1000);
const REGION_LABEL = process.env.HOUSING_REGION_LABEL || "Arcata / Humboldt County area";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function findMatchedCities(text, cities) {
  const hay = ` ${String(text || "").toLowerCase()} `;
  return (cities || []).filter((c) => hay.includes(` ${c.toLowerCase()} `));
}

function classifyError(err) {
  const message = String(err?.message || "Unknown error");
  const status = Number(err?.response?.status || 0);

  if (status === 401 || status === 403 || status === 406 || status === 429) return "blocked";
  if (status >= 400 && status < 500) return "blocked";
  if (status >= 500) return "network";
  if (err?.code === "ECONNABORTED" || /timeout/i.test(message)) return "timeout";
  if (/(ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|network error)/i.test(message)) return "network";
  if (/(self signed certificate|unable to verify|certificate|SSL)/i.test(message)) return "network";
  if (/(parse|invalid url|unexpected token)/i.test(message)) return "parse";
  return "unknown";
}

async function httpGetWithRetry(url, config = {}, label = "request") {
  let lastError;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await axios.get(url, config);
    } catch (err) {
      lastError = err;
      const bucket = classifyError(err);
      const retryable = bucket === "network" || bucket === "timeout";
      if (!retryable || attempt === RETRY_ATTEMPTS) break;
      const delayMs = RETRY_BASE_MS * (2 ** (attempt - 1));
      console.warn(`[retry] ${label} attempt ${attempt}/${RETRY_ATTEMPTS} failed (${bucket}): ${err.message}. Retrying in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

function looksRelevant(title, queries) {
  const t = String(title || "").toLowerCase();
  const genericHousing = /\b(apartment|studio|bedroom|housing|rental|rent|waitlist|voucher|section 8|unit|lease|floorplan)\b/i.test(t);
  const queryHit = (queries || []).some((q) => {
    const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
    return words.length && words.every((w) => t.includes(w));
  });
  return genericHousing || queryHit;
}

function isLikelyListingLink(href, title) {
  const h = String(href || "").toLowerCase();
  const t = String(title || "").toLowerCase();
  return (
    /listing|apartment|rent|rental|housing|property|floorplan|unit|waitlist/.test(h) ||
    /\$[\d,]+/.test(t) ||
    /studio|\d+\s*bed/.test(t)
  );
}

function extractRentValue(text) {
  const m = String(text || "").match(/\$ ?(\d{1,3}(?:,\d{3})*|\d{3,5})/);
  if (!m) return 0;
  return Number(m[1].replace(/,/g, ""));
}

function extractBedrooms(text) {
  const m = String(text || "").toLowerCase().match(/(\d+)\s*(bed|br|bedroom)/);
  if (!m) return 0;
  return Number(m[1]);
}

function extractBathrooms(text) {
  const t = String(text || "").toLowerCase();
  const m = t.match(/(\d+(?:\.\d+)?)\s*(bath|ba|bathroom)/);
  if (!m) return 0;
  return Number(m[1]);
}

async function fetchHousingSite({ source, org, siteUrl, queries, cities = [], listingType = "" }) {
  const requestConfig = {
    timeout: 30000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Referer": "https://www.google.com/"
    }
  };

  let html = "";
  try {
    const resp = await httpGetWithRetry(siteUrl, requestConfig, `${source}:${org}`);
    html = String(resp.data || "");
  } catch (err) {
    const status = Number(err?.response?.status || 0);
    if (status === 403 || status === 405 || status === 406 || status === 429) {
      const mirrorUrl = `https://r.jina.ai/http://${siteUrl.replace(/^https?:\/\//i, "")}`;
      const fallback = await httpGetWithRetry(mirrorUrl, requestConfig, `${source}:${org}:mirror`);
      html = String(fallback.data || "");
    } else {
      throw err;
    }
  }

  const listings = [];
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(html)) !== null) {
    const hrefRaw = match[1] || "";
    const inner = match[2] || "";
    const title = normalizeText(inner.replace(/<[^>]+>/g, " "));
    if (!title || title.length < 4) continue;

    const href = hrefRaw.startsWith("http") ? hrefRaw : new URL(hrefRaw, siteUrl).toString();
    if (!isLikelyListingLink(href, title)) continue;
    if (!looksRelevant(title, queries)) continue;

    const cityHits = findMatchedCities(`${title} ${href} ${org}`, cities);
    const rentValue = extractRentValue(title);
    const bedrooms = extractBedrooms(title);
    const bathrooms = extractBathrooms(title);

    listings.push({
      source,
      id: href,
      title,
      org,
      listingType,
      locations: cityHits.length ? cityHits.join("; ") : REGION_LABEL,
      openDate: "",
      closeDate: "",
      url: href,
      summary: `Listing discovered from ${org}.`,
      whoMayApply: "See listing",
      pay: rentValue > 0 ? `$${rentValue}` : "",
      rentValue,
      bedrooms,
      bathrooms
    });
  }

  if (!listings.length && html) {
    const lines = html.split(/\r?\n/).map((l) => normalizeText(l)).filter(Boolean);
    for (const line of lines) {
      if (!looksRelevant(line, queries)) continue;
      const rentValue = extractRentValue(line);
      const bedrooms = extractBedrooms(line);
      const bathrooms = extractBathrooms(line);
      listings.push({
        source,
        id: `${source}:${org}:${line.slice(0, 120)}`,
        title: line.slice(0, 180),
        org,
        listingType,
        locations: REGION_LABEL,
        openDate: "",
        closeDate: "",
        url: siteUrl,
        summary: `Listing text discovered from ${org}.`,
        whoMayApply: "See listing",
        pay: rentValue > 0 ? `$${rentValue}` : "",
        rentValue,
        bedrooms,
        bathrooms
      });
      if (listings.length >= 150) break;
    }
  }

  const uniq = new Map();
  for (const listing of listings) uniq.set(listing.id, listing);
  return Array.from(uniq.values()).slice(0, 200);
}

export async function fetchHousingListings({ queries = ["affordable housing"], cities = [], sites = [] }) {
  const settled = await Promise.allSettled(
    sites.map((s) => fetchHousingSite({ ...s, queries, cities }))
  );

  const listings = [];
  const errors = [];
  const sourceStats = [];
  for (let i = 0; i < settled.length; i += 1) {
    const result = settled[i];
    const site = sites[i];
    if (result.status === "fulfilled") {
      listings.push(...result.value);
      sourceStats.push({ source: site.source, org: site.org, count: result.value.length });
    } else {
      const error = result.reason?.message || "Unknown error";
      const errorBucket = classifyError(result.reason);
      errors.push({ source: site.source, org: site.org, error, errorBucket });
      sourceStats.push({ source: site.source, org: site.org, count: 0, error, errorBucket });
    }
  }

  return { listings, errors, sourceStats, boardsChecked: sites.length };
}
