/**
 * We Work Remotely RSS — latest remote jobs, filtered to data engineering.
 * https://weworkremotely.com/remote-jobs.rss
 */

import { getText } from "../http.js";
import { stripHtml } from "../filter.js";
import {
  emptySkipCounts,
  isoDate,
  keepFeedJob,
  logKept,
} from "../feeds/keep.js";

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
  return {
    id: `wwr_${slug || index}`,
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
    source: "wwr",
    date_posted: isoDate(item.date_posted),
    url: item.url || "",
    description: stripHtml(item.description).slice(0, 20000),
  };
}

export async function searchWwrJobs() {
  const url = "https://weworkremotely.com/remote-jobs.rss";
  console.log(`[wwr] ${url}`);
  const xml = await getText(url);
  const items = parseRssItems(xml);
  const kept = [];
  const seen = new Set();
  const counts = emptySkipCounts();

  for (let i = 0; i < items.length; i += 1) {
    const job = mapItem(items[i], i);
    if (!job.id || seen.has(job.id)) continue;
    seen.add(job.id);
    if (keepFeedJob(job, counts)) kept.push(job);
  }

  logKept("wwr", kept.length, items.length, counts);
  return { jobs: kept };
}
