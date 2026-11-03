/** Shared Playwright launch/context so board scrapers look less like bots. */

export const PLAYWRIGHT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export function browserLaunchOptions(headless) {
  return {
    headless,
    args: ["--disable-blink-features=AutomationControlled"],
  };
}

export function contextOptions(extra = {}) {
  return {
    userAgent: PLAYWRIGHT_UA,
    viewport: { width: 1400, height: 900 },
    locale: "en-US",
    extraHTTPHeaders: { "accept-language": "en-US,en;q=0.9" },
    ...extra,
  };
}
