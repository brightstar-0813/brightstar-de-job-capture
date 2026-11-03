/**
 * Ingest jobs from Chrome extension (JobRight logged-in session).
 */

import { captureRuleReason } from "./filter.js";
import {
  beginRun,
  finishRun,
  upsertJob,
  syncCsv,
  getMeta,
  pruneStore,
} from "./store.js";
import { notifyCaptureComplete } from "./slack.js";
import { config } from "./config.js";

/**
 * @param {object[]} jobs
 * @param {{ source?: string, skipSlack?: boolean }} [opts]
 */
export async function ingestJobsPayload(jobs, opts = {}) {
  const source = String(opts.source || "jobright").toLowerCase();
  const list = Array.isArray(jobs) ? jobs : [];
  const runId = beginRun();
  const counts = { newCount: 0, updatedCount: 0, skippedCount: 0 };
  const newJobs = [];

  for (const raw of list) {
    const job = {
      ...raw,
      source: raw.source || source,
      id: raw.id || (raw.jobId ? `${source}_${raw.jobId}` : null),
    };
    if (!job.id) {
      counts.skippedCount += 1;
      continue;
    }
    const reason = captureRuleReason(job);
    if (reason) {
      counts.skippedCount += 1;
      continue;
    }
    // Only accept autofill for jobright unless extension already filtered (trusted)
    if (source === "jobright" && !opts.trusted) {
      const apply = String(raw.applyLabel || raw.apply_type || "").toUpperCase();
      const easy = raw.jobtargetEasyapply === true || raw._easyApply === true;
      const isAutofill = easy || /AUTOFILL/i.test(apply);
      if (!isAutofill) {
        counts.skippedCount += 1;
        continue;
      }
    }

    const { status, job: saved } = upsertJob(job, runId);
    if (status === "new") {
      counts.newCount += 1;
      newJobs.push(saved);
    } else {
      counts.updatedCount += 1;
    }
  }

  pruneStore();
  const files = syncCsv();
  finishRun(runId, counts);

  if (!opts.skipSlack) {
    try {
      await notifyCaptureComplete({
        webhookUrl: config.slackWebhookUrl,
        runId,
        source,
        ...counts,
        newJobs,
      });
    } catch (err) {
      console.warn(`[ingest/slack] ${err.message}`);
    }
  }

  return {
    ok: true,
    runId,
    source,
    ...counts,
    received: list.length,
    files,
    lastCsv: getMeta("last_csv_path"),
  };
}
