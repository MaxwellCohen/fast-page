// CSS size sweep: <style> vs <link> vs <style>+duplicate (Next.js-style) at 3-250 KB, across network presets,
// for a cold first load and a repeat visit. Writes inline-css/sweep/data.json and data.csv (published with the site).
//
// Usage: node inline-css/bench/sweep.mjs [runs=7]
//   PROFILES=slow4g,fast4g   only these presets (see lib.mjs)
//   ORIGIN=https://site      measure a deployed site instead of the local server (cold visits only, prints results)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { brotliCompressSync } from "node:zlib";
import { join } from "node:path";
import { root, presets, startServer, startChrome, quantile } from "./lib.mjs";

const RUNS = Number(process.argv[2] ?? 7);
const LIVE = process.env.ORIGIN?.replace(/\/$/, "");
const sizes = [3, 10, 25, 50, 75, 100, 150, 200, 250];
const variants = ["inline", "link", "dup"];
const visits = LIVE ? ["cold"] : ["cold", "repeat"];
const profiles = Object.values(presets).filter((p) => !process.env.PROFILES || process.env.PROFILES.split(",").includes(p.name));

// Model an SSR app: HTML is dynamic (no-store), hashed CSS is immutable.
const server = await startServer((path) => ({ "cache-control": path.endsWith(".html") ? "no-store" : "public, max-age=31536000, immutable" }));
const origin = LIVE ?? server.origin;
if (!LIVE) await server.warm(sizes.flatMap((n) => [...variants.map((v) => `/inline-css/sweep/${v}-${n}.html`), `/inline-css/sweep/css-${n}.css`]));
const chrome = await startChrome();

const dataFile = join(root, "inline-css", "sweep", "data.json");
// Merge into existing data so profiles can be measured in separate runs (each profile is saved as soon as it finishes).
const previous = !LIVE && existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, "utf8")) : { rows: [], meta: { profiles: [] } };
const keepRows = (names) => previous.rows.filter((r) => !names.includes(r.profile));
const allProfiles = () => Object.values(presets).filter((p) => previous.meta.profiles.some((q) => q.name === p.name) || rows.some((r) => r.profile === p.name));
function save() {
  const merged = [...keepRows(profiles.map((p) => p.name)), ...rows].sort((a, b) => Object.keys(presets).indexOf(a.profile) - Object.keys(presets).indexOf(b.profile));
  const meta = {
    description: "FCP/LCP for a text-LCP page with its CSS inlined (<style>), linked (<link>), or inlined plus duplicated at the end of the body (as Next.js inlineCss does via the RSC payload). Medians and quartiles per cell; 'cold' = fresh browser context, 'repeat' = same URL loaded again in the same context.",
    source: "https://github.com/MaxwellCohen/fast-page/tree/main/inline-css",
    date: new Date().toISOString().slice(0, 10), browser: chrome.product, runsPerCell: RUNS,
    method: "Headless Chrome, DevTools network throttling (request-level latency) and CPU throttling. Local server, brotli quality 11. HTML Cache-Control: no-store; CSS: immutable.",
    profiles: allProfiles(),
  };
  writeFileSync(dataFile, JSON.stringify({ meta, rows: merged }, null, 2) + "\n");
  const cols = ["profile", "rttMs", "requestLatencyMs", "downKbps", "cpuSlowdown", "cssKB", "cssRawBytes", "cssBrotliBytes", "variant", "visit", "htmlBrotliBytes", "fcp_p25", "fcp_median", "fcp_p75", "lcp_p25", "lcp_median", "lcp_p75", "load_median", "transferredBytes", "runs"];
  const flat = (r) => ({ ...r, fcp_p25: r.fcp.p25, fcp_median: r.fcp.median, fcp_p75: r.fcp.p75, lcp_p25: r.lcp.p25, lcp_median: r.lcp.median, lcp_p75: r.lcp.p75, load_median: r.load.median });
  writeFileSync(join(root, "inline-css", "sweep", "data.csv"), [cols.join(","), ...merged.map((r) => cols.map((c) => flat(r)[c]).join(","))].join("\n") + "\n");
  console.error(`saved ${merged.length} rows to inline-css/sweep/data.json and data.csv`);
}

const br = (f) => brotliCompressSync(readFileSync(join(root, "inline-css", "sweep", f))).length;
const rows = [];
for (const profile of profiles) {
  const jobs = sizes.flatMap((n) => variants.flatMap((v) => visits.map((visit) => ({ n, v, visit }))));
  const samples = new Map(jobs.map((j) => [j, []]));
  // Interleave run by run so drift affects every cell equally.
  for (let r = 0; r < RUNS; r++) {
    for (const j of jobs) {
      const url = `${origin}/inline-css/sweep/${j.v}-${j.n}.html`;
      samples.get(j).push(await chrome.load(profile, url, j.visit === "repeat" ? url : undefined));
    }
    console.error(`${profile.name}: run ${r + 1}/${RUNS}`);
  }
  for (const [j, s] of samples) {
    const stat = (k) => ({ p25: Math.round(quantile(s.map((x) => x[k]), 0.25)), median: Math.round(quantile(s.map((x) => x[k]), 0.5)), p75: Math.round(quantile(s.map((x) => x[k]), 0.75)) });
    const lcpEls = [...new Set(s.map((x) => x.el))];
    const row = {
      profile: profile.name, rttMs: profile.rtt, requestLatencyMs: profile.latency, downKbps: Math.round(profile.down * 8 / 1000), cpuSlowdown: profile.cpu,
      cssKB: j.n, cssRawBytes: Buffer.byteLength(readFileSync(join(root, "inline-css", "sweep", `css-${j.n}.css`))), cssBrotliBytes: br(`css-${j.n}.css`),
      variant: j.v, visit: j.visit, htmlBrotliBytes: br(`${j.v}-${j.n}.html`),
      fcp: stat("fcp"), lcp: stat("lcp"), load: stat("load"), transferredBytes: Math.round(quantile(s.map((x) => x.bytes), 0.5)), lcpElement: lcpEls.join("|"), runs: s.length,
    };
    rows.push(row);
    console.log([row.profile, row.visit, `${row.cssKB}KB`, row.variant, "FCP", row.fcp.median, "LCP", row.lcp.median, "load", row.load.median, row.transferredBytes + "B", row.lcpElement].join("\t"));
  }
  if (!LIVE) save();
}
await chrome.close(); server.close();

