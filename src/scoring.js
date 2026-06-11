function toWords(text) {
  return String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function countKeywordMatches(haystack, keywords) {
  const lower = String(haystack || "").toLowerCase();
  return (keywords || []).filter((k) => lower.includes(String(k).toLowerCase()));
}

export function scoreListing(listing, profileText, profileKeywords, opts = {}) {
  const queries = opts.queries || [];
  const minRent = Number(opts.minRent || 0);
  const maxRent = Number(opts.maxRent || 0);
  const minBedrooms = Number(opts.minBedrooms || 0);
  const maxBedrooms = Number(opts.maxBedrooms || 0);
  const minBathrooms = Number(opts.minBathrooms || 0);
  const maxBathrooms = Number(opts.maxBathrooms || 0);
  const text = `${listing.title || ""} ${listing.summary || ""} ${listing.org || ""}`.toLowerCase();

  let score = 0;
  const matchedKeywords = countKeywordMatches(text, profileKeywords);
  const queryHit = queries.some((q) => {
    const words = toWords(q);
    return words.length && words.every((w) => text.includes(w));
  });

  if (queryHit) score += 40;
  if (matchedKeywords.length) score += Math.min(20, matchedKeywords.length * 5);
  if (
    listing.rentValue > 0 &&
    (minRent <= 0 || listing.rentValue >= minRent) &&
    (maxRent <= 0 || listing.rentValue <= maxRent)
  ) score += 20;
  if (minBedrooms > 0 && listing.bedrooms >= minBedrooms) score += 20;
  if (maxBedrooms > 0 && listing.bedrooms > 0 && listing.bedrooms <= maxBedrooms) score += 10;
  if (minBathrooms > 0 && listing.bathrooms >= minBathrooms) score += 10;
  if (maxBathrooms > 0 && listing.bathrooms > 0 && listing.bathrooms <= maxBathrooms) score += 10;
  if (/\b(arcata|eureka|mckinleyville|humboldt|blue lake|trinidad|fortuna)\b/i.test(`${listing.title || ""} ${listing.locations || ""} ${listing.org || ""}`)) score += 15;
  if (/\b(senior|55\+|62\+|affordable|low income|voucher|section 8|waitlist)\b/i.test(text)) score += 15;
  if (/\b(studio|1\s*bed|one bedroom|1br)\b/i.test(text)) score += 10;

  return {
    ...listing,
    matchScore: Math.min(100, score),
    matchedKeywords
  };
}

export function isAlignedWithProfile(listing, minKeywordHits = 1, opts = {}) {
  const minRent = Number(opts.minRent || 0);
  const maxRent = Number(opts.maxRent || 0);
  const minBedrooms = Number(opts.minBedrooms || 0);
  const maxBedrooms = Number(opts.maxBedrooms || 0);
  const minBathrooms = Number(opts.minBathrooms || 0);
  const maxBathrooms = Number(opts.maxBathrooms || 0);
  const requireRent = Boolean(opts.requireRent);
  const keywordHits = Array.isArray(listing.matchedKeywords) ? listing.matchedKeywords.length : 0;

  if (requireRent && !listing.rentValue) return false;
  if (minRent > 0 && listing.rentValue > 0 && listing.rentValue < minRent) return false;
  if (maxRent > 0 && listing.rentValue > 0 && listing.rentValue > maxRent) return false;
  if (minBedrooms > 0 && listing.bedrooms > 0 && listing.bedrooms < minBedrooms) return false;
  if (maxBedrooms > 0 && listing.bedrooms > 0 && listing.bedrooms > maxBedrooms) return false;
  if (minBathrooms > 0 && listing.bathrooms > 0 && listing.bathrooms < minBathrooms) return false;
  if (maxBathrooms > 0 && listing.bathrooms > 0 && listing.bathrooms > maxBathrooms) return false;
  if (keywordHits < minKeywordHits) return false;
  return true;
}
