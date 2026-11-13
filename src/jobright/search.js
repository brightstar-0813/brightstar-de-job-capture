/**
 * JobRight.ai data-engineering search -- remote US roles via Playwright.
 * Uses saved Cloudflare clearance cookies; opens a headed window once when
 * challenged. No JobRight account login. CSV is shared (no already-applied filter).
 */

import { config } from "../config.js";
import {
  isDataEngTitle,
  isUsEligible,
  isRemoteArrangement,
  parsePostedDate,
  isWithinRecentDays,
} from "../filter.js";
import {
  isLinkedinJobUrl,
  pickJobrightJobUrl,
  buildJobrightDescription,
} from "./url.js";
import {
  openJobrightContext,
  fetchSearchInPage,
  refreshClearanceHeaded,
  persistStorageState,
} from "./client.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseSalary(salaryDesc) {
  const s = String(salaryDesc || "");
  const nums = [...s.matchAll(/\$?\s*([\d.]+)\s*K/gi)].map((m) =>
    Math.round(Number(m[1]) * 1000)
  );
  if (nums.length >= 2) {
    return { min: String(nums[0]), max: String(nums[1]), unit: "YEAR" };
  }
  if (nums.length === 1) {
    return { min: String(nums[0]), max: "", unit: "YEAR" };
  }
  return { min: "", max: "", unit: "" };
}

function mapApiJob(item) {
  const jr = item?.jobResult || {};
  const company = item?.companyResult || {};
  const id = jr.jobId ? `jobright_${jr.jobId}` : null;
  if (!id) return null;

  const salary = parseSalary(jr.salaryDesc);
  const applyLink = String(jr.applyLink || jr.originalUrl || "").trim();
  const originalUrl = String(jr.originalUrl || "").trim();
  const redirectsToLinkedin =
    isLinkedinJobUrl(applyLink) || isLinkedinJobUrl(originalUrl);
  const url = pickJobrightJobUrl(jr);

  const postedAbs =
    parsePostedDate(jr.publishTime) || parsePostedDate(jr.publishTimeDesc);
  const datePosted = postedAbs
    ? postedAbs.toISOString().slice(0, 10)
    : String(jr.publishTime || jr.publishTimeDesc || "");

  const workArrangement =
    jr.workModel || (jr.isRemote === true ? "Remote" : "Onsite");

  return {
    id,
    title: jr.jobTitle || jr.jobNlpTitle || "",
    organization: company.companyName || "",
    location: jr.jobLocation || (jr.jobLocations || [])[0] || "",
    work_arrangement: workArrangement,
    remote_restricted_to: "",
    experience_level: jr.jobSeniority || "",
    employment_type: jr.employmentType || "",
    salary_min: salary.min || (jr.minSalary != null ? String(jr.minSalary) : ""),
    salary_max: salary.max || (jr.maxSalary != null ? String(jr.maxSalary) : ""),
    salary_currency: "USD",
    salary_unit: salary.unit || (jr.minSalary || jr.maxSalary ? "YEAR" : ""),
    key_skills: "",
    source: "jobright",
    date_posted: datePosted,
    url,
    description: buildJobrightDescription(jr),
    _applyLink: applyLink,
    _linkedinApply: redirectsToLinkedin,
    _expired: jr.isDeleted === true || jr.hiddenJob === true,
  };
}

function isTargetJob(mapped) {
  return (
    isDataEngTitle(mapped.title, mapped.description) && isUsEligible(mapped)
  );
}

/**
 * @param {import('playwright').Browser} browser
 */
export async function searchJobrightJobs(browser) {
  console.log(`[jobright] Playwright discovery (clearance cookies)`);

  const titles =
    config.jobrightTitles && config.jobrightTitles.length
      ? config.jobrightTitles
      : [config.searchQ];

  let context = await openJobrightContext(browser);
  let page = await context.newPage();
  let refreshed = false;

  const all = [];
  const seen = new Set();
  let nonRemoteSkipped = 0;
  let nonDeSkipped = 0;
  let staleSkipped = 0;
  let expiredSkipped = 0;
  let linkedinSkipped = 0;
  let apiCount = 0;
  let queryOkCount = 0;

  try {
    for (const [i, query] of titles.entries()) {
      if (i > 0 && config.delayMs) await sleep(config.delayMs);

      let api;
      try {
        api = await fetchSearchInPage(page, {
          query,
          daysAgo: config.recentDays,
        });
      } catch (err) {
        console.warn(`[jobright] query="${query}" failed: ${err.message}`);
        continue;
      }

      if (api.challenged && !refreshed) {
        refreshed = true;
        console.warn(`[jobright] blocked on query="${query}" ? refreshing clearance`);
        await context.close().catch(() => {});
        const ok = await refreshClearanceHeaded(query);
        if (!ok) {
          console.warn(`[jobright] could not clear challenge ? skipping remaining seeds`);
          break;
        }
        context = await openJobrightContext(browser);
        page = await context.newPage();
        try {
          api = await fetchSearchInPage(page, {
            query,
            daysAgo: config.recentDays,
          });
        } catch (err) {
          console.warn(`[jobright] retry query="${query}" failed: ${err.message}`);
          continue;
        }
        if (api.challenged) {
          console.warn(
            `[jobright] still challenged after headed refresh ? skipping JobRight`
          );
          break;
        }
      } else if (api.challenged && refreshed) {
        console.warn(
          `[jobright] challenged again after refresh ? stopping JobRight early`
        );
        break;
      }

      const list = api.jobList;
      apiCount += list.length;
      if (api.ok) queryOkCount += 1;
      let newForQuery = 0;

      for (const item of list) {
        const mapped = mapApiJob(item);
        if (!mapped) continue;
        if (seen.has(mapped.id)) continue;
        seen.add(mapped.id);
        newForQuery += 1;

        if (mapped._expired) {
          expiredSkipped += 1;
          continue;
        }
        if (mapped._linkedinApply || /linkedin\.com/i.test(mapped.url || "")) {
          linkedinSkipped += 1;
          continue;
        }
        if (!isRemoteArrangement(mapped.work_arrangement)) {
          nonRemoteSkipped += 1;
          continue;
        }
        if (!isTargetJob(mapped)) {
          nonDeSkipped += 1;
          continue;
        }
        if (isWithinRecentDays(mapped.date_posted, config.recentDays) === false) {
          staleSkipped += 1;
          continue;
        }

        delete mapped._applyLink;
        delete mapped._linkedinApply;
        delete mapped._expired;
        all.push(mapped);
      }

      console.log(
        `[jobright] query="${query}" jobs=${list.length} unseen=${newForQuery}` +
          ` total=${api.totalJobs ?? "?"} ok=${api.ok} via=${api.via || "?"}`
      );
    }

    // Refresh saved state after a successful scrape so cookies stay current.
    if (queryOkCount > 0) {
      await persistStorageState(context).catch(() => {});
    }
  } finally {
    await context.close().catch(() => {});
  }

  console.log(
    `[jobright] kept ${all.length} US-remote data engineering jobs` +
      ` (titles=${titles.length}, api=${apiCount}, okQueries=${queryOkCount}/${titles.length},` +
      ` skipped LinkedIn=${linkedinSkipped},` +
      ` skipped non-remote=${nonRemoteSkipped}, skipped non-DE/non-US=${nonDeSkipped},` +
      ` skipped expired=${expiredSkipped},` +
      ` skipped stale(>${config.recentDays}d)=${staleSkipped})`
  );

  return { jobs: all };
}
