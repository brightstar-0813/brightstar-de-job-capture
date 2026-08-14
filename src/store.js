import fs from "fs";
import path from "path";
import { config, CSV_HEADERS, SOURCE_IDS, CSV_SOURCE_ORDER } from "./config.js";
import { writeCsv } from "./csv.js";
import { matchesCaptureRule, isRecentJob } from "./filter.js";

/**
 * A job qualifies for the store/CSV output when it matches the capture rule
 * (US-remote Data Engineer-family title) AND was posted within the configured recency window.
 */
function matchesOutputRule(job) {
  return matchesCaptureRule(job) && isRecentJob(job, config.recentDays);
}

/**
 * File-backed store (JSON) — no native deps.
 * Keeps jobs + run history for dedupe and CSV sync.
 */

function ensureDataDir() {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

function storePath() {
  return config.storePath || path.join(config.dataDir, "store.json");
}

function defaultStore() {
  return {
    meta: {},
    nextRunId: 1,
    runs: [],
    jobs: {},
  };
}

let cache = null;

function load() {
  if (cache) return cache;
  ensureDataDir();
  const p = storePath();
  if (!fs.existsSync(p)) {
    cache = defaultStore();
    save();
    return cache;
  }
  try {
    cache = { ...defaultStore(), ...JSON.parse(fs.readFileSync(p, "utf8")) };
    cache.meta = cache.meta || {};
    cache.jobs = cache.jobs || {};
    cache.runs = cache.runs || [];
    cache.nextRunId = cache.nextRunId || 1;
  } catch {
    cache = defaultStore();
  }
  return cache;
}

function save() {
  ensureDataDir();
  fs.writeFileSync(storePath(), JSON.stringify(cache, null, 2), "utf8");
}

// Keep dbPath config for compatibility; also mirror a marker file name
export function getMeta(key, fallback = null) {
  const s = load();
  return Object.prototype.hasOwnProperty.call(s.meta, key)
    ? s.meta[key]
    : fallback;
}

export function setMeta(key, value) {
  const s = load();
  s.meta[key] = String(value);
  save();
}

export function beginRun() {
  const s = load();
  const id = s.nextRunId++;
  s.runs.push({
    id,
    started_at: new Date().toISOString(),
    finished_at: null,
    new_count: 0,
    updated_count: 0,
    skipped_count: 0,
    error: null,
  });
  save();
  return id;
}

export function finishRun(runId, counts, error = null) {
  const s = load();
  const run = s.runs.find((r) => r.id === runId);
  if (!run) return;
  run.finished_at = new Date().toISOString();
  run.new_count = counts.newCount || 0;
  run.updated_count = counts.updatedCount || 0;
  run.skipped_count = counts.skippedCount || 0;
  run.error = error;
  save();
}

export function getLastRun() {
  const s = load();
  if (!s.runs.length) return null;
  return s.runs[s.runs.length - 1];
}

export function getStatus() {
  const s = load();
  const jobs = Object.values(s.jobs);
  const lastRun = getLastRun();
  const bySource = {};
  for (const id of SOURCE_IDS) {
    bySource[`${id}Jobs`] = jobs.filter(
      (j) => String(j.source || "").toLowerCase() === id
    ).length;
  }
  return {
    totalJobs: jobs.length,
    ...bySource,
    diceJobs: bySource.diceJobs,
    jobrightJobs: bySource.jobrightJobs,
    newJobs: jobs.filter((j) => j.status === "new").length,
    lastRun: lastRun || null,
    csvPath: getMeta("last_csv_path"),
    latestCsv: config.csvLatestPath,
    apiBase: config.apiBase,
  };
}

function jobFromRow(row) {
  if (!row) return null;
  const out = {};
  for (const h of CSV_HEADERS) {
    out[h] = row[h] ?? "";
  }
  return out;
}

export function getJob(id) {
  return jobFromRow(load().jobs[String(id)]);
}

export function listJobs({ status, source, limit = 50 } = {}) {
  const lim = Math.max(1, Math.min(500, Number(limit) || 50));
  let rows = Object.values(load().jobs);
  if (status) {
    rows = rows.filter((j) => j.status === String(status));
  }
  if (source) {
    const src = String(source).toLowerCase();
    rows = rows.filter((j) => String(j.source || "").toLowerCase() === src);
  }
  rows.sort((a, b) =>
    String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || ""))
  );
  return rows.slice(0, lim).map(jobFromRow);
}

