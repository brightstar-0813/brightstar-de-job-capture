import https from "https";
import { URL } from "url";

/**
 * POST JSON via Node https (works on Node 16 without global fetch).
 */
export function postJson(urlString, payload) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch (err) {
      reject(err);
      return;
    }
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const FETCH_HEADERS = {
  accept: "application/json, application/rss+xml, text/xml, */*",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

export async function getText(urlString, { timeoutMs = 20000 } = {}) {
  const res = await fetch(urlString, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${urlString}`);
  }
  return body;
}

export async function getJson(urlString, opts = {}) {
  const body = await getText(urlString, opts);
  return JSON.parse(body);
}

/** Like getJson, but returns { ok, status, json } without throwing on HTTP errors. */
export async function tryGetJson(
  urlString,
  { timeoutMs = 20000, headers = {} } = {}
) {
  try {
    const res = await fetch(urlString, {
      headers: { ...FETCH_HEADERS, ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    return { ok: false, status: 0, json: null, error: err.message };
  }
}
