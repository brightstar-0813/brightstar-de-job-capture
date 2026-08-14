# Data Engineering Jobs Capture (multi-source)

Capture **US-remote data engineering** jobs from Dice, JobRight, Built In, Greenhouse, ZipRecruiter, and Monster **twice daily (5:00 AM and 5:00 PM local time)**, append/dedupe locally, write **dated CSVs**, and Slack-notify on new jobs.

## What gets saved

Each run overwrites **one** combined CSV with the latest qualifying jobs from all sources:

- `download/jobs_latest.csv` — all sources together (`source` column marks Dice / JobRight / Built In / …)
- `download/store.json` — shared dedupe history

Filter (applied to all sources):

- **Keep:** **US remote only** (Remote / Remote OK / Remote Solely — not hybrid or on-site; not UK/EU/India/etc.) and title is a **Data Engineer** family role (`Senior Data Engineer`, `Analytics Engineer`, `ETL Engineer`, `Data Platform Engineer`, `Big Data Engineer`, `Databricks Engineer`, …). Exact wording is not required. Posted within the last `RECENT_DAYS` days (default 3).
- **Skip:** generic SWE/ML/scientist/analyst titles even if the JD mentions data; non-eng titles (sales, recruiting, PM); **hybrid/on-site**; **non-US** locations; **LinkedIn** apply/redirect links; **expired / no-longer-available** postings; postings **older than `RECENT_DAYS`**.
- **Skip (already applied):** jobs you've **already applied to** — JobRight via `POST /swan/job/applied/jobs-v3`, and **Dice** via the *My Jobs → Applied* tab (needs a saved Dice login, see below). Applied jobs are skipped during capture and removed from the local store each run.

## How automation is split (recommended)

| Source | How it runs | Notes |
|--------|-------------|-------|
| **Dice** | Windows Task Scheduler | Optional login for applied-job exclusion |
| **JobRight** | Scheduler + saved Playwright login (or Chrome extension) | Needs `npm run jobright:login` |
| **Built In** | Scheduler (Playwright) | Reliable; remote + keyword search |
| **Greenhouse** | Scheduler (public board API) | No login; polls curated company boards (`GREENHOUSE_BOARDS`) |
| **ZipRecruiter** | Scheduler (Playwright) | Often Cloudflare-blocked in headless — may return 0 |
| **Monster** | Scheduler (Playwright) | Often empty/blocked in headless — may return 0 |

### Optional: skip already-applied Dice jobs

Dice capture works logged-out, but to also **exclude jobs you've already applied to on Dice**, save a one-time session:

```bash
npm run dice:login
```

A browser opens — sign in, land on your dashboard, press Enter. The session is saved to `download/dice-auth.json` and reused on every run. When it expires you'll get a Slack alert to re-run `npm run dice:login` (Dice capture keeps working meanwhile, just without applied-job exclusion).

### Why the extension for JobRight?

Autofill buttons only show when you are signed in. The extension opens JobRight in a background tab using **your existing Chrome cookies**, scrapes autofill jobs, and posts them to the local API. No `jobright:login` / Playwright auth file needed.

**Requirements for JobRight auto-capture:**

1. Stay signed in to [jobright.ai](https://jobright.ai) in Chrome  
2. API auto-starts at Windows logon (`npm run schedule:api`) — no manual `npm start`  
3. Load this repo’s `extension/` (unpacked)  
4. Click **Capture JobRight** once to verify

## Fully automatic — daily at 5 AM and 5 PM (Windows)

Install **both** scheduled tasks (capture + API at logon):

```bash
npm run schedule:install
```

| Task | What it does |
|------|----------------|
| `AIJobCapture_5am5pm` | Runs capture daily at **5:00 AM** and **5:00 PM** (local time) |
| `AIJobCapture_API_AtLogon` | Starts `node src/server.js` when you log in (so JobRight extension can ingest) |

You do **not** need to open Cursor or type `npm start` after that — just reboot/login once, stay signed in to JobRight in Chrome, and keep the extension loaded.

Optional checks:

```powershell
Get-ScheduledTask -TaskName AIJobCapture_5am5pm, AIJobCapture_API_AtLogon
Start-ScheduledTask -TaskName AIJobCapture_API_AtLogon
Start-ScheduledTask -TaskName AIJobCapture_5am5pm
```

Individual installs: `npm run schedule:dice` or `npm run schedule:api`.

## Manual run

```bash
npm run capture
```

## Local API + extension

```bash
npm start
```

Then load `extension/` unpacked in Chrome.

| Endpoint | Description |
|----------|-------------|
| `GET /api/status` | Last run, CSV paths |
| `GET /api/jobs?status=new` | New jobs |
| `POST /api/run` | Trigger Dice capture (Node) |
| `POST /api/ingest` | Extension posts JobRight jobs |
| `GET /api/export.csv?source=dice` | Download Dice CSV |
| `GET /api/export.csv?source=jobright` | Download JobRight CSV |

## Env highlights

| Key | Meaning |
|-----|---------|
| `SEARCH_Q` | Primary query label (`Data Engineer`) |
| `SEARCH_QUERIES` | Comma-separated discovery queries for Dice / Built In / … |
| `JOBRIGHT_TITLES` | Comma-separated JobRight seed titles |
| `CAPTURE_DICE` | `true`/`false` |
| `CAPTURE_JOBRIGHT` | Playwright JobRight (`false` = use extension) |
| `JOBRIGHT_AUTH_PATH` | Playwright login state |
| `CSV_PREFIX_DICE` / `CSV_PREFIX_JOBRIGHT` | Dated filename prefixes |
| `DATA_DIR` | Output folder (`download`) |
| `CRON_SCHEDULE` | Used by `npm start` only |

## Notes

- Personal job-hunting use; polite delays / page caps.
- After JobRight UI changes, re-run `npm run jobright:login` if autofill jobs stop appearing.
- Re-run `npm run schedule:install` after upgrading so Windows tasks use the new `AIJobCapture_*` names (old `DiceJobCapture_*` tasks are removed).
