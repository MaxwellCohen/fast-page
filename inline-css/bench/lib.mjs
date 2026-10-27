// Shared harness: a local static server (brotli, CDN-like) and a minimal Chrome DevTools Protocol client.
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { brotliCompressSync } from "node:zlib";
import { tmpdir } from "node:os";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Chrome DevTools throttling presets (request-level latency = RTT x 3.75 for Slow 4G, x 2.75 for Fast 4G,
// which is how DevTools/Lighthouse approximate TCP+TLS setup and slow start).
export const presets = {
  slow4g: { name: "slow4g", label: "Slow 4G", rtt: 150, latency: 562.5, down: 1474.56e3 / 8, up: 675e3 / 8, cpu: 4 },
  fast4g: { name: "fast4g", label: "Fast 4G", rtt: 60, latency: 165, down: 9e6 * 0.9 / 8, up: 1.5e6 * 0.9 / 8, cpu: 4 },
  cable: { name: "cable", label: "Cable", rtt: 28, latency: 28, down: 5e6 / 8, up: 1e6 / 8, cpu: 1 },
};

// headersFor(path) lets a caller model e.g. dynamic HTML (no-store) + immutable assets.
export async function startServer(headersFor = () => ({ "cache-control": "max-age=86400" })) {
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".json": "application/json", ".csv": "text/csv" };
  const compressed = new Map();
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const type = types[extname(path)] ?? "application/octet-stream";
      const headers = { "content-type": type, ...headersFor(path) };
      let body = await readFile(join(root, path));
      // Compress once and keep it, like a CDN edge cache. Brotli 11 on 250 KB takes ~250 ms per call.
      if (type.startsWith("text/")) { body = compressed.get(path) ?? compressed.set(path, brotliCompressSync(body)).get(path); headers["content-encoding"] = "br"; }
      res.writeHead(200, headers).end(body);
    } catch { res.writeHead(404).end(); }
  }).listen(0);
  await new Promise((ok) => server.once("listening", ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, warm: async (paths) => { for (const p of paths) await (await fetch(origin + p)).arrayBuffer(); }, close: () => server.close() };
}

// Injected by the harness only; the pages themselves have no JS.
const observer = `
  window.__m = { fcp: 0, lcp: 0, el: "", all: [], load: 0 };
  addEventListener("load", () => { __m.load = performance.now(); });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") __m.fcp = e.startTime; }).observe({ type: "paint", buffered: true });
  new PerformanceObserver((l) => { const e = l.getEntries().at(-1); __m.lcp = e.startTime; __m.el = e.element ? e.element.tagName : "?"; __m.all.push(__m.el + "@" + Math.round(e.startTime) + "/" + e.size); }).observe({ type: "largest-contentful-paint", buffered: true });`;

export async function startChrome() {
  const userDir = await mkdtemp(join(tmpdir(), "inline-css-"));
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${userDir}`, "--no-first-run", "--window-size=1350,940", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((ok) => chrome.stderr.on("data", (d) => { const m = /ws:\/\/\S+/.exec(String(d)); if (m) ok(m[0]); }));
  const ws = new WebSocket(wsUrl);
  await new Promise((ok) => ws.addEventListener("open", ok));
  let id = 0; const pending = new Map(); const listeners = new Set();
  ws.addEventListener("message", ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) { const { ok, err } = pending.get(msg.id); pending.delete(msg.id); msg.error ? err(new Error(msg.error.message)) : ok(msg.result); }
    else for (const l of listeners) l(msg);
  });
  const send = (method, params = {}, sessionId) => new Promise((ok, err) => { const i = ++id; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const once = (method, sessionId, ms = 60_000) => new Promise((ok, err) => {
    const t = setTimeout(() => { listeners.delete(l); err(new Error(`timeout waiting for ${method}`)); }, ms);
    const l = (m) => { if (m.method === method && m.sessionId === sessionId) { clearTimeout(t); listeners.delete(l); ok(m.params); } };
    listeners.add(l);
  });
  const { product } = await send("Browser.getVersion");

  // Loads `url` in a fresh browser context (empty cache, new sockets). `warmUrl`, if given, is loaded first in the
  // same context, so its cacheable responses are in the HTTP cache for the measured load.
  async function load(profile, url, warmUrl) {
    const { browserContextId } = await send("Target.createBrowserContext");
    try {
      const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      await send("Page.enable", {}, sessionId);
      await send("Page.bringToFront", {}, sessionId);
      await send("Network.enable", {}, sessionId);
      await send("Network.emulateNetworkConditions", { offline: false, latency: profile.latency, downloadThroughput: profile.down, uploadThroughput: profile.up }, sessionId);
      await send("Emulation.setCPUThrottlingRate", { rate: profile.cpu }, sessionId);
      await send("Page.addScriptToEvaluateOnNewDocument", { source: observer }, sessionId);
      const go = async (u) => { const loaded = once("Page.loadEventFired", sessionId); await send("Page.navigate", { url: u }, sessionId); await loaded; };
      if (warmUrl) await go(warmUrl);
      let bytes = 0;
      const count = (m) => { if (m.sessionId === sessionId && m.method === "Network.loadingFinished") bytes += m.params.encodedDataLength; };
      listeners.add(count);
      await go(url);
      await new Promise((r) => setTimeout(r, 300));
      listeners.delete(count);
      const { result } = await send("Runtime.evaluate", { expression: "JSON.stringify(__m)", returnByValue: true }, sessionId);
      return { ...JSON.parse(result.value), bytes };
    } finally {
      await send("Target.disposeBrowserContext", { browserContextId });
    }
  }

  async function close() {
    ws.close(); const exited = new Promise((ok) => chrome.once("exit", ok)); chrome.kill(); await exited;
    await rm(userDir, { recursive: true, force: true });
  }
  return { product, load, close };
}

export const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
export const median = (a) => quantile(a, 0.5);
