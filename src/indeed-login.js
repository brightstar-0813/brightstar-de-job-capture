/**
 * One-time Indeed session — complete Cloudflare (and optional sign-in) in a
 * real Chrome window, then save the profile for headless capture.
 *
 * Usage: npm run indeed:login
 */

import fs from "fs";
import readline from "readline";
import { chromium } from "playwright";
import { config } from "./config.js";

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  fs.mkdirSync(config.indeedProfileDir, { recursive: true });
  console.log("Opening Indeed in Chrome.");
  console.log("Pass the Cloudflare check (and sign in if asked) until you see job cards.");
  console.log(`Profile: ${config.indeedProfileDir}`);

  let context;
  try {
    context = await chromium.launchPersistentContext(config.indeedProfileDir, {
      headless: false,
      channel: "chrome",
      viewport: { width: 1400, height: 900 },
      locale: "en-US",
    });
  } catch {
    context = await chromium.launchPersistentContext(config.indeedProfileDir, {
      headless: false,
      viewport: { width: 1400, height: 900 },
      locale: "en-US",
    });
  }

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(
    "https://www.indeed.com/jobs?q=Data+Engineer&l=Remote&fromage=7&sort=date",
    { waitUntil: "domcontentloaded", timeout: 90000 }
  );

  await ask(
    "\nWhen you can see Data Engineer job listings (not “Additional Verification Required”), press Enter here… "
  );

  await context.storageState({ path: config.indeedAuthPath });
  await context.close();
  console.log(`Saved cookies: ${config.indeedAuthPath}`);
  console.log("Next capture will reuse this Indeed session.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
