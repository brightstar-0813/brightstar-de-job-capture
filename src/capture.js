/**
 * Capture US-remote data engineering jobs — public APIs/feeds first
 * (Greenhouse, Lever, Ashby, Himalayas, Remotive, Jobicy, Remote OK, WWR,
 * Working Nomads, Jobspresso, SkipTheDrive, Arc, Jobgether, Arbeitnow,
 * The Muse, USAJOBS, Adzuna, Google Jobs), plus Dice / Built In over HTTP/curl,
 * JobRight via Playwright (Cloudflare clearance, no account login),
 * and Playwright ZipRecruiter / Monster. Indeed / CareerBuilder stay off by default.
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
import { searchJobicyJobs } from "./jobicy/search.js";
import { searchRemoteokJobs } from "./remoteok/search.js";
import { searchWwrJobs } from "./wwr/search.js";
import { searchJobgetherJobs } from "./jobgether/search.js";
import { searchArbeitnowJobs } from "./arbeitnow/search.js";
import { searchThemuseJobs } from "./themuse/search.js";
import { searchWorkingnomadsJobs } from "./workingnomads/search.js";
import { searchJobspressoJobs } from "./jobspresso/search.js";
import { searchSkipthedriveJobs } from "./skipthedrive/search.js";
import { searchArcJobs } from "./arc/search.js";
import { searchUsajobsJobs } from "./usajobs/search.js";
import { searchAdzunaJobs } from "./adzuna/search.js";
import { searchGoogleJobs } from "./googlejobs/search.js";
import { searchZiprecruiterJobs } from "./ziprecruiter/search.js";
import { searchMonsterJobs } from "./monster/search.js";
import { searchIndeedJobs } from "./indeed/search.js";
import { searchCareerbuilderJobs } from "./careerbuilder/search.js";
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
import { notifyCaptureComplete } from "./slack.js";

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
  if (config.captureJobicy) out.push("jobicy");
  if (config.captureRemoteok) out.push("remoteok");
  if (config.captureWwr) out.push("wwr");
  if (config.captureJobgether) out.push("jobgether");
  if (config.captureArbeitnow) out.push("arbeitnow");
  if (config.captureThemuse) out.push("themuse");
  if (config.captureWorkingnomads) out.push("workingnomads");
  if (config.captureJobspresso) out.push("jobspresso");
  if (config.captureSkipthedrive) out.push("skipthedrive");
  if (config.captureArc) out.push("arc");
  if (config.captureUsajobs) out.push("usajobs");
  if (config.captureAdzuna) out.push("adzuna");
  if (config.captureGooglejobs) out.push("googlejobs");
  if (config.captureZiprecruiter) out.push("ziprecruiter");
  if (config.captureMonster) out.push("monster");
  if (config.captureIndeed) out.push("indeed");
  if (config.captureCareerbuilder) out.push("careerbuilder");
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
  const fetchRunners = [];
  if (config.captureHimalayas) fetchRunners.push(["himalayas", searchHimalayasJobs]);
  if (config.captureGreenhouse) {
    fetchRunners.push(["greenhouse", searchGreenhouseJobs]);
  }
  if (config.captureLever) fetchRunners.push(["lever", searchLeverJobs]);
  if (config.captureAshby) fetchRunners.push(["ashby", searchAshbyJobs]);
  if (config.captureRemotive) fetchRunners.push(["remotive", searchRemotiveJobs]);
  if (config.captureJobicy) fetchRunners.push(["jobicy", searchJobicyJobs]);
  if (config.captureRemoteok) fetchRunners.push(["remoteok", searchRemoteokJobs]);
  if (config.captureJobgether) fetchRunners.push(["jobgether", searchJobgetherJobs]);
  if (config.captureArbeitnow) fetchRunners.push(["arbeitnow", searchArbeitnowJobs]);
  if (config.captureThemuse) fetchRunners.push(["themuse", searchThemuseJobs]);
  if (config.captureWorkingnomads) {
    fetchRunners.push(["workingnomads", searchWorkingnomadsJobs]);
  }
  if (config.captureJobspresso) {
    fetchRunners.push(["jobspresso", searchJobspressoJobs]);
  }
  if (config.captureSkipthedrive) {
    fetchRunners.push(["skipthedrive", searchSkipthedriveJobs]);
  }
  if (config.captureArc) fetchRunners.push(["arc", searchArcJobs]);
  if (config.captureUsajobs) fetchRunners.push(["usajobs", searchUsajobsJobs]);
  if (config.captureAdzuna) fetchRunners.push(["adzuna", searchAdzunaJobs]);
  if (config.captureGooglejobs) {
    fetchRunners.push(["googlejobs", searchGoogleJobs]);
  }

  // curl sources — limit concurrency; Cloudflare rate-limits burst traffic.
  const curlRunners = [];
  if (config.captureWwr) curlRunners.push(["wwr", searchWwrJobs]);
  if (config.captureBuiltin) curlRunners.push(["builtin", searchBuiltinJobs]);
  if (config.captureDice) curlRunners.push(["dice", searchDiceJobs]);

  const fetchBatches = await runPool(fetchRunners, 6);
  const curlBatches = await runPool(curlRunners, 2);
  return [...fetchBatches, ...curlBatches];
}

function needsBrowser() {
  return (
    config.captureJobright ||
    config.captureZiprecruiter ||
    config.captureMonster ||
    config.captureIndeed ||
    config.captureCareerbuilder
  );
}

export async function runCapture({ skipSlack = false } = {}) {
  if (running) {
    return { ok: false, error: "Capture already in progress" };
  }
  running = true;
  const runId = beginRun();
  const counts = { newCount: 0, updatedCount: 0, skippedCount: 0 };
  const newJobs = [];
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

    const feedBatches = await collectFeedJobs();
    for (const batch of feedBatches) {
      if (!batch) continue;
      if (batch.jobs?.length) {
        ingestJobs(batch.jobs, runId, counts, newJobs);
      }
    }

    // JobRight: Playwright public search (no account login).
    if (browser && config.captureJobright) {
      await runNamedSource("jobright", async () => {
        const { jobs } = await searchJobrightJobs(browser);
        console.log(`[capture] jobright jobs: ${jobs.length}`);
        ingestJobs(jobs, runId, counts, newJobs);
      });
    }

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

    if (browser && config.captureIndeed) {
      await runNamedSource("indeed", async () => {
        const { jobs, blocked } = await searchIndeedJobs(browser);
        console.log(
          `[capture] indeed jobs: ${jobs.length}${blocked ? " (blocked)" : ""}`
        );
        ingestJobs(jobs, runId, counts, newJobs);
      });
    }

    if (browser && config.captureCareerbuilder) {
      await runNamedSource("careerbuilder", async () => {
        const { jobs, blocked } = await searchCareerbuilderJobs(browser);
        console.log(
          `[capture] careerbuilder jobs: ${jobs.length}${blocked ? " (blocked)" : ""}`
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
    console.log(`[capture] csv=${csvOut.csvPath} (rows=${csvOut.count})`);
    const parts = Object.entries(csvOut.bySource || {})
      .filter(([, v]) => v.count > 0)
      .map(([src, v]) => `${src}=${v.count}`)
      .join(", ");
    if (parts) {
      console.log(`[capture] per-source csv: ${parts}`);
    }

    if (!skipSlack) {
      try {
        await notifyCaptureComplete({
          webhookUrl: config.slackWebhookUrl,
          runId,
          source: enabled.join("+"),
          ...counts,
          newJobs,
        });
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
      bySource: csvOut.bySource,
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
