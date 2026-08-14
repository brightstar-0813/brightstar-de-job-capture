/**
 * Monster — best-effort US-remote data engineering scrape.
 * The site often returns an empty/blocked page to headless browsers; we detect
 * that and skip cleanly rather than fail the whole capture.
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
  params.set("q", query);
  params.set("where", "Remote");
  params.set("page", String(page));
  params.set("so", "m.h.sh");
  return `https://www.monster.com/jobs/search?${params.toString()}`;
}

/**
 * @param {import('playwright').Browser} browser
 */
export async function searchMonsterJobs(browser) {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1400, height: 900 },
    locale: "en-US",
  });
  const page = await context.newPage();
  const kept = [];
  const seen = new Set();

  try {
    for (let p = 1; p <= Math.min(3, config.maxPages); p += 1) {
      const query =
        (config.searchQueries && config.searchQueries[0]) || config.searchQ;
      const url = buildSearchUrl(p, query);
      console.log(`[monster] page ${p}: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(5000 + config.delayMs);

      const bodyLen = await page.evaluate(
        () => (document.body?.innerText || "").length
      );
      if (bodyLen < 40) {
        console.warn(
          `[monster] empty/blocked page (bodyLen=${bodyLen}) — skipping Monster this run`
        );
        return { jobs: [], blocked: true };
      }

      const stubs = await page.evaluate(() => {
        const out = [];
        const seenLocal = new Set();
        for (const a of document.querySelectorAll(
          'a[href*="/job-openings/"], a[href*="jobid="]'
        )) {
          const href = (a.href || "").split("#")[0];
          if (!href || seenLocal.has(href)) continue;
          seenLocal.add(href);
          out.push({
            url: href,
            title: (a.textContent || "").replace(/\s+/g, " ").trim(),
          });
        }
        return out;
      });

      console.log(`[monster] page ${p}: found ${stubs.length} links`);
      if (!stubs.length) break;

      for (const stub of stubs) {
        if (seen.has(stub.url)) continue;
        seen.add(stub.url);

        try {
          await page.goto(stub.url, {
            waitUntil: "domcontentloaded",
            timeout: 45000,
          });
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
            };
          });

          const idMatch =
            stub.url.match(/--([a-f0-9-]{20,})/i) ||
            stub.url.match(/jobid=([^&]+)/i) ||
            stub.url.match(/\/job-openings\/([^/?#]+)/i);
          const id = `monster_${idMatch ? idMatch[1] : kept.length}`;
          const postedAbs = parsePostedDate(data.date_posted);
          const job = {
            id,
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
            source: "monster",
            date_posted: postedAbs
              ? postedAbs.toISOString().slice(0, 10)
              : String(data.date_posted || ""),
            url: stub.url.split("?")[0],
            description: String(data.description || "")
              .replace(/<[^>]+>/g, " ")
              .trim(),
          };

          if (!isRemoteArrangement(job.work_arrangement)) continue;
          if (!isUsEligible(job)) continue;
          if (!isDataEngTitle(job.title, job.description)) continue;
          if (isWithinRecentDays(job.date_posted, config.recentDays) === false)
            continue;
          kept.push(job);
        } catch (err) {
          console.warn(`[monster] detail failed: ${err.message}`);
        }
      }
    }

    console.log(`[monster] kept ${kept.length} US-remote data engineering jobs`);
    return { jobs: kept, blocked: false };
  } finally {
    await context.close();
  }
}
