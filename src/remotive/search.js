/**
 * Remotive public API — remote jobs filtered client-side to data engineering.
 * Search query param is weak (returns unrelated hits); pull category feeds instead.
 * https://remotive.com/api/remote-jobs
 */

import { getJsonPreferCurl } from "../curl.js";
import { stripHtml } from "../filter.js";
import {
  emptySkipCounts,
  isoDate,
  keepFeedJob,
  logKept,
} from "../feeds/keep.js";

const ENDPOINTS = [
  "https://remotive.com/api/remote-jobs?category=software-dev",
  "https://remotive.com/api/remote-jobs?category=data",
  "https://remotive.com/api/remote-jobs",
];

function mapJob(j) {
  const location = j.candidate_required_location || "";
  return {
    id: `remotive_${j.id}`,
    title: j.title || "",
    organization: j.company_name || "",
    location,
    work_arrangement: "Remote",
    remote_restricted_to: "",
    experience_level: "",
    employment_type: j.job_type || "",
    salary_min: "",
    salary_max: "",
    salary_currency: "USD",
    salary_unit: "",
    key_skills: Array.isArray(j.tags) ? j.tags.join(", ") : "",
    source: "remotive",
    date_posted: isoDate(j.publication_date),
    url: j.url || "",
    description: stripHtml(j.description).slice(0, 20000),
  };
}

export async function searchRemotiveJobs() {
  const seen = new Set();
  const kept = [];
  const counts = emptySkipCounts();
  let scanned = 0;

  for (const url of ENDPOINTS) {
    console.log(`[remotive] ${url}`);
    let json;
    try {
      json = await getJsonPreferCurl(url, { timeoutMs: 45000 });
    } catch (err) {
      console.warn(`[remotive] ${url} failed: ${err.message}`);
      continue;
    }
    const list = Array.isArray(json?.jobs) ? json.jobs : [];
    console.log(`[remotive] jobs=${list.length}`);
    for (const raw of list) {
      if (!raw?.id || seen.has(raw.id)) continue;
      seen.add(raw.id);
      scanned += 1;
      const job = mapJob(raw);
      if (keepFeedJob(job, counts)) kept.push(job);
    }
  }

  logKept("remotive", kept.length, scanned, counts);
  return { jobs: kept };
}
