/**
 * Ashby — public job-board API (jobs.ashbyhq.com/{token}).
 * Polls employers that commonly hire data engineers. Tune via ASHBY_BOARDS.
 */

import { config } from "../config.js";
import { tryGetJson } from "../http.js";
import { isoDate, keepFeedJob, emptySkipCounts, logKept } from "../feeds/keep.js";
import {
  atsJob,
  companyNameFromSlug,
  inferWorkArrangement,
  mapPool,
} from "../ats/map.js";

async function fetchBoardJobs(board) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}`;
  const res = await tryGetJson(url);
  if (!res.ok) return { ok: false, status: res.status, jobs: [] };
  return { ok: true, status: res.status, jobs: res.json?.jobs || [] };
}

export async function searchAshbyJobs() {
  const boards = config.ashbyBoards || [];
  const all = [];
  const seen = new Set();
  const counts = emptySkipCounts();
  let scanned = 0;
  let boardErrors = 0;
  let boardsWithDe = 0;

  console.log(`[ashby] scanning ${boards.length} company boards`);

  await mapPool(boards, 8, async (board) => {
    let result;
    try {
      result = await fetchBoardJobs(board);
    } catch (err) {
      boardErrors += 1;
      console.warn(`[ashby] board ${board} failed: ${err.message}`);
      return;
    }
    if (!result.ok) {
      boardErrors += 1;
      if (result.status !== 404 && result.status !== 0) {
        console.warn(`[ashby] board ${board} HTTP ${result.status}`);
      }
      return;
    }

    let keptHere = 0;
    for (const j of result.jobs) {
      const id = String(j.id || j.jobId || "");
      if (!id || seen.has(`${board}_${id}`)) continue;
      seen.add(`${board}_${id}`);
      scanned += 1;

      const title = j.title || "";
      const description = j.descriptionHtml || j.descriptionPlain || "";
      const location = j.locationName || j.location || "";
      const work = inferWorkArrangement(
        location,
        title,
        description,
        j.workplaceType || j.employmentType || ""
      );
      const mapped = atsJob({
        source: "ashby",
        board,
        id,
        title,
        organization: companyNameFromSlug(board),
        location,
        work,
        datePosted: isoDate(j.publishedDate || j.publishedAt || j.updatedAt),
        url:
          j.jobUrl ||
          j.applyUrl ||
          `https://jobs.ashbyhq.com/${board}/job/${id}`,
        description,
      });
      if (keepFeedJob(mapped, counts, { skipRecency: true })) {
        all.push(mapped);
        keptHere += 1;
      }
    }
    if (keptHere) boardsWithDe += 1;
  });

  logKept("ashby", all.length, scanned, counts);
  console.log(
    `[ashby] boards=${boards.length} withDeJobs=${boardsWithDe} errors=${boardErrors}`
  );
  return { jobs: all };
}
