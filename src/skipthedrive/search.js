/**
 * SkipTheDrive — public remote-job search HTML (no API).
 * https://www.skipthedrive.com/?s=Data+Engineer
 */

import { config, pagesForSearchQuery } from "../config.js";
import { getText } from "../http.js";
import { stripHtml } from "../filter.js";
import {
  emptySkipCounts,
  isoDate,
  keepFeedJob,
  logKept,
} from "../feeds/keep.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function searchUrl(query, page) {
  const q = encodeURIComponent(query);
  if (page <= 1) return `https://www.skipthedrive.com/?s=${q}`;
  return `https://www.skipthedrive.com/page/${page}/?s=${q}`;
}

function parseArticles(html) {
  const parts = String(html || "").split(/<article\b/i).slice(1);
  const jobs = [];
  for (const part of parts) {
    if (!/\btype-job\b/.test(part.slice(0, 400))) continue;
    const id = (part.match(/\bid="post-(\d+)"/) || [])[1];
    const url = (part.match(/<h2[^>]*>\s*<a href="([^"]+)"/i) || [])[1] || "";
    const title = stripHtml((part.match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1]);
    const organization = stripHtml(
      (part.match(/custom_fields_company_name_display_search_results['"]>([\s\S]*?)<\/span>/i) ||
        [])[1]
    );
    const posted = (part.match(/<time[^>]*datetime="([^"]+)"/i) || [])[1] || "";
    const relative = stripHtml(
      (part.match(/custom_fields_job_date_display_search_results['"]>([\s\S]*?)<\/span>/i) ||
        [])[1]
    );
    if (!id || !url) continue;
    jobs.push({
      id: `skipthedrive_${id}`,
      title,
      organization,
      location: "",
      work_arrangement: "Remote",
      remote_restricted_to: "",
      experience_level: "",
      employment_type: "",
      salary_min: "",
      salary_max: "",
      salary_currency: "USD",
      salary_unit: "",
      key_skills: "",
      source: "skipthedrive",
      date_posted: isoDate(posted || relative),
      url,
      description: "",
    });
  }
  return jobs;
}

export async function searchSkipthedriveJobs() {
  const kept = [];
  const seen = new Set();
  const counts = emptySkipCounts();
  let scanned = 0;

  for (let qi = 0; qi < config.searchQueries.length; qi += 1) {
    const query = config.searchQueries[qi];
    const pageCap = pagesForSearchQuery(qi);
    for (let page = 1; page <= pageCap; page += 1) {
      const url = searchUrl(query, page);
      console.log(`[skipthedrive] ${url}`);
      let html;
      try {
        html = await getText(url);
      } catch (err) {
        console.warn(`[skipthedrive] ${query} page ${page} failed: ${err.message}`);
        break;
      }
      const batch = parseArticles(html);
      if (!batch.length) break;
      scanned += batch.length;
      let added = 0;
      for (const job of batch) {
        if (seen.has(job.id)) continue;
        seen.add(job.id);
        added += 1;
        if (keepFeedJob(job, counts)) kept.push(job);
      }
      if (!added) break;
      if (page < pageCap) await sleep(config.delayMs);
    }
  }

  logKept("skipthedrive", kept.length, scanned, counts);
  return { jobs: kept };
}
