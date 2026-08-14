/**
 * JobRight.ai data engineering search — keep APPLY WITH AUTOFILL only
 * (skip APPLY NOW / LinkedIn redirects).
 *
 * Jobs load via POST /swan/recommend/search (not __NEXT_DATA__.jobList).
 */

import fs from "fs";
import { config } from "../config.js";
import {
  isDataEngTitle,
  isLinkedinLink,
  isRemoteArrangement,
  isUsEligible,
  parsePostedDate,
  isWithinRecentDays,
} from "../filter.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

function buildDescription(jr) {
  const parts = [];
  if (jr.jobSummary) parts.push(String(jr.jobSummary).trim());
  if (Array.isArray(jr.coreResponsibilities) && jr.coreResponsibilities.length) {
    parts.push("Responsibilities:\n- " + jr.coreResponsibilities.join("\n- "));
  }
  if (Array.isArray(jr.requirements) && jr.requirements.length) {
    parts.push("Requirements:\n- " + jr.requirements.join("\n- "));
  }
  return parts.join("\n\n").trim();
}

function mapApiJob(item) {
  const jr = item?.jobResult || {};
  const company = item?.companyResult || {};
  const id = jr.jobId ? `jobright_${jr.jobId}` : null;
  if (!id) return null;

  const salary = parseSalary(jr.salaryDesc);
  const url = (
    jr.url ||
    `https://jobright.ai/jobs/info/${jr.jobId}`
  ).split("?")[0];

  // Prefer the absolute epoch publishTime; fall back to the relative desc.
  const postedAbs = parsePostedDate(jr.publishTime) || parsePostedDate(jr.publishTimeDesc);
  const datePosted = postedAbs
    ? postedAbs.toISOString().slice(0, 10)
    : String(jr.publishTime || jr.publishTimeDesc || "");

  // Prefer JobRight's workModel; fall back to isRemote. Unknown / non-remote
  // defaults to Onsite so the remote-only filter rejects it.
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
    description: buildDescription(jr),
    _easyApply: jr.jobtargetEasyapply === true,
    _applyLink: String(jr.applyLink || jr.originalUrl || ""),
    _isCompanySite: jr.isCompanySiteLink === true,
    _expired: jr.isDeleted === true || jr.hiddenJob === true,
  };
}

function isTargetJob(mapped) {
  return isDataEngTitle(mapped.title, mapped.description) && isUsEligible(mapped);
}

/**
 * Exclude jobs whose apply/job link points to LinkedIn (redirect applications
 * we don't want). Everything else from the API is accepted.
 */
function isLinkedinApply(mapped) {
  return isLinkedinLink(mapped._applyLink, mapped.url);
}

/**
 * Fetch job list via JobRight's recommend/search API (session cookies).
 * @param {import('playwright').Page} page
 */
