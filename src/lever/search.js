/**
 * Lever — public company postings (jobs.lever.co/{token}).
 * Polls employers that commonly hire data engineers. Tune via LEVER_BOARDS.
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
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`;
  const res = await tryGetJson(url);
  if (!res.ok) return { ok: false, status: res.status, jobs: [] };
  return {
    ok: true,
    status: res.status,
    jobs: Array.isArray(res.json) ? res.json : [],
  };
}

export async function searchLeverJobs() {
  const boards = config.leverBoards || [];
  const all = [];
  const seen = new Set();
  const counts = emptySkipCounts();
  let scanned = 0;
  let boardErrors = 0;
  let boardsWithDe = 0;

  console.log(`[lever] scanning ${boards.length} company boards`);

  await mapPool(boards, 8, async (board) => {
    let result;
    try {
      result = await fetchBoardJobs(board);
    } catch (err) {
      boardErrors += 1;
      console.warn(`[lever] board ${board} failed: ${err.message}`);
      return;
    }
    if (!result.ok) {
      boardErrors += 1;
      if (result.status !== 404 && result.status !== 0) {
        console.warn(`[lever] board ${board} HTTP ${result.status}`);
      }
      return;
    }

    let keptHere = 0;
    for (const j of result.jobs) {
      const id = String(j.id || "");
      if (!id || seen.has(`${board}_${id}`)) continue;
      seen.add(`${board}_${id}`);
      scanned += 1;

      const title = j.text || j.title || "";
      const description = j.descriptionPlain || j.description || "";
      const location = j.categories?.location || "";
      const work = inferWorkArrangement(
        location,
        title,
        description,
        j.workplaceType || ""
      );
      const mapped = atsJob({
        source: "lever",
        board,
        id,
        title,
        organization: companyNameFromSlug(board),
        location,
        work,
        datePosted: isoDate(j.createdAt),
        url: j.hostedUrl || j.applyUrl || `https://jobs.lever.co/${board}`,
        description,
      });
      if (keepFeedJob(mapped, counts, { skipRecency: true })) {
        all.push(mapped);
        keptHere += 1;
      }
    }
    if (keptHere) boardsWithDe += 1;
  });

  logKept("lever", all.length, scanned, counts);
  console.log(
    `[lever] boards=${boards.length} withDeJobs=${boardsWithDe} errors=${boardErrors}`
  );
  return { jobs: all };
}
