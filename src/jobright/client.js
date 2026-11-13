/**
 * JobRight Playwright client -- public search via browser.
 * Cloudflare Turnstile blocks curl; we reuse saved storageState and, when
 * challenged, open a headed window once to clear it and persist cookies.
 * No JobRight account login is required.
 */

import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { config } from "../config.js";
import { browserLaunchOptions, contextOptions } from "../browser.js";

const ORIGIN = "https://jobright.ai";
const CHALLENGE_WAIT_MS = 120000;

export function buildPublicSearchUrl(query, { daysAgo = null } = {}) {
  const taxonomy = encodeURIComponent(
    JSON.stringify([{ taxonomyId: "00-00-00", title: query }])
  );
  return (
    `${ORIGIN}/jobs/search?value=${encodeURIComponent(query)}` +
    `&searchType=job_title&country=US&workModel=2` +
    `&jobTaxonomyList=${taxonomy}` +
    (daysAgo ? `&daysAgo=${daysAgo}` : "")
  );
}

export function isChallengeUrl(url) {
  return /\/_jr\/security\/challenge/i.test(String(url || ""));
}

export async function pageLooksChallenged(page) {
  if (isChallengeUrl(page.url())) return true;
  return page.evaluate(() => {
    const html = document.documentElement?.innerHTML || "";
    return (
      /challenge-form|challenges\.cloudflare\.com|cf-turnstile|jrTurnstile/i.test(
        html
      ) && !document.querySelector('script#__NEXT_DATA__')
    );
  });
}

async function readNextDataProps(page) {
  return page.evaluate(() => {
    const el = document.querySelector('script#__NEXT_DATA__');
    if (!el?.textContent) return null;
    try {
      return JSON.parse(el.textContent)?.props?.pageProps || null;
    } catch {
      return null;
    }
  });
}

function buildRecommendBody(query, daysAgo) {
  return {
    searchType: "job_title",
    value: query,
    jobTaxonomyList: [{ taxonomyId: "00-00-00", title: query }],
    country: "US",
    jobTypes: [],
    seniority: [],
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
    refresh: true,
    position: 0,
    sortCondition: 0,
  };
}

async function fetchRecommendInPage(page, query, daysAgo) {
  return page.evaluate(
    async ({ query, daysAgo, body }) => {
      const url =
        `/swan/recommend/search?searchType=job_title` +
        `&refresh=true&count=20&position=0&sortCondition=0`;
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
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return {
        status: res.status,
        ok: res.ok && !!json?.success,
        jobList: json?.result?.jobList || [],
        totalJobs: json?.result?.jobNum ?? null,
        errorMsg: json?.errorMsg || null,
      };
    },
    { query, daysAgo, body: buildRecommendBody(query, daysAgo) }
  );
}

/**
 * @param {import('playwright').Browser} browser
 */
export async function openJobrightContext(browser) {
  const opts = contextOptions();
  if (fs.existsSync(config.jobrightAuthPath)) {
    opts.storageState = config.jobrightAuthPath;
  }
  return browser.newContext(opts);
}

export async function persistStorageState(context) {
  const authPath = config.jobrightAuthPath;
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  await context.storageState({ path: authPath });
  console.log(`[jobright] saved clearance cookies -> ${authPath}`);
}

/**
 * Poll until challenge is gone and search page data is present.
 * @param {import('playwright').Page} page
 */
export async function waitOutChallenge(page, timeoutMs = CHALLENGE_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const challenged = await pageLooksChallenged(page).catch(() => true);
    if (!challenged) {
      const props = await readNextDataProps(page);
      if (props && Array.isArray(props.jobList)) return true;
      // Cleared challenge but still navigating / soft landing.
      if (!isChallengeUrl(page.url()) && /\/jobs/i.test(page.url())) {
        return true;
      }
    }
    await page.waitForTimeout(1500);
  }
  return false;
}

/**
 * Headed one-shot: open JobRight search, wait for Turnstile to clear, save cookies.
 */
export async function refreshClearanceHeaded(seedQuery = "Data Engineer") {
  console.warn(
    `[jobright] Cloudflare challenge -- opening headed browser (solve if needed, up to ${Math.round(CHALLENGE_WAIT_MS / 1000)}s)`
  );
  const browser = await chromium.launch(browserLaunchOptions(false));
  let context;
  try {
    context = await browser.newContext(contextOptions());
    const page = await context.newPage();
    const url = buildPublicSearchUrl(seedQuery, { daysAgo: config.recentDays });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    const cleared = await waitOutChallenge(page);
    if (!cleared) {
      console.warn(`[jobright] challenge wait timed out -- JobRight may stay empty`);
      return false;
    }
    await persistStorageState(context);
    return true;
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/**
 * Visit public search in an existing page; extract jobList from __NEXT_DATA__,
 * falling back to /swan/recommend/search when SSR payload is empty.
 * @param {import('playwright').Page} page
 */
export async function fetchSearchInPage(page, { query, daysAgo = null } = {}) {
  const url = buildPublicSearchUrl(query, { daysAgo });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(800);

  let challenged = await pageLooksChallenged(page);
  if (challenged) {
    const cleared = await waitOutChallenge(page, 20000);
    challenged = !cleared || (await pageLooksChallenged(page));
  }

  if (challenged) {
    return {
      ok: false,
      challenged: true,
      status: 0,
      jobList: [],
      totalJobs: null,
    };
  }

  // Prefer landing on the search URL so __NEXT_DATA__ matches the query.
  if (!/\/jobs\/search/i.test(page.url())) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(800);
  }

  const props = await readNextDataProps(page);
  let jobList = Array.isArray(props?.jobList) ? props.jobList : [];
  let totalJobs = props?.totalJobs ?? null;

  if (!jobList.length) {
    try {
      const api = await fetchRecommendInPage(page, query, daysAgo);
      if (api.ok && api.jobList.length) {
        jobList = api.jobList;
        totalJobs = api.totalJobs;
        return {
          ok: true,
          challenged: false,
          status: api.status,
          jobList,
          totalJobs,
          via: "swan",
        };
      }
      if (!jobList.length && api.errorMsg) {
        console.warn(
          `[jobright] swan fallback query="${query}": ${api.errorMsg}`
        );
      }
    } catch (err) {
      console.warn(`[jobright] swan fallback failed: ${err.message}`);
    }
  }

  return {
    ok: !!props || jobList.length > 0,
    challenged: false,
    status: 200,
    jobList,
    totalJobs,
    via: "ssr",
  };
}
