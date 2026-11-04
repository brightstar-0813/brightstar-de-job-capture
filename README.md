# Data Engineering Jobs Capture (multi-source)

Capture **US-remote data engineering** jobs from public ATS/feeds (Greenhouse, Lever, Ashby, Himalayas, Remotive, Remote OK, WWR) plus Dice, Built In, and JobRight — **twice daily (5:00 AM and 5:00 PM local time)**, append/dedupe locally, write **dated CSVs**, and Slack-notify on new jobs.

Feed-first / HTTP-first: parallel public APIs and curl (Cloudflare-friendly). Playwright is only used for optional ZipRecruiter/Monster.

## What gets saved

Each run overwrites **one** combined CSV with the latest qualifying jobs from all sources:

- `download/jobs_latest.csv` — all sources together (`source` column marks Dice / JobRight / Built In / …)
- `download/store.json` — shared dedupe history (title+company fingerprint; prefers Built In / Himalayas / Greenhouse over JobRight)

Filter (applied to all sources):

- **Keep:** **US remote only** (not hybrid or on-site; not UK/EU/India/etc.) and title is a **Data Engineer** family role (`Senior Data Engineer`, `Analytics Engineer`, `ETL Engineer`, `Data Platform Engineer`, `Big Data Engineer`, `Databricks Engineer`, …). Posted within the last `RECENT_DAYS` days (default 3). Greenhouse/Lever/Ashby stay while still listed on the live board.
- **Skip:** generic SWE/ML/scientist/analyst titles; non-eng titles; **hybrid/on-site**; **non-US** locations; **LinkedIn** URLs; expired postings; stale non-ATS posts.
- Already-applied filtering is **not** used — the CSV is shared across people.

## Sources

| Source | How it runs | Notes |
|--------|-------------|-------|
| **Built In** | curl HTML | Listing + detail pages (JSON retrieval API is empty) |
| **Himalayas / Remotive / Remote OK / WWR** | Public API / RSS | curl-friendly; parallel; no browser |
| **Greenhouse / Lever / Ashby** | Public board APIs | Curated company tokens; concurrent (`mapPool`) |
| **Dice** | Public job-search API | curl + web client key; no browser for discovery |
| **JobRight** | HTTP API | curl + `SESSION_ID` from `jobright:login` |
| **ZipRecruiter / Monster** | Playwright | **Off by default** (often blocked) |

### JobRight session (required for JobRight source)

```bash
npm run jobright:login
```

JobRight’s search API needs a `SESSION_ID` cookie from that login file. When it expires you get a Slack alert and JobRight returns 0 until you re-login.

### Chrome extension (optional)

The extension can still scrape JobRight from your Chrome session and `POST /api/ingest`. Scheduler capture no longer depends on it.

## Fully automatic — daily at 5 AM and 5 PM (Windows)

```bash
npm run schedule:install
```

## Manual run

```bash
npm run capture
```

## Env highlights

| Key | Meaning |
|-----|---------|
| `SEARCH_Q` / `SEARCH_QUERIES` | Discovery queries |
| `JOBRIGHT_TITLES` | JobRight seed titles |
| `CAPTURE_*` | Per-source toggles (`LEVER`, `ASHBY`, `HIMALAYAS`, …) |
| `GREENHOUSE_BOARDS` / `LEVER_BOARDS` / `ASHBY_BOARDS` | ATS board tokens |
| `RECENT_DAYS` | Recency window (default 3) |
| `CAPTURE_ZIPRECRUITER` / `CAPTURE_MONSTER` | Default `false` |

## Notes

- Personal job-hunting use; polite delays / page caps.
- Fingerprint dedupe collapses staffing-agency cross-posts across boards.
- Re-run `npm run schedule:install` after upgrading scheduler scripts.