async function fetchRecommendJobs(
  page,
  { count, position = 0, refresh = true, query = config.searchQ, daysAgo = null }
) {
  const value = query;
  return page.evaluate(
    async ({ value, count, position, refresh, daysAgo }) => {
      const body = {
        searchType: "job_title",
        value,
        jobTaxonomyList: [{ taxonomyId: "00-00-00", title: value }],
        country: "US",
        jobTypes: [],
        seniority: [],
        // JobRight expects integer enums: 1=Onsite, 2=Remote, 3=Hybrid
        workModel: [2],
        locations: [],
        companies: [],
        isH1BOnly: false,
        companyCategory: null,
        annualSalaryMinimum: null,
        roleType: null,
        companyStages: null,
        skills: [],
        excludedCompanies: [],
        excludedSkills: null,
        excludeStaffingAgency: false,
        minYearsOfExperienceRange: null,
        excludeCompanyCategory: [],
        excludeSecurityClearance: false,
        excludeUsCitizen: false,
        daysAgo: daysAgo || null,
        refresh,
        position,
        sortCondition: 0,
      };
      const url =
        `https://jobright.ai/swan/recommend/search?searchType=job_title` +
        `&refresh=${refresh ? "true" : "false"}&count=${count}` +
        `&position=${position}&sortCondition=0`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/plain, */*",
          "x-client-type": "web",
        },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        return { ok: false, status: res.status, jobList: [] };
      }
      const json = await res.json();
      return {
        ok: !!json?.success,
        status: res.status,
        jobList: json?.result?.jobList || [],
        jobNum: json?.result?.jobNum,
      };
    },
    { value, count, position, refresh, daysAgo }
  );
}

/**
 * Fetch the set of jobs the user has already applied to on JobRight, via
 * POST /swan/job/applied/jobs-v3 (applyStatus:0 covers every applied stage).
 * Returns a Set of store IDs like "jobright_<jobId>".
 * @param {import('playwright').Page} page
 */
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
 * @param {import('playwright').Browser} browser
 */
export async function searchJobrightJobs(browser) {
  const hasAuth = fs.existsSync(config.jobrightAuthPath);
  const contextOptions = {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1400, height: 900 },
  };
  if (hasAuth) {
    contextOptions.storageState = config.jobrightAuthPath;
    console.log(`[jobright] using auth: ${config.jobrightAuthPath}`);
  } else {
    console.warn(
      `[jobright] no auth file at ${config.jobrightAuthPath} — APPLY WITH AUTOFILL may be hidden. Run: npm run jobright:login`
    );
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const all = [];
  const seen = new Set();
  let linkedinSkipped = 0;
  let nonRemoteSkipped = 0;
  let nonDeSkipped = 0;
  let appliedSkipped = 0;
  let staleSkipped = 0;
  let expiredSkipped = 0;
  let apiCount = 0;
  let queryOkCount = 0;
  let appliedIds = new Set();

  const titles =
    config.jobrightTitles && config.jobrightTitles.length
      ? config.jobrightTitles
      : [config.searchQ];
  const perTitle = Math.max(10, Math.min(100, config.pageSize * config.jobrightMaxPages));

  try {
    for (const query of titles) {
      const url = buildJobrightSearchUrl(1, query);
      console.log(`[jobright] query="${query}" open: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3500 + config.delayMs);

      if (appliedIds.size === 0) {
        const applied = await fetchAppliedJobIds(page).catch(() => null);
        if (applied?.ok && applied.ids.length) {
          appliedIds = new Set(applied.ids);
          console.log(`[jobright] already-applied jobs to exclude: ${appliedIds.size}`);
        }
      }

      console.log(
        `[jobright] fetching recommend/search query="${query}" count=${perTitle}`
      );
      const api = await fetchRecommendJobs(page, {
        count: perTitle,
        position: 0,
        refresh: true,
        query,
        daysAgo: config.recentDays,
      });
      const list = Array.isArray(api.jobList) ? api.jobList : [];
      apiCount += list.length;
      if (api.ok) queryOkCount += 1;
      console.log(
        `[jobright] query="${query}" api jobs=${list.length} jobNum=${api.jobNum ?? "?"} ok=${api.ok}`
      );

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
        if (isLinkedinApply(mapped)) {
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

        delete mapped._easyApply;
        delete mapped._applyLink;
        delete mapped._isCompanySite;
        delete mapped._expired;
        all.push(mapped);
      }
    }
  } finally {
    await context.close();
  }

  // Session is considered unauthenticated (login missing/expired) when there
  // was no auth file, or every recommend/search query failed (ok=false). A
  // valid session returns ok=true even when there are zero matching jobs.
  const unauthenticated = !hasAuth || (titles.length > 0 && queryOkCount === 0);

  console.log(
    `[jobright] kept ${all.length} US-remote data engineering jobs` +
      ` (titles=${titles.length}, api=${apiCount}, okQueries=${queryOkCount}/${titles.length},` +
      ` skipped LinkedIn=${linkedinSkipped},` +
      ` skipped non-remote=${nonRemoteSkipped}, skipped non-DE/non-US=${nonDeSkipped},` +
      ` skipped already-applied=${appliedSkipped}, skipped expired=${expiredSkipped},` +
      ` skipped stale(>${config.recentDays}d)=${staleSkipped})`
  );
  if (unauthenticated) {
    console.warn(
      `[jobright] session unauthenticated (login missing or expired) — run: npm run jobright:login`
    );
  }

  return {
    jobs: all,
    appliedIds: Array.from(appliedIds),
    auth: {
      hadAuthFile: hasAuth,
      attempts: titles.length,
      okQueries: queryOkCount,
      unauthenticated,
    },
  };
}
