/**
 * Built In — US-remote data engineering jobs via public HTML (curl).
 * Their JSON retrieval API currently returns empty; listing + detail HTML work.
 */

import { config } from "../config.js";
import { curlGetText } from "../curl.js";
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

function queries() {
  return config.searchQueries?.length
    ? config.searchQueries
    : [config.searchQ || "Data Engineer"];
}

function buildSearchUrl(page = 1, query = config.searchQ) {
  const params = new URLSearchParams();
  params.set("search", query);
  params.set("daysSinceUpdated", String(config.recentDays));
  if (page > 1) params.set("page", String(page));
  return `https://builtin.com/jobs/remote?${params.toString()}`;
}

function parseListingStubs(html) {
  const out = [];
  const seen = new Set();
  const re = /href="(\/job\/[^"]+\/(\d+))"/gi;
  let m;
  while ((m = re.exec(html))) {
    const path = m[1];
    const id = m[2];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const slug = path.split("/")[2] || "";
    const titleGuess = slug
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    out.push({
      id,
      url: `https://builtin.com${path.split("?")[0]}`,
      title: titleGuess,
    });
  }
  return out;
}

function firstMatch(html, patterns) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

function parseDetail(html, stub) {
  const h1 = firstMatch(html, [
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
  ]);
  const title = stripHtml(h1) || stub.title || "";

  let organization = firstMatch(html, [
    /property="og:site_name"\s+content="([^"]+)"/i,
    /<a[^>]+href="\/company\/[^"]+"[^>]*>([\s\S]*?)<\/a>/i,
  ]);
  organization = stripHtml(organization);

  const bodyText = stripHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
  );

  const remoteBadge =
    /\bhiring remotely\b/i.test(bodyText.slice(0, 2500)) ||
    /\bfully remote\b/i.test(bodyText.slice(0, 2500)) ||
    /(^|\n)\s*remote\s*(\n|$)/i.test(bodyText.slice(0, 1500));
  const hybrid = /\bhybrid\b/i.test(bodyText.slice(0, 2500));
  const onsite = /\bon[-\s]?site\b|\bin[-\s]?office\b/i.test(
    bodyText.slice(0, 2500)
  );
  let work = "Remote";
  if (hybrid) work = "Hybrid";
  else if (onsite && !remoteBadge) work = "Onsite";
  else if (remoteBadge || /\bremote\b/i.test(bodyText.slice(0, 2500))) {
    work = "Remote";
  }

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
  const ldDate = firstMatch(html, [
    /"datePosted"\s*:\s*"([^"]+)"/i,
  ]);
  if (ldDate) datePosted = ldDate;

  let description = bodyText;
  const cut = bodyText.search(
    /\b(about the role|job description|what you.?ll do|responsibilities)\b/i
  );
  if (cut > 0) description = bodyText.slice(cut);

  return {
    id: `builtin_${stub.id}`,
    title,
    organization,
    location: remoteBadge || work === "Remote" ? "Remote" : "",
    work_arrangement: work,
    remote_restricted_to: "",
    experience_level: "",
    employment_type: "",
    salary_min: "",
    salary_max: "",
    salary_currency: "USD",
    salary_unit: "",
    key_skills: "",
    source: "builtin",
    date_posted: isoDate(datePosted),
    url: stub.url,
    description: description.replace(/\n{3,}/g, "\n\n").trim().slice(0, 20000),
  };
}

/**
 * @param {import('playwright').Browser} [_browser] unused — kept for call-site compat
 */
export async function searchBuiltinJobs(_browser) {
  const stubs = [];
  const seen = new Set();
  const counts = emptySkipCounts();

  for (const query of queries()) {
    console.log(`[builtin] query="${query}"`);
    for (let p = 1; p <= config.maxPages; p += 1) {
      const url = buildSearchUrl(p, query);
      console.log(`[builtin] page ${p}: ${url}`);
      let html;
      try {
        html = await curlGetText(url, {
          timeoutMs: 45000,
          headers: {
            accept: "text/html,application/xhtml+xml",
            referer: "https://builtin.com/jobs",
          },
        });
      } catch (err) {
        console.warn(`[builtin] page ${p} failed: ${err.message}`);
        break;
      }
      if (/Just a moment|Attention Required/i.test(html)) {
        console.warn(`[builtin] Cloudflare challenge on listing page`);
        break;
      }
      const batch = parseListingStubs(html);
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
      if (config.delayMs) await sleep(config.delayMs);
    }
  }

  const kept = [];
  for (let i = 0; i < stubs.length; i += 1) {
    const stub = stubs[i];
    console.log(`[builtin] detail ${i + 1}/${stubs.length}: ${stub.id}`);
    try {
      const html = await curlGetText(stub.url, {
        timeoutMs: 45000,
        headers: {
          accept: "text/html,application/xhtml+xml",
          referer: "https://builtin.com/jobs/remote",
        },
      });
      if (/Just a moment|Attention Required/i.test(html)) {
        console.warn(`[builtin] Cloudflare on detail ${stub.id}`);
        continue;
      }
      const job = parseDetail(html, stub);
      if (keepFeedJob(job, counts)) kept.push(job);
    } catch (err) {
      console.warn(`[builtin] failed ${stub.id}: ${err.message}`);
    }
    if (config.delayMs) await sleep(config.delayMs);
  }

  logKept("builtin", kept.length, stubs.length, counts);
  return { jobs: kept };
}
