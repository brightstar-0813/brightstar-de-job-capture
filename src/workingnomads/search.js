/**
 * Working Nomads public jobs feed (Applyre "Top 200" — Remote and Flexible Work).
 * https://www.workingnomads.com/api/exposed_jobs/
 */

import { getJson } from "../http.js";
import { stripHtml } from "../filter.js";
import {
  emptySkipCounts,
  isoDate,
  keepFeedJob,
  logKept,
} from "../feeds/keep.js";

function jobId(url) {
  const m = String(url || "").match(/\/job\/go\/(\d+)/i);
  return m ? `workingnomads_${m[1]}` : "";
}

function mapJob(j) {
  const id = jobId(j.url);
  const tags = Array.isArray(j.tags) ? j.tags.join(", ") : String(j.tags || "");
  return {
    id,
    title: j.title || "",
    organization: j.company_name || "",
    location: j.location || "",
    work_arrangement: "Remote",
    remote_restricted_to: "",
    experience_level: "",
    employment_type: j.category_name || "",
    salary_min: "",
    salary_max: "",
    salary_currency: "USD",
    salary_unit: "",
    key_skills: tags,
    source: "workingnomads",
    date_posted: isoDate(j.pub_date),
    url: j.url || "",
    description: stripHtml(j.description).slice(0, 20000),
  };
}

export async function searchWorkingnomadsJobs() {
  const url = "https://www.workingnomads.com/api/exposed_jobs/";
  console.log(`[workingnomads] ${url}`);
  let list;
  try {
    list = await getJson(url, { timeoutMs: 25000 });
  } catch (err) {
    console.warn(`[workingnomads] fetch failed: ${err.message}`);
    return { jobs: [] };
  }
  if (!Array.isArray(list)) {
    console.warn("[workingnomads] unexpected response shape");
    return { jobs: [] };
  }

  const kept = [];
  const seen = new Set();
  const counts = emptySkipCounts();

  for (const raw of list) {
    const job = mapJob(raw);
    if (!job.id || seen.has(job.id)) continue;
    seen.add(job.id);
    if (keepFeedJob(job, counts)) kept.push(job);
  }

  logKept("workingnomads", kept.length, list.length, counts);
  return { jobs: kept };
}
