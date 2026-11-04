/**
 * JobRight /swan API client — direct HTTP via curl + optional saved cookies.
 * Discovery works with a SESSION_ID from jobright-auth.json (no Playwright).
 */

import fs from "fs";
import { config } from "../config.js";
import { curlPostJson, curlRequest } from "../curl.js";

const API_ORIGIN = "https://jobright.ai";

function cookieHeaderFromAuthFile(authPath = config.jobrightAuthPath) {
  if (!authPath || !fs.existsSync(authPath)) return "";
  try {
    const state = JSON.parse(fs.readFileSync(authPath, "utf8"));
    const cookies = Array.isArray(state.cookies) ? state.cookies : [];
    // SESSION_ID alone is enough for recommend/search.
    return cookies
      .filter((c) => {
        const domain = String(c.domain || "").replace(/^\./, "");
        return /jobright\.ai$/i.test(domain) && c.name === "SESSION_ID";
      })
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  } catch {
    return "";
  }
}

export function hasJobrightSessionCookie() {
  const header = cookieHeaderFromAuthFile();
  return /(?:^|;\s*)SESSION_ID=/.test(header);
}

function defaultHeaders(extra = {}) {
  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    "x-client-type": "web",
    origin: "https://jobright.ai",
    referer: "https://jobright.ai/jobs",
    ...extra,
  };
}

function sessionCookies() {
  return cookieHeaderFromAuthFile();
}

/**
 * @param {string} pathWithQuery e.g. `/swan/recommend/search?...`
 * @param {{ method?: string, body?: object, timeoutMs?: number }} opts
 */
export async function jobrightApiFetch(pathWithQuery, opts = {}) {
  const url = pathWithQuery.startsWith("http")
    ? pathWithQuery
    : `${API_ORIGIN}${pathWithQuery}`;

  const cookies = sessionCookies();
  if ((opts.method || "GET").toUpperCase() === "POST") {
    const res = await curlPostJson(url, opts.body ?? {}, {
      timeoutMs: opts.timeoutMs ?? 60000,
      headers: defaultHeaders(),
      cookies,
    });
    return { ok: res.ok, status: res.status, json: res.json };
  }

  const res = await curlRequest(url, {
    method: opts.method || "GET",
    timeoutMs: opts.timeoutMs ?? 60000,
    headers: defaultHeaders(),
    cookies,
  });
  let json = null;
  try {
    json = res.body ? JSON.parse(res.body) : null;
  } catch {
    json = null;
  }
  return { ok: res.status >= 200 && res.status < 300, status: res.status, json };
}

export function buildRecommendSearchBody(query, { daysAgo = null, position = 0 } = {}) {
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
    position,
    sortCondition: 0,
  };
}

/**
 * POST /swan/recommend/search
 */
export async function fetchRecommendSearch({
  count,
  query,
  daysAgo = null,
  position = 0,
}) {
  const path =
    `/swan/recommend/search?searchType=job_title` +
    `&refresh=true&count=${count}&position=${position}&sortCondition=0`;
  const { ok, status, json } = await jobrightApiFetch(path, {
    method: "POST",
    body: buildRecommendSearchBody(query, { daysAgo, position }),
  });
  return {
    ok: ok && !!json?.success,
    status,
    jobList: json?.result?.jobList || [],
    jobNum: json?.result?.jobNum,
    errorMsg: json?.errorMsg || null,
    errorCode: json?.errorCode || null,
  };
}
