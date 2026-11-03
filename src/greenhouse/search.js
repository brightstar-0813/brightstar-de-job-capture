/**
 * Greenhouse — public company boards (boards.greenhouse.io/{token}).
 * Polls data-platform / analytics employers. Tune via GREENHOUSE_BOARDS.
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
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`;
  const res = await tryGetJson(url);
  if (!res.ok) return { ok: false, status: res.status, jobs: [] };
  return { ok: true, status: res.status, jobs: res.json?.jobs || [] };
}

/**
 * @param {import('playwright').Browser} [_browser]
 */
export async function searchGreenhouseJobs(_browser) {
  const boards = config.greenhouseBoards || [];
  const all = [];
  const seen = new Set();
  const counts = emptySkipCounts();
  let scanned = 0;
  let boardErrors = 0;
  let boardsWithDe = 0;

  console.log(`[greenhouse] scanning ${boards.length} company boards`);

  await mapPool(boards, 8, async (board) => {
    let result;
    try {
      result = await fetchBoardJobs(board);
    } catch (err) {
      boardErrors += 1;
      console.warn(`[greenhouse] board ${board} failed: ${err.message}`);
      return;
    }
    if (!result.ok) {
      boardErrors += 1;
      if (result.status !== 404 && result.status !== 0) {
        console.warn(`[greenhouse] board ${board} HTTP ${result.status}`);
      }
      return;
    }

    let keptHere = 0;
    for (const j of result.jobs) {
      const id = String(j.id || "");
      if (!id || seen.has(`${board}_${id}`)) continue;
      seen.add(`${board}_${id}`);
      scanned += 1;

      const title = j.title || "";
      const description = j.content || "";
      const location = j.location?.name || "";
      const work = inferWorkArrangement(location, title, description);
      const mapped = atsJob({
        source: "greenhouse",
        board,
        id,
        title,
        organization: companyNameFromSlug(board),
        location,
        work,
        datePosted: isoDate(j.updated_at),
        url: j.absolute_url || `https://boards.greenhouse.io/${board}/jobs/${j.id}`,
        description,
      });
      if (keepFeedJob(mapped, counts, { skipRecency: true })) {
        all.push(mapped);
        keptHere += 1;
      }
    }
    if (keptHere) boardsWithDe += 1;
  });

  logKept("greenhouse", all.length, scanned, counts);
  console.log(
    `[greenhouse] boards=${boards.length} withDeJobs=${boardsWithDe} errors=${boardErrors}`
  );
  return { jobs: all };
}