export function allJobs() {
  return Object.values(load().jobs)
    .sort((a, b) =>
      String(a.first_seen_at || "").localeCompare(String(b.first_seen_at || ""))
    )
    .map(jobFromRow);
}

/**
 * Upsert a scraped job for the current run.
 * @returns {{ status: 'new'|'updated', job: object }}
 */
export function upsertJob(scraped, runId) {
  const s = load();
  const now = new Date().toISOString();
  const id = String(scraped.id);
  const existing = s.jobs[id];

  const base = {
    id,
    title: scraped.title || "",
    organization: scraped.organization || "",
    location: scraped.location || "",
    work_arrangement: scraped.work_arrangement || "",
    remote_restricted_to: scraped.remote_restricted_to || "",
    experience_level: scraped.experience_level || "",
    employment_type: scraped.employment_type || "",
    salary_min: scraped.salary_min ?? "",
    salary_max: scraped.salary_max ?? "",
    salary_currency: scraped.salary_currency || "USD",
    salary_unit: scraped.salary_unit || "",
    key_skills: scraped.key_skills || "",
    source: scraped.source || "dice",
    date_posted: scraped.date_posted || "",
    url: scraped.url || "",
    description: scraped.description || "",
  };

  if (!existing) {
    const job = {
      ...base,
      first_seen_run_id: runId,
      last_seen_run_id: runId,
      first_seen_at: now,
      last_seen_at: now,
      status: "new",
    };
    s.jobs[id] = job;
    save();
    return { status: "new", job };
  }

  const job = {
    ...base,
    first_seen_run_id: existing.first_seen_run_id,
    last_seen_run_id: runId,
    first_seen_at: existing.first_seen_at,
    last_seen_at: now,
    status: "updated",
  };
  s.jobs[id] = job;
  save();
  return { status: "updated", job };
}

export function jobsBySource(source) {
  const src = String(source || "").toLowerCase();
  return allJobs().filter((j) => String(j.source || "").toLowerCase() === src);
}

/**
 * Permanently remove stored jobs that no longer satisfy the output rule:
 * the capture rule (hybrid/on-site, non-US, or title is not data engineering) or the
 * recency window (posted more than RECENT_DAYS ago). Used to clean out legacy
 * rows and age out stale postings.
 * @returns {{ removed: number, kept: number }}
 */
export function pruneStore() {
  const s = load();
  const ids = Object.keys(s.jobs);
  let removed = 0;
  for (const id of ids) {
    if (!matchesOutputRule(s.jobs[id])) {
      delete s.jobs[id];
      removed += 1;
    }
  }
  if (removed > 0) save();
  return { removed, kept: Object.keys(s.jobs).length };
}

/**
 * Permanently remove stored jobs by id (e.g. jobs the user has since applied
 * to on JobRight). Ignores ids that are not present.
 * @param {Iterable<string>} ids
 * @returns {{ removed: number, kept: number }}
 */
export function removeJobs(ids) {
  const s = load();
  let removed = 0;
  for (const id of ids || []) {
    const key = String(id);
    if (Object.prototype.hasOwnProperty.call(s.jobs, key)) {
      delete s.jobs[key];
      removed += 1;
    }
  }
  if (removed > 0) save();
  return { removed, kept: Object.keys(s.jobs).length };
}

/**
 * Write one combined CSV with the latest qualifying jobs from all sources.
 * Overwrites `jobs_latest.csv` (or CSV_LATEST_FILE) each run.
 * @returns {{ csvPath: string, latestPath: string, count: number }}
 */
function csvSourceRank(source) {
  const src = String(source || "").toLowerCase();
  const idx = CSV_SOURCE_ORDER.indexOf(src);
  return idx === -1 ? CSV_SOURCE_ORDER.length : idx;
}

export function syncCsv(rows = null) {
  const all = rows || allJobs();
  const clean = (all || []).filter((j) => matchesOutputRule(j));
  // Source order first (JobRight last), then newest first within each source.
  clean.sort((a, b) => {
    const bySource = csvSourceRank(a.source) - csvSourceRank(b.source);
    if (bySource !== 0) return bySource;
    return String(b.last_seen_at || b.date_posted || "").localeCompare(
      String(a.last_seen_at || a.date_posted || "")
    );
  });

  const latestPath = config.csvLatestPath;
  writeCsv(latestPath, clean);
  setMeta("last_csv_path", latestPath);
  setMeta("last_csv_latest_path", latestPath);
  return { csvPath: latestPath, latestPath, count: clean.length };
}

export function closeStore() {
  if (cache) save();
  cache = null;
}
