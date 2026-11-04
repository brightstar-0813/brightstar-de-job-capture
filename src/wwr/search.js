/**
 * We Work Remotely RSS — public feeds via curl (Node fetch gets Cloudflare 403).
 * https://weworkremotely.com/remote-job-rss-feed
 */

import { getTextPreferCurl } from "../curl.js";
import { stripHtml } from "../filter.js";
import {
  emptySkipCounts,
  isoDate,
  keepFeedJob,
  logKept,
} from "../feeds/keep.js";

const FEEDS = [
  "https://weworkremotely.com/categories/remote-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
  "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss",
  "https://weworkremotely.com/remote-jobs.rss",
];

function rssTag(block, name) {
  const cdata = block.match(
    new RegExp(`<${name}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>`, "i")
  );
  if (cdata) return cdata[1].trim();
  const plain = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return plain ? plain[1].trim() : "";
}

function parseRssItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    items.push({
      title: rssTag(block, "title"),
      url: rssTag(block, "link"),
      description: rssTag(block, "description"),
      date_posted: rssTag(block, "pubDate"),
      region: rssTag(block, "region"),
      country: rssTag(block, "country"),
      category: rssTag(block, "category"),
      type: rssTag(block, "type"),
    });
  }
  return items;
}

function splitCompanyTitle(rawTitle) {
  const t = String(rawTitle || "").replace(/\s+/g, " ").trim();
  const idx = t.indexOf(":");
  if (idx > 0 && idx < 80) {
    return {
      organization: t.slice(0, idx).trim(),
      title: t.slice(idx + 1).trim(),
    };
  }
  return { organization: "", title: t };
}

function mapItem(item, index) {
  const { organization, title } = splitCompanyTitle(item.title);
  const slug = String(item.url || "")
    .replace(/https?:\/\/(www\.)?weworkremotely\.com\//i, "")
    .replace(/[^\w/-]+/g, "_")
    .slice(0, 80);
  const location = [item.region, item.country].filter(Boolean).join(", ");
  return {
    id: `wwr_${slug || index}`,
    title,
    organization,
    location,
    work_arrangement: "Remote",
    remote_restricted_to: "",
    experience_level: "",
    employment_type: item.type || "",
    salary_min: "",
    salary_max: "",
    salary_currency: "USD",
    salary_unit: "",
    key_skills: "",
    source: "wwr",
    date_posted: isoDate(item.date_posted),
    url: item.url || "",
    description: stripHtml(item.description).slice(0, 20000),
  };
}

export async function searchWwrJobs() {
  const kept = [];
  const seen = new Set();
  const counts = emptySkipCounts();
  let scanned = 0;

  for (const url of FEEDS) {
    console.log(`[wwr] ${url}`);
    let xml;
    try {
      xml = await getTextPreferCurl(url, {
        timeoutMs: 45000,
        headers: {
          accept: "application/rss+xml, application/xml, text/xml, */*",
        },
      });
    } catch (err) {
      console.warn(`[wwr] feed failed: ${err.message}`);
      continue;
    }
    if (/Just a moment|Attention Required/i.test(xml)) {
      console.warn(`[wwr] Cloudflare challenge for ${url}`);
      continue;
    }
    const items = parseRssItems(xml);
    console.log(`[wwr] items=${items.length}`);
    for (let i = 0; i < items.length; i += 1) {
      const job = mapItem(items[i], i);
      if (!job.id || seen.has(job.id)) continue;
      seen.add(job.id);
      scanned += 1;
      if (keepFeedJob(job, counts)) kept.push(job);
    }
  }

  logKept("wwr", kept.length, scanned, counts);
  return { jobs: kept };
}
