/**
 * Arbeitnow public job-board API (EU/remote). Client-side DE filter via keepFeedJob.
 * https://www.arbeitnow.com/api/job-board-api
 */

import { tryGetJson } from "../http.js";
import { stripHtml } from "../filter.js";
import {
  emptySkipCounts,
  isoDate,
  keepFeedJob,
  logKept,
} from "../feeds/keep.js";

function mapJob(j) {
  const slug = j.slug || j.url;
  return {
    id: `arbeitnow_${String(slug || "").replace(/[^\w-]+/g, "_").slice(0, 80)}`,
    title: j.title || "",
    organization: j.company_name || "",
    location: j.location || "",
    work_arrangement: j.remote === true ? "Remote" : "",
    remote_restricted_to: "",
    experience_level: "",
    employment_type: Array.isArray(j.job_types)
      ? j.job_types.join(", ")
      : j.job_types || "",
    salary_min: "",
    salary_max: "",
    salary_currency: "USD",
    salary_unit: "",
    key_skills: Array.isArray(j.tags) ? j.tags.join(", ") : "",
    source: "arbeitnow",
    date_posted: isoDate(j.created_at),
    url: j.url || "",
    description: stripHtml(j.description).slice(0, 20000),
  };
}

export async function searchArbeitnowJobs() {
  const url = "https://www.arbeitnow.com/api/job-board-api";
  console.log(`[arbeitnow] ${url}`);
  const res = await tryGetJson(url, { timeoutMs: 25000 });
  if (!res.ok) {
    console.warn(`[arbeitnow] HTTP ${res.status}`);
    return { jobs: [] };
  }
  const list = Array.isArray(res.json?.data) ? res.json.data : [];
  const kept = [];
  const seen = new Set();
  const counts = emptySkipCounts();

  for (const raw of list) {
    const job = mapJob(raw);
    if (!job.id || seen.has(job.id)) continue;
    seen.add(job.id);
    if (keepFeedJob(job, counts)) kept.push(job);
  }

  logKept("arbeitnow", kept.length, list.length, counts);
  return { jobs: kept };
}
