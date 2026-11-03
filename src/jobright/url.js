/**
 * Normalize / validate external apply URLs from JobRight (and similar boards).
 * Incomplete ATS shells (Indeed viewjob without jk, Greenhouse embed without
 * token) are rejected so callers can fall back to the JobRight job page.
 */

export function isLinkedinJobUrl(url) {
  return /linkedin\.com/i.test(String(url || ""));
}

/**
 * True when a URL looks like a usable external apply/view link.
 * @param {string} url
 */
export function isCompleteExternalJobUrl(url) {
  return Boolean(normalizeExternalJobUrl(url));
}

/**
 * Clean an external job URL. Returns "" when unusable / LinkedIn / incomplete.
 * - Keeps Indeed `jk=` and Greenhouse embed query params (do not strip `?`)
 * - Lever `…/apply` → job posting page
 * @param {string} raw
 * @returns {string}
 */
export function normalizeExternalJobUrl(raw) {
  const s = String(raw || "").trim();
  if (!s || isLinkedinJobUrl(s)) return "";

  let u;
  try {
    u = new URL(s);
  } catch {
    return "";
  }

  const host = u.hostname.toLowerCase();
  const path = u.pathname || "";

  // Lever apply form → posting page
  if (host.includes("jobs.lever.co") && /\/apply\/?$/i.test(path)) {
    u.pathname = path.replace(/\/apply\/?$/i, "");
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  }

  // Indeed needs a job key
  if (host.includes("indeed.com")) {
    const jk = u.searchParams.get("jk");
    if (jk) {
      return `https://${host}/viewjob?jk=${encodeURIComponent(jk)}`;
    }
    if (/\/(viewjob|rc\/clk|pagead\/clk)\/[^/?]+/i.test(path)) {
      u.hash = "";
      return `${u.origin}${u.pathname}`.replace(/\/$/, "");
    }
    return "";
  }

  // Greenhouse embed shell needs token / gh_jid (and often `for`)
  if (host.includes("greenhouse.io") && /\/embed\/job_app\/?$/i.test(path)) {
    const token = u.searchParams.get("token");
    const ghJid = u.searchParams.get("gh_jid");
    const board = u.searchParams.get("for");
    if (!token && !ghJid) return "";
    const out = new URL(`${u.origin}${path}`);
    if (board) out.searchParams.set("for", board);
    if (token) out.searchParams.set("token", token);
    if (ghJid) out.searchParams.set("gh_jid", ghJid);
    return out.toString();
  }

  // Ashby / Greenhouse board paths / Dice — keep path; drop noisy tracking only
  u.hash = "";
  const tracking = new Set([
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "ref",
    "source",
  ]);
  for (const key of [...u.searchParams.keys()]) {
    if (tracking.has(key.toLowerCase())) u.searchParams.delete(key);
  }
  const qs = u.searchParams.toString();
  return `${u.origin}${u.pathname}`.replace(/\/$/, "") + (qs ? `?${qs}` : "");
}

/**
 * Prefer a complete non-LinkedIn external apply URL; else JobRight job page.
 * @param {{ jobId?: string, url?: string, applyLink?: string, originalUrl?: string, isCompanySiteLink?: boolean }} jr
 */
export function pickJobrightJobUrl(jr) {
  const jobId = jr?.jobId;
  const fallback = String(
    jr?.url || (jobId ? `https://jobright.ai/jobs/info/${jobId}` : "")
  )
    .trim()
    .split("#")[0];
  const fallbackClean = fallback.includes("jobright.ai")
    ? fallback.split("?")[0]
    : normalizeExternalJobUrl(fallback) || fallback.split("?")[0];

  const candidates = [jr?.applyLink, jr?.originalUrl]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  let secondary = "";
  for (const c of candidates) {
    if (isLinkedinJobUrl(c)) continue;
    const normalized = normalizeExternalJobUrl(c);
    if (!normalized) continue;
    const prefer =
      jr?.isCompanySiteLink === true ||
      /greenhouse\.io|jobs\.lever\.co|ashbyhq\.com|indeed\.com|dice\.com|myworkdayjobs|workday\.com|smartrecruiters|jobvite|icims\.com|ultipro|workforcenow\.adp|oraclecloud|taleo|bamboohr|lever\.co/i.test(
        normalized
      );
    if (prefer) return normalized;
    if (!secondary) secondary = normalized;
  }

  return secondary || fallbackClean;
}

