/**
 * Remotive public API — remote jobs matching data-engineering searches.
 * https://remotive.com/api/remote-jobs
 */

import { config } from "../config.js";
import { getJson } from "../http.js";
import { stripHtml } from "../filter.js";
import {
  emptySkipCounts,
  isoDate,
  keepFeedJob,
  logKept,
} from "../feeds/keep.js";

function queries() {
  return config.searchQueries?.length
    ? config.searchQueries
    : [config.searchQ || "Data Engineer"];
}

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

  for (const q of queries()) {
    const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}`;
    console.log(`[remotive] ${url}`);
    let json;
    try {
      json = await getJson(url);
    } catch (err) {
      console.warn(`[remotive] query "${q}" failed: ${err.message}`);
      continue;
    }
    const list = Array.isArray(json?.jobs) ? json.jobs : [];
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
