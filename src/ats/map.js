import { stripHtml } from "../filter.js";

export function companyNameFromSlug(slug) {
  return String(slug || "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function inferWorkArrangement(location, title, description, explicit = "") {
  const exp = String(explicit || "").toLowerCase();
  if (exp) {
    if (/hybrid/.test(exp)) return "Hybrid";
    if (/on[-\s]?site|onsite|in[-\s]?office|in[-\s]?person/.test(exp)) return "Onsite";
    if (/remote|telecommute/.test(exp)) return "Remote";
  }
  const loc = String(location || "");
  const blob = `${loc} ${title} ${String(description || "").slice(0, 3000)}`;
  if (/hybrid/i.test(loc) && !/\bremote\b/i.test(loc)) return "Hybrid";
  if (
    /on[-\s]?site|in[-\s]?office|in[-\s]?person/i.test(loc) &&
    !/\bremote\b/i.test(loc)
  ) {
    return "Onsite";
  }
  if (/\bremote\b/i.test(blob) || /\bwork from home\b/i.test(blob)) return "Remote";
  if (/^remote\b/i.test(loc.trim())) return "Remote";
  return "Onsite";
}

export function atsJob({
  source,
  board,
  id,
  title,
  organization,
  location,
  work,
  datePosted,
  url,
  description,
}) {
  return {
    id: `${source}_${board}_${id}`,
    title: title || "",
    organization: organization || companyNameFromSlug(board),
    location: location || "",
    work_arrangement: work || "",
    remote_restricted_to: "",
    experience_level: "",
    employment_type: "",
    salary_min: "",
    salary_max: "",
    salary_currency: "USD",
    salary_unit: "",
    key_skills: "",
    source,
    date_posted: datePosted || "",
    url: url || "",
    description: stripHtml(description).slice(0, 20000),
  };
}

/**
 * Run async tasks with a concurrency cap.
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<void>} fn
 */
export async function mapPool(items, limit, fn) {
  const list = items || [];
  let i = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (i < list.length) {
      const item = list[i];
      i += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
