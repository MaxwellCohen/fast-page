// Measures FCP/LCP for the inline-css example pages in headless Chrome, using the DevTools protocol directly.
// Usage: node inline-css/bench/measure.mjs [runs=7]   then   node inline-css/bench/build.mjs
// For the 3-250 KB size sweep, see sweep.mjs.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { root, startServer, startChrome, median } from "./lib.mjs";

const RUNS = Number(process.argv[2] ?? 7);

const profiles = [
  { name: "mobile", label: "Mobile (slow 4G)", latency: 150, down: 1.6e6 / 8, up: 750e3 / 8, cpu: 4 },
  { name: "3g", label: "High-latency 3G", latency: 400, down: 700e3 / 8, up: 400e3 / 8, cpu: 4 },
  { name: "broadband", label: "Broadband", latency: 20, down: 20e6 / 8, up: 5e6 / 8, cpu: 1 },
];
const cold = ["small-inline.html", "small-link.html", "belowfold-inline.html", "belowfold-link.html", "large-inline.html", "large-link.html"];
// [page measured, page visited first in the same context to warm the cache]
const warm = [["large-inline-next.html", "large-inline.html"], ["large-link-next.html", "large-link.html"]];

// Same Cache-Control as production (max-age=86400 everywhere).
const server = await startServer();
const origin = `${server.origin}/inline-css/`;
await server.warm([...cold, ...warm.flat(), "small.css", "large.css"].map((f) => `/inline-css/${f}`));
const chrome = await startChrome();

const data = {};
for (const profile of profiles.filter((p) => !process.env.PROFILES || process.env.PROFILES.includes(p.name))) {
  data[profile.name] = {};
  const jobs = [...cold.map((p) => [p]), ...warm].filter(([p]) => !process.env.PAGES || p.includes(process.env.PAGES));
  const samples = Object.fromEntries(jobs.map(([p]) => [p, []]));
  // Interleave pages run by run so drift affects every page equally.
  for (let r = 0; r < RUNS; r++) for (const [p, w] of jobs) samples[p].push(await chrome.load(profile, origin + p, w && origin + w));
  for (const [p, s] of Object.entries(samples)) {
    data[profile.name][p] = { fcp: median(s.map((x) => x.fcp)), lcp: median(s.map((x) => x.lcp)), bytes: median(s.map((x) => x.bytes)), lcpElement: s[0].el };
    if (process.env.DEBUG) console.log(s.map((x) => x.all.join(" ")));
    console.log(profile.name.padEnd(10), p.padEnd(24), "FCP", Math.round(data[profile.name][p].fcp), "LCP", Math.round(data[profile.name][p].lcp), data[profile.name][p].lcpElement, data[profile.name][p].bytes);
  }
}

if (!process.env.PAGES && !process.env.PROFILES) await writeFile(join(root, "inline-css", "bench", "results.json"), JSON.stringify({ date: new Date().toISOString().slice(0, 10), browser: chrome.product, runs: RUNS, profiles, data }, null, 2) + "\n");
await chrome.close(); server.close();
