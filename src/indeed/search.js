/**
 * Indeed — remote data-engineering jobs posted within RECENT_DAYS.
 * Cloudflare blocks stock headless Chromium; reuse the Chrome profile from
 * `npm run indeed:login` and read mosaic job cards from the search page.
 */

import fs from "fs";
import { chromium } from "playwright";
import { config } from "../config.js";
import { browserLaunchOptions, contextOptions } from "../browser.js";
import {
  containsDataEng,
  isBlockedEmployer,
  isRemoteArrangement,
  isUsFriendlyLocation,
  isWithinRecentDays,
  isExpiredPosting,
  looksDataEngTitle,
  parsePostedDate,
} from "../filter.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fromageDays(days) {
  const d = Math.max(1, Number(days) || 7);
  if (d <= 1) return "1";
  if (d <= 3) return "3";
  if (d <= 7) return "7";
  return "14";
}

function buildSearchUrl(q, start = 0) {
  const params = new URLSearchParams();
  params.set("q", q);
  params.set("l", "Remote");
  params.set("fromage", fromageDays(config.recentDays));
  params.set("sort", "date");
  if (start > 0) params.set("start", String(start));
  return `https://www.indeed.com/jobs?${params.toString()}`;
}

function looksBlocked(title, snippet) {
  const t = `${title}\n${snippet}`;
  return /just a moment|additional verification required|unusual traffic|verify you are (a )?human|cf-browser-verification|attention required/i.test(
    t
  );
}

function profileReady() {
  try {
    return (
      fs.existsSync(config.indeedProfileDir) &&
      fs.readdirSync(config.indeedProfileDir).length > 0
    );
  } catch {
    return false;
  }
}

/**
 * @param {Record<string, unknown>} opts
 */
async function launchPersistent(opts) {
  try {
    return await chromium.launchPersistentContext(config.indeedProfileDir, {
      ...opts,
      channel: "chrome",
    });
  } catch {
    return chromium.launchPersistentContext(config.indeedProfileDir, opts);
  }
}

function mapCard(card) {
  const jk = String(card.jobkey || "").trim();
  if (!jk) return null;
  const postedAbs = parsePostedDate(card.pubDate);
  const loc = String(card.location || "Remote");
  const remote = card.remote === true || /\bremote\b/i.test(loc);
  const href = String(card.href || "").trim();
  const url = href
    ? href.startsWith("http")
      ? href.split("&from=")[0]
      : `https://www.indeed.com${href.split("&from=")[0]}`
    : `https://www.indeed.com/viewjob?jk=${jk}`;
  return {
    id: `indeed_${jk}`,
    title: String(card.title || "").trim(),
    organization: String(card.company || "").trim(),
    location: loc || "Remote",
    work_arrangement: remote ? "Remote" : "",
    remote_restricted_to: "",
    experience_level: "",
    employment_type: "",
    salary_min: "",
    salary_max: "",
    salary_currency: "USD",
    salary_unit: "",
    key_skills: "",
    source: "indeed",
    date_posted: postedAbs
      ? postedAbs.toISOString().slice(0, 10)
      : String(card.pubDate || ""),
    url,
    description: String(card.snippet || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    expired: card.expired === true,
  };
}

function keepJob(job) {
  if (!job?.id || job.expired) return false;
  if (isExpiredPosting(`${job.title}\n${job.description}`)) return false;
  if (isBlockedEmployer(job.organization)) return false;
  if (!isRemoteArrangement(job.work_arrangement)) return false;
  if (!isUsFriendlyLocation(job.location, job.title)) return false;
  if (!containsDataEng(job.title, job.description)) return false;
  if (isWithinRecentDays(job.date_posted, config.recentDays) === false) {
    return false;
  }
  return true;
}

async function extractCards(page) {
  return page.evaluate(() => {
    const cards = [];
    const seen = new Set();

    const walk = (node) => {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node !== "object") return;
      const key = node.jobkey || node.jobKey || node.jk;
      const title = node.title || node.displayTitle || node.jobTitle;
      if (key && title) {
        const id = String(key);
        if (!seen.has(id)) {
          seen.add(id);
          const loc = String(
            node.formattedLocation ||
              node.jobLocationCity ||
              node.location ||
              ""
          );
          cards.push({
            jobkey: id,
            title: String(title),
            company: String(
              node.company ||
                node.companyName ||
                node.companyDisplayName ||
                ""
            ),
            location: loc,
            snippet: String(
              node.snippet || node.excerpt || node.jobSnippet || ""
            ),
            pubDate:
              node.pubDate ||
              node.formattedRelativeTime ||
              node.date ||
              "",
            remote: !!(
              node.remoteLocation ||
              node.remoteWorkModel ||
              /remote/i.test(loc)
            ),
            expired: node.expired === true || node.jobExpired === true,
            href: node.viewJobLink || node.link || node.url || "",
          });
        }
        return;
      }
      for (const v of Object.values(node)) walk(v);
    };

    try {
      if (window.mosaic && window.mosaic.providerData) {
        walk(window.mosaic.providerData);
      }
    } catch {
      /* ignore */
    }

    for (const s of document.querySelectorAll("script")) {
      const t = s.textContent || "";
      if (!/"jobkey"/.test(t) && !/mosaic-provider-jobcards/.test(t)) continue;
      const trimmed = t.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          walk(JSON.parse(trimmed));
        } catch {
          /* ignore */
        }
      }
      const assigned = t.match(
        /mosaic\.providerData\s*=\s*(\{[\s\S]*\});?\s*$/
      );
      if (assigned) {
        try {
          walk(JSON.parse(assigned[1]));
        } catch {
          /* ignore */
        }
      }
    }

    if (!cards.length) {
      for (const a of document.querySelectorAll(
        'a[href*="/viewjob?jk="], a.jcs-JobTitle'
      )) {
        const href = (a.href || "").split("#")[0];
        const jk = (href.match(/[?&]jk=([a-z0-9]+)/i) || [])[1];
        if (!jk || seen.has(jk)) continue;
        seen.add(jk);
        cards.push({
          jobkey: jk,
          title: (a.textContent || "").replace(/\s+/g, " ").trim(),
          company: "",
          location: "Remote",
          snippet: "",
          pubDate: "",
          remote: true,
          expired: false,
          href,
        });
      }
    }

    return cards;
  });
}

