/**
 * Greenhouse — pull US-remote data engineering jobs from a curated list of
 * public company job boards via boards-api.greenhouse.io (no login required).
 *
 * Greenhouse has no global search: each employer has a board token
 * (boards.greenhouse.io/{token}). Tune via GREENHOUSE_BOARDS.
 */

import { config } from "../config.js";
import {
  isDataEngTitle,
  isRemoteArrangement,
  isUsEligible,
  isWithinRecentDays,
  parsePostedDate,
} from "../filter.js";

function stripHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inferWorkArrangement(location, title, description) {
  const loc = String(location || "");
  const blob = `${loc} ${title} ${String(description || "").slice(0, 3000)}`;
  if (/hybrid/i.test(loc) && !/\bremote\b/i.test(loc)) return "Hybrid";
  if (/on[-\s]?site|in[-\s]?office|in[-\s]?person/i.test(loc) && !/\bremote\b/i.test(loc)) {
    return "Onsite";
  }
  if (/\bremote\b/i.test(blob) || /\bwork from home\b/i.test(blob)) return "Remote";
  // Many Greenhouse "Remote US" style locations
  if (/^remote\b/i.test(loc.trim())) return "Remote";
  return "Onsite";
}

async function fetchBoardJobs(board) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    return { ok: false, status: res.status, jobs: [] };
  }
  const json = await res.json();
  return { ok: true, status: res.status, jobs: json.jobs || [] };
}

/**
 * Browser arg unused — kept for a uniform capture interface.
 * @param {import('playwright').Browser} [_browser]
 */
export async function searchGreenhouseJobs(_browser) {
  const boards = config.greenhouseBoards || [];
  const all = [];
  const seen = new Set();
  let nonRemoteSkipped = 0;
  let nonDeSkipped = 0;
  let nonUsSkipped = 0;
  let staleSkipped = 0;
  let boardErrors = 0;

  console.log(`[greenhouse] scanning ${boards.length} boards`);

  for (const board of boards) {
    let result;
    try {
      result = await fetchBoardJobs(board);
    } catch (err) {
      boardErrors += 1;
      console.warn(`[greenhouse] board ${board} failed: ${err.message}`);
      continue;
    }
    if (!result.ok) {
      boardErrors += 1;
      if (result.status !== 404) {
        console.warn(`[greenhouse] board ${board} HTTP ${result.status}`);
      }
      continue;
    }

    for (const j of result.jobs) {
      const id = `greenhouse_${board}_${j.id}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const title = j.title || "";
      const organization = board; // board token ≈ employer slug; refine below
      const description = stripHtml(j.content);
      const location = j.location?.name || "";
      const work = inferWorkArrangement(location, title, description);
      const postedAbs = parsePostedDate(j.updated_at);
      const datePosted = postedAbs
        ? postedAbs.toISOString().slice(0, 10)
        : String(j.updated_at || "");

      // Prefer company name from absolute_url host path; organization from board.
      const companyName = String(board)
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      const mapped = {
        id,
        title,
        organization: companyName,
        location,
        work_arrangement: work,
        remote_restricted_to: "",
        experience_level: "",
        employment_type: "",
        salary_min: "",
        salary_max: "",
        salary_currency: "USD",
        salary_unit: "",
        key_skills: "",
        source: "greenhouse",
        date_posted: datePosted,
        url: j.absolute_url || `https://boards.greenhouse.io/${board}/jobs/${j.id}`,
        description,
      };

      if (!isRemoteArrangement(mapped.work_arrangement)) {
        nonRemoteSkipped += 1;
        continue;
      }
      if (!isUsEligible(mapped)) {
        nonUsSkipped += 1;
        continue;
      }
      if (!isDataEngTitle(mapped.title, mapped.description)) {
        nonDeSkipped += 1;
        continue;
      }
      if (isWithinRecentDays(mapped.date_posted, config.recentDays) === false) {
        staleSkipped += 1;
        continue;
      }
      all.push(mapped);
    }
  }

  console.log(
    `[greenhouse] kept ${all.length} US-remote data engineering jobs` +
      ` (boards=${boards.length}, boardErrors=${boardErrors},` +
      ` non-remote=${nonRemoteSkipped},` +
      ` non-US=${nonUsSkipped},` +
      ` non-DE=${nonDeSkipped}, stale=${staleSkipped})`
  );

  return { jobs: all };
}
