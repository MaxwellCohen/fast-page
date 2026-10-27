// Measures FCP/LCP for the inline-css pages in headless Chrome, using the DevTools protocol directly.
// Usage: node inline-css/bench/measure.mjs [runs=7]   then   node inline-css/bench/build.mjs
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { brotliCompressSync } from "node:zlib";
import { tmpdir } from "node:os";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNS = Number(process.argv[2] ?? 7);
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const profiles = [
  { name: "mobile", label: "Mobile (slow 4G)", latency: 150, down: 1.6e6 / 8, up: 750e3 / 8, cpu: 4 },
  { name: "3g", label: "High-latency 3G", latency: 400, down: 700e3 / 8, up: 400e3 / 8, cpu: 4 },
  { name: "broadband", label: "Broadband", latency: 20, down: 20e6 / 8, up: 5e6 / 8, cpu: 1 },
];
const cold = ["small-inline.html", "small-link.html", "belowfold-inline.html", "belowfold-link.html", "large-inline.html", "large-link.html"];
// [page measured, page visited first in the same context to warm the cache]
const warm = [["large-inline-next.html", "large-inline.html"], ["large-link-next.html", "large-link.html"]];

// --- static server: brotli text (like the CDNs), same Cache-Control as production -------------------------------
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css" };
const compressed = new Map();
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const type = types[extname(path)] ?? "application/octet-stream";
    const headers = { "content-type": type, "cache-control": "max-age=86400" };
    let body = await readFile(join(root, path));
    // Compress once and keep it, like a CDN edge cache. Brotli 11 on 250 KB takes ~250 ms per call.
    if (type.startsWith("text/")) { body = compressed.get(path) ?? compressed.set(path, brotliCompressSync(body)).get(path); headers["content-encoding"] = "br"; }
    res.writeHead(200, headers).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const origin = `http://127.0.0.1:${server.address().port}/inline-css/`;
for (const f of [...cold, ...warm.flat(), "small.css", "large.css"]) await (await fetch(origin + f)).arrayBuffer(); // warm the compression cache

// --- Chrome + minimal CDP client --------------------------------------------------------------
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
const once = (method, sessionId) => new Promise((ok) => { const l = (m) => { if (m.method === method && m.sessionId === sessionId) { listeners.delete(l); ok(m.params); } }; listeners.add(l); });
const { product } = await send("Browser.getVersion");

// Injected by the harness only; the pages themselves have no JS.
const observer = `
  window.__m = { fcp: 0, lcp: 0, el: "", all: [] };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") __m.fcp = e.startTime; }).observe({ type: "paint", buffered: true });
  new PerformanceObserver((l) => { const e = l.getEntries().at(-1); __m.lcp = e.startTime; __m.el = e.element ? e.element.tagName : "?"; __m.all.push(__m.el + "@" + Math.round(e.startTime) + "/" + e.size); }).observe({ type: "largest-contentful-paint", buffered: true });`;

async function load(profile, url, warmUrl) {
  const { browserContextId } = await send("Target.createBrowserContext"); // fresh cache + socket pool
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
  await send("Target.disposeBrowserContext", { browserContextId });
  return { ...JSON.parse(result.value), bytes };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const data = {};
for (const profile of profiles.filter((p) => !process.env.PROFILES || process.env.PROFILES.includes(p.name))) {
  data[profile.name] = {};
  const jobs = [...cold.map((p) => [p]), ...warm].filter(([p]) => !process.env.PAGES || p.includes(process.env.PAGES));
  const samples = Object.fromEntries(jobs.map(([p]) => [p, []]));
  // Interleave pages run by run so drift affects every page equally.
  for (let r = 0; r < RUNS; r++) for (const [p, w] of jobs) samples[p].push(await load(profile, origin + p, w && origin + w));
  for (const [p, s] of Object.entries(samples)) {
    data[profile.name][p] = { fcp: median(s.map((x) => x.fcp)), lcp: median(s.map((x) => x.lcp)), bytes: median(s.map((x) => x.bytes)), lcpElement: s[0].el };
    if (process.env.DEBUG) console.log(s.map((x) => x.all.join(" ")));
    console.log(profile.name.padEnd(10), p.padEnd(24), "FCP", Math.round(data[profile.name][p].fcp), "LCP", Math.round(data[profile.name][p].lcp), data[profile.name][p].lcpElement, data[profile.name][p].bytes);
  }
}

if (!process.env.PAGES && !process.env.PROFILES) await writeFile(join(root, "inline-css", "bench", "results.json"), JSON.stringify({ date: new Date().toISOString().slice(0, 10), browser: product, runs: RUNS, profiles, data }, null, 2) + "\n");
ws.close(); const exited = new Promise((ok) => chrome.once("exit", ok)); chrome.kill(); await exited; server.close(); await rm(userDir, { recursive: true, force: true });
