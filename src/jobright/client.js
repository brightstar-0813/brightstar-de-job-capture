/**
 * JobRight /swan API client — direct HTTP, no browser, extension, or login.
 */

const API_ORIGIN = "https://jobright.ai";
const DEFAULT_HEADERS = {
  accept: "application/json, text/plain, */*",
  "content-type": "application/json",
  "x-client-type": "web",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

/**
 * @param {string} pathWithQuery e.g. `/swan/recommend/search?...`
 * @param {{ method?: string, body?: object, timeoutMs?: number }} opts
 */
export async function jobrightApiFetch(pathWithQuery, opts = {}) {
  const url = pathWithQuery.startsWith("http")
    ? pathWithQuery
    : `${API_ORIGIN}${pathWithQuery}`;

  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: { ...DEFAULT_HEADERS },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 45000),
  });

  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
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
 * POST /swan/recommend/search (no login / cookies).
 */
export async function fetchRecommendSearch({ count, query, daysAgo = null, position = 0 }) {
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
  };
}
