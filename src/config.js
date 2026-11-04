import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const dataDir = path.resolve(root, process.env.DATA_DIR || "download");

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return String(raw).toLowerCase() !== "false";
}

function parseCsvList(raw, fallback) {
  const fromEnv = String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;
  return fallback;
}

function csvList(name, fallback) {
  return parseCsvList(process.env[name], fallback);
}

const DEFAULT_SEARCH_QUERIES = [
  "Data Engineer",
  "Senior Data Engineer",
  "Analytics Engineer",
  "ETL Engineer",
  "Data Platform Engineer",
];

const DEFAULT_JOBRIGHT_TITLES = [
  "Data Engineer",
  "Senior Data Engineer",
  "Staff Data Engineer",
  "Lead Data Engineer",
  "Principal Data Engineer",
  "Analytics Engineer",
  "ETL Engineer",
  "Data Platform Engineer",
  "Data Infrastructure Engineer",
  "Big Data Engineer",
];

export const config = {
  root,
  dataDir,
  /** Single combined CSV with latest jobs from all sources. */
  csvLatestFile: process.env.CSV_LATEST_FILE || "jobs_latest.csv",
  csvLatestPath: path.join(
    dataDir,
    process.env.CSV_LATEST_FILE || "jobs_latest.csv"
  ),
  storePath: path.join(dataDir, process.env.STORE_FILE || "store.json"),
  dbPath: path.join(dataDir, process.env.STORE_FILE || "store.json"),
  slackWebhookUrl: String(process.env.SLACK_WEBHOOK_URL || "").trim(),
  port: Number(process.env.PORT || 3847),
  /** Primary query label (logging / API status). */
  searchQ: process.env.SEARCH_Q || "Data Engineer",
  /**
   * Discovery queries for Dice / Built In / Himalayas / Remotive / …
   * Override with SEARCH_QUERIES (comma-separated).
   */
  searchQueries: parseCsvList(process.env.SEARCH_QUERIES, DEFAULT_SEARCH_QUERIES),
  maxPages: Math.max(1, Number(process.env.MAX_PAGES || 5)),
  /** Extra pages for secondary queries on feed APIs (Himalayas). */
  searchExtraPages: Math.max(1, Number(process.env.SEARCH_EXTRA_PAGES || 2)),
  /** Only capture/keep jobs posted within this many days. */
  recentDays: Math.max(1, Number(process.env.RECENT_DAYS || 3)),
  pageSize: Math.max(1, Math.min(100, Number(process.env.PAGE_SIZE || 20))),
  headless: bool("HEADLESS", true),
  delayMs: Math.max(0, Number(process.env.DELAY_MS || 800)),
  cronSchedule: process.env.CRON_SCHEDULE || "0 5,17 * * *",
  apiBase: `http://127.0.0.1:${Number(process.env.PORT || 3847)}`,
  captureDice: bool("CAPTURE_DICE", true),
  captureJobright: bool("CAPTURE_JOBRIGHT", true),
  captureBuiltin: bool("CAPTURE_BUILTIN", true),
  captureGreenhouse: bool("CAPTURE_GREENHOUSE", true),
  captureLever: bool("CAPTURE_LEVER", true),
  captureAshby: bool("CAPTURE_ASHBY", true),
  captureHimalayas: bool("CAPTURE_HIMALAYAS", true),
  captureRemotive: bool("CAPTURE_REMOTIVE", true),
  captureRemoteok: bool("CAPTURE_REMOTEOK", true),
  captureWwr: bool("CAPTURE_WWR", true),
  /** Often Cloudflare-blocked in headless — off by default (prefer public APIs). */
  captureZiprecruiter: bool("CAPTURE_ZIPRECRUITER", false),
  /** Often empty/blocked in headless — off by default (prefer public APIs). */
  captureMonster: bool("CAPTURE_MONSTER", false),
  /**
   * Greenhouse board tokens (boards.greenhouse.io/{token}).
   * Data-platform / analytics-leaning employers.
   */
  greenhouseBoards: csvList("GREENHOUSE_BOARDS", [
    "affirm",
    "stripe",
    "datadog",
    "notion",
    "figma",
    "hubspot",
    "twilio",
    "snowflakecomputing",
    "gitlab",
    "cloudflare",
    "doordash",
    "instacart",
    "asana",
    "coinbase",
    "gusto",
    "rippling",
    "ramp",
    "brex",
    "airbnb",
    "dropbox",
    "boxinc",
    "zendesk",
    "plaid",
    "calendly",
    "canva",
    "discord",
    "robinhood",
    "square",
    "block",
    "okta",
    "hashicorp",
    "databricks",
    "mongodb",
    "elastic",
    "confluent",
    "fivetran",
    "airbytehq",
    "dbtlabs",
    "prefect",
    "astronomer",
    "palantir",
    "docusign",
    "smartsheet",
    "qualtrics",
    "surveymonkey",
    "duolingo",
    "grammarly",
    "coursera",
    "udemy",
    "khanacademy",
    "vanta",
    "mercury",
    "flexport",
    "shippo",
    "faire",
    "whatnot",
  ]),
  /**
   * Lever company tokens (jobs.lever.co/{token}).
   */
  leverBoards: csvList("LEVER_BOARDS", [
    // Boards still answering api.lever.co (many former tokens 404'd).
    "resilinc",
    "padsplit",
    "railroad19",
    "massive-rocket",
    "coderio",
    "wealthfront",
    "linkedin",
    "neon",
    "fly",
    "docusign",
    "jetbrains",
    "pipedrive",
    "freshworks",
    "anduril",
    "samsara",
    "chime",
    "toast",
    "gong",
    "outreach",
    "lattice",
    "pagerduty",
    "launchdarkly",
    "snyk",
    "cockroachlabs",
    "clickhouse",
    "airtable",
    "webflow",
    "miro",
    "coda",
    "loom",
    "calendly",
    "typeform",
    "klaviyo",
    "braze",
    "iterable",
    "posthog",
    "retool",
    "scaleai",
  ]),
  /**
   * Ashby job-board tokens (jobs.ashbyhq.com/{token}).
   */
  ashbyBoards: csvList("ASHBY_BOARDS", [
    "databricks",
    "snowflake",
    "ramp",
    "notion",
    "linear",
    "vercel",
    "openai",
    "anthropic",
    "rippling",
    "vanta",
    "mercury",
    "brex",
    "plaid",
    "asana",
    "figma",
    "canva",
    "intercom",
    "retool",
    "cursor",
    "posthog",
  ]),
  jobrightAuthPath: path.resolve(
    root,
    process.env.JOBRIGHT_AUTH_PATH || path.join("download", "jobright-auth.json")
  ),
  jobrightMaxPages: Math.max(
    1,
    Number(process.env.JOBRIGHT_MAX_PAGES || process.env.MAX_PAGES || 5)
  ),
  /**
   * JobRight search SEEDS (not title filters). Keep/skip is the capture
   * rule: US remote + Data Engineer-family title.
   */
  jobrightTitles: parseCsvList(
    process.env.JOBRIGHT_TITLES,
    DEFAULT_JOBRIGHT_TITLES
  ),
};

