/**
 * Remote OK public API — client-side data-engineering filter.
 * https://remoteok.com/api
 */

import { getJson } from "../http.js";
import { stripHtml } from "../filter.js";
import {
  emptySkipCounts,
  isoDate,
  keepFeedJob,
  logKept,
} from "../feeds/keep.js";

function mapJob(j) {
  const id = j.slug || j.id;
  return {
    id: `remoteok_${id}`,
    title: j.position || j.title || "",
    organization: j.company || "",
    location: j.location || "",
    work_arrangement: "Remote",
    remote_restricted_to: "",
    experience_level: "",
    employment_type: "",
    salary_min: j.salary_min != null ? String(j.salary_min) : "",
    salary_max: j.salary_max != null ? String(j.salary_max) : "",
    salary_currency: "USD",
    salary_unit: j.salary_min || j.salary_max ? "YEAR" : "",
    key_skills: Array.isArray(j.tags) ? j.tags.join(", ") : "",
    source: "remoteok",
    date_posted: isoDate(j.date || (j.epoch ? j.epoch * 1000 : "")),
    url: j.url || j.apply_url || (j.slug ? `https://remoteok.com/remote-jobs/${j.slug}` : ""),
    description: stripHtml(j.description).slice(0, 20000),
  };
}

export async function searchRemoteokJobs() {
  const url = "https://remoteok.com/api";
  console.log(`[remoteok] ${url}`);
  const json = await getJson(url);
  const list = (Array.isArray(json) ? json : []).filter((j) => j && (j.position || j.slug));
  const kept = [];
  const seen = new Set();
  const counts = emptySkipCounts();

  for (const raw of list) {
    const job = mapJob(raw);
    if (!job.id || seen.has(job.id)) continue;
    seen.add(job.id);
    if (keepFeedJob(job, counts)) kept.push(job);
  }

  logKept("remoteok", kept.length, list.length, counts);
  return { jobs: kept };
}
