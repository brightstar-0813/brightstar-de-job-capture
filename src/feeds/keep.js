import { config } from "../config.js";
import {
  isDataEngTitle,
  isRemoteArrangement,
  isUsEligible,
  isWithinRecentDays,
  parsePostedDate,
  isLinkedinLink,
} from "../filter.js";

export function emptySkipCounts() {
  return { nonRemote: 0, location: 0, nonDe: 0, stale: 0 };
}

export function isoDate(value) {
  const d = parsePostedDate(value);
  return d ? d.toISOString().slice(0, 10) : String(value || "");
}

/**
 * Shared keep/drop for JSON/RSS/ATS feed jobs. Mutates `counts`.
 */
export function keepFeedJob(job, counts, { skipRecency = false } = {}) {
  if (!isRemoteArrangement(job.work_arrangement)) {
    counts.nonRemote += 1;
    return false;
  }
  if (!isUsEligible(job)) {
    counts.location += 1;
    return false;
  }
  if (!isDataEngTitle(job.title, job.description)) {
    counts.nonDe += 1;
    return false;
  }
  if (isLinkedinLink(job.url)) {
    counts.stale += 1;
    return false;
  }
  if (
    !skipRecency &&
    isWithinRecentDays(job.date_posted, config.recentDays) === false
  ) {
    counts.stale += 1;
    return false;
  }
  return true;
}

export function logKept(source, kept, scanned, counts) {
  console.log(
    `[${source}] kept ${kept} US-remote data engineering jobs` +
      ` (scanned=${scanned}, non-remote=${counts.nonRemote},` +
      ` location=${counts.location}, non-DE=${counts.nonDe}, stale=${counts.stale})`
  );
}