/** Known capture source ids (used for status counts). */
export const SOURCE_IDS = [
  "dice",
  "jobright",
  "builtin",
  "greenhouse",
  "lever",
  "ashby",
  "himalayas",
  "remotive",
  "remoteok",
  "wwr",
  "ziprecruiter",
  "monster",
];

/**
 * Preferred posting when the same role appears on several boards.
 * Lower index = higher priority.
 */
export const SOURCE_PRIORITY = [
  "builtin",
  "himalayas",
  "greenhouse",
  "dice",
  "lever",
  "ashby",
  "remotive",
  "remoteok",
  "wwr",
  "ziprecruiter",
  "monster",
  "jobright",
];

/** CSV row order — mirrors SOURCE_PRIORITY (JobRight last). */
export const CSV_SOURCE_ORDER = [...SOURCE_PRIORITY];

export const CSV_HEADERS = [
  "id",
  "title",
  "organization",
  "location",
  "work_arrangement",
  "remote_restricted_to",
  "experience_level",
  "employment_type",
  "salary_min",
  "salary_max",
  "salary_currency",
  "salary_unit",
  "key_skills",
  "source",
  "date_posted",
  "url",
  "description",
  "first_seen_run_id",
  "last_seen_run_id",
  "first_seen_at",
  "last_seen_at",
  "status",
];
