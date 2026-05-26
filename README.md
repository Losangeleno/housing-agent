# housing-agent

Automated San Diego housing listing monitor with scoring, reporting, and Teams notifications.

## What It Does

- Checks configured housing websites for listing links.
- Scores listings against your profile + budget criteria.
- Saves new matched listings to `outputs/positive_hits.csv`.
- Writes per-site status reports for Excel:
  - `outputs/all_sites_status.csv`
  - `outputs/site_availability_report.csv`
- Sends a Teams summary with health/error stats and CSV payload.

## Setup

```powershell
cd C:\Users\LOSAN\Documents\Codex\2026-05-23\i-created-an-ai-agent-using\housing-agent
npm install
copy .env.example .env
```

Edit `.env`:

- `TEAMS_FLOW_URL`
- `PROFILE_PATH` (optional, PDF with your housing preferences)
- `MAX_RENT`
- `MIN_BEDROOMS`
- `HOUSING_QUERY` / `HOUSING_QUERIES`

## Run Once

```powershell
npm run collect:once
npm run notify:teams
```

## API Mode

```powershell
npm start
```

Search endpoint:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:3010/housing/search" -ContentType "application/json" -Body '{"query":"affordable housing","maxRent":2800,"minBedrooms":1}'
```

## Automation

GitHub Actions workflow:

- `.github/workflows/scheduled-jobs.yml`

Runs every 6 hours plus manual dispatch, then uploads `outputs/` as artifacts.

