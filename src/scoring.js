function toWords(text) {
  return String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function countKeywordMatches(haystack, keywords) {
  const lower = String(haystack || "").toLowerCase();
  return (keywords || []).filter((k) => lower.includes(String(k).toLowerCase()));
}

export function scoreListing(listing, profileText, profileKeywords, opts = {}) {
  const queries = opts.queries || [];
  const maxRent = Number(opts.maxRent || 0);
  const minBedrooms = Number(opts.minBedrooms || 0);
  const text = `${listing.title || ""} ${listing.summary || ""} ${listing.org || ""}`.toLowerCase();

  let score = 0;
  const matchedKeywords = countKeywordMatches(text, profileKeywords);
  const queryHit = queries.some((q) => {
    const words = toWords(q);
    return words.length && words.every((w) => text.includes(w));
  });

  if (queryHit) score += 40;
  if (matchedKeywords.length) score += Math.min(20, matchedKeywords.length * 5);
  if (maxRent > 0 && listing.rentValue > 0 && listing.rentValue <= maxRent) score += 20;
  if (minBedrooms > 0 && listing.bedrooms >= minBedrooms) score += 20;

  return {
    ...listing,
    matchScore: Math.min(100, score),
    matchedKeywords
  };
}

export function isAlignedWithProfile(listing, minKeywordHits = 1, opts = {}) {
  const maxRent = Number(opts.maxRent || 0);
  const minBedrooms = Number(opts.minBedrooms || 0);
  const keywordHits = Array.isArray(listing.matchedKeywords) ? listing.matchedKeywords.length : 0;

  if (maxRent > 0 && listing.rentValue > 0 && listing.rentValue > maxRent) return false;
  if (minBedrooms > 0 && listing.bedrooms > 0 && listing.bedrooms < minBedrooms) return false;
  if (keywordHits < minKeywordHits) return false;
  return true;
}

