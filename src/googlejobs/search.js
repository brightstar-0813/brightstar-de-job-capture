/**
 * Google Jobs via SerpAPI (optional). Google has no free public Jobs API.
 * Set SERPAPI_KEY to enable: https://serpapi.com/google-jobs-api
 */

import { config } from "../config.js";
import { tryGetJson } from "../http.js";
import { stripHtml } from "../filter.js";
import {
  emptySkipCounts,
  isoDate,
  keepFeedJob,
  logKept,
} from "../feeds/keep.js";

function mapJob(j, index) {
  const id = j.job_id || j.place_id || `${j.title}_${index}`;
  const apply =
    (Array.isArray(j.apply_options) && j.apply_options[0]?.link) ||
    j.share_link ||
    "";
  const posted = j.detected_extensions?.posted_at || j.posted_at || "";
  return {
    id: `googlejobs_${String(id).replace(/[^\w-]+/g, "_").slice(0, 80)}`,
    title: j.title || "",
    organization: j.company_name || "",
    location: j.location || "",
    work_arrangement: /\bremote\b/i.test(`${j.location || ""} ${j.title || ""}`)
      ? "Remote"
      : "",
    remote_restricted_to: "",
    experience_level: "",
    employment_type: j.detected_extensions?.schedule_type || "",
    salary_min: "",
    salary_max: "",
    salary_currency: "USD",
    salary_unit: "",
    key_skills: "",
    source: "googlejobs",
    date_posted: isoDate(posted),
    url: apply || "",
    description: stripHtml(j.description).slice(0, 20000),
  };
}

export async function searchGoogleJobs() {
  const key = String(config.serpapiKey || "").trim();
  if (!key) {
    console.log(
      `[googlejobs] skipped — set SERPAPI_KEY to pull Google Jobs (no free Google API)`
    );
    return { jobs: [] };
  }

  const params = new URLSearchParams();
  params.set("engine", "google_jobs");
  params.set("q", `${config.searchQ || "Data Engineer"} remote`);
  params.set("hl", "en");
  params.set("gl", "us");
  params.set("chips", "date_posted:week");
  params.set("api_key", key);
  const url = `https://serpapi.com/search.json?${params.toString()}`;
  console.log(`[googlejobs] serpapi google_jobs q=${params.get("q")}`);

  const res = await tryGetJson(url, { timeoutMs: 30000 });
  if (!res.ok) {
    console.warn(`[googlejobs] HTTP ${res.status}`);
    return { jobs: [] };
  }
  const list = Array.isArray(res.json?.jobs_results)
    ? res.json.jobs_results
    : [];
  const kept = [];
  const seen = new Set();
  const counts = emptySkipCounts();

  for (let i = 0; i < list.length; i += 1) {
    const job = mapJob(list[i], i);
    if (!job.id || seen.has(job.id)) continue;
    seen.add(job.id);
    if (keepFeedJob(job, counts)) kept.push(job);
  }

  logKept("googlejobs", kept.length, list.length, counts);
  return { jobs: kept };
}
