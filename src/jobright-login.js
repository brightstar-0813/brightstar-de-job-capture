/**
 * One-time JobRight login — saves session cookies for API-only capture.
 * After this, scheduled runs call /swan/recommend/search directly (no browser UI).
 *
 * Usage: npm run jobright:login
 * A browser window opens; sign in to JobRight, then return here and press Enter.
 */

import fs from "fs";
import path from "path";
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
  fs.mkdirSync(path.dirname(config.jobrightAuthPath), { recursive: true });
  console.log("Opening JobRight — sign in in the browser window.");
  console.log(`Auth will be saved to: ${config.jobrightAuthPath}`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("https://jobright.ai/jobs/search", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await ask(
    "\nAfter you are logged in and can see APPLY WITH AUTOFILL buttons, press Enter here… "
  );

  await context.storageState({ path: config.jobrightAuthPath });
  await browser.close();
  console.log(`Saved: ${config.jobrightAuthPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
