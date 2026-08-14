/**
 * Capture rule: US remote data-engineering family only.
 *
 * Gold-standard titles: Data Engineer, Senior/Staff/Principal Data Engineer,
 * Analytics Engineer, ETL/ELT Engineer, Data Platform / Infrastructure /
 * Pipeline / Warehouse Engineer, Big Data Engineer, DataOps Engineer,
 * Snowflake / Databricks / dbt Engineer. Exact wording is not required.
 *
 * Generic SWE/ML/scientist/analyst titles are skipped even if the JD mentions
 * data. Non-eng titles (sales, recruiting, PM) are skipped.
 * Hybrid / on-site and non-US locations are skipped.
 */

const NON_ENG_TITLE_RE =
  /\b(account executive|sales|recruiter|recruiting|sourcer|customer success|marketing|product manager|program manager|project manager|designer|writer|intern(?!al)|teacher|instructor|data entry)\b/i;

const SKIP_NEAR_DE_RE =
  /\b(data[\s-]?scientists?|data[\s-]?analysts?|business[\s-]?analysts?|research[\s-]?scientists?|machine[\s-]?learning[\s-]?engineers?|ml[\s-]?engineers?)\b/i;

const DATA_CENTER_RE = /\bdata[\s-]?cent(?:er|re)s?\b/i;
const DATA_FETCHING_RE = /\bdata[\s-]?fetching\b/i;

const DATA_ENG_RE = new RegExp(
  [
    String.raw`\b(?:big[\s-]?data|analytics|etl|elt)\b.{0,32}\b(?:engineers?|engineering|developers?)\b`,
    String.raw`\b(?:engineers?|engineering|developers?)\b.{0,32}\b(?:big[\s-]?data|analytics|etl|elt)\b`,
    String.raw`\bdata[\s-]+(?:engineers?|engineering|developers?)\b`,
    String.raw`\bdata\b(?![\s-]?cent(?:er|re)).{0,28}\b(?:engineers?|engineering|developers?)\b`,
    String.raw`\b(?:engineers?|engineering|developers?)\b.{0,32}\bdata[\s-]?(?:platform|infrastructure|pipeline|warehouse|ops|migration|integration|engineering)\b`,
    String.raw`\bdata[\s-]?(?:platform|infrastructure|pipeline|warehouse|ops|migration|integration)(?:[\s-]*(?:engineers?|engineering|developers?))?\b`,
    String.raw`\b(?:snowflake|databricks|dbt)[\s-]+(?:engineers?|engineering|developers?)\b`,
    String.raw`\b(?:engineers?|engineering|developers?)\b.{0,24}\b(?:snowflake|databricks|dbt)\b`,
  ].join("|"),
  "i"
);

const US_EXPLICIT_RE =
  /\b(united states|u\.s\.a\.|u\.s\.|\busa\b|\bus\b|america)\b/i;

const NON_US_COUNTRY_RE =
  /\b(united kingdom|england|scotland|wales|\buk\b|europe|european|emea|apac|asia pacific|\basia\b|india|canada|australia|new zealand|germany|france|netherlands|ireland|spain|italy|sweden|norway|denmark|finland|switzerland|austria|belgium|portugal|poland|romania|ukraine|israel|singapore|japan|china|korea|brazil|mexico|argentina|chile|colombia|latam|latin america|philippines|nigeria|pakistan|bangladesh|vietnam|thailand|indonesia|malaysia|uae|dubai|south africa)\b/i;

const US_STATE_COMMA_RE =
  /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/i;

const US_STATE_NAME_RE =
  /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia)\b/i;

/**
 * Title is a data-engineering family role (or close variant). JD is ignored
 * so a backend SWE with "we use Spark" in the description is not kept.
 */
export function isDataEngTitle(title, _description) {
  const t = String(title || "");
  if (!t.trim()) return false;
  if (NON_ENG_TITLE_RE.test(t)) return false;
  if (DATA_CENTER_RE.test(t) || DATA_FETCHING_RE.test(t)) return false;
  if (SKIP_NEAR_DE_RE.test(t) && !DATA_ENG_RE.test(t)) return false;
  return DATA_ENG_RE.test(t);
}

/** @deprecated Use isDataEngTitle — kept so older call sites keep working. */
export function containsAi(title, description) {
  return isDataEngTitle(title, description);
}

