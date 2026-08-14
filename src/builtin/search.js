/**
 * Built In — US-remote data engineering jobs via search + detail scrape.
 */

import { config } from "../config.js";
import {
  isDataEngTitle,
  isRemoteArrangement,
  isUsEligible,
  isWithinRecentDays,
  parsePostedDate,
} from "../filter.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildSearchUrl(page = 1, query = config.searchQ) {
  const params = new URLSearchParams();
  params.set("search", query);
  params.set("daysSinceUpdated", String(config.recentDays));
  if (page > 1) params.set("page", String(page));
  return `https://builtin.com/jobs/remote?${params.toString()}`;
}

async function scrapeListingPage(page) {
  return page.evaluate(() => {
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/job/"]')) {
      const href = (a.href || "").split("?")[0];
      const idMatch = href.match(/\/job\/[^/]+\/(\d+)/);
      if (!idMatch || seen.has(idMatch[1])) continue;
      seen.add(idMatch[1]);
      const title = (a.textContent || "").replace(/\s+/g, " ").trim();
      out.push({ id: idMatch[1], url: href, title });
    }
    return out;
  });
}

async function scrapeDetail(page, stub) {
  await page.goto(stub.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(1500 + config.delayMs);

  const data = await page.evaluate(() => {
    const text = (el) =>
      el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "";
    const h1 = document.querySelector("h1");
    let company = "";
    for (const a of document.querySelectorAll('a[href*="/company/"]')) {
      const t = text(a);
      const href = a.getAttribute("href") || "";
      if (!t || /\/jobs|\/faq/i.test(href) || t.length > 80) continue;
      if (/^jobs$/i.test(t)) continue;
      company = t;
      break;
    }
    const main = document.querySelector("main") || document.body;
    const bodyText = main ? main.innerText || "" : "";
    const remoteBadge =
      /\bhiring remotely\b/i.test(bodyText.slice(0, 2500)) ||
      /\bfully remote\b/i.test(bodyText.slice(0, 2500)) ||
      /(^|\n)\s*remote\s*(\n|$)/i.test(bodyText.slice(0, 1500));
    const hybrid = /\bhybrid\b/i.test(bodyText.slice(0, 2500));
    const onsite = /\bon[-\s]?site\b|\bin[-\s]?office\b/i.test(bodyText.slice(0, 2500));
    let work = "";
    if (hybrid) work = "Hybrid";
    else if (onsite && !remoteBadge) work = "Onsite";
    else if (remoteBadge || /\bremote\b/i.test(bodyText.slice(0, 2500))) work = "Remote";

    const postedMatch = bodyText.match(
      /(?:job\s+)?posted\s+(\d+)\s+days?\s+ago|posted\s+today|just posted|reposted\s+(\d+)\s+days?\s+ago/i
    );
    let datePosted = "";
    if (postedMatch) {
      if (/today|just posted/i.test(postedMatch[0])) datePosted = "today";
      else {
        const days = Number(postedMatch[1] || postedMatch[2] || 0);
        datePosted = `${days} days ago`;
      }
    }

    // Prefer description after the title block — drop nav chrome.
    let description = bodyText;
    const cut = bodyText.search(/\b(about the role|job description|what you.?ll do|responsibilities)\b/i);
    if (cut > 0) description = bodyText.slice(cut);

    return {
      title: text(h1),
      organization: company,
      work_arrangement: work,
      date_posted_raw: datePosted,
      description: description.replace(/\n{3,}/g, "\n\n").trim().slice(0, 20000),
      location: remoteBadge ? "Remote" : "",
    };
  });

  const postedAbs = parsePostedDate(data.date_posted_raw);
  const datePosted = postedAbs
    ? postedAbs.toISOString().slice(0, 10)
    : String(data.date_posted_raw || "");

  return {
    id: `builtin_${stub.id}`,
    title: data.title || stub.title || "",
    organization: data.organization || "",
    location: data.location || "",
    work_arrangement: data.work_arrangement || "Remote",
    remote_restricted_to: "",
    experience_level: "",
    employment_type: "",
    salary_min: "",
    salary_max: "",
    salary_currency: "USD",
    salary_unit: "",
    key_skills: "",
    source: "builtin",
    date_posted: datePosted,
    url: stub.url,
    description: data.description || "",
  };
}

/**
 * @param {import('playwright').Browser} browser
 */
export async function searchBuiltinJobs(browser) {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();
  const stubs = [];
  const seen = new Set();

  try {
    const queries =
      config.searchQueries?.length > 0
        ? config.searchQueries
        : [config.searchQ];

    for (const query of queries) {
      console.log(`[builtin] query="${query}"`);
      for (let p = 1; p <= config.maxPages; p += 1) {
        const url = buildSearchUrl(p, query);
        console.log(`[builtin] page ${p}: ${url}`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await sleep(2500 + config.delayMs);
        const batch = await scrapeListingPage(page);
        console.log(`[builtin] page ${p}: found ${batch.length} links`);
        if (!batch.length) break;
        let added = 0;
        for (const s of batch) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          stubs.push(s);
          added += 1;
        }
        if (added === 0) break;
      }
    }

    const kept = [];
    let nonRemote = 0;
    let nonDe = 0;
    let nonUs = 0;
    let stale = 0;

    for (let i = 0; i < stubs.length; i += 1) {
      const stub = stubs[i];
      console.log(`[builtin] detail ${i + 1}/${stubs.length}: ${stub.id}`);
      try {
        const job = await scrapeDetail(page, stub);
        if (!isRemoteArrangement(job.work_arrangement)) {
          nonRemote += 1;
          continue;
        }
        if (!isUsEligible(job)) {
          nonUs += 1;
          continue;
        }
        if (!isDataEngTitle(job.title, job.description)) {
          nonDe += 1;
          continue;
        }
        if (isWithinRecentDays(job.date_posted, config.recentDays) === false) {
          stale += 1;
          continue;
        }
        kept.push(job);
      } catch (err) {
        console.warn(`[builtin] failed ${stub.id}: ${err.message}`);
      }
      if (config.delayMs) await sleep(config.delayMs);
    }

    console.log(
      `[builtin] kept ${kept.length} US-remote data engineering jobs` +
        ` (stubs=${stubs.length}, non-remote=${nonRemote},` +
        ` non-US=${nonUs}, non-DE=${nonDe}, stale=${stale})`
    );
    return { jobs: kept };
  } finally {
    await context.close();
  }
}
