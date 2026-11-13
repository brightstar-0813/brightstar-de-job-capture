/**
 * Jobspresso — WordPress Job Manager listing endpoint (no public search API).
 * POST https://jobspresso.co/jm-ajax/get_listings/
 */

import { config } from "../config.js";
import { stripHtml } from "../filter.js";
import {
  emptySkipCounts,
  keepFeedJob,
  logKept,
} from "../feeds/keep.js";

const ENDPOINT = "https://jobspresso.co/jm-ajax/get_listings/";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseListings(html) {
  const parts = String(html || "").split(/<li\b[^>]*id="job_listing-/i).slice(1);
  const jobs = [];
  for (const part of parts) {
    const id = (part.match(/^(\d+)/) || [])[1];
    const url = (part.match(/data-href="([^"]+)"/i) || [])[1] || "";
    const title = stripHtml((part.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || [])[1]);
    const organization = stripHtml((part.match(/<strong>([\s\S]*?)<\/strong>/i) || [])[1]);
    const location = stripHtml(
      (part.match(/job_listing-location[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1]
    );
    if (!id || !url) continue;
    jobs.push({
      id: `jobspresso_${id}`,
      title,
      organization,
      location,
      work_arrangement: "Remote",
      remote_restricted_to: "",
      experience_level: "",
      employment_type: "",
      salary_min: "",
      salary_max: "",
      salary_currency: "USD",
      salary_unit: "",
      key_skills: "",
      source: "jobspresso",
      date_posted: "",
      url: url.replace(/&amp;/g, "&"),
      description: "",
    });
  }
  return jobs;
}

async function fetchPage(query, page) {
  const body = new URLSearchParams({
    search_keywords: query,
    search_location: "",
    per_page: "20",
    page: String(page),
  });
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
    body,
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = JSON.parse(text);
  return {
    found: json?.found_jobs !== false,
    jobs: parseListings(json?.html || ""),
    maxPages: Number(json?.max_num_pages) || 1,
  };
}

export async function searchJobspressoJobs() {
  const kept = [];
  const seen = new Set();
  const counts = emptySkipCounts();
  let scanned = 0;

  const queries =
    config.roleTitles?.length > 0 ? config.roleTitles : [config.searchQ];
  const pageCap = Math.max(1, config.rolePages || 2);

  for (let qi = 0; qi < queries.length; qi += 1) {
    const query = queries[qi];
    let maxPages = pageCap;
    for (let page = 1; page <= pageCap && page <= maxPages; page += 1) {
      const url = `${ENDPOINT} q=${encodeURIComponent(query)} page=${page}`;
      console.log(`[jobspresso] ${url}`);
      let batch;
      try {
        batch = await fetchPage(query, page);
      } catch (err) {
        console.warn(`[jobspresso] ${query} page ${page} failed: ${err.message}`);
        break;
      }
      maxPages = Math.min(pageCap, batch.maxPages || 1);
      if (!batch.jobs.length) break;
      scanned += batch.jobs.length;
      let added = 0;
      for (const job of batch.jobs) {
        if (seen.has(job.id)) continue;
        seen.add(job.id);
        added += 1;
        if (keepFeedJob(job, counts)) kept.push(job);
      }
      if (!added || !batch.found) break;
      if (page < maxPages) await sleep(config.delayMs);
    }
  }

  logKept("jobspresso", kept.length, scanned, counts);
  return { jobs: kept };
}
