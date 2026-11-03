/**
 * Capture US-remote data engineering jobs — public APIs/feeds first
 * (Greenhouse, Lever, Ashby, Himalayas, Remotive, Remote OK, WWR),
 * plus Dice, Built In, and JobRight (API-first). ZipRecruiter/Monster
 * stay off by default (often blocked in headless).
 */

import { chromium } from "playwright";
import { config } from "./config.js";
import { browserLaunchOptions } from "./browser.js";
import { searchDiceJobs } from "./dice/search.js";
import { scrapeJobDetails } from "./dice/detail.js";
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
import { captureRuleReason, looksDataEngTitle } from "./filter.js";
import {
  beginRun,
  finishRun,
  upsertJob,
  syncCsv,
  closeStore,
  getMeta,
  pruneStore,
  removeJobs,
  repairJobrightUrls,
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

async function collectFeedJobs() {
  const runners = [];
  if (config.captureHimalayas) runners.push(["himalayas", searchHimalayasJobs]);
  if (config.captureGreenhouse) runners.push(["greenhouse", searchGreenhouseJobs]);
  if (config.captureLever) runners.push(["lever", searchLeverJobs]);
  if (config.captureAshby) runners.push(["ashby", searchAshbyJobs]);
  if (config.captureRemotive) runners.push(["remotive", searchRemotiveJobs]);
  if (config.captureRemoteok) runners.push(["remoteok", searchRemoteokJobs]);
  if (config.captureWwr) runners.push(["wwr", searchWwrJobs]);
  if (!runners.length) return [];

  const batches = await Promise.all(
    runners.map(async ([name, fn]) => {
      const result = await runNamedSource(name, fn);
      const jobs = result?.jobs || [];
      console.log(`[capture] ${name} jobs: ${jobs.length}`);
      return jobs;
    })
  );
  return batches.flat();
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
    const feedPromise = collectFeedJobs();

    browser = await chromium.launch(browserLaunchOptions(config.headless));

    if (config.captureBuiltin) {
      await runNamedSource("builtin", async () => {
        const { jobs } = await searchBuiltinJobs(browser);
        console.log(`[capture] builtin jobs: ${jobs.length}`);
        ingestJobs(jobs, runId, counts, newJobs);
      });
    }

    if (config.captureDice) {
      await runNamedSource("dice", async () => {
        const { jobs: stubs, appliedIds: diceApplied, unauthenticated } =
          await searchDiceJobs(browser);
        diceAuthExpired = !!unauthenticated;
        const relevant = stubs.filter((s) => looksDataEngTitle(s.title));
        const skippedTitle = stubs.length - relevant.length;
        console.log(
          `[capture] dice listings: ${stubs.length}` +
            (skippedTitle
              ? ` (skip ${skippedTitle} unrelated titles before detail)`
              : "")
        );
        const details = await scrapeJobDetails(browser, relevant);
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
      });
    }

    if (config.captureZiprecruiter) {
      await runNamedSource("ziprecruiter", async () => {
        const { jobs, blocked } = await searchZiprecruiterJobs(browser);
        console.log(
          `[capture] ziprecruiter jobs: ${jobs.length}${blocked ? " (blocked)" : ""}`
        );
        ingestJobs(jobs, runId, counts, newJobs);
      });
    }

    if (config.captureMonster) {
      await runNamedSource("monster", async () => {
        const { jobs, blocked } = await searchMonsterJobs(browser);
        console.log(
          `[capture] monster jobs: ${jobs.length}${blocked ? " (blocked)" : ""}`
        );
        ingestJobs(jobs, runId, counts, newJobs);
      });
    }

    const feedJobs = await feedPromise;
    if (feedJobs.length) {
      ingestJobs(feedJobs, runId, counts, newJobs);
    }

    // JobRight last — CSV / fingerprint priority also ranks it lowest.
    if (config.captureJobright) {
      await runNamedSource("jobright", async () => {
        const { jobs: jrJobs, auth, appliedIds } =
          await searchJobrightJobs(browser);
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
