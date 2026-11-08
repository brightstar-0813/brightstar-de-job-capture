/**
 * JobRight public search client — logged-out /jobs/search page via curl.
 * The page server-renders the first 20 results into __NEXT_DATA__; the
 * /swan API requires a SESSION_ID cookie, so it is not used.
 * Pagination params are ignored when logged out — vary the query instead.
 */

import { curlRequest } from "../curl.js";

const ORIGIN = "https://jobright.ai";

export function buildPublicSearchUrl(query, { daysAgo = null } = {}) {
  const taxonomy = encodeURIComponent(
    JSON.stringify([{ taxonomyId: "00-00-00", title: query }])
  );
  return (
    `${ORIGIN}/jobs/search?value=${encodeURIComponent(query)}` +
    `&searchType=job_title&country=US&workModel=2` +
    `&jobTaxonomyList=${taxonomy}` +
    (daysAgo ? `&daysAgo=${daysAgo}` : "")
  );
}

function extractNextData(html) {
  const m = String(html || "").match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/**
 * GET the public search page and return its server-rendered job list.
 */
export async function fetchPublicSearch({ query, daysAgo = null }) {
  const url = buildPublicSearchUrl(query, { daysAgo });
  const res = await curlRequest(url, {
    timeoutMs: 60000,
    followRedirects: true,
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  const props = extractNextData(res.body)?.props?.pageProps;
  const jobList = Array.isArray(props?.jobList) ? props.jobList : [];
  return {
    ok: res.status >= 200 && res.status < 300 && !!props,
    status: res.status,
    jobList,
    totalJobs: props?.totalJobs ?? null,
  };
}
