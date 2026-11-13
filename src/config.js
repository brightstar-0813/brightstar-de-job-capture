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
  "Staff Data Engineer",
  "Analytics Engineer",
  "ETL Engineer",
  "Data Platform Engineer",
  "Databricks Engineer",
  "Snowflake Data Engineer",
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
  "Data Warehouse Engineer",
  "Data Pipeline Engineer",
  "Cloud Data Engineer",
  "Snowflake Data Engineer",
  "Databricks Engineer",
  "Spark Engineer",
  "Azure Data Engineer",
  "AWS Data Engineer",
  "GCP Data Engineer",
  "Data Integration Engineer",
  "Junior Data Engineer",
  "Python Data Engineer",
  "Data Engineering Manager",
  "Data Ops Engineer",
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
  captureJobicy: bool("CAPTURE_JOBICY", true),
  captureRemoteok: bool("CAPTURE_REMOTEOK", true),
  captureWwr: bool("CAPTURE_WWR", true),
  captureJobgether: bool("CAPTURE_JOBGETHER", true),
  captureArbeitnow: bool("CAPTURE_ARBEITNOW", true),
  captureThemuse: bool("CAPTURE_THEMUSE", true),
  captureWorkingnomads: bool("CAPTURE_WORKINGNOMADS", true),
  captureJobspresso: bool("CAPTURE_JOBSPRESSO", true),
  captureSkipthedrive: bool("CAPTURE_SKIPTHEDRIVE", true),
  captureArc: bool("CAPTURE_ARC", true),
  captureUsajobs: bool("CAPTURE_USAJOBS", true),
  captureAdzuna: bool("CAPTURE_ADZUNA", true),
  captureGooglejobs: bool("CAPTURE_GOOGLEJOBS", true),
  /** Playwright ZipRecruiter — on by default; may no-op if Cloudflare blocks. */
  captureZiprecruiter: bool("CAPTURE_ZIPRECRUITER", true),
  /** Playwright Monster — on by default; fail soft when blocked. */
  captureMonster: bool("CAPTURE_MONSTER", true),
  /** Indeed scrape — off by default (Cloudflare); set CAPTURE_INDEED=true. */
  captureIndeed: bool("CAPTURE_INDEED", false),
  /** CareerBuilder — off by default (often bot-blocked). */
  captureCareerbuilder: bool("CAPTURE_CAREERBUILDER", false),
  usajobsApiKey: String(process.env.USAJOBS_API_KEY || "").trim(),
  usajobsUserEmail: String(process.env.USAJOBS_USER_EMAIL || "").trim(),
  adzunaAppId: String(process.env.ADZUNA_APP_ID || "").trim(),
  adzunaAppKey: String(process.env.ADZUNA_APP_KEY || "").trim(),
  serpapiKey: String(process.env.SERPAPI_KEY || "").trim(),
  jobicyTags: csvList("JOBICY_TAGS", ["python", "data", "etl", "sql"]),
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
    "amplitude",
    "mixpanel",
    "sentry",
    "launchdarkly",
    "fullstory",
    "spotify",
    "adobe",
    "intuit",
    "paypal",
    "sofi",
    "chime",
    "slack",
    "heroku",
    "crowdstrike",
    "samsara",
    "gong",
    "clari",
    "outreach",
    "braze",
    "iterable",
    "klaviyo",
    "informatica",
    "snaplogic",
    "workato",
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
    "dbtlabs",
    "fivetran",
    "airbyte",
    "prefect",
    "astronomer",
  ]),
  indeedAuthPath: path.resolve(
    root,
    process.env.INDEED_AUTH_PATH || path.join("download", "indeed-auth.json")
  ),
  indeedHeaded: bool("INDEED_HEADED", false),
  /**
   * Playwright storageState cookies for JobRight /swan (Cloudflare clearance).
   */
  jobrightAuthPath: path.resolve(
    root,
    process.env.JOBRIGHT_AUTH_PATH || path.join("download", "jobright-auth.json")
  ),
  /**
   * Role-title fan-out for Jobspresso (and optional Built In). Tune via ROLE_TITLES.
   */
  roleTitles: csvList("ROLE_TITLES", DEFAULT_JOBRIGHT_TITLES),
  rolePages: Math.max(1, Number(process.env.ROLE_PAGES || 2)),
  jobrightMaxPages: Math.max(
    1,
    Number(process.env.JOBRIGHT_MAX_PAGES || process.env.MAX_PAGES || 5)
  ),
  /**
   * JobRight search SEEDS (not title filters). Keep/skip is the capture
   * rule: US remote + Data Engineer-family title. /swan returns 20 jobs per
   * page; JOBRIGHT_MAX_PAGES (default 5) pages each seed.
   */
  jobrightTitles: csvList("JOBRIGHT_TITLES", DEFAULT_JOBRIGHT_TITLES),
};

export function pagesForSearchQuery(index) {
  return Number(index) === 0 ? config.maxPages : config.searchExtraPages;
}

/** Known capture source ids (used for status counts). */
export const SOURCE_IDS = [
  "builtin",
  "himalayas",
  "greenhouse",
  "dice",
  "lever",
  "ashby",
  "remotive",
  "jobicy",
  "remoteok",
  "wwr",
  "jobgether",
  "arbeitnow",
  "themuse",
  "workingnomads",
  "jobspresso",
  "skipthedrive",
  "arc",
  "usajobs",
  "adzuna",
  "googlejobs",
  "ziprecruiter",
  "monster",
  "indeed",
  "careerbuilder",
  "jobright",
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
  "indeed",
  "ziprecruiter",
  "careerbuilder",
  "monster",
  "jobgether",
  "themuse",
  "remotive",
  "jobicy",
  "remoteok",
  "wwr",
  "workingnomads",
  "jobspresso",
  "skipthedrive",
  "arc",
  "arbeitnow",
  "usajobs",
  "adzuna",
  "googlejobs",
  "jobright",
];

/** CSV row order — mirrors SOURCE_PRIORITY (JobRight last). */
export const CSV_SOURCE_ORDER = [...SOURCE_PRIORITY];

/**
 * Filename sequence for per-source CSVs (`01_builtin_…`, `02_himalayas_…`).
 * Workday is a URL-board view (not a capture source).
 */
export const CSV_EXPORT_ORDER = [
  "builtin",
  "himalayas",
  "greenhouse",
  "dice",
  "lever",
  "ashby",
  "workday",
  "jobgether",
  "themuse",
  "jobright",
  "remotive",
  "jobicy",
  "remoteok",
  "wwr",
  "workingnomads",
  "jobspresso",
  "skipthedrive",
  "arc",
  "arbeitnow",
  "usajobs",
  "adzuna",
  "googlejobs",
  "ziprecruiter",
  "monster",
  "indeed",
  "careerbuilder",
];

export const CSV_HEADERS = [
  "seq",
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
