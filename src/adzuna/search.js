/**
 * Adzuna US job aggregator API (Applyre "Top 200" — Additional Job Search Engines).
 * Free tier: https://developer.adzuna.com/ — set ADZUNA_APP_ID + ADZUNA_APP_KEY.
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

const PAGE_SIZE = 50;
const MAX_PAGES = 3;

function mapJob(j) {
  const loc = j.location?.display_name || "";
  const remote = /\bremote\b/i.test(`${loc} ${j.title || ""} ${j.description || ""}`);
  return {
    id: `adzuna_${String(j.id || "").replace(/[^\w-]+/g, "_")}`,
    title: j.title || "",
    organization: j.company?.display_name || "",
    location: loc,
    work_arrangement: remote ? "Remote" : "",
    remote_restricted_to: "",
    experience_level: "",
    employment_type: j.contract_type || "",
    salary_min: j.salary_min != null ? String(j.salary_min) : "",
    salary_max: j.salary_max != null ? String(j.salary_max) : "",
    salary_currency: "USD",
    salary_unit: "",
    key_skills: Array.isArray(j.category?.label) ? j.category.label : j.category?.label || "",
    source: "adzuna",
    date_posted: isoDate(j.created),
    url: j.redirect_url || "",
    description: stripHtml(j.description).slice(0, 20000),
  };
}

async function searchPage(creds, phrase, page) {
  const params = new URLSearchParams();
  params.set("app_id", creds.appId);
  params.set("app_key", creds.appKey);
  params.set("what_phrase", phrase);
  params.set("where", "remote");
  params.set("results_per_page", String(PAGE_SIZE));
  params.set("sort_by", "date");
  params.set("max_days_old", String(Math.min(30, config.recentDays || 7)));
  const url = `https://api.adzuna.com/v1/api/jobs/us/search/${page}?${params.toString()}`;
  return tryGetJson(url, { timeoutMs: 30000 });
}

export async function searchAdzunaJobs() {
  const appId = String(config.adzunaAppId || "").trim();
  const appKey = String(config.adzunaAppKey || "").trim();
  if (!appId || !appKey) {
    console.log(
      "[adzuna] skipped — set ADZUNA_APP_ID and ADZUNA_APP_KEY (free at developer.adzuna.com)"
    );
    return { jobs: [] };
  }

  const creds = { appId, appKey };
  const phrases = (config.searchQueries || [config.searchQ || "Data Engineer"]).slice(
    0,
    4
  );
  console.log(`[adzuna] phrases=${phrases.join(", ")}`);

  const kept = [];
  const seen = new Set();
  const counts = emptySkipCounts();
  let scanned = 0;

  for (const phrase of phrases) {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const res = await searchPage(creds, phrase, page);
      if (!res.ok) {
        console.warn(`[adzuna] HTTP ${res.status} phrase=${phrase} page=${page}`);
        break;
      }
      const list = Array.isArray(res.json?.results) ? res.json.results : [];
      if (!list.length) break;
      scanned += list.length;

      for (const raw of list) {
        const job = mapJob(raw);
        if (!job.id || seen.has(job.id)) continue;
        seen.add(job.id);
        if (keepFeedJob(job, counts)) kept.push(job);
      }
      if (list.length < PAGE_SIZE) break;
    }
  }

  logKept("adzuna", kept.length, scanned, counts);
  return { jobs: kept };
}
