/**
 * Jobgether filter API — remote data-engineering offers (no browser).
 * https://filter-api.jobgether.com/api/offer
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function locationText(raw) {
  const countries = Array.isArray(raw?.countries) ? raw.countries : [];
  return countries
    .map((c) => (typeof c === "string" ? c : c?.name || c?.slug || ""))
    .filter(Boolean)
    .join(", ");
}

function mapJob(j) {
  const id = j._id || j.slug;
  const remote = String(j.remoteOfferType || j.workingEnvironment || "");
  return {
    id: `jobgether_${id}`,
    title: j.title || "",
    organization: j.companyData?.name || "",
    location: locationText(j),
    work_arrangement: /remote/i.test(remote) ? "Remote" : remote,
    remote_restricted_to: "",
    experience_level: "",
    employment_type: j.contractType || "",
    salary_min: "",
    salary_max: "",
    salary_currency: "USD",
    salary_unit: "",
    key_skills: Array.isArray(j.skills)
      ? j.skills.map((s) => s?.name || s).filter(Boolean).join(", ")
      : "",
    source: "jobgether",
    date_posted: isoDate(j.postDate || j.createdAt),
    url:
      j.canonicalUrl ||
      (id ? `https://jobgether.com/offer/${id}` : j.applyUrl || ""),
    description: stripHtml(j.description).slice(0, 20000),
  };
}

function queries() {
  const list = config.searchQueries?.length
    ? config.searchQueries
    : [config.searchQ || "Data Engineer"];
  return list.slice(0, 4);
}

export async function searchJobgetherJobs() {
  const kept = [];
  const seen = new Set();
  const counts = emptySkipCounts();
  let scanned = 0;
  const pageSize = 15;
  const maxPages = 4;

  for (const keyword of queries()) {
    for (let page = 0; page < maxPages; page += 1) {
      const params = new URLSearchParams();
      params.set("keyword", keyword);
      params.set("$limit", String(pageSize));
      params.set("$skip", String(page * pageSize));
      const url = `https://filter-api.jobgether.com/api/offer?${params.toString()}`;
      console.log(`[jobgether] ${url}`);
      const res = await tryGetJson(url, { timeoutMs: 25000 });
      if (!res.ok) {
        console.warn(`[jobgether] HTTP ${res.status} — skipping remaining pages`);
        break;
      }
      const list = Array.isArray(res.json?.data) ? res.json.data : [];
      if (!list.length) break;

      for (const raw of list) {
        const job = mapJob(raw);
        if (!job.id || seen.has(job.id)) continue;
        seen.add(job.id);
        scanned += 1;
        if (keepFeedJob(job, counts)) kept.push(job);
      }

      const total = Number(res.json?.total || 0);
      if ((page + 1) * pageSize >= total) break;
      await sleep(400);
    }
  }

  logKept("jobgether", kept.length, scanned, counts);
  return { jobs: kept };
}
