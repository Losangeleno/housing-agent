import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchDirectGovJobs } from "../src/sources.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const citiesFile = path.join(root, "data", "san-diego-county-cities.txt");
const sitesFile = path.join(root, "data", "individual-job-sites.json");
const allCitiesFile = path.join(root, "data", "all-county-cities.json");
const allTribalFile = path.join(root, "data", "all-tribal-governments.json");
const eduFile = path.join(root, "data", "san-diego-education-institutions.json");

const cities = fs.readFileSync(citiesFile, "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const sites = JSON.parse(fs.readFileSync(sitesFile, "utf8"));
const allCities = JSON.parse(fs.readFileSync(allCitiesFile, "utf8"));
const allTribal = JSON.parse(fs.readFileSync(allTribalFile, "utf8"));
const education = JSON.parse(fs.readFileSync(eduFile, "utf8"));

const cityBoards = allCities.map(city => ({
  source: "CITY_LOCAL_SEARCH",
  org: `${city} (San Diego County area)`,
  boardUrl: `https://www.governmentjobs.com/jobs?keyword=${encodeURIComponent("city of " + city)}&location=San%20Diego%2C%20CA`,
  institutionType: "City/Local Government"
}));
const tribalBoards = allTribal.map(name => ({
  source: "TRIBAL_GOV_SEARCH",
  org: name,
  boardUrl: `https://www.governmentjobs.com/jobs?keyword=${encodeURIComponent(name)}&location=San%20Diego%2C%20CA`,
  institutionType: "Tribal Government"
}));
const educationBoards = education.map(x => ({
  source: "EDU_SEARCH",
  org: x.name,
  boardUrl: `https://www.governmentjobs.com/jobs?keyword=${encodeURIComponent(x.name)}&location=San%20Diego%2C%20CA`,
  institutionType: x.type || ""
}));
const mergedSites = [...sites, ...cityBoards, ...tribalBoards, ...educationBoards];

const query = process.env.JOB_QUERY || "IT support";
const result = await fetchDirectGovJobs({ query, cities, sites: mergedSites });

console.log(JSON.stringify({
  ok: true,
  query,
  siteCount: mergedSites.length,
  boardsChecked: result.boardsChecked,
  jobsFound: result.jobs.length,
  sourceStats: result.sourceStats,
  errors: result.errors
}, null, 2));
