/**
 * curl.exe / curl transport — Cloudflare / API-gateway friendly where
 * Node's fetch TLS fingerprint is blocked (Dice, WWR, Built In, JobRight).
 */

import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const CURL_BIN = process.platform === "win32" ? "curl.exe" : "curl";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function tmpPath(prefix) {
  return path.join(
    os.tmpdir(),
    `de-jobs-${prefix}-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.tmp`
  );
}

/**
 * @param {string} url
 * @param {{
 *   method?: string,
 *   headers?: Record<string,string>,
 *   body?: string,
 *   timeoutMs?: number,
 *   userAgent?: string,
 *   cookies?: string,
 * }} [opts]
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function curlRequest(url, opts = {}) {
  const outFile = tmpPath("out");
  const bodyFile = opts.body != null ? tmpPath("body") : null;
  const args = [
    "-sS",
    "--max-time",
    String(Math.max(5, Math.ceil((opts.timeoutMs ?? 45000) / 1000))),
    "-A",
    opts.userAgent || DEFAULT_UA,
    "-o",
    outFile,
    "-w",
    "%{http_code}",
  ];

  const headers = { ...(opts.headers || {}) };
  // Pass cookies as a header string. Do NOT use `-b <file>` unless the file
  // is Netscape format — a plain `name=value` file is misread as an empty jar.
  const cookieHeader = opts.cookies || headers.cookie || headers.Cookie || "";
  delete headers.cookie;
  delete headers.Cookie;
  if (cookieHeader) {
    args.push("-H", `Cookie: ${cookieHeader}`);
  }

  for (const [k, v] of Object.entries(headers)) {
    if (v == null || v === "") continue;
    args.push("-H", `${k}: ${v}`);
  }

  if (opts.method) args.push("-X", opts.method);
  if (bodyFile != null) {
    fs.writeFileSync(bodyFile, opts.body, "utf8");
    args.push("--data-binary", `@${bodyFile}`);
  }
  args.push(url);

  try {
    const { stdout, stderr } = await execFileAsync(CURL_BIN, args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    const status = Number(String(stdout || "").trim()) || 0;
    const body = fs.existsSync(outFile)
      ? fs.readFileSync(outFile, "utf8")
      : "";
    if (!status && stderr) {
      throw new Error(stderr.trim() || "curl failed");
    }
    return { status, body };
  } finally {
    for (const f of [outFile, bodyFile]) {
      if (f && fs.existsSync(f)) {
        try {
          fs.unlinkSync(f);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

export async function curlGetText(url, opts = {}) {
  const { status, body } = await curlRequest(url, opts);
  if (status < 200 || status >= 300) {
    throw new Error(`HTTP ${status} for ${url}`);
  }
  return body;
}

export async function curlGetJson(url, opts = {}) {
  const headers = {
    accept: "application/json, text/plain, */*",
    ...(opts.headers || {}),
  };
  const body = await curlGetText(url, { ...opts, headers });
  return JSON.parse(body);
}

export async function curlPostJson(url, payload, opts = {}) {
  const headers = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    ...(opts.headers || {}),
  };
  const { status, body } = await curlRequest(url, {
    ...opts,
    method: "POST",
    headers,
    body: JSON.stringify(payload ?? {}),
  });
  let json = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    json = null;
  }
  return { status, ok: status >= 200 && status < 300, json, body };
}

/** Prefer curl; fall back to fetch if curl is missing. */
export async function getTextPreferCurl(url, opts = {}) {
  try {
    return await curlGetText(url, opts);
  } catch (err) {
    if (/ENOENT|not found|curl/i.test(String(err?.message || err))) {
      const res = await fetch(url, {
        headers: {
          "user-agent": opts.userAgent || DEFAULT_UA,
          accept: opts.headers?.accept || "*/*",
          ...(opts.headers || {}),
        },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 45000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return text;
    }
    throw err;
  }
}

export async function getJsonPreferCurl(url, opts = {}) {
  const text = await getTextPreferCurl(url, {
    ...opts,
    headers: {
      accept: "application/json, text/plain, */*",
      ...(opts.headers || {}),
    },
  });
  return JSON.parse(text);
}
