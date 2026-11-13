/**
 * Jobicy public remote-jobs API — multiple data-engineering tags.
 * https://jobicy.com/api/v2/remote-jobs
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

function tags() {
  return config.jobicyTags?.length
    ? config.jobicyTags
    : ["python", "data", "etl", "sql"];
}

function mapJob(j) {
  return {
    id: `jobicy_${j.id || j.jobSlug}`,
    title: j.jobTitle || "",
    organization: j.companyName || "",
    location: j.jobGeo || "",
    work_arrangement: "Remote",
    remote_restricted_to: "",
    experience_level: j.jobLevel || "",
    employment_type: j.jobType || "",
    salary_min: "",
    salary_max: "",
    salary_currency: "USD",
    salary_unit: "",
    key_skills: "",
    source: "jobicy",
    date_posted: isoDate(j.pubDate),
    url: j.url || "",
    description: stripHtml(j.jobDescription || j.jobExcerpt).slice(0, 20000),
  };
}

export async function searchJobicyJobs() {
  const seen = new Set();
  const kept = [];
  const counts = emptySkipCounts();
  let scanned = 0;

  for (const tag of tags()) {
    const url = `https://jobicy.com/api/v2/remote-jobs?count=100&tag=${encodeURIComponent(tag)}`;
    console.log(`[jobicy] ${url}`);
    const res = await tryGetJson(url, { timeoutMs: 25000 });
    if (!res.ok) {
      console.warn(`[jobicy] tag="${tag}" HTTP ${res.status}`);
      continue;
    }
    const list = Array.isArray(res.json?.jobs) ? res.json.jobs : [];
    for (const raw of list) {
      const job = mapJob(raw);
      if (!job.id || seen.has(job.id)) continue;
      seen.add(job.id);
      scanned += 1;
      if (keepFeedJob(job, counts)) kept.push(job);
    }
  }

  logKept("jobicy", kept.length, scanned, counts);
  return { jobs: kept };
}
