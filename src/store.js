import fs from "fs";
import path from "path";
import {
  config,
  CSV_HEADERS,
  SOURCE_IDS,
  SOURCE_PRIORITY,
  CSV_EXPORT_ORDER,
} from "./config.js";
import { writeCsv } from "./csv.js";
import { matchesCaptureRule, isRecentJob, parsePostedDate } from "./filter.js";
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
  if (/myworkdayjobs\.com|workday\.com\/.*\/job\//.test(u)) return "workday";
  if (/indeed\.com/.test(u)) return "indeed";
  if (/dice\.com/.test(u)) return "dice";
  if (/ziprecruiter\.com/.test(u)) return "ziprecruiter";
  if (/builtin\.com/.test(u)) return "builtin";
  if (/monster\.com/.test(u)) return "monster";
  if (/careerbuilder\.com/.test(u)) return "careerbuilder";
  if (/himalayas\.app/.test(u)) return "himalayas";
  if (/remotive\.com/.test(u)) return "remotive";
  if (/remoteok\.com/.test(u)) return "remoteok";
  if (/weworkremotely\.com/.test(u)) return "wwr";
  return "";
}

function isWorkdayJobUrl(url) {
  return sourceHintFromUrl(url) === "workday";
}

function csvSourceSlug(source) {
  return (
    String(source || "other")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "other"
  );
}

export function csvExportIndex(source) {
  const slug = csvSourceSlug(source);
  const idx = CSV_EXPORT_ORDER.indexOf(slug);
  return idx === -1 ? CSV_EXPORT_ORDER.length + 1 : idx + 1;
}

export function csvPathForSource(source) {
  const slug = csvSourceSlug(source);
  const n = String(csvExportIndex(slug)).padStart(2, "0");
  return path.join(config.dataDir, `${n}_${slug}_jobs_latest.csv`);
}

function cleanupLegacySourceCsvs(keepPaths) {
  const keep = new Set(
    [...keepPaths, config.csvLatestPath].map((p) => path.resolve(String(p || "")))
  );
  let dir;
  try {
    dir = fs.readdirSync(config.dataDir);
  } catch {
    return;
  }
  for (const name of dir) {
    if (!/_jobs_latest\.csv$/i.test(name)) continue;
    if (/^\d{2}_/.test(name)) continue;
    const full = path.resolve(config.dataDir, name);
    if (keep.has(full)) continue;
    try {
      fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
  }
}

function withSeq(rows) {
  return (rows || []).map((row, i) => ({ ...row, seq: i + 1 }));
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
 * Permanently remove stored jobs by id.
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

function csvSourceRank(job) {
  return sourcePriorityRank(job);
}

function jobPostedAtMs(job, now = new Date()) {
  const posted = parsePostedDate(job?.date_posted, now);
  return posted ? posted.getTime() : 0;
}

function sortJobsForCsv(jobs, now = new Date()) {
  const list = [...(jobs || [])];
  list.sort((a, b) => {
    const aMs = jobPostedAtMs(a, now);
    const bMs = jobPostedAtMs(b, now);
    const aDated = aMs > 0;
    const bDated = bMs > 0;
    if (aDated !== bDated) return aDated ? -1 : 1;
    if (bMs !== aMs) return bMs - aMs;

    const bySource = csvSourceRank(a) - csvSourceRank(b);
    if (bySource !== 0) return bySource;

    const aSeen = Date.parse(a?.last_seen_at || a?.first_seen_at || "") || 0;
    const bSeen = Date.parse(b?.last_seen_at || b?.first_seen_at || "") || 0;
    if (bSeen !== aSeen) return bSeen - aSeen;

    return String(b.last_seen_at || "").localeCompare(
      String(a.last_seen_at || "")
    );
  });
  return list;
}

/**
 * Write combined + per-source CSVs with the latest qualifying jobs.
 * - `jobs_latest.csv` — all sources (rows numbered via `seq`)
 * - `NN_{source}_jobs_latest.csv` — one numbered file per source
 * - `NN_workday_jobs_latest.csv` — Workday apply URLs (any source)
 */
export function syncCsv(rows = null) {
  const all = rows || allJobs();
  const now = new Date();
  const clean = sortJobsForCsv(
    (all || [])
      .filter((j) => matchesOutputRule(j))
      .map((j) => {
        if (String(j.source || "").toLowerCase() === "jobright" || /^jobright_/i.test(j.id || "")) {
          return { ...j, source: "jobright" };
        }
        const idSrc = sourceFromId(j.id);
        return idSrc && idSrc !== j.source ? { ...j, source: idSrc } : j;
      }),
    now
  );

  const latestPath = config.csvLatestPath;
  writeCsv(latestPath, withSeq(clean));

  const bySource = {};
  const buckets = new Map();
  for (const job of clean) {
    const src = csvSourceSlug(job.source || sourceFromId(job.id) || "other");
    if (!buckets.has(src)) buckets.set(src, []);
    buckets.get(src).push(job);
  }

  const writtenPaths = [];
  const sourcesToWrite = [
    ...CSV_EXPORT_ORDER,
    ...[...buckets.keys()].filter((s) => !CSV_EXPORT_ORDER.includes(s)),
  ];
  for (const src of sourcesToWrite) {
    if (src === "workday") continue;
    const list = sortJobsForCsv(buckets.get(src) || [], now);
    const filePath = csvPathForSource(src);
    writeCsv(filePath, withSeq(list));
    writtenPaths.push(filePath);
    bySource[src] = {
      path: filePath,
      count: list.length,
      seq: csvExportIndex(src),
    };
  }

  const workdayJobs = sortJobsForCsv(
    clean.filter((j) => isWorkdayJobUrl(j.url)),
    now
  );
  const workdayPath = csvPathForSource("workday");
  writeCsv(workdayPath, withSeq(workdayJobs));
  writtenPaths.push(workdayPath);
  bySource.workday = {
    path: workdayPath,
    count: workdayJobs.length,
    seq: csvExportIndex("workday"),
  };

  cleanupLegacySourceCsvs(writtenPaths);

  setMeta("last_csv_path", latestPath);
  setMeta("last_csv_latest_path", latestPath);
  setMeta("last_csv_by_source", JSON.stringify(bySource));
  return {
    csvPath: latestPath,
    latestPath,
    count: clean.length,
    bySource,
  };
}

export function closeStore() {
  if (cache) save();
  cache = null;
}
