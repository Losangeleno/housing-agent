import "dotenv/config";
import fs from "fs";
import path from "path";
import { loadResumeText, extractKeywords } from "../src/resume.js";
import { fetchDirectGovJobs } from "../src/sources.js";
import { scoreJob, isAlignedWithResume } from "../src/scoring.js";

const root = process.cwd();
const cities = JSON.parse(fs.readFileSync(path.join(root, "data", "all-county-cities.json"), "utf8"));
const tribes = JSON.parse(fs.readFileSync(path.join(root, "data", "all-tribal-governments.json"), "utf8"));
const edu = JSON.parse(fs.readFileSync(path.join(root, "data", "san-diego-education-institutions.json"), "utf8"));
const sites = JSON.parse(fs.readFileSync(path.join(root, "data", "individual-job-sites.json"), "utf8"));

const cityBoards = cities.map((city) => ({
  source: "CITY_LOCAL_SEARCH",
  org: `${city} (San Diego County area)`,
  boardUrl: `https://www.governmentjobs.com/jobs?keyword=${encodeURIComponent("city of " + city)}&location=San%20Diego%2C%20CA`,
  institutionType: "City/Local Government"
}));

const tribalBoards = tribes.map((name) => ({
  source: "TRIBAL_GOV_SEARCH",
  org: name,
  boardUrl: `https://www.governmentjobs.com/jobs?keyword=${encodeURIComponent(name)}&location=San%20Diego%2C%20CA`,
  institutionType: "Tribal Government"
}));

const educationBoards = edu.map((x) => ({
  source: "EDU_SEARCH",
  org: x.name,
  boardUrl: `https://www.governmentjobs.com/jobs?keyword=${encodeURIComponent(x.name)}&location=San%20Diego%2C%20CA`,
  institutionType: x.type || ""
}));

const merged = [...sites, ...cityBoards, ...tribalBoards, ...educationBoards];
const resumeText = await loadResumeText(process.env.RESUME_PATH);
const keywords = extractKeywords(resumeText);
console.log("keywords:", keywords);

const { jobs } = await fetchDirectGovJobs({ query: process.env.JOB_QUERY || "IT support", cities, sites: merged });
const scored = jobs.map((j) => scoreJob(j, resumeText, keywords, tribes)).sort((a, b) => b.matchScore - a.matchScore);

console.log("job count:", scored.length);
console.log("top 25 scores:");
for (const j of scored.slice(0, 25)) {
  console.log(`${j.matchScore} | ${j.title} | ${j.org} | hits=${j.matchedKeywords.length}`);
}

const alignedAt20 = scored.filter((j) => j.matchScore >= 20 && isAlignedWithResume(j, 1));
console.log("aligned count @score>=20 hits>=1:", alignedAt20.length);
console.log("sample aligned:");
for (const j of alignedAt20.slice(0, 10)) {
  console.log(`${j.matchScore} | ${j.title} | ${j.org} | ${j.url}`);
}
