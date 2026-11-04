/**
 * JobRight.ai data-engineering search — remote US roles via recommend/search API.
 * Discovery uses curl + SESSION_ID from jobright-auth.json (no Playwright).
 * Does not filter by already-applied — CSV is shared across people.
 */

import fs from "fs";
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
  fetchRecommendSearch,
  hasJobrightSessionCookie,
} from "./client.js";

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

/**
 * Fetch remote data-engineering jobs from JobRight API (curl + cookies).
 */
export async function searchJobrightJobs() {
  console.log(`[jobright] API discovery via curl + saved session cookie`);

  const hadAuthFile = fs.existsSync(config.jobrightAuthPath);
  if (!hasJobrightSessionCookie()) {
    console.warn(
      `[jobright] no SESSION_ID — run: npm run jobright:login`
    );
  }

  const all = [];
  const seen = new Set();
  let nonRemoteSkipped = 0;
  let nonDeSkipped = 0;
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
      ` skipped expired=${expiredSkipped},` +
      ` skipped stale(>${config.recentDays}d)=${staleSkipped})`
  );

  return {
    jobs: all,
    auth: {
      hadAuthFile,
      attempts: titles.length,
      okQueries: queryOkCount,
      // Discovery needs SESSION_ID; surface expired login when all queries fail.
      unauthenticated: queryOkCount === 0 && hadAuthFile,
    },
  };
}