function bulletBlock(title, items) {
  const lines = (items || [])
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  if (!lines.length) return "";
  return `${title}:\n- ${lines.join("\n- ")}`;
}

/**
 * Build a JD string from JobRight API jobResult fields.
 * Search results expose summary + structured quals (not a full HTML JD).
 * @param {Record<string, unknown>} jr
 */
export function buildJobrightDescription(jr) {
  const parts = [];
  const summary = [
    jr?.jobSummary,
    jr?.jdResponsibilitySummary,
    jr?.summary,
    jr?.description,
    jr?.jobDescription,
    jr?.fullDescription,
    jr?.jd,
  ]
    .map((v) => String(v || "").trim())
    .find(Boolean);
  if (summary) parts.push(summary);

  const resp = bulletBlock("Responsibilities", jr?.coreResponsibilities);
  if (resp) parts.push(resp);

  const quals = jr?.qualifications;
  const mustLines = Array.isArray(quals?.mustHave)
    ? quals.mustHave
    : Array.isArray(jr?.requirements)
      ? jr.requirements
      : [];
  const must = bulletBlock("Requirements", mustLines);
  if (must) parts.push(must);

  const preferred = bulletBlock(
    "Preferred",
    Array.isArray(quals?.preferredHave)
      ? quals.preferredHave
      : Array.isArray(jr?.preferredQualifications)
        ? jr.preferredQualifications
        : []
  );
  if (preferred) parts.push(preferred);

  // skillSummaries often duplicates mustHave — only add when quals were empty
  if (!must && Array.isArray(jr?.skillSummaries) && jr.skillSummaries.length) {
    const skills = bulletBlock("Requirements", jr.skillSummaries);
    if (skills) parts.push(skills);
  }

  const benefits = bulletBlock("Benefits", jr?.benefitsSummaries);
  if (benefits) parts.push(benefits);

  const why = String(jr?.whyJoinUs || "").trim();
  if (why) parts.push(why);

  return parts.join("\n\n").trim();
}

/**
 * True when a stored URL is an incomplete ATS shell (params were stripped).
 * @param {string} url
 */
export function isIncompleteExternalJobUrl(url) {
  const s = String(url || "").trim();
  if (!s) return true;
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase();
    const path = u.pathname || "";
    if (host.includes("indeed.com") && /\/viewjob\/?$/i.test(path) && !u.searchParams.get("jk")) {
      return true;
    }
    if (
      host.includes("greenhouse.io") &&
      /\/embed\/job_app\/?$/i.test(path) &&
      !u.searchParams.get("token") &&
      !u.searchParams.get("gh_jid")
    ) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

/**
 * Repair a stored JobRight job URL in place (Lever /apply, incomplete shells).
 * @param {{ id?: string, url?: string }} job
 * @returns {string} repaired url
 */
export function repairJobrightStoredUrl(job) {
  const id = String(job?.id || "");
  const jobId = id.startsWith("jobright_") ? id.slice("jobright_".length) : "";
  const fallback = jobId ? `https://jobright.ai/jobs/info/${jobId}` : "";
  const raw = String(job?.url || "").trim();
  if (!raw) return fallback;

  const normalized = normalizeExternalJobUrl(raw);
  if (normalized) return normalized;
  if (isIncompleteExternalJobUrl(raw)) return fallback || raw;
  if (raw.includes("jobright.ai")) return raw.split("?")[0].split("#")[0];
  return fallback || raw;
}
