import fs from "fs";
import path from "path";
import { config, CSV_HEADERS, SOURCE_IDS, SOURCE_PRIORITY, CSV_SOURCE_ORDER } from "./config.js";
import { writeCsv } from "./csv.js";
import { matchesCaptureRule, isRecentJob } from "./filter.js";
import {
  isIncompleteExternalJobUrl,
  repairJobrightStoredUrl,
} from "./jobright/url.js";

/** Career-board sources: still listed = still open, even if date_posted is old. */
const ATS_SOURCES = new Set(["greenhouse", "lever", "ashby"]);

/**
 * A job qualifies for the store/CSV output when it matches the capture rule
 * (US-remote Data Engineer-family title) AND was posted within the configured
 * recency window. Greenhouse/Lever/Ashby jobs instead stay while we still see
 * them on the live board (last_seen_at).
 */
function matchesOutputRule(job) {
  if (!matchesCaptureRule(job)) return false;
  const src = String(job.source || "").toLowerCase();
  if (ATS_SOURCES.has(src)) {
    return isRecentJob(
      { ...job, date_posted: job.last_seen_at || job.first_seen_at },
      config.recentDays
    );
  }
  return isRecentJob(job, config.recentDays);
}

function normalizeKeyPart(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s+&/-]/g, " ")
    .replace(
      /\b(inc|llc|ltd|corp|corporation|co|company|limited|the)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Same title + employer is one job, even when boards assign different ids.
 */
export function jobFingerprint(job) {
  const title = normalizeKeyPart(job?.title);
  const org = normalizeKeyPart(job?.organization);
  if (!title || !org) return "";
  return `${title}||${org}`;
}

function sourceFromId(id) {
  const prefix = String(id || "").split("_")[0].toLowerCase();
  return SOURCE_IDS.includes(prefix) ? prefix : "";
}

function sourceHintFromUrl(url) {
  const u = String(url || "").toLowerCase();
  if (!u) return "";
  if (/boards\.greenhouse\.io|greenhouse\.io/.test(u)) return "greenhouse";
  if (/jobs\.lever\.co/.test(u)) return "lever";
  if (/jobs\.ashbyhq\.com|ashbyhq\.com/.test(u)) return "ashby";
  if (/dice\.com/.test(u)) return "dice";
  if (/ziprecruiter\.com/.test(u)) return "ziprecruiter";
  if (/builtin\.com/.test(u)) return "builtin";
  if (/monster\.com/.test(u)) return "monster";
  if (/himalayas\.app/.test(u)) return "himalayas";
  if (/remotive\.com/.test(u)) return "remotive";
  if (/remoteok\.com/.test(u)) return "remoteok";
  if (/weworkremotely\.com/.test(u)) return "wwr";
  return "";
}

export function sourcePriorityRank(job) {
  const src = String(
    sourceHintFromUrl(job?.url) ||
      job?.source ||
      sourceFromId(job?.id) ||
      ""
  ).toLowerCase();
  const idx = SOURCE_PRIORITY.indexOf(src);
  return idx === -1 ? SOURCE_PRIORITY.length : idx;
}

function preferJob(a, b) {
  const pa = sourcePriorityRank(a);
  const pb = sourcePriorityRank(b);
  if (pa !== pb) return pa < pb ? a : b;

  const aDesc = String(a.description || "").length;
  const bDesc = String(b.description || "").length;
  if (bDesc !== aDesc) return bDesc > aDesc ? b : a;
  const aSeen = String(a.last_seen_at || a.first_seen_at || "");
  const bSeen = String(b.last_seen_at || b.first_seen_at || "");
  if (bSeen !== aSeen) return bSeen > aSeen ? b : a;
  return a;
}

function urlQuality(url) {
  const u = String(url || "").trim();
  if (!u) return 0;
  if (isIncompleteExternalJobUrl(u)) return 1;
  if (/\/apply\/?$/i.test(u)) return 2;
  if (/jobright\.ai\/jobs\/info\//i.test(u)) return 3;
  return 4;
}

function preferStoredUrl(...urls) {
  let best = "";
  let bestQ = -1;
  for (const u of urls) {
    const s = String(u || "").trim();
    if (!s) continue;
    const q = urlQuality(s);
    if (q > bestQ) {
      best = s;
      bestQ = q;
    }
  }
  return best;
}

function preferStoredDescription(...descs) {
  let best = "";
  for (const d of descs) {
    const s = String(d || "");
    if (s.length > best.length) best = s;
  }
  return best;
}

function findJobByFingerprint(jobs, fingerprint, exceptId) {
  if (!fingerprint) return null;
  for (const job of Object.values(jobs)) {
    if (exceptId && String(job.id) === String(exceptId)) continue;
    if (jobFingerprint(job) === fingerprint) return job;
  }
  return null;
}

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
 * Fingerprint-merges cross-board duplicates, preferring higher-priority sources.
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
    const twin = findJobByFingerprint(s.jobs, jobFingerprint(base), id);
    if (twin) {
      const winner = preferJob(twin, base);
      const merged = {
        ...winner,
        id: winner.id,
        source:
          sourceFromId(winner.id) ||
          winner.source ||
          twin.source ||
          base.source,
        url: preferStoredUrl(winner.url, twin.url, base.url),
        description: preferStoredDescription(
          winner.description,
          twin.description,
          base.description
        ),
        date_posted: winner.date_posted || twin.date_posted || base.date_posted,
        first_seen_run_id: twin.first_seen_run_id,
        last_seen_run_id: runId,
        first_seen_at: twin.first_seen_at,
        last_seen_at: now,
        status: "updated",
      };
      if (winner.id !== twin.id) {
        delete s.jobs[twin.id];
      }
      s.jobs[merged.id] = merged;
      save();
      return { status: "updated", job: merged };
    }
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
    url: preferStoredUrl(base.url, existing.url),
    description: preferStoredDescription(base.description, existing.description),
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
 * Permanently remove stored jobs that no longer satisfy the output rule.
 * Also collapses fingerprint duplicates.
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

  const byFp = new Map();
  for (const job of Object.values(s.jobs)) {
    const fp = jobFingerprint(job);
    if (!fp) continue;
    const prev = byFp.get(fp);
    if (!prev) {
      byFp.set(fp, job);
      continue;
    }
    const winner = preferJob(prev, job);
    const loser = winner === prev ? job : prev;
    byFp.set(fp, winner);
    delete s.jobs[loser.id];
    removed += 1;
  }

  if (removed > 0) save();
  return { removed, kept: Object.keys(s.jobs).length };
}

/**
 * Permanently remove stored jobs by id (e.g. already-applied JobRight/Dice).
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

/** Repair incomplete JobRight / ATS shell URLs in the store. */
export function repairJobrightUrls() {
  const s = load();
  let repaired = 0;
  for (const job of Object.values(s.jobs)) {
    const before = String(job.url || "");
    const after = repairJobrightStoredUrl(job);
    if (after && after !== before) {
      job.url = after;
      repaired += 1;
    }
  }
  if (repaired > 0) save();
  return { repaired };
}

function csvSourceRank(source) {
  const src = String(source || "").toLowerCase();
  const idx = CSV_SOURCE_ORDER.indexOf(src);
  return idx === -1 ? CSV_SOURCE_ORDER.length : idx;
}

/**
 * Write one combined CSV with the latest qualifying jobs from all sources.
 * @returns {{ csvPath: string, latestPath: string, count: number }}
 */
export function syncCsv(rows = null) {
  const all = rows || allJobs();
  const clean = (all || []).filter((j) => matchesOutputRule(j));
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
