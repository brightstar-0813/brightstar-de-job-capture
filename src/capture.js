/**
 * Capture US-remote data engineering jobs — public APIs/feeds first
 * (Greenhouse, Lever, Ashby, Himalayas, Remotive, Remote OK, WWR),
 * plus Dice, Built In, and JobRight over HTTP/curl (no browser required
 * for discovery). ZipRecruiter/Monster stay off by default.
 */

import { chromium } from "playwright";
import { config } from "./config.js";
import { browserLaunchOptions } from "./browser.js";
import { searchDiceJobs } from "./dice/search.js";
import { searchJobrightJobs } from "./jobright/search.js";
import { searchBuiltinJobs } from "./builtin/search.js";
import { searchGreenhouseJobs } from "./greenhouse/search.js";
import { searchLeverJobs } from "./lever/search.js";
import { searchAshbyJobs } from "./ashby/search.js";
import { searchHimalayasJobs } from "./himalayas/search.js";
import { searchRemotiveJobs } from "./remotive/search.js";
import { searchRemoteokJobs } from "./remoteok/search.js";
import { searchWwrJobs } from "./wwr/search.js";
import { searchZiprecruiterJobs } from "./ziprecruiter/search.js";
import { searchMonsterJobs } from "./monster/search.js";
import { captureRuleReason } from "./filter.js";
import {
  beginRun,
  finishRun,
  upsertJob,
  syncCsv,
  closeStore,
  getMeta,
  pruneStore,
  repairJobrightUrls,
} from "./store.js";
import {
  notifyCaptureComplete,
  notifyJobrightLoginExpired,
} from "./slack.js";

let running = false;

function ingestJobs(jobs, runId, counts, newJobs) {
  for (const job of jobs) {
    if (!job?.id) {
      counts.skippedCount += 1;
      continue;
    }
    const reason = captureRuleReason(job);
    if (reason) {
      counts.skippedCount += 1;
      console.log(`[filter] skip ${job.id}: ${reason}`);
      continue;
    }
    const { status, job: saved } = upsertJob(job, runId);
    if (status === "new") {
      counts.newCount += 1;
      newJobs.push(saved);
    } else {
      counts.updatedCount += 1;
    }
  }
}

function enabledSources() {
  const out = [];
  if (config.captureBuiltin) out.push("builtin");
  if (config.captureHimalayas) out.push("himalayas");
  if (config.captureGreenhouse) out.push("greenhouse");
  if (config.captureDice) out.push("dice");
  if (config.captureLever) out.push("lever");
  if (config.captureAshby) out.push("ashby");
  if (config.captureRemotive) out.push("remotive");
  if (config.captureRemoteok) out.push("remoteok");
  if (config.captureWwr) out.push("wwr");
  if (config.captureZiprecruiter) out.push("ziprecruiter");
  if (config.captureMonster) out.push("monster");
  if (config.captureJobright) out.push("jobright");
  return out;
}

