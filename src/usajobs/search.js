/**
 * USAJOBS federal job search API (Applyre "Top 200" — General Job Search).
 * Free key: https://developer.usajobs.gov/APIRequest/Index
 * Requires USAJOBS_API_KEY + USAJOBS_USER_EMAIL (used in User-Agent).
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

const BASE = "https://data.usajobs.gov/api/search";

function mapJob(item) {
  const d = item?.MatchedObjectDescriptor || {};
  const details = d.UserArea?.Details || {};
  const rem = d.PositionRemuneration?.[0] || {};
  const url =
    (Array.isArray(d.ApplyURI) && d.ApplyURI[0]) || d.PositionURI || "";
  const desc = [
    details.JobSummary,
    details.MajorDuties,
    d.QualificationSummary,
  ]
    .filter(Boolean)
    .join("\n\n");
  const remote =
    details.TeleworkEligible === true ||
    /telework|remote work|work from home/i.test(desc);
  return {
    id: `usajobs_${item?.MatchedObjectId || d.PositionID || ""}`.replace(
      /[^\w-]+/g,
      "_"
    ),
    title: d.PositionTitle || "",
    organization: d.DepartmentName || d.OrganizationName || "",
    location: d.PositionLocationDisplay || "",
    work_arrangement: remote ? "Remote" : "",
    remote_restricted_to: "",
    experience_level: "",
    employment_type: d.PositionSchedule?.[0]?.Name || "",
    salary_min: rem.MinimumRange || "",
    salary_max: rem.MaximumRange || "",
    salary_currency: "USD",
    salary_unit: rem.Description || "",
    key_skills: (d.JobCategory || []).map((c) => c.Name).join(", "),
    source: "usajobs",
    date_posted: isoDate(d.PublicationStartDate),
    url,
    description: stripHtml(desc).slice(0, 20000),
  };
}

export async function searchUsajobsJobs() {
  const key = String(config.usajobsApiKey || "").trim();
  const email = String(config.usajobsUserEmail || "").trim();
  if (!key || !email) {
    console.log(
      "[usajobs] skipped — set USAJOBS_API_KEY and USAJOBS_USER_EMAIL (free at developer.usajobs.gov)"
    );
    return { jobs: [] };
  }

  const params = new URLSearchParams();
  params.set("Keyword", config.searchQ || "Data Engineer");
  params.set("RemoteIndicator", "True");
  params.set("DatePosted", String(Math.min(60, config.recentDays || 7)));
  params.set("ResultsPerPage", "50");
  params.set("Page", "1");
  params.set("Fields", "Full");
  params.set("HiringPath", "public");

  const url = `${BASE}?${params.toString()}`;
  console.log(`[usajobs] remote Keyword=${params.get("Keyword")}`);

  const res = await tryGetJson(url, {
    timeoutMs: 30000,
    headers: {
      "Authorization-Key": key,
      "User-Agent": email,
      Host: "data.usajobs.gov",
    },
  });
  if (!res.ok) {
    console.warn(`[usajobs] HTTP ${res.status}`);
    return { jobs: [] };
  }

  const list = res.json?.SearchResult?.SearchResultItems || [];
  const kept = [];
  const seen = new Set();
  const counts = emptySkipCounts();

  for (const raw of list) {
    const job = mapJob(raw);
    if (!job.id || seen.has(job.id)) continue;
    seen.add(job.id);
    if (keepFeedJob(job, counts, { skipRecency: true })) kept.push(job);
  }

  logKept("usajobs", kept.length, list.length, counts);
  return { jobs: kept };
}