/**
 * @param {import('playwright').Browser} browser
 */
export async function searchIndeedJobs(browser) {
  const headed = config.indeedHeaded === true;
  const useProfile = profileReady();
  const hasAuth = fs.existsSync(config.indeedAuthPath);
  let ownContext = null;
  let context;
  const kept = [];
  const seen = new Set();
  // All SEARCH_QUERIES (same list as Dice) — first query deep-pages, rest shallower.
  const queries =
    config.searchQueries?.length > 0
      ? config.searchQueries
      : [config.searchQ];

  try {
    if (useProfile) {
      console.log(`[indeed] using Chrome profile: ${config.indeedProfileDir}`);
      ownContext = await launchPersistent({
        ...browserLaunchOptions(headed ? false : config.headless),
        ...contextOptions(),
        headless: headed ? false : config.headless,
      });
      context = ownContext;
    } else {
      const extra = hasAuth ? { storageState: config.indeedAuthPath } : {};
      if (hasAuth) {
        console.log(`[indeed] using cookies: ${config.indeedAuthPath}`);
      } else {
        console.warn(
          `[indeed] no saved session — Cloudflare will likely block. Run: npm run indeed:login`
        );
      }
      context = await browser.newContext(contextOptions(extra));
    }

    const page = context.pages()[0] || (await context.newPage());

    for (let qi = 0; qi < queries.length; qi += 1) {
      const q = queries[qi];
      const pages =
        qi === 0
          ? Math.max(1, Math.min(config.maxPages || 8, 12))
          : Math.max(1, Math.min(config.searchExtraPages || 3, 5));
      for (let p = 0; p < pages; p += 1) {
        const url = buildSearchUrl(q, p * 10);
        console.log(`[indeed] q="${q}" page ${p + 1}/${pages}: ${url}`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await sleep(4000 + config.delayMs);
        try {
          await page.waitForSelector(
            'a[href*="/viewjob?jk="], a.jcs-JobTitle, [data-jk]',
            { timeout: 15000 }
          );
        } catch {
          /* mosaic JSON may still be present */
        }

        const title = await page.title();
        const snippet = await page.evaluate(() =>
          (document.body?.innerText || "").slice(0, 800)
        );
        if (looksBlocked(title, snippet)) {
          console.warn(
            `[indeed] Cloudflare challenge — run: npm run indeed:login`
          );
          return { jobs: kept, blocked: true };
        }

        const cards = await extractCards(page);
        console.log(`[indeed] q="${q}" page ${p + 1}: cards=${cards.length}`);
        if (!cards.length) break;

        let newOnPage = 0;
        for (const card of cards) {
          const job = mapCard(card);
          if (!job || seen.has(job.id)) continue;
          seen.add(job.id);
          if (job.title && !looksDataEngTitle(job.title)) continue;
          if (!keepJob(job)) continue;
          kept.push(job);
          newOnPage += 1;
        }
        if (newOnPage === 0 && p > 0) break;
      }
    }

    console.log(`[indeed] kept ${kept.length} remote data-engineering jobs`);
    return { jobs: kept, blocked: false };
  } finally {
    if (ownContext) await ownContext.close().catch(() => {});
    else if (context) await context.close().catch(() => {});
  }
}
