/**
 * Himalayas public remote-jobs search API (no auth).
 * https://himalayas.app/jobs/api/search
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

function queries() {
  return config.searchQueries?.length
    ? config.searchQueries
    : [config.searchQ || "Data Engineer"];
}

function locationText(j) {
  const locs = Array.isArray(j.locationRestrictions)
    ? j.locationRestrictions
    : [];
  return locs
    .map((c) => (typeof c === "string" ? c : c?.name || c?.slug || ""))
    .filter(Boolean)
    .join(", ");
}

function mapJob(j) {
  const id = j.guid || j.applicationLink;
  return {
    id: `himalayas_${String(id || "")
      .replace(/[^\w-]+/g, "_")
      .slice(0, 80)}`,
    title: j.title || "",
    organization: j.companyName || "",
    location: locationText(j),
    work_arrangement: "Remote",
    remote_restricted_to: "",
    experience_level: Array.isArray(j.seniority)
      ? j.seniority.join(", ")
      : j.seniority || "",
    employment_type: j.employmentType || "",
    salary_min: j.minSalary != null ? String(j.minSalary) : "",
    salary_max: j.maxSalary != null ? String(j.maxSalary) : "",
    salary_currency: j.currency || "USD",
    salary_unit: j.salaryPeriod || "",
    key_skills: Array.isArray(j.categories) ? j.categories.join(", ") : "",
    source: "himalayas",
    date_posted: isoDate(j.pubDate),
    url: j.applicationLink || "",
    description: stripHtml(j.description || j.excerpt).slice(0, 20000),
  };
}

export async function searchHimalayasJobs() {
  const seen = new Set();
  const kept = [];
  const counts = emptySkipCounts();
  let scanned = 0;
  const pagesPerQuery = Math.min(3, config.searchExtraPages || 2);

  for (const q of queries()) {
    for (let page = 1; page <= pagesPerQuery; page += 1) {
      const params = new URLSearchParams();
      params.set("q", q);
      params.set("sort", "recent");
      params.set("page", String(page));
      const url = `https://himalayas.app/jobs/api/search?${params.toString()}`;
      console.log(`[himalayas] ${url}`);
      const res = await tryGetJson(url, { timeoutMs: 25000 });
      if (!res.ok) {
        console.warn(`[himalayas] query "${q}" page ${page} HTTP ${res.status}`);
        break;
      }
      const list = Array.isArray(res.json?.jobs) ? res.json.jobs : [];
      if (!list.length) break;
      let newOnPage = 0;
      for (const raw of list) {
        const job = mapJob(raw);
        if (!job.id || seen.has(job.id)) continue;
        seen.add(job.id);
        scanned += 1;
        newOnPage += 1;
        if (!String(job.location || "").trim()) {
          counts.location += 1;
          continue;
        }
        if (keepFeedJob(job, counts)) kept.push(job);
      }
      if (newOnPage === 0) break;
    }
  }

  logKept("himalayas", kept.length, scanned, counts);
  return { jobs: kept };
}
