/**
 * CareerBuilder — best-effort remote data-engineering scrape.
 * Often empty or bot-blocked in headless; skip cleanly then.
 * Searches SEARCH_QUERIES (capped) for broader DE-family coverage.
 */

import { config } from "../config.js";
import { contextOptions } from "../browser.js";
import {
  containsDataEng,
  isBlockedEmployer,
  isRemoteArrangement,
  isWithinRecentDays,
  isExpiredPosting,
  looksDataEngTitle,
  parsePostedDate,
} from "../filter.js";

const MAX_QUERIES = 8;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function postedParam(days) {
  const d = Math.max(1, Number(days) || 7);
  if (d <= 1) return "1";
  if (d <= 3) return "3";
  if (d <= 7) return "7";
  return "30";
}

function buildSearchUrl(q) {
  const params = new URLSearchParams();
  params.set("keywords", q);
  params.set("location", "Remote");
  params.set("posted", postedParam(config.recentDays));
  return `https://www.careerbuilder.com/jobs?${params.toString()}`;
}

function looksBlocked(title, snippet) {
  const t = `${title}\n${snippet}`;
  return /just a moment|unusual traffic|verify you are|access denied|captcha/i.test(
    t
  );
}

/**
 * @param {import('playwright').Browser} browser
 */
export async function searchCareerbuilderJobs(browser) {
  const context = await browser.newContext(contextOptions());
  const page = await context.newPage();
  const kept = [];
  const seen = new Set();
  const queries = (config.searchQueries || [config.searchQ]).slice(0, MAX_QUERIES);

  try {
    for (const q of queries) {
      const url = buildSearchUrl(q);
      console.log(`[careerbuilder] search: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(5000 + config.delayMs);

      const title = await page.title();
      const snippet = await page.evaluate(() =>
        (document.body?.innerText || "").slice(0, 800)
      );
      if (looksBlocked(title, snippet) || snippet.length < 40) {
        console.warn(
          `[careerbuilder] blocked or empty page — skipping this run`
        );
        return { jobs: kept, blocked: true };
      }

      const stubs = await page.evaluate(() => {
        const out = [];
        const seenLocal = new Set();
        for (const a of document.querySelectorAll(
          'a[href*="/job/"], a[href*="/jobs/"]'
        )) {
          const href = (a.href || "").split("?")[0];
          if (!href || seenLocal.has(href)) continue;
          if (!/careerbuilder\.com\/job/i.test(href)) continue;
          seenLocal.add(href);
          out.push({
            url: href,
            title: (a.textContent || "").replace(/\s+/g, " ").trim(),
          });
        }
        return out;
      });

      console.log(`[careerbuilder] "${q}" listing links: ${stubs.length}`);
      const relevant = stubs.filter(
        (s) => !s.title || looksDataEngTitle(s.title)
      );
      const toScrape = relevant.slice(0, 25);

      for (let i = 0; i < toScrape.length; i += 1) {
        const stub = toScrape[i];
        if (seen.has(stub.url)) continue;
        seen.add(stub.url);
        console.log(`[careerbuilder] detail ${i + 1}/${toScrape.length}`);
        try {
          await page.goto(stub.url, {
            waitUntil: "domcontentloaded",
            timeout: 45000,
          });
          await sleep(1000 + config.delayMs);
          const data = await page.evaluate(() => {
            const text = (el) =>
              el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "";
            let ld = null;
            for (const s of document.querySelectorAll(
              'script[type="application/ld+json"]'
            )) {
              try {
                const p = JSON.parse(s.textContent || "");
                const nodes = Array.isArray(p) ? p : [p];
                for (const n of nodes) {
                  if (n && (n["@type"] === "JobPosting" || n.title)) {
                    ld = n;
                    break;
                  }
                }
              } catch {
                /* ignore */
              }
              if (ld) break;
            }
            const body = document.body?.innerText || "";
            const work = /\bhybrid\b/i.test(body.slice(0, 2000))
              ? "Hybrid"
              : /\bon[-\s]?site\b/i.test(body.slice(0, 2000)) &&
                !/\bremote\b/i.test(body.slice(0, 2000))
              ? "Onsite"
              : /\bremote\b/i.test(body.slice(0, 2000))
              ? "Remote"
              : ld?.jobLocationType === "TELECOMMUTE"
              ? "Remote"
              : "";
            return {
              title: text(document.querySelector("h1")) || (ld && ld.title) || "",
              organization:
                (ld && (ld.hiringOrganization?.name || ld.hiringOrganization)) ||
                "",
              description:
                (ld && ld.description) ||
                text(document.querySelector('[class*="description"]')) ||
                body.slice(0, 15000),
              date_posted: (ld && ld.datePosted) || "",
              work_arrangement: work,
              bodyPreview: body.slice(0, 2500),
            };
          });

          if (isExpiredPosting(data.bodyPreview)) continue;

          const idMatch = stub.url.match(/\/job\/([^/?#]+)/i);
          const postedAbs = parsePostedDate(data.date_posted);
          const job = {
            id: `careerbuilder_${idMatch ? idMatch[1] : kept.length}`,
            title: data.title || stub.title || "",
            organization: String(data.organization || "").trim(),
            location: "Remote",
            work_arrangement: data.work_arrangement || "Remote",
            remote_restricted_to: "",
            experience_level: "",
            employment_type: "",
            salary_min: "",
            salary_max: "",
            salary_currency: "USD",
            salary_unit: "",
            key_skills: "",
            source: "careerbuilder",
            date_posted: postedAbs
              ? postedAbs.toISOString().slice(0, 10)
              : String(data.date_posted || ""),
            url: stub.url,
            description: String(data.description || "")
              .replace(/<[^>]+>/g, " ")
              .trim(),
          };

          if (isBlockedEmployer(job.organization)) continue;
          if (!isRemoteArrangement(job.work_arrangement)) continue;
          if (!containsDataEng(job.title, job.description)) continue;
          if (isWithinRecentDays(job.date_posted, config.recentDays) === false)
            continue;
          kept.push(job);
        } catch (err) {
          console.warn(`[careerbuilder] detail failed: ${err.message}`);
        }
      }
    }

    console.log(`[careerbuilder] kept ${kept.length} remote data-engineering jobs`);
    return { jobs: kept, blocked: false };
  } finally {
    await context.close();
  }
}