async function runNamedSource(name, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[capture] ${name} failed: ${err.message}`);
    return null;
  }
}

async function runPool(runners, concurrency) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < runners.length) {
      const idx = i;
      i += 1;
      const [name, fn] = runners[idx];
      const result = await runNamedSource(name, fn);
      const jobs = result?.jobs || [];
      console.log(`[capture] ${name} jobs: ${jobs.length}`);
      out[idx] = { name, result, jobs };
    }
  }
  const n = Math.max(1, Math.min(concurrency, runners.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out.filter(Boolean);
}

async function collectFeedJobs() {
  // Node-fetch ATS/feeds — fine in parallel.
  const fetchRunners = [];
  if (config.captureHimalayas) fetchRunners.push(["himalayas", searchHimalayasJobs]);
  if (config.captureGreenhouse) {
    fetchRunners.push(["greenhouse", searchGreenhouseJobs]);
  }
  if (config.captureLever) fetchRunners.push(["lever", searchLeverJobs]);
  if (config.captureAshby) fetchRunners.push(["ashby", searchAshbyJobs]);
  if (config.captureRemotive) fetchRunners.push(["remotive", searchRemotiveJobs]);
  if (config.captureRemoteok) fetchRunners.push(["remoteok", searchRemoteokJobs]);

  // curl sources — limit concurrency; Cloudflare rate-limits burst traffic.
  const curlRunners = [];
  if (config.captureWwr) curlRunners.push(["wwr", searchWwrJobs]);
  if (config.captureBuiltin) curlRunners.push(["builtin", searchBuiltinJobs]);
  if (config.captureDice) curlRunners.push(["dice", searchDiceJobs]);
  if (config.captureJobright) curlRunners.push(["jobright", searchJobrightJobs]);

  const fetchBatches = await runPool(fetchRunners, 6);
  const curlBatches = await runPool(curlRunners, 2);
  return [...fetchBatches, ...curlBatches];
}

function needsBrowser() {
  // Discovery is HTTP/curl. Playwright only for optional ZipRecruiter/Monster.
  return config.captureZiprecruiter || config.captureMonster;
}

export async function runCapture({ skipSlack = false } = {}) {
  if (running) {
    return { ok: false, error: "Capture already in progress" };
  }
  running = true;
  const runId = beginRun();
  const counts = { newCount: 0, updatedCount: 0, skippedCount: 0 };
  const newJobs = [];
  let jobrightAuthExpired = false;
  const enabled = enabledSources();

  console.log(
    `[capture] run #${runId} starting (queries=${(config.searchQueries || [config.searchQ]).join(" | ")}) sources=${enabled.join(",")}`
  );

  let browser;
  const swallowTransient = (err) => {
    console.warn(`[capture] transient browser error: ${err?.message || err}`);
  };
  process.on("uncaughtException", swallowTransient);
  process.on("unhandledRejection", swallowTransient);

  try {
    const useBrowser = needsBrowser();
    if (useBrowser) {
      browser = await chromium.launch(browserLaunchOptions(config.headless));
    } else {
      console.log(`[capture] API/curl mode — no Playwright browser`);
    }

    // Parallel public HTTP sources (includes Built In / Dice / JobRight).
    const feedBatches = await collectFeedJobs();
    for (const batch of feedBatches) {
      if (!batch) continue;
      if (batch.name === "jobright") {
        jobrightAuthExpired = !!batch.result?.auth?.unauthenticated;
      }
      if (batch.jobs?.length) {
        ingestJobs(batch.jobs, runId, counts, newJobs);
      }
    }

    // Optional browser-only boards (off by default).
    if (browser && config.captureZiprecruiter) {
      await runNamedSource("ziprecruiter", async () => {
        const { jobs, blocked } = await searchZiprecruiterJobs(browser);
        console.log(
          `[capture] ziprecruiter jobs: ${jobs.length}${blocked ? " (blocked)" : ""}`
        );
        ingestJobs(jobs, runId, counts, newJobs);
      });
    }

    if (browser && config.captureMonster) {
      await runNamedSource("monster", async () => {
        const { jobs, blocked } = await searchMonsterJobs(browser);
        console.log(
          `[capture] monster jobs: ${jobs.length}${blocked ? " (blocked)" : ""}`
        );
        ingestJobs(jobs, runId, counts, newJobs);
      });
    }

    const repaired = repairJobrightUrls();
    if (repaired.repaired > 0) {
      console.log(
        `[capture] repaired ${repaired.repaired} incomplete JobRight URLs`
      );
    }

    const pruned = pruneStore();
    if (pruned.removed > 0) {
      console.log(
        `[capture] pruned ${pruned.removed} legacy jobs no longer matching rule`
      );
    }
    const csvOut = syncCsv();
    console.log(
      `[capture] done — new=${counts.newCount} updated=${counts.updatedCount} skipped=${counts.skippedCount}`
    );
    console.log(
      `[capture] csv=${csvOut.csvPath} (rows=${csvOut.count})`
    );

    if (!skipSlack) {
      try {
        await notifyCaptureComplete({
          webhookUrl: config.slackWebhookUrl,
          runId,
          source: enabled.join("+"),
          ...counts,
          newJobs,
        });
        if (jobrightAuthExpired) {
          await notifyJobrightLoginExpired({
            webhookUrl: config.slackWebhookUrl,
            runId,
          });
        }
      } catch (slackErr) {
        console.warn(`[slack] ${slackErr.message}`);
      }
    }

    finishRun(runId, counts);
    return {
      ok: true,
      runId,
      ...counts,
      newJobs,
      csvPath: csvOut.csvPath,
      latestPath: csvOut.latestPath,
      csvCount: csvOut.count,
      lastCsv: getMeta("last_csv_path"),
    };
  } catch (err) {
    const error = err.message || String(err);
    console.error(`[capture] failed: ${error}`);
    finishRun(runId, counts, error);
    return { ok: false, runId, ...counts, error };
  } finally {
    process.off("uncaughtException", swallowTransient);
    process.off("unhandledRejection", swallowTransient);
    if (browser) await browser.close().catch(() => {});
    running = false;
  }
}

export function isCaptureRunning() {
  return running;
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("capture.js") ||
    process.argv[1].replace(/\\/g, "/").endsWith("/src/capture.js"));

if (isMain) {
  runCapture()
    .then((result) => {
      closeStore();
      process.exit(result.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      closeStore();
      process.exit(1);
    });
}
