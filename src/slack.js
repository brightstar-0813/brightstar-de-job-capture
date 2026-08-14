/**
 * Notify Slack via Incoming Webhook.
 */

import { postJson } from "./http.js";

export function isSlackWebhookUrl(url) {
  const raw = String(url || "").trim();
  return /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_+-]+$/i.test(raw);
}

export async function postSlackMessage(webhookUrl, text) {
  const endpoint = String(webhookUrl || "").trim();
  if (!isSlackWebhookUrl(endpoint)) {
    throw new Error(
      "Invalid Slack webhook URL. Paste a hooks.slack.com Incoming Webhook URL."
    );
  }

  const { status, body } = await postJson(endpoint, {
    text: String(text || "").trim() || "(empty)",
  });
  if (status < 200 || status >= 300) {
    throw new Error(body || `Slack notify failed (HTTP ${status}).`);
  }
  if (body && body !== "ok" && !/^ok\b/i.test(body)) {
    throw new Error(body);
  }
  return { ok: true };
}

function truncate(text, max = 120) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function sourceLabel(source) {
  const s = String(source || "").toLowerCase();
  if (!s) return "Capture";
  if (s.includes("+")) {
    return s
      .split("+")
      .map((part) => sourceLabel(part.trim()))
      .join(" + ");
  }
  const labels = {
    dice: "Dice",
    jobright: "JobRight",
    builtin: "Built In",
    greenhouse: "Greenhouse",
    ziprecruiter: "ZipRecruiter",
    monster: "Monster",
    both: "Dice + JobRight",
  };
  return labels[s] || source;
}

function jobSourceTag(job) {
  const s = String(job?.source || "").toLowerCase();
  const labels = {
    dice: "[Dice] ",
    jobright: "[JobRight] ",
    builtin: "[Built In] ",
    greenhouse: "[Greenhouse] ",
    ziprecruiter: "[ZipRecruiter] ",
    monster: "[Monster] ",
  };
  return labels[s] || "";
}

/**
 * @param {{
 *   webhookUrl: string,
 *   runId: number,
 *   source?: string,
 *   newCount: number,
 *   updatedCount: number,
 *   skippedCount: number,
 *   newJobs: Array<{ title?: string, organization?: string, url?: string, description?: string, source?: string }>
 * }} opts
 */
export async function notifyCaptureComplete({
  webhookUrl,
  runId,
  source,
  newCount = 0,
  updatedCount = 0,
  skippedCount = 0,
  newJobs = [],
}) {
  if (!webhookUrl || !isSlackWebhookUrl(webhookUrl)) {
    return { skipped: true, reason: "no_webhook" };
  }

  const resolvedSource =
    source ||
    (() => {
      const set = new Set(
        newJobs.map((j) => String(j.source || "").toLowerCase()).filter(Boolean)
      );
      if (set.size === 1) return [...set][0];
      if (set.has("dice") && set.has("jobright")) return "dice+jobright";
      return "";
    })();

  const label = sourceLabel(resolvedSource);
  const showPerJobTag =
    String(resolvedSource).includes("+") ||
    newJobs.some(
      (j) =>
        j.source &&
        String(j.source).toLowerCase() !== String(resolvedSource).toLowerCase()
    );

  const maxBullets = 15;
  const bullets = newJobs.slice(0, maxBullets).map((j) => {
    const tag = showPerJobTag ? jobSourceTag(j) : "";
    const who = [j.organization, j.title].filter(Boolean).join(" — ") || "job";
    const link = j.url ? ` <${j.url}|open>` : "";
    const preview = truncate(j.description, 100);
    return preview
      ? `• ${tag}${who}${link}\n  _${preview}_`
      : `• ${tag}${who}${link}`;
  });

  const more =
    newJobs.length > maxBullets
      ? `\n_…and ${newJobs.length - maxBullets} more new jobs_`
      : "";

  const header = `*${label} US-remote data engineering capture* (run #${runId})\nnew: *${newCount}* · updated: ${updatedCount} · skipped filter: ${skippedCount}`;
  const body =
    newCount > 0
      ? `${header}\n\n${bullets.join("\n")}${more}`
      : `${header}\n_No new data engineering jobs this run._`;

  await postSlackMessage(webhookUrl, body);
  return { ok: true };
}

/**
 * Alert that JobRight returned no authenticated results — its saved login is
 * missing or expired and needs to be refreshed with `npm run jobright:login`.
 * @param {{ webhookUrl: string, runId?: number }} opts
 */
export async function notifyJobrightLoginExpired({ webhookUrl, runId }) {
  if (!webhookUrl || !isSlackWebhookUrl(webhookUrl)) {
    return { skipped: true, reason: "no_webhook" };
  }
  const runTag = runId != null ? ` (run #${runId})` : "";
  const text =
    `:warning: *JobRight login expired*${runTag}\n` +
    `JobRight returned no authenticated results, so no JobRight jobs were captured this run. ` +
    `Dice is unaffected.\n` +
    `Fix: run \`npm run jobright:login\` to refresh the saved session.`;
  await postSlackMessage(webhookUrl, text);
  return { ok: true };
}

/**
 * Alert that the saved Dice login has expired, so already-applied Dice jobs
 * can't be excluded this run (they may reappear until you re-login).
 * @param {{ webhookUrl: string, runId?: number }} opts
 */
export async function notifyDiceLoginExpired({ webhookUrl, runId }) {
  if (!webhookUrl || !isSlackWebhookUrl(webhookUrl)) {
    return { skipped: true, reason: "no_webhook" };
  }
  const runTag = runId != null ? ` (run #${runId})` : "";
  const text =
    `:warning: *Dice login expired*${runTag}\n` +
    `Dice jobs were still captured, but already-applied jobs could not be excluded ` +
    `(they may reappear in results until you re-login).\n` +
    `Fix: run \`npm run dice:login\` to refresh the saved session.`;
  await postSlackMessage(webhookUrl, text);
  return { ok: true };
}
