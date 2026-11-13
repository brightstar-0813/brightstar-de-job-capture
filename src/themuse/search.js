/**
 * The Muse public jobs API — no API key required.
 * https://www.themuse.com/api/public/jobs
 */

import { tryGetJson } from "../http.js";
import { stripHtml } from "../filter.js";
import {
  emptySkipCounts,
  isoDate,
  keepFeedJob,
  logKept,
} from "../feeds/keep.js";

const CATEGORIES = [
  "Data Science",
  "Software Engineering",
  "IT",
];

function mapJob(j) {
  const locs = Array.isArray(j.locations)
    ? j.locations.map((l) => l.name).filter(Boolean).join("; ")
    : "";
  const levels = Array.isArray(j.levels)
    ? j.levels.map((l) => l.name).filter(Boolean).join(", ")
    : "";
  const cats = Array.isArray(j.categories)
    ? j.categories.map((c) => c.name).filter(Boolean).join(", ")
    : "";
  return {
    id: `themuse_${j.id}`,
    title: j.name || "",
    organization: j.company?.name || "",
    location: locs,
    work_arrangement: "Remote",
    remote_restricted_to: "",
    experience_level: levels,
    employment_type: j.type || "",
    salary_min: "",
    salary_max: "",
    salary_currency: "USD",
    salary_unit: "",
    key_skills: cats,
    source: "themuse",
    date_posted: isoDate(j.publication_date),
    url: j.refs?.landing_page || "",
    description: stripHtml(j.contents || "").slice(0, 20000),
  };
}

async function fetchCategoryPages(category, maxPages = 3) {
  const out = [];
  for (let page = 0; page < maxPages; page += 1) {
    const url =
      `https://www.themuse.com/api/public/jobs` +
      `?category=${encodeURIComponent(category)}` +
      `&location=${encodeURIComponent("Flexible / Remote")}` +
      `&descending=true&page=${page}`;
    const res = await tryGetJson(url, { timeoutMs: 25000 });
    if (!res.ok) {
      if (page === 0) {
        console.warn(`[themuse] ${category} page ${page} HTTP ${res.status}`);
      }
      break;
    }
    const list = Array.isArray(res.json?.results) ? res.json.results : [];
    if (!list.length) break;
    out.push(...list);
    const pageCount = Number(res.json?.page_count || 1);
    if (page + 1 >= pageCount) break;
  }
  return out;
}

export async function searchThemuseJobs() {
  const seen = new Set();
  const kept = [];
  const counts = emptySkipCounts();
  let scanned = 0;

  console.log(`[themuse] scanning ${CATEGORIES.length} public categories`);

  for (const category of CATEGORIES) {
    let list = [];
    try {
      list = await fetchCategoryPages(category, 3);
    } catch (err) {
      console.warn(`[themuse] ${category} failed: ${err.message}`);
      continue;
    }
    for (const raw of list) {
      if (!raw?.id || seen.has(raw.id)) continue;
      seen.add(raw.id);
      scanned += 1;
      const job = mapJob(raw);
      if (keepFeedJob(job, counts)) kept.push(job);
    }
  }

  logKept("themuse", kept.length, scanned, counts);
  return { jobs: kept };
}
