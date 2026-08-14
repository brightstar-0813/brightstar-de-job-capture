/**
 * Capture US-remote data engineering jobs from Dice, JobRight, Built In,
 * Greenhouse, ZipRecruiter, and Monster. Task Scheduler / cron entrypoint.
 */

import { chromium } from "playwright";
import { config } from "./config.js";
import { searchDiceJobs } from "./dice/search.js";
import { scrapeJobDetails } from "./dice/detail.js";
import { searchJobrightJobs } from "./jobright/search.js";
import { searchBuiltinJobs } from "./builtin/search.js";
import { searchGreenhouseJobs } from "./greenhouse/search.js";
import { searchZiprecruiterJobs } from "./ziprecruiter/search.js";
import { searchMonsterJobs } from "./monster/search.js";
import { matchesCaptureRule } from "./filter.js";
import {
  beginRun,
  finishRun,
  upsertJob,
  syncCsv,
  closeStore,
  getMeta,
  pruneStore,
  removeJobs,
} from "./store.js";
import {
  notifyCaptureComplete,
  notifyJobrightLoginExpired,
  notifyDiceLoginExpired,
} from "./slack.js";

let running = false;

function ingestJobs(jobs, runId, counts, newJobs) {
  for (const job of jobs) {
    if (!job?.id) {
      counts.skippedCount += 1;
      continue;
    }
    if (!matchesCaptureRule(job)) {
      counts.skippedCount += 1;
      console.log(
        `[filter] skip ${job.id}: not US-remote data engineering title`
      );
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
  if (config.captureDice) out.push("dice");
  if (config.captureJobright) out.push("jobright");
  if (config.captureBuiltin) out.push("builtin");
  if (config.captureGreenhouse) out.push("greenhouse");
  if (config.captureZiprecruiter) out.push("ziprecruiter");
  if (config.captureMonster) out.push("monster");
  return out;
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
  let diceAuthExpired = false;
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
    browser = await chromium.launch({ headless: config.headless });

    if (config.captureDice) {
      try {
        const { jobs: stubs, appliedIds: diceApplied, unauthenticated } =
          await searchDiceJobs(browser);
        diceAuthExpired = !!unauthenticated;
        console.log(`[capture] dice listings: ${stubs.length}`);
        const details = await scrapeJobDetails(browser, stubs);
        console.log(`[capture] dice details: ${details.length}`);
        ingestJobs(details, runId, counts, newJobs);

        if (Array.isArray(diceApplied) && diceApplied.length) {
          const { removed } = removeJobs(diceApplied);
          if (removed > 0) {
            console.log(
              `[capture] removed ${removed} already-applied dice jobs from store`
            );
          }
        }
      } catch (err) {
        console.warn(`[capture] dice failed, continuing: ${err.message}`);
        try {
          await browser.close();
        } catch {
          /* ignore */
        }
        browser = await chromium.launch({ headless: config.headless });
      }
    }

    if (config.captureBuiltin) {
      const { jobs } = await searchBuiltinJobs(browser);
      console.log(`[capture] builtin jobs: ${jobs.length}`);
      ingestJobs(jobs, runId, counts, newJobs);
    }

    if (config.captureGreenhouse) {
      const { jobs } = await searchGreenhouseJobs(browser);
      console.log(`[capture] greenhouse jobs: ${jobs.length}`);
      ingestJobs(jobs, runId, counts, newJobs);
    }

    if (config.captureZiprecruiter) {
      const { jobs, blocked } = await searchZiprecruiterJobs(browser);
      console.log(
        `[capture] ziprecruiter jobs: ${jobs.length}${blocked ? " (blocked)" : ""}`
      );
      ingestJobs(jobs, runId, counts, newJobs);
    }

    if (config.captureMonster) {
      const { jobs, blocked } = await searchMonsterJobs(browser);
      console.log(
        `[capture] monster jobs: ${jobs.length}${blocked ? " (blocked)" : ""}`
      );
      ingestJobs(jobs, runId, counts, newJobs);
    }

    // JobRight last — CSV export also places JobRight rows at the bottom.
    if (config.captureJobright) {
      const { jobs: jrJobs, auth, appliedIds } = await searchJobrightJobs(browser);
      console.log(`[capture] jobright jobs: ${jrJobs.length}`);
      jobrightAuthExpired = !!auth?.unauthenticated;
      ingestJobs(jrJobs, runId, counts, newJobs);

      if (Array.isArray(appliedIds) && appliedIds.length) {
        const { removed } = removeJobs(appliedIds);
        if (removed > 0) {
          console.log(
            `[capture] removed ${removed} already-applied jobright jobs from store`
          );
        }
      }
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
        if (diceAuthExpired) {
          await notifyDiceLoginExpired({
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
