/**
 * Probe JobRight recommend/search body variants for HTTP 400 cause.
 */
import { chromium } from "playwright";
import { config } from "../src/config.js";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: config.jobrightAuthPath,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
});
const page = await context.newPage();
await page.goto("https://jobright.ai/jobs", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(3000);

const variants = [
  { label: "empty workModel", workModel: [], daysAgo: null },
  { label: 'workModel ["Remote"]', workModel: ["Remote"], daysAgo: null },
  { label: 'workModel ["REMOTE"]', workModel: ["REMOTE"], daysAgo: null },
  { label: 'workModel ["remote"]', workModel: ["remote"], daysAgo: null },
  { label: "daysAgo 3 only", workModel: [], daysAgo: 3 },
  { label: "Remote+daysAgo", workModel: ["Remote"], daysAgo: 3 },
];

const out = await page.evaluate(async (variants) => {
  const results = [];
  for (const v of variants) {
    const body = {
      searchType: "job_title",
      value: "Data Engineer",
      jobTaxonomyList: [
        { taxonomyId: "00-00-00", title: "Data Engineer" },
      ],
      country: "US",
      jobTypes: [],
      seniority: [],
      workModel: v.workModel,
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
      daysAgo: v.daysAgo,
      refresh: true,
      position: 0,
      sortCondition: 0,
    };
    const res = await fetch(
      "https://jobright.ai/swan/recommend/search?searchType=job_title&refresh=true&count=5&position=0&sortCondition=0",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/plain, */*",
          "x-client-type": "web",
        },
        body: JSON.stringify(body),
        credentials: "include",
      }
    );
    let errText = "";
    try {
      const j = await res.json();
      errText = JSON.stringify(j).slice(0, 200);
    } catch {
      errText = await res.text().catch(() => "");
    }
    results.push({
      label: v.label,
      status: res.status,
      ok: res.ok,
      errText,
    });
  }
  return results;
}, variants);

console.log(JSON.stringify(out, null, 2));
await browser.close();
