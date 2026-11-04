/**
 * JobRight content script — extract US-remote data engineering jobs via
 * POST /swan/recommend/search (skip LinkedIn / non-remote / expired).
 *
 * Wrapped in a guarded IIFE: this file is both a manifest content_script AND
 * injected on demand via chrome.scripting.executeScript. Without the guard the
 * second injection redeclares the top-level consts ("Identifier already
 * declared") and adds a duplicate message listener.
 */

(function () {
  // Bump when scrape/API body changes so executeScript can replace a stale
  // injection (old code used workModel: ["Remote"] → HTTP 400).
  const CS_VERSION = 7;
  if (window.__AI_JOBRIGHT_CS_VERSION__ === CS_VERSION) return;
  if (typeof window.__AI_JOBRIGHT_CS_LISTENER__ === "function") {
    try {
      chrome.runtime.onMessage.removeListener(window.__AI_JOBRIGHT_CS_LISTENER__);
    } catch {
      /* ignore */
    }
  }
  window.__AI_JOBRIGHT_CS_VERSION__ = CS_VERSION;
  window.__AI_JOBRIGHT_CS_LOADED__ = true;

const NON_ENG_TITLE_RE =
  /\b(account executive|sales|recruiter|recruiting|sourcer|customer success|marketing|product manager|program manager|project manager|designer|writer|intern(?!al)|teacher|instructor|data entry)\b/i;
const SKIP_NEAR_DE_RE =
  /\b(data[\s-]?scientists?|data[\s-]?analysts?|business[\s-]?analysts?|research[\s-]?scientists?|machine[\s-]?learning[\s-]?engineers?|ml[\s-]?engineers?)\b/i;
const DATA_CENTER_RE = /\bdata[\s-]?cent(?:er|re)s?\b/i;
const DATA_FETCHING_RE = /\bdata[\s-]?fetching\b/i;
const DATA_ENG_RE = new RegExp(
  [
    String.raw`\b(?:big[\s-]?data|analytics|etl|elt)\b.{0,32}\b(?:engineers?|engineering|developers?)\b`,
    String.raw`\b(?:engineers?|engineering|developers?)\b.{0,32}\b(?:big[\s-]?data|analytics|etl|elt)\b`,
    String.raw`\bdata[\s-]+(?:engineers?|engineering|developers?)\b`,
    String.raw`\bdata\b(?![\s-]?cent(?:er|re)).{0,28}\b(?:engineers?|engineering|developers?)\b`,
    String.raw`\b(?:engineers?|engineering|developers?)\b.{0,32}\bdata[\s-]?(?:platform|infrastructure|pipeline|warehouse|ops|migration|integration|engineering)\b`,
    String.raw`\bdata[\s-]?(?:platform|infrastructure|pipeline|warehouse|ops|migration|integration)(?:[\s-]*(?:engineers?|engineering|developers?))?\b`,
    String.raw`\b(?:snowflake|databricks|dbt)[\s-]+(?:engineers?|engineering|developers?)\b`,
    String.raw`\b(?:engineers?|engineering|developers?)\b.{0,24}\b(?:snowflake|databricks|dbt)\b`,
  ].join("|"),
  "i"
);
const US_EXPLICIT_RE =
  /\b(united states|u\.s\.a\.|u\.s\.|\busa\b|\bus\b|america)\b/i;
const NON_US_COUNTRY_RE =
  /\b(united kingdom|england|scotland|wales|\buk\b|europe|european|emea|apac|asia pacific|\basia\b|india|canada|australia|new zealand|germany|france|netherlands|ireland|spain|italy|sweden|norway|denmark|finland|switzerland|austria|belgium|portugal|poland|romania|ukraine|israel|singapore|japan|china|korea|brazil|mexico|argentina|chile|colombia|latam|latin america|philippines|nigeria|pakistan|bangladesh|vietnam|thailand|indonesia|malaysia|uae|dubai|south africa)\b/i;
const US_STATE_COMMA_RE =
  /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/i;
const US_STATE_NAME_RE =
  /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia)\b/i;

function isDataEngTitle(title) {
  const t = String(title || "");
  if (!t.trim()) return false;
  if (NON_ENG_TITLE_RE.test(t)) return false;
  if (DATA_CENTER_RE.test(t) || DATA_FETCHING_RE.test(t)) return false;
  if (SKIP_NEAR_DE_RE.test(t) && !DATA_ENG_RE.test(t)) return false;
  return DATA_ENG_RE.test(t);
}

function isUsEligible(job) {
  const blob = [job?.location, job?.remote_restricted_to, job?.title]
    .map((s) => String(s || ""))
    .join(" ")
    .trim();
  if (!blob) return true;
  if (US_EXPLICIT_RE.test(blob) || US_STATE_COMMA_RE.test(blob) || US_STATE_NAME_RE.test(blob)) {
    return true;
  }
  if (NON_US_COUNTRY_RE.test(blob)) return false;
  return true;
}

function isRemoteArrangement(workArrangement) {
  const w = String(workArrangement || "").toLowerCase().trim();
  if (!w) return true;
  if (/hybrid/.test(w)) return false;
  if (/on[-\s]?site|onsite|in[-\s]?office|in[-\s]?person/.test(w)) return false;
  return /\bremote\b/.test(w);
}

// Only keep jobs posted within this many days (mirror of RECENT_DAYS).
const RECENT_DAYS = 3;

function parsePostedDate(value, now) {
  now = now || new Date();
  if (value == null || value === "") return null;
  if (typeof value === "number" || /^\d+$/.test(String(value).trim())) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = String(Math.trunc(n)).length <= 10 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(value).trim().toLowerCase();
  if (/(^|\b)(just posted|today|moments? ago|minutes? ago|hours? ago|<\s*1\s*day)/.test(s)) {
    return now;
  }
  if (/\byesterday\b/.test(s)) return new Date(now.getTime() - 864e5);
  const rel = s.match(/(\d+)\+?\s*(hour|day|week|month|year)s?\s*ago/);
  if (rel) {
    const unit = { hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 }[rel[2]];
    return new Date(now.getTime() - Number(rel[1]) * unit);
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function isWithinRecentDays(value, days, now) {
  now = now || new Date();
  const d = parsePostedDate(value, now);
  if (!d) return null;
  const age = now.getTime() - d.getTime();
  if (age < 0) return true;
  return age <= days * 864e5;
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

function parseSalary(salaryDesc) {
  const s = String(salaryDesc || "");
  const nums = [...s.matchAll(/\$?\s*([\d.]+)\s*K/gi)].map((m) =>
    Math.round(Number(m[1]) * 1000)
  );
  if (nums.length >= 2) return { min: String(nums[0]), max: String(nums[1]), unit: "YEAR" };
  if (nums.length === 1) return { min: String(nums[0]), max: "", unit: "YEAR" };
  return { min: "", max: "", unit: "" };
}

function mapItem(item, applyLabel) {
  const jr = item?.jobResult || {};
  const company = item?.companyResult || {};
  if (!jr.jobId) return null;
  const salary = parseSalary(jr.salaryDesc);
  const url = (`https://jobright.ai/jobs/info/${jr.jobId}`).split("?")[0];
  const postedAbs =
    parsePostedDate(jr.publishTime) || parsePostedDate(jr.publishTimeDesc);
  const datePosted = postedAbs
    ? postedAbs.toISOString().slice(0, 10)
    : String(jr.publishTime || jr.publishTimeDesc || "");
  const workArrangement =
    jr.workModel || (jr.isRemote === true ? "Remote" : "Onsite");
  return {
    id: `jobright_${jr.jobId}`,
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
    applyLabel,
    jobtargetEasyapply: jr.jobtargetEasyapply === true,
    _applyLink: String(jr.applyLink || jr.originalUrl || ""),
    _isCompanySite: jr.isCompanySiteLink === true,
    _expired: jr.isDeleted === true || jr.hiddenJob === true,
  };
}

function isLinkedinApply(mapped) {
  const link = String(mapped._applyLink || "");
  const url = String(mapped.url || "");
  return /linkedin\.com/i.test(link) || /linkedin\.com/i.test(url);
}

function isTargetJob(mapped) {
  return isDataEngTitle(mapped.title) && isUsEligible(mapped);
}

async function fetchRecommendJobs(query, count = 50) {
  const value = query || "Data Engineer";
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
    daysAgo: RECENT_DAYS,
    refresh: true,
    position: 0,
    sortCondition: 0,
  };
  const url =
    `https://jobright.ai/swan/recommend/search?searchType=job_title` +
    `&refresh=true&count=${count}&position=0&sortCondition=0`;
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
    throw new Error(`recommend/search HTTP ${res.status}`);
  }
  const json = await res.json();
  return {
    list: json?.result?.jobList || [],
    jobNum: json?.result?.jobNum,
    success: !!json?.success,
  };
}

async function ensureSearch(query) {
  const q = query || "Data Engineer";
  if (/value=/i.test(location.href)) return;
  const input = document.querySelector(
    'input[placeholder*="Search" i], input[type="search"]'
  );
  if (!input) return;
  input.focus();
  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.value = q;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
  );
  await new Promise((r) => setTimeout(r, 3500));
}

async function scrapeJobrightJobs(titles) {
  const listTitles =
    Array.isArray(titles) && titles.length
      ? titles
      : ["Data Engineer"];

  const byId = new Map();
  let apiCount = 0;
  let skippedLinkedin = 0;
  let skippedStale = 0;
  let skippedExpired = 0;
  let okQueries = 0;

  for (const query of listTitles) {
    await ensureSearch(query);
    let list = [];
    let success = false;
    try {
      const api = await fetchRecommendJobs(query, 50);
      list = api.list || [];
      success = !!api.success;
      if (success) okQueries += 1;
    } catch (err) {
      console.warn("[jobright-cs] fetch failed", query, err.message);
      continue;
    }
    apiCount += list.length;

    for (const item of list) {
      const mapped = mapItem(item, "");
      if (!mapped) continue;
      if (byId.has(mapped.id)) continue;

      if (mapped._expired) {
        skippedExpired += 1;
        continue;
      }
      if (isLinkedinApply(mapped)) {
        skippedLinkedin += 1;
        continue;
      }
      if (!isRemoteArrangement(mapped.work_arrangement)) continue;
      if (!isTargetJob(mapped)) continue;
      if (isWithinRecentDays(mapped.date_posted, RECENT_DAYS) === false) {
        skippedStale += 1;
        continue;
      }

      delete mapped._applyLink;
      delete mapped._isCompanySite;
      delete mapped._expired;
      byId.set(mapped.id, mapped);
    }
  }

  const kept = Array.from(byId.values());
  if (okQueries === 0 && listTitles.length > 0) {
    return {
      ok: false,
      error:
        "JobRight recommend/search failed for all titles (check login / API body)",
      jobs: [],
      stats: {
        apiCount,
        okQueries,
        titles: listTitles.length,
        kept: 0,
        csVersion: CS_VERSION,
        href: location.href,
      },
    };
  }
  return {
    ok: true,
    jobs: kept,
    stats: {
      apiCount,
      okQueries,
      titles: listTitles.length,
      kept: kept.length,
      skippedLinkedin,
      skippedStale,
      skippedExpired,
      csVersion: CS_VERSION,
      href: location.href,
    },
  };
}

function onScrapeMessage(msg, _sender, sendResponse) {
  if (!msg || (msg.type !== "SCRAPE_JOBRIGHT_V3" && msg.type !== "SCRAPE_JOBRIGHT")) {
    return;
  }
  const titles = Array.isArray(msg.titles)
    ? msg.titles
    : msg.query
    ? [msg.query]
    : null;
  scrapeJobrightJobs(titles)
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ ok: false, error: err.message, jobs: [] }));
  return true;
}

window.__AI_JOBRIGHT_CS_LISTENER__ = onScrapeMessage;
chrome.runtime.onMessage.addListener(onScrapeMessage);
})();
