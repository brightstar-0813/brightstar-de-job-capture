# Data Engineering Jobs Capture (multi-source)

Capture **US-remote data engineering** jobs from as many public boards as practical — ATS/feeds (Greenhouse, Lever, Ashby, Himalayas, Remotive, Jobicy, Remote OK, WWR, Working Nomads, Jobspresso, SkipTheDrive, Arc, Jobgether, Arbeitnow, The Muse), optional USAJOBS / Adzuna / Google Jobs (keys), Dice, Built In, JobRight `/swan`, plus Playwright ZipRecruiter / Monster — **twice daily (5:00 AM and 5:00 PM local time)**, dedupe locally, write **combined + numbered per-source CSVs**, and Slack-notify on new jobs.

Feed-first / HTTP-first: parallel public APIs and curl. Playwright for JobRight (public search + Cloudflare clearance cookies; **no JobRight account login**), ZipRecruiter / Monster, and optional Indeed / CareerBuilder.

## What gets saved

Each run overwrites:

- `download/jobs_latest.csv` — all sources (`source` column; rows have `seq` newest-first)
- `download/NN_{source}_jobs_latest.csv` — one numbered CSV per source (apply-yield order)
- `download/NN_workday_jobs_latest.csv` — Workday apply URLs (any capture source)
- `download/store.json` — shared dedupe history (title+company fingerprint; prefers Built In / Himalayas / Greenhouse over JobRight)

Filter (applied to all sources):

- **Keep:** **US remote only** (not hybrid or on-site) and title is a **Data Engineer** family role (`Senior Data Engineer`, `Analytics Engineer`, `ETL Engineer`, `Data Platform Engineer`, `Big Data Engineer`, `Databricks Engineer`, …). Posted within the last `RECENT_DAYS` days (default 3). Greenhouse/Lever/Ashby stay while still listed on the live board.
- **Skip:** generic SWE/ML/scientist/analyst titles; non-eng titles; **hybrid/on-site**; **non-US** locations; **LinkedIn** URLs; expired/stale non-ATS posts.

## Sources

| Source | How it runs | Default |
|--------|-------------|---------|
| **Built In / Dice / WWR** | curl HTML/API | on |
| **Himalayas / Remotive / Jobicy / Remote OK / Jobgether / Arbeitnow / The Muse / Working Nomads** | Public JSON | on |
| **Jobspresso / SkipTheDrive / Arc** | Public HTML / listing pages | on |
| **Greenhouse / Lever / Ashby** | Public board APIs | on |
| **USAJOBS / Adzuna / Google Jobs** | APIs (keys) | on when keys set; no-op without |
| **JobRight** | Playwright public search; saves Cloudflare clearance to `jobright-auth.json` (headed window only if Turnstile blocks) | on — **no account login** |
| **ZipRecruiter / Monster** | Playwright | on (fail soft if blocked) |
| **Indeed / CareerBuilder** | Playwright | **off** (`npm run indeed:login` if enabling Indeed) |

## Fully automatic — daily at 5 AM and 5 PM (Windows)

```bash
npm run schedule:install
```

Tasks: `DEJobCapture_5am5pm`, `DEJobCapture_API_AtLogon`.

## Manual run

```bash
npm run capture
```

## Env highlights

| Key | Meaning |
|-----|---------|
| `SEARCH_Q` / `SEARCH_QUERIES` | Discovery queries |
| `JOBRIGHT_TITLES` / `ROLE_TITLES` | JobRight / Jobspresso seed titles |
| `JOBRIGHT_MAX_PAGES` | Pages per JobRight seed (default 5 → up to ~100 rows/title) |
| `CAPTURE_*` | Per-source toggles |
| `JOBICY_TAGS` | Jobicy API tags (default `python,data,etl,sql`) |
| `USAJOBS_*` / `ADZUNA_*` / `SERPAPI_KEY` | Optional extra yield |
| `GREENHOUSE_BOARDS` / `LEVER_BOARDS` / `ASHBY_BOARDS` | ATS board tokens |
| `RECENT_DAYS` | Recency window (default 3) |
| `CAPTURE_INDEED` / `CAPTURE_CAREERBUILDER` | Default `false` |

## Notes

- Personal job-hunting use; polite delays / page caps.
- Fingerprint dedupe collapses staffing-agency cross-posts across boards.
- Re-run `npm run schedule:install` after upgrading scheduler scripts.
