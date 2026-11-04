/**
 * Remote OK public API — client-side data-engineering filter.
 * https://remoteok.com/api  (large payload; use longer timeout / curl)
 */

import { getJsonPreferCurl } from "../curl.js";
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
    url:
      j.url ||
      j.apply_url ||
      (j.slug ? `https://remoteok.com/remote-jobs/${j.slug}` : ""),
    description: stripHtml(j.description).slice(0, 20000),
  };
}

export async function searchRemoteokJobs() {
  const urls = [
    "https://remoteok.com/api?tag=data",
    "https://remoteok.com/api",
  ];
  const kept = [];
  const seen = new Set();
  const counts = emptySkipCounts();
  let scanned = 0;

  for (const url of urls) {
    console.log(`[remoteok] ${url}`);
    let json;
    try {
      json = await getJsonPreferCurl(url, {
        timeoutMs: 90000,
        headers: {
          accept: "application/json",
        },
      });
    } catch (err) {
      console.warn(`[remoteok] ${url} failed: ${err.message}`);
      continue;
    }
    const list = (Array.isArray(json) ? json : []).filter(
      (j) => j && (j.position || j.slug)
    );
    console.log(`[remoteok] jobs=${list.length}`);
    for (const raw of list) {
      const job = mapJob(raw);
      if (!job.id || seen.has(job.id)) continue;
      seen.add(job.id);
      scanned += 1;
      if (keepFeedJob(job, counts)) kept.push(job);
    }
    // Full API already covers tag=data; stop after first successful pull with rows.
    if (list.length) break;
  }

  logKept("remoteok", kept.length, scanned, counts);
  return { jobs: kept };
}
