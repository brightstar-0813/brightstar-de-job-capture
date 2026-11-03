/**
 * JobRight.ai data-engineering search — remote US roles via recommend/search API.
 * Discovery needs no login. Optional saved session still excludes already-applied
 * jobs (Playwright + jobright-auth.json).
 */

import fs from "fs";
import { config } from "../config.js";
import { contextOptions } from "../browser.js";
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
import { fetchRecommendSearch } from "./client.js";

export function buildJobrightSearchUrl(page = 1, query = config.searchQ) {
  const taxonomy = encodeURIComponent(
    JSON.stringify([{ taxonomyId: "00-00-00", title: query }])
  );
  const value = encodeURIComponent(query);
  const start = Math.max(0, (page - 1) * config.pageSize);
  return (
    `https://jobright.ai/jobs/search?visit=search&value=${value}` +
    `&searchType=job_title&country=US&jobTaxonomyList=${taxonomy}` +
    `&startPos=${start}`
  );
}

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

async function fetchAppliedJobIds(page) {
  return page.evaluate(async () => {
    const ids = [];
    let cursor = null;
    let ok = true;
    for (let i = 0; i < 20; i += 1) {
      const res = await fetch("https://jobright.ai/swan/job/applied/jobs-v3", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/plain, */*",
          "x-client-type": "web",
        },
        body: JSON.stringify({ cursor, pageSize: 50, applyStatus: 0 }),
        credentials: "include",
      });
      if (!res.ok) {
        ok = false;
        break;
      }
      const json = await res.json().catch(() => null);
      const result = json?.result || {};
      const list = Array.isArray(result.list) ? result.list : [];
      for (const it of list) {
        const jobId = it?.jobResult?.jobId || it?.jobId;
        if (jobId) ids.push(`jobright_${jobId}`);
      }
      if (!result.hasMore || !result.cursor) break;
      cursor = result.cursor;
    }
    return { ok, ids };
  });
}

/**
 * Optional: load already-applied JobRight ids when a saved login exists.
 * @param {import('playwright').Browser} browser
 */
async function loadAppliedIds(browser) {
  const hasAuth = fs.existsSync(config.jobrightAuthPath);
  if (!hasAuth || !browser) {
    return { appliedIds: new Set(), unauthenticated: !hasAuth, hadAuthFile: hasAuth };
  }
  const context = await browser.newContext(
    contextOptions({ storageState: config.jobrightAuthPath })
  );
  const page = await context.newPage();
  try {
    await page.goto("https://jobright.ai/jobs", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(2000);
    const applied = await fetchAppliedJobIds(page).catch(() => null);
    if (applied?.ok) {
      console.log(
        `[jobright] already-applied jobs to exclude: ${applied.ids.length}`
      );
      return {
        appliedIds: new Set(applied.ids),
        unauthenticated: false,
        hadAuthFile: true,
      };
    }
    console.warn(
      `[jobright] session unauthenticated (login missing or expired) — run: npm run jobright:login`
    );
    return { appliedIds: new Set(), unauthenticated: true, hadAuthFile: true };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Fetch remote data-engineering jobs from JobRight API.
 * @param {import('playwright').Browser} [browser] used only for optional applied exclusion
 */
export async function searchJobrightJobs(browser) {
  console.log(`[jobright] API-first discovery (login only for applied exclusion)`);

  const { appliedIds, unauthenticated, hadAuthFile } = await loadAppliedIds(
    browser
  );

  const all = [];
  const seen = new Set();
  let nonRemoteSkipped = 0;
  let nonDeSkipped = 0;
  let appliedSkipped = 0;
  let staleSkipped = 0;
  let expiredSkipped = 0;
  let linkedinSkipped = 0;
  let apiCount = 0;
  let queryOkCount = 0;

  const titles =
    config.jobrightTitles && config.jobrightTitles.length
      ? config.jobrightTitles
      : [config.searchQ];
  const pageSize = 20;
  const pagesPerTitle = Math.max(1, config.jobrightMaxPages);

  for (const query of titles) {
    let titleOk = false;
    for (let page = 0; page < pagesPerTitle; page += 1) {
      const position = page * pageSize;
      console.log(
        `[jobright] API recommend/search query="${query}" page=${page + 1}/${pagesPerTitle} count=${pageSize} position=${position}`
      );
      const api = await fetchRecommendSearch({
        count: pageSize,
        query,
        daysAgo: config.recentDays,
        position,
      });
      const list = Array.isArray(api.jobList) ? api.jobList : [];
      apiCount += list.length;
      if (api.ok) titleOk = true;
      console.log(
        `[jobright] query="${query}" page=${page + 1} api jobs=${list.length} jobNum=${api.jobNum ?? "?"} ok=${api.ok}` +
          (api.errorMsg ? ` err=${api.errorMsg}` : "")
      );
      if (!api.ok || !list.length) break;

      for (const item of list) {
        const mapped = mapApiJob(item);
        if (!mapped) continue;
        if (seen.has(mapped.id)) continue;
        seen.add(mapped.id);

        if (mapped._expired) {
          expiredSkipped += 1;
          continue;
        }
        if (appliedIds.has(mapped.id)) {
          appliedSkipped += 1;
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

      if (list.length < pageSize) break;
    }
    if (titleOk) queryOkCount += 1;
  }

  console.log(
    `[jobright] kept ${all.length} US-remote data engineering jobs` +
      ` (titles=${titles.length}, api=${apiCount}, okQueries=${queryOkCount}/${titles.length},` +
      ` skipped LinkedIn=${linkedinSkipped},` +
      ` skipped non-remote=${nonRemoteSkipped}, skipped non-DE/non-US=${nonDeSkipped},` +
      ` skipped already-applied=${appliedSkipped}, skipped expired=${expiredSkipped},` +
      ` skipped stale(>${config.recentDays}d)=${staleSkipped})`
  );

  return {
    jobs: all,
    appliedIds: Array.from(appliedIds),
    auth: {
      hadAuthFile,
      attempts: titles.length,
      okQueries: queryOkCount,
      unauthenticated: hadAuthFile && unauthenticated,
    },
  };
}
