import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadResumeText, extractKeywords } from "./resume.js";
import { fetchHousingListings } from "./sources.js";
import { scoreListing, isAlignedWithProfile } from "./scoring.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const sitesFile = path.join(root, "data", "housing-sites.json");
const allCitiesFile = path.join(root, "data", "all-county-cities.json");

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, agent: "housing-agent" }));

app.post("/housing/search", async (req, res) => {
  try {
    const query = req.body?.query || process.env.HOUSING_QUERY || "affordable housing";
    const queries = [query];
    const sites = fs.existsSync(sitesFile) ? JSON.parse(fs.readFileSync(sitesFile, "utf8")) : [];
    const cities = fs.existsSync(allCitiesFile) ? JSON.parse(fs.readFileSync(allCitiesFile, "utf8")) : ["San Diego"];
    const maxRent = Number(req.body?.maxRent || process.env.MAX_RENT || 0);
    const minBedrooms = Number(req.body?.minBedrooms || process.env.MIN_BEDROOMS || 0);
    const minKeywordHits = Number(process.env.MIN_PROFILE_KEYWORD_HITS || 1);
    const scoreThreshold = Number(process.env.POSITIVE_SCORE_MIN || 50);

    const profilePath = process.env.PROFILE_PATH || process.env.RESUME_PATH || "";
    const profileText = profilePath ? await loadResumeText(profilePath) : "";
    const profileKeywords = extractKeywords(profileText);

    const { listings, errors, boardsChecked } = await fetchHousingListings({ queries, cities, sites });
    const scored = listings
      .map((l) => scoreListing(l, profileText, profileKeywords, { queries, maxRent, minBedrooms }))
      .sort((a, b) => b.matchScore - a.matchScore);
    const filtered = scored.filter((l) => l.matchScore >= scoreThreshold && isAlignedWithProfile(l, minKeywordHits, { maxRent, minBedrooms }));

    res.json({
      ok: true,
      cityCount: cities.length,
      siteCount: sites.length,
      boardsChecked,
      boardErrors: errors,
      total: filtered.length,
      top: filtered.slice(0, 25)
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const port = Number(process.env.PORT || 3010);
app.listen(port, () => {
  console.log(`housing-agent listening on ${port}`);
});

