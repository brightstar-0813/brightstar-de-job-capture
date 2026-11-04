/**
 * Dice — public job-search API (no browser).
 * Uses Dice's web client API key via curl (Node fetch is API-gateway blocked).
 */

import { config } from "../config.js";
import { curlGetJson } from "../curl.js";
import {
  emptySkipCounts,
  isoDate,
  keepFeedJob,
  logKept,
} from "../feeds/keep.js";

/** Public web client key embedded in dice.com (rotated rarely). */
const DICE_API_KEY =
  process.env.DICE_API_KEY || "1YAt0R9wBg4WfsF9VB2778F5CHLAPMVW3WAZcKd8";

const DICE_API =
  "https://job-search-api.svc.dhigroupinc.com/v1/dice/jobs/search";

/**
 * Map a recency window (days) to Dice's coarse postedDate token.
 */
export function postedDateToken(days) {
  const d = Math.max(1, Number(days) || 3);
  if (d <= 1) return "ONE";
  if (d <= 3) return "THREE";
  if (d <= 7) return "SEVEN";
  return "THIRTY";
}

export function buildSearchUrl(page = 1, query = config.searchQ) {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("countryCode", "US");
  params.set("radius", "30");
  params.set("radiusUnit", "mi");
  params.set("page", String(page));
  params.set("pageSize", String(config.pageSize));
  params.set("language", "en");
  params.set("filters.postedDate", postedDateToken(config.recentDays));
  params.set("filters.workplaceTypes", "Remote");
  return `https://www.dice.com/jobs?${params.toString()}`;
}

export function extractJobIdFromUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw, "https://www.dice.com");
    const parts = u.pathname.split("/").filter(Boolean);
    const detailIdx = parts.findIndex(
      (p) => p === "job-detail" || p === "detail"
    );
    if (detailIdx >= 0 && parts[detailIdx + 1]) {
      if (parts[detailIdx] === "job-detail" && parts[detailIdx + 2]) {
        return parts[detailIdx + 2];
      }
      return parts[detailIdx + 1];
    }
    const qid = u.searchParams.get("jobId") || u.searchParams.get("id");
    return qid || null;
  } catch {
    return null;
  }
}

export function normalizeJobUrl(url) {
  try {
    const u = new URL(String(url), "https://www.dice.com");
    u.hash = "";
    return u.toString();
  } catch {
    return String(url || "");
  }
}

function queries() {
  return config.searchQueries?.length
    ? config.searchQueries
    : [config.searchQ || "Data Engineer"];
}

function workArrangement(row) {
  const types = Array.isArray(row.workplaceTypes)
    ? row.workplaceTypes.map((t) => String(t))
    : [];
  if (types.some((t) => /hybrid/i.test(t))) return "Hybrid";
  if (types.some((t) => /on[-\s]?site|onsite/i.test(t)) && !row.isRemote) {
    return "Onsite";
  }
  if (row.isRemote === true || types.some((t) => /remote/i.test(t))) {
    // Pure remote only when no hybrid/onsite also listed.
    if (types.some((t) => /hybrid|on[-\s]?site|onsite/i.test(t))) {
      return types.join(", ");
    }
    return "Remote";
  }
  return types.join(", ") || "";
}

function mapApiJob(row) {
  const url = normalizeJobUrl(row.detailsPageUrl || "");
  const id = extractJobIdFromUrl(url) || row.jobId || row.id;
  if (!id) return null;
  return {
    id: String(id),
    title: row.title || "",
    organization: row.companyName || "",
    location: row.jobLocation?.displayName || "",
    work_arrangement: workArrangement(row),
    remote_restricted_to: "",
    experience_level: "",
    employment_type: Array.isArray(row.employmentType)
      ? row.employmentType.join(", ")
      : row.employmentType || "",
    salary_min: "",
    salary_max: "",
    salary_currency: "USD",
    salary_unit: "",
    key_skills: "",
    source: "dice",
    date_posted: isoDate(row.postedDate || row.modifiedDate),
    url,
    description: String(row.summary || "").slice(0, 20000),
  };
}

function buildApiUrl(page, query) {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("countryCode2", "US");
  params.set("radius", "30");
  params.set("radiusUnit", "mi");
  params.set("page", String(page));
  params.set("pageSize", String(config.pageSize));
  params.set("filters.postedDate", postedDateToken(config.recentDays));
  params.set("filters.workplaceTypes", "Remote");
  params.set("culture", "en");
  params.set("language", "en");
  params.set("includeRemote", "true");
  params.set(
    "facets",
    "employmentType|postedDate|workFromHomeAvailability|employerType|easyApply|isRemote|workplaceTypes"
  );
  params.set(
    "fields",
    "id|jobId|summary|title|postedDate|modifiedDate|jobLocation.displayName|detailsPageUrl|salary|companyName|employmentType|workFromHomeAvailability|isRemote|workplaceTypes|companyPageUrl|employerType|easyApply"
  );
  return `${DICE_API}?${params.toString()}`;
}

/**
 * Fetch remote US data-engineering jobs from Dice's public search API.
 */
export async function searchDiceJobs() {
  console.log(`[dice] API discovery via job-search-api (curl)`);

  const kept = [];
  const seen = new Set();
  const counts = emptySkipCounts();
  let scanned = 0;

  for (const query of queries()) {
    console.log(`[dice] query="${query}"`);
    for (let page = 1; page <= config.maxPages; page += 1) {
      const url = buildApiUrl(page, query);
      console.log(`[dice] page ${page}: api search`);
      let json;
      try {
        json = await curlGetJson(url, {
          timeoutMs: 45000,
          headers: {
            accept: "application/json, text/plain, */*",
            origin: "https://www.dice.com",
            referer: "https://www.dice.com/",
            "x-api-key": DICE_API_KEY,
          },
        });
      } catch (err) {
        console.warn(`[dice] query "${query}" page ${page} failed: ${err.message}`);
        break;
      }
      const list = Array.isArray(json?.data) ? json.data : [];
      console.log(`[dice] page ${page}: api jobs=${list.length}`);
      if (!list.length) break;

      let newOnPage = 0;
      for (const row of list) {
        const job = mapApiJob(row);
        if (!job?.id || seen.has(job.id)) continue;
        seen.add(job.id);
        scanned += 1;
        if (keepFeedJob(job, counts)) {
          kept.push(job);
          newOnPage += 1;
        }
      }
      if (list.length < config.pageSize || newOnPage === 0) break;
    }
  }

  logKept("dice", kept.length, scanned, counts);
  return { jobs: kept };
}
