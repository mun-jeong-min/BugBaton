import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile, spawn } from "node:child_process";
import process from "node:process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { codedError } from "./errors.js";

const CHROME_CANDIDATES = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
  win32: [
    `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
};

export async function findChrome(explicit) {
  const candidates = [explicit, process.env.CHROME_PATH, ...(CHROME_CANDIDATES[process.platform] ?? [])].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

export function chromeBinaryVersion(binary) {
  if (!binary) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(binary, ["--version"], { timeout: 3_000 }, (error, stdout, stderr) => {
      resolve(error ? null : String(stdout || stderr).trim() || null);
    });
  });
}

export function normalizeEndpoint(value = "http://127.0.0.1:9222") {
  try {
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw codedError("INVALID_ENDPOINT", "CDP discovery endpoints must use http:// or https://", { exitCode: 2, hint: "Pass the HTTP origin that serves /json/version, such as http://127.0.0.1:9222." });
    }
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.origin;
  } catch (error) {
    if (error.code === "INVALID_ENDPOINT") throw error;
    throw codedError("INVALID_ENDPOINT", `Invalid CDP endpoint ${JSON.stringify(value)}`, { exitCode: 2, hint: "Use an HTTP origin such as http://127.0.0.1:9222." });
  }
}

export function assertSafeEndpoint(endpoint, allowRemote = false) {
  const host = new URL(endpoint).hostname;
  if (!allowRemote && !["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw codedError("REMOTE_ENDPOINT_BLOCKED", `Refusing remote CDP endpoint ${host}`, { exitCode: 2, hint: "Pass --allow-remote only when the endpoint and network are trusted." });
  }
}

async function fetchJson(url, timeoutMs = 2_000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

export function browserVersion(endpoint) {
  return fetchJson(`${endpoint}/json/version`);
}

export function browserInstanceId(version) {
  const source = version?.webSocketDebuggerUrl;
  return source ? createHash("sha256").update(source).digest("hex") : null;
}

export async function listTabs(endpoint) {
  const targets = await fetchJson(`${endpoint}/json/list`);
  return targets.filter((target) => target.type === "page");
}

export async function waitForChrome(endpoint, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await browserVersion(endpoint);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`Chrome did not expose CDP at ${endpoint}: ${lastError?.message ?? "timeout"}`);
}

export function findFreeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

export function launchChrome(binary, { port, profile, url, headless, deterministic }) {
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(deterministic ? ["--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--disable-extensions"] : []),
    ...(headless ? ["--headless=new", "--disable-gpu"] : []),
    url ?? "about:blank",
  ];
  const child = spawn(binary, args, { detached: true, stdio: "ignore" });
  child.unref();
  return { pid: child.pid, args };
}

export function selectTab(tabs, selector) {
  if (!tabs.length) throw codedError("NO_PAGE_TABS", "No page tabs are available", { hint: "Open the local app in Chrome, then run `chroma tabs`." });
  if (!selector) return tabs[0];
  const exact = tabs.find((tab) => tab.id === selector);
  if (exact) return exact;
  const matches = tabs.filter((tab) => tab.id.startsWith(selector) || tab.url.includes(selector) || tab.title.includes(selector));
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw codedError("TAB_NOT_FOUND", `No tab matches ${JSON.stringify(selector)}`, { hint: "Run `chroma tabs` and pass an exact target ID." });
  throw codedError("TAB_AMBIGUOUS", `Tab selector ${JSON.stringify(selector)} is ambiguous (${matches.length} matches)`, { exitCode: 2, hint: "Pass an exact target ID from `chroma tabs`.", details: { matches: matches.length } });
}
