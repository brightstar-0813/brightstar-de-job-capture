/**
 * Arc.dev — public remote-job search pages. Listings are embedded as
 * Next.js data (no public API). Each search returns the first page only.
 * https://arc.dev/remote-jobs/data-engineer
 */

import { config } from "../config.js";
import { getText } from "../http.js";
import {
  emptySkipCounts,
  isoDate,
  keepFeedJob,
  logKept,
} from "../feeds/keep.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function searchUrl(query) {
  const slug = String(query || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  return `https://arc.dev/remote-jobs/${encodeURIComponent(slug)}`;
}

function locationOf(countries) {
  const list = (Array.isArray(countries) ? countries : [])
    .map((c) => String(c || "").trim())
    .filter(Boolean);
  if (!list.length) return "";
  if (list.some((c) => c.toUpperCase() === "US")) return "United States";
  return list.join(", ");
}

function mapJob(j) {
  const slug = String(j.urlString || "").trim();
  const key = String(j.randomKey || "").trim();
  if (!slug || !key) return null;
  const categories = Array.isArray(j.categories) ? j.categories : [];
  const skills = categories
    .map((c) => c?.name)
    .filter(Boolean)
    .join(", ");
  const hourly = j.minHourlyRate || j.maxHourlyRate;
  return {
    id: `arc_${key}`,
    title: j.title || "",
    organization: j.company?.name || "",
    location: locationOf(j.requiredCountries),
    work_arrangement: "Remote",
    remote_restricted_to: "",
    experience_level: j.experienceLevel || (j.experienceLevels || []).join(", "),
    employment_type: j.jobType || "",
    salary_min: hourly
      ? String(j.minHourlyRate || "")
      : j.minAnnualSalary != null
        ? String(j.minAnnualSalary)
        : "",
    salary_max: hourly
      ? String(j.maxHourlyRate || "")
      : j.maxAnnualSalary != null
        ? String(j.maxAnnualSalary)
        : "",
    salary_currency: "USD",
    salary_unit: hourly ? "HOUR" : j.minAnnualSalary || j.maxAnnualSalary ? "YEAR" : "",
    key_skills: skills,
    source: "arc",
    date_posted: isoDate(j.postedAt),
    url: `https://arc.dev/remote-jobs/j/${slug}-${key}`,
    description: "",
  };
}

function jobsFromHtml(html) {
  const m = String(html || "").match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!m) return [];
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  const page = data?.props?.pageProps || {};
  return [...(page.arcJobs || []), ...(page.externalJobs || [])];
}

export async function searchArcJobs() {
  const kept = [];
  const seen = new Set();
  const counts = emptySkipCounts();
  let scanned = 0;

  for (let i = 0; i < config.searchQueries.length; i += 1) {
    const query = config.searchQueries[i];
    const url = searchUrl(query);
    console.log(`[arc] ${url}`);
    let html;
    try {
      html = await getText(url);
    } catch (err) {
      console.warn(`[arc] ${query} failed: ${err.message}`);
      continue;
    }
    const batch = jobsFromHtml(html);
    scanned += batch.length;
    for (const raw of batch) {
      const job = mapJob(raw);
      if (!job || seen.has(job.id)) continue;
      seen.add(job.id);
      if (keepFeedJob(job, counts)) kept.push(job);
    }
    if (i < config.searchQueries.length - 1) await sleep(config.delayMs);
  }

  logKept("arc", kept.length, scanned, counts);
  return { jobs: kept };
}