/**
 * Remote-only: keep fully remote roles, drop hybrid and on-site.
 * An empty value is treated as remote only because Dice search is already
 * restricted to Remote (detail pages often omit workplace type). Any explicit
 * hybrid / on-site / in-office label is rejected; otherwise the value must
 * mention "remote".
 */
export function isRemoteArrangement(workArrangement) {
  const w = String(workArrangement || "").toLowerCase().trim();
  if (!w) return true;
  if (/hybrid/.test(w)) return false;
  if (/on[-\s]?site|onsite|in[-\s]?office|in[-\s]?person/.test(w)) return false;
  return /\bremote\b/.test(w);
}

function locationBlob(job) {
  return [
    job?.location,
    job?.remote_restricted_to,
    job?.title,
  ]
    .map((s) => String(s || ""))
    .join(" ")
    .trim();
}

/**
 * US-eligible remote: keep when the posting is for the United States (or has
 * no country, because Dice / JobRight / Built In searches are already US-scoped).
 * Skip when location/restriction is clearly another country and does not also
 * mention the US.
 */
export function isUsEligible(job) {
  const blob = locationBlob(job);
  if (!blob) return true;
  if (US_EXPLICIT_RE.test(blob) || US_STATE_COMMA_RE.test(blob) || US_STATE_NAME_RE.test(blob)) {
    return true;
  }
  if (NON_US_COUNTRY_RE.test(blob)) return false;
  return true;
}

/**
 * Final capture decision: data-engineering title + remote + US.
 * @param {{ title?: string, description?: string, organization?: string, work_arrangement?: string, location?: string, remote_restricted_to?: string }} job
 */
export function matchesCaptureRule(job) {
  if (!job) return false;
  if (!isRemoteArrangement(job.work_arrangement)) return false;
  if (!isUsEligible(job)) return false;
  return isDataEngTitle(job.title, job.description);
}

export function filterAiJobs(jobs) {
  return (jobs || []).filter((j) => matchesCaptureRule(j));
}

export function isLinkedinLink(...links) {
  return links.some((l) => /linkedin\.com/i.test(String(l || "")));
}

/**
 * Parse a job's posted date into an absolute Date. Handles:
 * - epoch ms (13 digits) / epoch seconds (10 digits)
 * - ISO / RFC date strings (Date.parse)
 * - relative English ("today", "just posted", "yesterday",
 *   "3 days ago", "2 weeks ago", "1 month ago", "5 hours ago")
 * Relative strings are resolved against `now` (the scrape time), so callers
 * should normalize to an absolute value at capture time.
 * @returns {Date|null} null when the value can't be understood.
 */
export function parsePostedDate(value, now = new Date()) {
  if (value == null || value === "") return null;

  if (typeof value === "number" || /^\d+$/.test(String(value).trim())) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = String(Math.trunc(n)).length <= 10 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const s = String(value).trim().toLowerCase();

  if (/(^|\b)(just posted|today|moments? ago|minutes? ago|hours? ago|<\s*1\s*day)/.test(s)) {
    return now;
  }
  if (/\byesterday\b/.test(s)) {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
  const rel = s.match(/(\d+)\+?\s*(hour|day|week|month|year)s?\s*ago/);
  if (rel) {
    const qty = Number(rel[1]);
    const unitMs = {
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
    }[rel[2]];
    return new Date(now.getTime() - qty * unitMs);
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/**
 * True when `value` resolves to within the last `days` days; false when older;
 * null when the date can't be parsed (caller decides how to treat unknowns).
 */
export function isWithinRecentDays(value, days, now = new Date()) {
  const d = parsePostedDate(value, now);
  if (!d) return null;
  const ageMs = now.getTime() - d.getTime();
  if (ageMs < 0) return true; // future-dated (clock skew) — treat as fresh
  return ageMs <= days * 24 * 60 * 60 * 1000;
}

/**
 * Recency decision for a stored/scraped job. Uses date_posted; when that is
 * missing/unparseable, falls back to first_seen_at so legacy rows still age
 * out. Jobs with no usable date at all are kept (lenient).
 */
export function isRecentJob(job, days, now = new Date()) {
  if (!job) return false;
  const byPosted = isWithinRecentDays(job.date_posted, days, now);
  if (byPosted !== null) return byPosted;
  const bySeen = isWithinRecentDays(job.first_seen_at, days, now);
  if (bySeen !== null) return bySeen;
  return true;
}
