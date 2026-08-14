/**
 * Background: schedule JobRight scrape daily at 5:00 AM and 5:00 PM (local time)
 * using the user's logged-in Chrome session (no Playwright login file needed).
 */

const API = "http://127.0.0.1:3847";
const ALARM = "jobright-capture-daily";
const LEGACY_ALARMS = ["jobright-capture-8h", "jobright-capture-12h"];
/** Local hours (24h) when JobRight capture runs — 5 AM and 5 PM. */
const RUN_HOURS = [5, 17];

/** Same role-family seeds as Playwright JOBRIGHT_TITLES (not title filters). */
const DEFAULT_TITLES = [
  "Data Engineer",
  "Senior Data Engineer",
  "Staff Data Engineer",
  "Lead Data Engineer",
  "Principal Data Engineer",
  "Analytics Engineer",
  "ETL Engineer",
  "Data Platform Engineer",
  "Data Infrastructure Engineer",
  "Big Data Engineer",
];

function buildSearchUrl(query = "Data Engineer") {
  const taxonomy = encodeURIComponent(
    JSON.stringify([{ taxonomyId: "00-00-00", title: query }])
  );
  const value = encodeURIComponent(query);
  return (
    `https://jobright.ai/jobs/search?visit=search&value=${value}` +
    `&searchType=job_title&country=US&jobTaxonomyList=${taxonomy}`
  );
}

async function apiPost(path, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "Local API offline — run npm start (or schedule:api) on port 3847"
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function getTitles() {
  const stored = await chrome.storage.local.get(["jobrightTitles", "searchQ"]);
  if (Array.isArray(stored.jobrightTitles) && stored.jobrightTitles.length) {
    return stored.jobrightTitles.map(String).filter(Boolean);
  }
  if (typeof stored.jobrightTitles === "string" && stored.jobrightTitles.trim()) {
    return stored.jobrightTitles
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // Prefer multi-title seeds; fall back to DEFAULT_TITLES.
  return DEFAULT_TITLES;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tab load timeout"));
    }, timeoutMs);

    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => {});
  });
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["jobright-content.js"],
    });
  } catch {
    /* already injected or page not ready */
  }
}

async function scrapeTab(tabId, titles) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await ensureContentScript(tabId);
    await sleep(800 + attempt * 500);
    try {
      const result = await chrome.tabs.sendMessage(tabId, {
        // v3+ — old content scripts ignored this type (they only handled SCRAPE_JOBRIGHT)
        type: "SCRAPE_JOBRIGHT_V3",
        titles,
      });
      // Stale CS (pre-v3) still throws recommend/search HTTP 400 via ok:false.
      if (result && result.ok === false && /HTTP 400/i.test(String(result.error || ""))) {
        lastErr = new Error(result.error);
        // Force re-inject: clear version so next ensureContentScript upgrades.
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            try {
              delete window.__SF_JOBRIGHT_CS_VERSION__;
              delete window.__SF_JOBRIGHT_CS_LOADED__;
              delete window.__AI_JOBRIGHT_CS_VERSION__;
              delete window.__AI_JOBRIGHT_CS_LOADED__;
            } catch {
              /* ignore */
            }
          },
        });
        continue;
      }
      return result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    lastErr?.message ||
      "Could not reach JobRight content script (reload the extension and stay signed in on jobright.ai)"
  );
}

/**
 * Open JobRight in a tab (uses existing login cookies), scrape, ingest, close.
 */
async function captureJobrightFromChrome() {
  const titles = await getTitles();
  const url = buildSearchUrl(titles[0] || "Data Engineer");

  const tab = await chrome.tabs.create({ url, active: false });
  const tabId = tab.id;

  try {
    await waitForTabComplete(tabId, 45000);
    await sleep(4000);

    const result = await scrapeTab(tabId, titles);

    if (!result?.ok) {
      throw new Error(result?.error || "JobRight scrape failed");
    }

    const ingest = await apiPost("/api/ingest", {
      source: "jobright",
      trusted: true,
      jobs: result.jobs || [],
    });

    await chrome.storage.local.set({
      lastJobrightCapture: {
        at: new Date().toISOString(),
        stats: result.stats,
        ingest,
      },
      lastJobrightError: null,
    });

    return { ok: true, stats: result.stats, ingest };
  } finally {
    try {
      if (tabId != null) await chrome.tabs.remove(tabId);
    } catch {
      /* ignore */
    }
  }
}

function nextRunMs(from = new Date()) {
  const now = from.getTime();
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    for (const hour of RUN_HOURS) {
      const d = new Date(from);
      d.setDate(d.getDate() + dayOffset);
      d.setHours(hour, 0, 0, 0);
      if (d.getTime() > now + 60_000) return d.getTime();
    }
  }
  const fallback = new Date(from);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(RUN_HOURS[0], 0, 0, 0);
  return fallback.getTime();
}

async function ensureAlarm() {
  for (const name of LEGACY_ALARMS) {
    await chrome.alarms.clear(name);
  }
  const when = nextRunMs();
  const existing = await chrome.alarms.get(ALARM);
  if (!existing || Math.abs((existing.scheduledTime || 0) - when) > 60_000) {
    await chrome.alarms.clear(ALARM);
    chrome.alarms.create(ALARM, { when });
  }
}

function scheduleNextAlarm() {
  chrome.alarms.create(ALARM, { when: nextRunMs() });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM) return;
  captureJobrightFromChrome()
    .catch((err) => {
      console.error("[jobright alarm]", err);
      chrome.storage.local.set({
        lastJobrightError: {
          at: new Date().toISOString(),
          error: String(err.message || err),
        },
      });
    })
    .finally(() => {
      scheduleNextAlarm();
    });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "CAPTURE_JOBRIGHT_NOW") {
    captureJobrightFromChrome()
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === "GET_JOBRIGHT_STATUS") {
    chrome.storage.local
      .get(["lastJobrightCapture", "lastJobrightError"])
      .then((data) => sendResponse({ ok: true, ...data }));
    return true;
  }
  return false;
});

ensureAlarm();
