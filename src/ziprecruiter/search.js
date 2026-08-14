/**
 * ZipRecruiter — best-effort US-remote data engineering scrape.
 * Often blocked by Cloudflare in headless mode; returns [] with a warning then.
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

function buildSearchUrl() {
  // SEO path tends to pass Cloudflare more often than /jobs-search?...
  const q =
    (config.searchQueries && config.searchQueries[0]) ||
    config.searchQ ||
    "Data Engineer";
  return `https://www.ziprecruiter.com/Jobs/Remote-${encodeURIComponent(
    String(q).replace(/\s+/g, "-")
  )}`;
}

/**
 * @param {import('playwright').Browser} browser
 */
export async function searchZiprecruiterJobs(browser) {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1400, height: 900 },
    locale: "en-US",
  });
  const page = await context.newPage();
  const kept = [];

  try {
    const url = buildSearchUrl();
    console.log(`[ziprecruiter] open: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(6000 + config.delayMs);

    const title = await page.title();
    const blocked = await page.evaluate(() => {
      const t = (document.title || "") + (document.body?.innerText || "").slice(0, 500);
      return /just a moment|security verification|cf-browser-verification|attention required/i.test(
        t
      );
    });
    if (blocked || /just a moment/i.test(title)) {
      console.warn(
        `[ziprecruiter] blocked by Cloudflare bot check — skipping this run`
      );
      return { jobs: [], blocked: true };
    }

    const stubs = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      for (const a of document.querySelectorAll("a[href]")) {
        const href = (a.href || "").split("?")[0];
        if (!/ziprecruiter\.com\/(job|ojob)\//i.test(href)) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        const title = (a.textContent || "").replace(/\s+/g, " ").trim();
        out.push({ url: href, title });
      }
      return out.slice(0, 60);
    });

    console.log(`[ziprecruiter] listing links: ${stubs.length}`);
    if (!stubs.length) {
      console.warn(
        `[ziprecruiter] no job links found (page may be JS-gated) — skipping`
      );
      return { jobs: [], blocked: false };
    }

    for (let i = 0; i < stubs.length; i += 1) {
      const stub = stubs[i];
      console.log(`[ziprecruiter] detail ${i + 1}/${stubs.length}`);
      try {
        await page.goto(stub.url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await sleep(1200 + config.delayMs);
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
            work_arrangement:
              work || (ld?.jobLocationType === "TELECOMMUTE" ? "Remote" : ""),
            location: "",
          };
        });

        const idMatch = stub.url.match(/\/(?:job|ojob)\/([^/?#]+)/i);
        const id = `ziprecruiter_${idMatch ? idMatch[1] : i}`;
        const postedAbs = parsePostedDate(data.date_posted);
        const job = {
          id,
          title: data.title || stub.title || "",
          organization: String(data.organization || "").trim(),
          location: data.location || "Remote",
          work_arrangement: data.work_arrangement || "Remote",
          remote_restricted_to: "",
          experience_level: "",
          employment_type: "",
          salary_min: "",
          salary_max: "",
          salary_currency: "USD",
          salary_unit: "",
          key_skills: "",
          source: "ziprecruiter",
          date_posted: postedAbs
            ? postedAbs.toISOString().slice(0, 10)
            : String(data.date_posted || ""),
          url: stub.url,
          description: String(data.description || "")
            .replace(/<[^>]+>/g, " ")
            .trim(),
        };

        if (!isRemoteArrangement(job.work_arrangement)) continue;
        if (!isUsEligible(job)) continue;
        if (!isDataEngTitle(job.title, job.description)) continue;
        if (isWithinRecentDays(job.date_posted, config.recentDays) === false) continue;
        kept.push(job);
      } catch (err) {
        console.warn(`[ziprecruiter] detail failed: ${err.message}`);
      }
    }

    console.log(`[ziprecruiter] kept ${kept.length} US-remote data engineering jobs`);
    return { jobs: kept, blocked: false };
  } finally {
    await context.close();
  }
}
