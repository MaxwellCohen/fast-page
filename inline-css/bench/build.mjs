// Generates the static pages in inline-css/ (the pages themselves contain no JS).
// Usage: node inline-css/bench/build.mjs   (re-run after measure.mjs to refresh the results table)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { gzipSync, brotliCompressSync, constants as zlib } from "node:zlib";
const br = (s) => brotliCompressSync(s).length; // quality 11, like CDN-precompressed static assets
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(dir, f), "utf8");
const write = (f, s) => writeFileSync(join(dir, f), s);
const kb = (n) => (n / 1024).toFixed(1) + " KB";

// ---------------------------------------------------------------------------
// large.css: small.css + ~240 KB of component-library rules (Bootstrap/MUI-sized).
// The pages are served by CDNs that use brotli, which collapses repetitive generated CSS (~10x).
// Real bundles carry entropy that templates don't: hashed class names (CSS Modules, emotion, styled-components),
// one-off values, and inlined SVG icons. We add the same kinds of noise so large.css compresses ~4x,
// like a heavy production bundle, instead of looking free over the wire. A seeded PRNG keeps the output stable.
let seed = 42;
const rnd = () => { // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (n) => Math.floor(rnd() * n);
const hex = () => "#" + int(0xffffff).toString(16).padStart(6, "0");
const hash = () => int(36 ** 6).toString(36).padStart(6, "0");
const num = (max, digits) => (rnd() * max).toFixed(digits).replace(/^0\./, ".");
const components = ["btn", "card", "modal", "navbar", "dropdown", "alert", "badge", "toast", "tooltip", "popover", "tabs", "accordion", "table", "form", "input", "select", "chip", "avatar", "drawer", "stepper", "pagination", "breadcrumb", "progress", "spinner", "list", "menu", "dialog", "snackbar", "slider", "switch"];
const parts = ["", "-header", "-body", "-footer", "-title", "-icon", "-label", "-group", "-item", "-content", "-actions", "-divider"];
const states = ["", "", "", ":hover", ":focus-visible", ":active", ":disabled", "[aria-expanded=true]", ".is-active", ".is-open"];
const props = [
  () => `color:${hex()}`, () => `background-color:${hex()}`, () => `border-color:${hex()}`,
  () => `padding:${num(2, 3)}rem ${num(3, 3)}rem`, () => `margin:${num(2, 3)}rem ${num(2, 3)}rem`,
  () => `border-radius:${int(24)}px`, () => `font-size:${(0.6 + rnd() * 1.6).toFixed(4)}rem`,
  () => `line-height:${(1 + rnd()).toFixed(3)}`, () => `letter-spacing:${num(0.1, 4)}em`,
  () => `box-shadow:0 ${int(20)}px ${int(40)}px rgba(${int(255)},${int(255)},${int(255)},${num(1, 2)})`,
  () => `transition:${pick(["color", "background-color", "opacity", "transform", "box-shadow"])} ${int(400)}ms cubic-bezier(${num(1, 2)},${num(1, 2)},${num(1, 2)},${num(1, 2)})`,
  () => `transform:translate(${num(20, 2)}px,${num(20, 2)}px) rotate(${num(360, 1)}deg)`,
  () => `--${pick(components)}-${hash()}:${hex()}`, () => `z-index:${int(2000)}`,
  () => `width:calc(${int(100)}% - ${num(4, 3)}rem)`, () => `grid-template-columns:${int(400)}px minmax(${int(200)}px,${num(4, 2)}fr)`,
];
// A random SVG path, like the icon sets bundles inline as data: URIs.
const icon = () => {
  let d = `M${int(24)} ${int(24)}`;
  for (let i = 0, n = 6 + int(10); i < n; i++) d += `${pick(["L", "l", "C", "c", "Q", "q"])}${num(24, 2)} ${num(24, 2)}`;
  return `background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23${int(0xffffff).toString(16).padStart(6, "0")}' d='${d}z'/%3E%3C/svg%3E")`;
};
let large = read("small.css") + "\n/* ---- component library (unused by this page, like most of a real bundle) ---- */\n";
while (large.length < 250_000) {
  const sel = `.${pick(components)}${pick(parts)}_${hash()}${pick(states)}`;
  const decls = Array.from({ length: 2 + int(5) }, () => pick(props)());
  if (rnd() < 0.06) decls.push(icon());
  large += `${sel}{${decls.join(";")}}\n`;
  if (rnd() < 0.02) large += `@media (min-width:${pick([576, 768, 992, 1200, 1400])}px){.${pick(components)}_${hash()}{${pick(props)()}}}\n`;
}
write("large.css", large);

// ---------------------------------------------------------------------------
// Pages
const small = read("small.css");
const sizes = {
  small: { raw: Buffer.byteLength(small), gz: gzipSync(small).length, br: br(small) },
  large: { raw: Buffer.byteLength(large), gz: gzipSync(large).length, br: br(large) },
};

const css = (name, mode) =>
  mode === "inline"
    ? `<style>\n${name === "small" ? small : large}</style>`
    : `<link rel="stylesheet" href="/inline-css/${name}.css" />`;

const lorem =
  "Before a browser can paint anything it needs every render-blocking stylesheet in the head. " +
  "With a link tag that means: download the HTML, parse it, find the link, then make a second request and wait for it. " +
  "With a style tag the CSS is already in the HTML response, so the first paint can happen as soon as the head has arrived. " +
  "The difference is roughly one network round trip, plus the time to download the stylesheet bytes. " +
  "On a fast, nearby connection that is a few milliseconds. On a mobile connection with 150 ms of latency it is often the single biggest item on the critical path.";

// ~20 KB of below-the-fold article text: a 3,000-word pseudo-vocabulary with a Zipf distribution,
// so it compresses about like real prose (~3-4x with brotli) rather than like a repeated string.
const syll = ["ka", "re", "mi", "to", "sa", "len", "por", "in", "da", "ve", "lo", "ri", "an", "es", "ul", "mon", "tra", "pe", "ci", "ob", "nu", "ser", "gal", "fi", "do", "ha", "qu", "zen", "bri", "ot"];
const vocab = Array.from({ length: 3000 }, () => Array.from({ length: 1 + int(4) }, () => pick(syll)).join(""));
const zipf = vocab.map((_, i) => 1 / (i + 1)), zipfSum = zipf.reduce((a, b) => a + b);
const word = () => { let r = rnd() * zipfSum, i = 0; while ((r -= zipf[i]) > 0) i++; return vocab[i]; };
let articleHtml = "";
for (let i = 0; articleHtml.length < 20_000; i++) {
  const sentence = () => { const w = Array.from({ length: 8 + Math.floor(rnd() * 12) }, word).join(" "); return w[0].toUpperCase() + w.slice(1) + ". "; };
  articleHtml += i % 8 === 0 ? `<h2 class="text-2xl font-semibold text-slate-900 mt-8 mb-2">Section ${i / 8 + 1}</h2>` : "";
  articleHtml += `<p class="mb-4">${Array.from({ length: 5 }, sentence).join("")}</p>\n`;
}

function page({ file, title, scenario, mode, cssName, belowFold = false, next = false, note }) {
  const other = mode === "inline" ? file.replace("inline", "link") : file.replace("link", "inline");
  const body = next
    ? `<h1 class="text-4xl md:text-6xl font-bold tracking-tight">The second page</h1>
        <p class="mt-6 text-xl leading-relaxed text-indigo-100">You came here from the previous page in the same session, so the browser has already seen this site's CSS. ${
          mode === "link"
            ? "This page links the same stylesheet, which is already in the HTTP cache: zero bytes and zero round trips for CSS."
            : "This page inlines the same CSS again, so the whole bundle is downloaded a second time inside the HTML."
        } ${lorem}</p>`
    : `<h1 class="text-4xl md:text-6xl font-bold tracking-tight">${title}</h1>
        <p class="mt-6 text-xl leading-relaxed text-indigo-100">${lorem}</p>`;
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} (${mode})</title>
    ${belowFold ? css("small", "inline") : css(cssName, mode)}
  </head>
  <body class="bg-slate-50 text-slate-900">
    <header class="border-b border-slate-200 bg-white">
      <div class="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between text-sm">
        <a class="font-semibold hover:underline" href="/inline-css/">&larr; inline-css</a>
        <span class="font-mono text-slate-500">${scenario} &middot; CSS: ${mode === "inline" ? "&lt;style&gt;" : "&lt;link&gt;"} ${cssName}.css (${kb(sizes[cssName].raw)} raw / ${kb(sizes[cssName].br)} brotli)</span>
        <a class="text-indigo-600 hover:underline" href="/inline-css/${other}">compare: ${mode === "inline" ? "link" : "inline"} &rarr;</a>
      </div>
    </header>
    <main>
      <section class="bg-gradient text-white">
        <div class="max-w-5xl mx-auto px-6 md:px-8 py-16">
        ${body}
        </div>
      </section>
      <section class="max-w-5xl mx-auto px-6 py-12">
        <div class="bg-amber-50 text-amber-800 rounded-lg p-6 text-sm leading-relaxed">${note}</div>${
          next ? "" : `
        <p class="mt-6 text-sm text-slate-600">${
          file.startsWith("large") ? `Next: <a class="text-indigo-600 underline" href="/inline-css/${file.replace(".html", "-next.html")}">go to the second page of this site &rarr;</a>` : ""
        }</p>`
        }
      </section>${belowFold ? `
      <!-- Below the fold: the stylesheet for the widgets below sits here, after the LCP content. -->
      ${css(cssName, mode)}
      <article class="max-w-3xl mx-auto px-6 py-12 text-lg leading-relaxed text-slate-700">${articleHtml}</article>` : ""}
    </main>
  </body>
</html>
`;
}

const pages = [
  { file: "small-inline.html", mode: "inline", cssName: "small", scenario: "1 · inline wins", title: "Small CSS, text LCP",
    note: "3 KB of atomic CSS and a text LCP (the paragraph above). Inlining removes the stylesheet request, so FCP and LCP both move earlier by about one round trip. The HTML grows by about 1 KB compressed, which is nothing." },
  { file: "small-link.html", mode: "link", cssName: "small", scenario: "1 · inline wins", title: "Small CSS, text LCP",
    note: "Same page, but the 3 KB stylesheet is linked. The browser can't paint until it has fetched small.css, which costs an extra round trip after the HTML arrives." },
  { file: "belowfold-inline.html", mode: "inline", cssName: "large", scenario: "2 · doesn't matter", belowFold: true, title: "Below-the-fold CSS",
    note: "The CSS for this hero (small.css) is inlined in the head. The 250 KB bundle for the widgets below the fold is inlined in a &lt;style&gt; in the body, after this content. The hero paints before the browser reaches it." },
  { file: "belowfold-link.html", mode: "link", cssName: "large", scenario: "2 · doesn't matter", belowFold: true, title: "Below-the-fold CSS",
    note: "Same page, but the below-the-fold bundle is a &lt;link&gt; in the body. Chrome only blocks rendering of content after a body stylesheet, so the hero paints at the same time either way." },
  { file: "large-inline.html", mode: "inline", cssName: "large", scenario: "3 · link wins", title: "Large CSS bundle",
    note: "A 250 KB component-library bundle (Bootstrap/MUI-sized) inlined. On this first page it's about as fast as linking. Every other page pays for the full bundle again, though, because CSS inside HTML can't be cached on its own." },
  { file: "large-link.html", mode: "link", cssName: "large", scenario: "3 · link wins", title: "Large CSS bundle",
    note: "The same bundle linked. The first page pays an extra round trip, but large.css goes into the HTTP cache, and every page after it skips the bytes and the round trip." },
  { file: "large-inline-next.html", mode: "inline", cssName: "large", scenario: "3 · link wins (page 2)", next: true, title: "Large CSS bundle, page 2",
    note: "This page inlines the bundle again. Even though the visitor just loaded a page with identical CSS, they download it all again." },
  { file: "large-link-next.html", mode: "link", cssName: "large", scenario: "3 · link wins (page 2)", next: true, title: "Large CSS bundle, page 2",
    note: "This page links large.css, which the previous page already cached. The browser paints as soon as the small HTML arrives." },
];
for (const p of pages) write(p.file, page(p));

// ---------------------------------------------------------------------------
// sweep/: the same text-LCP page with CSS from 3 KB to 250 KB, as <style>, <link>, and
// <style> + a second copy at the end of the body (what Next.js inlineCss sends: the CSS again in the RSC payload).
export const sweepSizes = [3, 10, 25, 50, 75, 100, 150, 200, 250];
mkdirSync(join(dir, "sweep"), { recursive: true });
const sweepCss = Object.fromEntries(sweepSizes.map((n) => {
  if (n * 1000 <= small.length) return [n, small];
  const cut = large.lastIndexOf("\n", n * 1000) + 1; // whole rules only
  return [n, large.slice(0, cut)];
}));
const sweepPage = (n, mode) => {
  const c = sweepCss[n];
  const head = mode === "link" ? `<link rel="stylesheet" href="/inline-css/sweep/css-${n}.css" />` : `<style>\n${c}</style>`;
  // JSON-escaped like a React Server Components payload, but inert: a <template> is never rendered and needs no JS.
  const dup = mode === "dup" ? `\n    <template>${JSON.stringify(c).replace(/</g, "\\u003c")}</template>` : "";
  const label = { inline: "&lt;style&gt;", link: "&lt;link&gt;", dup: "&lt;style&gt; + copy in body (Next.js-style)" }[mode];
  const nav = ["inline", "link", "dup"].filter((m) => m !== mode).map((m) => `<a class="text-indigo-600 hover:underline" href="/inline-css/sweep/${m}-${n}.html">${m}</a>`).join(" &middot; ");
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${n} KB CSS (${mode})</title>
    ${head}
  </head>
  <body class="bg-slate-50 text-slate-900">
    <header class="border-b border-slate-200 bg-white">
      <div class="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between text-sm">
        <a class="font-semibold hover:underline" href="/inline-css/sweep/">&larr; size sweep</a>
        <span class="font-mono text-slate-500">CSS: ${label} ${kb(Buffer.byteLength(c))} raw / ${kb(br(c))} brotli</span>
        <span>compare: ${nav}</span>
      </div>
    </header>
    <main>
      <section class="bg-gradient text-white">
        <div class="max-w-5xl mx-auto px-6 md:px-8 py-16">
        <h1 class="text-4xl md:text-6xl font-bold tracking-tight">${n} KB of CSS</h1>
        <p class="mt-6 text-xl leading-relaxed text-indigo-100">${lorem}</p>
        </div>
      </section>
    </main>${dup}
  </body>
</html>
`;
};
for (const n of sweepSizes) {
  writeFileSync(join(dir, "sweep", `css-${n}.css`), sweepCss[n]);
  for (const m of ["inline", "link", "dup"]) writeFileSync(join(dir, "sweep", `${m}-${n}.html`), sweepPage(n, m));
}

// sweep/index.html: charts + tables + fitted heuristic from sweep/data.json (written by sweep.mjs)
const sweepDataFile = join(dir, "sweep", "data.json");
const sweepData = existsSync(sweepDataFile) ? JSON.parse(readFileSync(sweepDataFile, "utf8")) : null;

// Least-squares line y = a + b x
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const fit = (pts) => {
  const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  const b = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  return { a: my - b * mx, b };
};

function analyse(profileName) {
  const rows = sweepData.rows.filter((r) => r.profile === profileName);
  const get = (n, v, visit) => rows.find((r) => r.cssKB === n && r.variant === v && r.visit === visit);
  return sweepSizes.map((n) => {
    const c = (v) => get(n, v, "cold"), r = (v) => get(n, v, "repeat");
    const saving = c("link").lcp.median - c("inline").lcp.median; // first visit: ms inlining saves
    const dupSaving = c("link").lcp.median - c("dup").lcp.median;
    const repeatCost = r("inline").lcp.median - r("link").lcp.median; // repeat visit: ms inlining costs
    const breakEven = repeatCost > 0 ? saving / (saving + repeatCost) : 1;
    return { n, br: c("link").cssBrotliBytes, c, r, saving, dupSaving, repeatCost, breakEven };
  });
}

function sweepChart(profile, a) {
  const W = 640, H = 260, L = 48, R = 150, T = 28, B = 36;
  const vals = a.flatMap((d) => [d.saving, d.repeatCost]);
  const step = [25, 50, 100, 200, 250, 500, 1000].find((st) => (Math.max(...vals) - Math.min(0, ...vals)) / st <= 6);
  const xMax = 250, yMax = Math.ceil(Math.max(...vals) / step) * step, yMin = Math.min(0, Math.floor(Math.min(...vals) / step) * step);
  const x = (v) => L + (v / xMax) * (W - L - R), y = (v) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
  const yTicks = []; for (let v = yMin; v <= yMax; v += step) yTicks.push(v);
  const series = [
    { key: "saving", cls: "s1", name: "First visit: LCP saved by inlining" },
    { key: "repeatCost", cls: "s2", name: "Repeat visit: LCP lost by inlining" },
  ];
  const line = (k) => a.map((d, i) => `${i ? "L" : "M"}${x(d.n).toFixed(1)} ${y(d[k]).toFixed(1)}`).join("");
  const last = a.at(-1);
  // crossing: first size where repeat cost exceeds the first-visit saving
  const cross = a.find((d) => d.repeatCost > d.saving);
  return `<figure class="chart">
  <figcaption><b>${profile.label}</b> <span class="muted">${profile.rtt} ms RTT &middot; ${(profile.down * 8 / 1e6).toFixed(1)} Mbps &middot; ${profile.cpu}&times; CPU</span></figcaption>
  <div class="legend">${series.map((s) => `<span><i class="key ${s.cls}"></i>${s.name}</span>`).join("")}</div>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${profile.label}: ms saved by inlining on first visit and ms lost on repeat visit, by CSS size">
    ${yTicks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("")}
    ${[0, 50, 100, 150, 200, 250].map((v) => `<text class="tick" x="${x(v)}" y="${H - B + 16}" text-anchor="middle">${v}</text>`).join("")}
    <text class="tick" x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">CSS size (KB, uncompressed)</text>
    <text class="tick" x="${L - 6}" y="${T - 14}" text-anchor="end">ms</text>
    ${cross ? `<line class="cross" x1="${x(cross.n)}" x2="${x(cross.n)}" y1="${T}" y2="${H - B}"/>` : ""}
    ${series.map((s) => `<path class="line ${s.cls}" d="${line(s.key)}"/>`).join("")}
    ${series.map((s) => a.map((d) => `<circle class="dot ${s.cls}" cx="${x(d.n)}" cy="${y(d[s.key])}" r="4"><title>${d.n} KB CSS (${kb(d.br)} brotli): ${s.name.toLowerCase()} ${d[s.key]} ms</title></circle>`).join("")).join("")}
    <text class="end" x="${x(last.n) + 8}" y="${y(last.saving) + 4}">${last.saving} ms saved</text>
    <text class="end" x="${x(last.n) + 8}" y="${y(last.repeatCost) + 4}">${last.repeatCost} ms lost</text>
  </svg>
</figure>`;
}

function sweepTable(profile, a) {
  return `<table><caption>${profile.label}: LCP medians in ms (p25&ndash;p75 in the tooltip)</caption>
  <thead><tr><th class="num">CSS</th><th class="num">brotli</th>
    <th class="num">cold &lt;style&gt;</th><th class="num">cold &lt;link&gt;</th><th class="num">cold dup</th><th class="num">saved by inlining</th>
    <th class="num">repeat &lt;style&gt;</th><th class="num">repeat &lt;link&gt;</th><th class="num">lost by inlining</th><th class="num">inline wins if returning &lt;</th></tr></thead>
  <tbody>${a.map((d) => {
    const cell = (row) => `<td class="num" title="p25 ${row.lcp.p25} / p75 ${row.lcp.p75}">${row.lcp.median}</td>`;
    return `<tr><td class="num">${d.n} KB</td><td class="num">${kb(d.br)}</td>${cell(d.c("inline"))}${cell(d.c("link"))}${cell(d.c("dup"))}
      <td class="num ${d.saving > 30 ? "win" : d.saving < -30 ? "lose" : ""}">${d.saving > 0 ? "+" : ""}${d.saving}</td>
      ${cell(d.r("inline"))}${cell(d.r("link"))}<td class="num ${d.repeatCost > 30 ? "lose" : ""}">${d.repeatCost > 0 ? "+" : ""}${d.repeatCost}</td>
      <td class="num">${Math.round(d.breakEven * 100)}%</td></tr>`;
  }).join("")}</tbody></table>`;
}

if (sweepData) {
  const profs = sweepData.meta.profiles;
  const analyses = Object.fromEntries(profs.map((p) => [p.name, analyse(p.name)]));
  const fits = profs.map((p) => {
    const a = analyses[p.name];
    const cost = fit(a.map((d) => [d.br / 1024, d.repeatCost]));
    const meanSaving = Math.round(a.reduce((s, d) => s + d.saving, 0) / a.length);
    return { p, a, cost, meanSaving, minSaving: Math.min(...a.map((d) => d.saving)), wire: 8 / (p.down * 8 / 1000) * 1024 }; // ms per KB at the link rate
  });
  const slow = fits.find((f) => f.p.name === "slow4g");
  const losses = fits.flatMap((f) => f.a.filter((d) => d.saving < 0).map((d) => ({ ...d, label: f.p.label })));
  const dupDeltas = fits.flatMap((f) => f.a.map((d) => d.c("dup").lcp.median - d.c("inline").lcp.median));
  const dupWorst = Math.max(...dupDeltas), dupMedian = median(dupDeltas);
  const big = sweepData.rows.find((r) => r.cssKB === 250 && r.variant === "dup"), bigInline = sweepData.rows.find((r) => r.cssKB === 250 && r.variant === "inline");
  const dupBytes = big.htmlBrotliBytes - bigInline.htmlBrotliBytes;
  const dupCost = (z) => z(readFileSync(join(dir, "sweep", "dup-250.html"))).length - z(readFileSync(join(dir, "sweep", "inline-250.html"))).length;
  write("sweep/index.html", `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Inline vs linked CSS: 3 KB to 250 KB size sweep</title>
    <style>
      :root{--surface-1:#fcfcfb;--text-primary:#0b0b0b;--text-secondary:#52514e;--muted:#898781;--grid:#e1e0d9;--series-1:#2a78d6;--series-2:#eb6834;--border:rgba(11,11,11,.10);--win:#dcfce7;--lose:#fee2e2}
      @media (prefers-color-scheme:dark){:root{--surface-1:#1a1a19;--text-primary:#f0efec;--text-secondary:#c3c2b7;--grid:#2c2c2a;--series-1:#3987e5;--series-2:#d95926;--border:rgba(255,255,255,.10);--win:#14361f;--lose:#3d1c1c}}
      body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:68rem;margin:0 auto;padding:2rem 1.25rem;line-height:1.55;color:var(--text-primary);background:var(--surface-1)}
      h1{font-size:2rem;margin:0 0 .5rem}h2{margin-top:2.5rem;border-bottom:1px solid var(--grid);padding-bottom:.25rem}
      a{color:var(--series-1)}code{font-family:ui-monospace,Menlo,monospace;font-size:.9em}
      .muted{color:var(--text-secondary);font-weight:400}
      .charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(30rem,1fr));gap:1.5rem}
      .chart{margin:0;border:1px solid var(--border);border-radius:.75rem;padding:1rem}
      .chart svg{width:100%;height:auto;display:block}
      .legend{display:flex;gap:1.25rem;flex-wrap:wrap;font-size:.8rem;color:var(--text-secondary);margin:.25rem 0 .5rem}
      .key{display:inline-block;width:14px;height:2px;margin-right:6px;vertical-align:middle;border-radius:1px}
      .key.s1{background:var(--series-1)}.key.s2{background:var(--series-2)}
      .grid{stroke:var(--grid);stroke-width:1}.cross{stroke:var(--muted);stroke-width:1}
      .tick{fill:var(--muted);font-size:11px}.end{fill:var(--text-secondary);font-size:11px}
      .line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
      .line.s1{stroke:var(--series-1)}.line.s2{stroke:var(--series-2)}
      .dot{stroke:var(--surface-1);stroke-width:2}.dot.s1{fill:var(--series-1)}.dot.s2{fill:var(--series-2)}
      .dot:hover{r:6}
      table{border-collapse:collapse;width:100%;font-size:.8rem;margin-top:1rem}
      caption{text-align:left;font-weight:600;padding:.5rem 0}
      th,td{border:1px solid var(--grid);padding:.3rem .45rem;text-align:left}
      .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
      .win{background:var(--win)}.lose{background:var(--lose)}
      .callout{border:1px solid var(--border);border-radius:.75rem;padding:1rem 1.25rem;margin-top:1rem}
      .small{font-size:.85rem;color:var(--text-secondary)}
    </style>
  </head>
  <body>
    <p><a href="/inline-css/">&larr; inline-css</a></p>
    <h1>Where does inlining CSS start to lose?</h1>
    <p>The same text-LCP page with 3 KB to 250 KB of CSS, as <code>&lt;style&gt;</code>, <code>&lt;link&gt;</code>, and <code>&lt;style&gt;</code> plus a second copy at the end of the body (what Next.js <code>inlineCss</code> sends: the CSS again in the RSC payload). Each is measured on a <b>cold first load</b> and a <b>repeat visit</b>, where the HTML is <code>no-store</code> like an SSR page and the linked CSS is <code>immutable</code>. For an app with soft navigation, that one full load per session is the only time CSS delivery matters.</p>

    <div class="callout">
      <p><b>${losses.length ? `On a cold first load, inlining lost in ${losses.length} of ${fits.length * sweepSizes.length} cells (${losses.map((l) => `${l.n} KB on ${l.label}: ${l.saving} ms`).join(", ")}).` : `On a cold first load, inlining never lost at any size, on any network.`}</b> The saving is roughly constant, about one request latency: ${fits.map((f) => `${f.meanSaving} ms on ${f.p.label}`).join(", ")} (average across sizes; the smallest was ${fits.map((f) => `${f.minSaving} ms`).join(" / ")}). A linked stylesheet costs one round trip <i>plus</i> the same bytes, so there is no crossover on first load.</p>
      <p><b>The cost shows up when the CSS would have been cached.</b> On a repeat visit, the inlined CSS is downloaded again at about ${fits.map((f) => `${f.cost.b.toFixed(1)} ms per brotli KB on ${f.p.label}`).join(", ")}. The <a href="#heuristic">break-even</a> depends on how many sessions start with the CSS already in cache.</p>
      <p><b>Duplicating the CSS (Next.js-style) cost at most ${dupWorst} ms of LCP versus a single inline copy</b> (median across sizes: ${dupMedian} ms). Brotli's window is larger than the CSS, so the second copy compresses to almost nothing (+${kb(dupBytes)} at 250 KB), and it sits after the LCP content. That depends on the compressor: at 250 KB the copy adds ${kb(dupCost(gzipSync))} with gzip (its 32 KB window can't see the first copy) and ${kb(dupCost((x) => brotliCompressSync(x, { params: { [zlib.BROTLI_PARAM_QUALITY]: 5 } })))} with brotli quality 5 (typical for on-the-fly CDN compression).</p>
    </div>

    <h2>First-visit saving vs repeat-visit cost</h2>
    <p class="small">Hover a point for its value. The vertical line marks the first size where the repeat-visit cost of inlining exceeds the first-visit saving (break-even at 50% returning sessions).</p>
    <div class="charts">${fits.map((f) => sweepChart(f.p, f.a)).join("")}</div>

    <h2 id="heuristic">Heuristic for frameworks</h2>
    <p>Let <i>s</i> be the first-visit saving and <i>c(size)</i> the repeat-visit cost. Inlining is better on average when the share of sessions that start with the CSS cached is below <b>s / (s + c)</b>. From this data:</p>
    <ul>
      ${fits.map((f) => `<li><b>${f.p.label}</b>: s &asymp; ${f.meanSaving} ms; c &asymp; ${Math.round(f.cost.a)} + ${f.cost.b.toFixed(1)} &times; brotliKB ms (link rate alone predicts ${f.wire.toFixed(1)} ms/KB).</li>`).join("")}
    </ul>
    <p>So the threshold isn't a fixed byte count. It scales with request latency divided by per-KB transfer time, and with how often your CSS is actually cached (deploy frequency matters: a new hash is a cold load). The "inline wins if returning &lt;" column below gives the break-even share at each size.</p>
    ${slow ? `<p>For example, on Slow 4G at ${slow.a.find((d) => d.n === 50).n} KB of CSS (${kb(slow.a.find((d) => d.n === 50).br)} brotli), inlining wins unless more than ${Math.round(slow.a.find((d) => d.n === 50).breakEven * 100)}% of sessions start with a warm cache.</p>` : ""}
    <p>A practical rule that follows: <b>inline the CSS needed for the first route when it's small, and also emit it as a linked, immutable file</b> so later full loads can use the cache (for example by inlining only when the request has no cookie or marker showing the asset was already fetched).</p>

    <h2>Data</h2>
    <p><a href="/inline-css/sweep/data.json">data.json</a> &middot; <a href="/inline-css/sweep/data.csv">data.csv</a>. Each row is one (network, CSS size, variant, visit) cell with FCP/LCP/load quartiles, bytes, and the network parameters. Re-run with <code>node inline-css/bench/sweep.mjs</code>.</p>
    ${fits.map((f) => sweepTable(f.p, f.a)).join("")}
    <p class="small">Measured ${sweepData.meta.date} with ${sweepData.meta.browser} (headless), ${sweepData.meta.runsPerCell} runs per cell. ${sweepData.meta.method} DevTools throttling applies latency per request and doesn't model TCP slow start packet by packet; its preset latencies (RTT &times; 3.75 for Slow 4G) approximate it.</p>
    <p class="small">Pages: ${sweepSizes.map((n) => `${n} KB <a href="/inline-css/sweep/inline-${n}.html">style</a>/<a href="/inline-css/sweep/link-${n}.html">link</a>/<a href="/inline-css/sweep/dup-${n}.html">dup</a>`).join(" &middot; ")}</p>
  </body>
</html>
`);
}

// ---------------------------------------------------------------------------
// index.html with the measured results (from bench/results.json, if present)
const resultsFile = join(dir, "bench", "results.json");
const results = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, "utf8")) : null;
const htmlSize = (f) => br(read(f));
// link minus inline for a pair, e.g. gap("mobile", "small", "lcp"); positive = inline faster
const gap = (prof, pair, k) => {
  const r = results?.data[prof];
  const [a, b] = pair.endsWith("-next") ? [r?.[pair.replace("-next", "-inline-next.html")], r?.[pair.replace("-next", "-link-next.html")]] : [r?.[pair + "-inline.html"], r?.[pair + "-link.html"]];
  return a && b ? Math.round(b[k] - a[k]) : "?";
};

function table(pairs, label) {
  if (!results) return `<p class="text-sm text-slate-500">Run <code>node inline-css/bench/measure.mjs</code> to fill in this table.</p>`;
  const rows = [];
  for (const prof of results.profiles) {
    for (const [inl, lnk] of pairs) {
      const a = results.data[prof.name]?.[inl], b = results.data[prof.name]?.[lnk];
      if (!a || !b) continue;
      const d = (k) => {
        const v = b[k] - a[k];
        return `<td class="num ${v > 30 ? "win" : v < -30 ? "lose" : ""}">${v > 0 ? "+" : ""}${Math.round(v)}</td>`;
      };
      rows.push(`<tr><td>${prof.label}</td><td><a href="/inline-css/${inl}">${inl}</a> vs <a href="/inline-css/${lnk}">${lnk}</a></td>
        <td class="num">${Math.round(a.fcp)}</td><td class="num">${Math.round(b.fcp)}</td>${d("fcp")}
        <td class="num">${Math.round(a.lcp)}</td><td class="num">${Math.round(b.lcp)}</td>${d("lcp")}
        <td class="num">${kb(a.bytes)}</td><td class="num">${kb(b.bytes)}</td></tr>`);
    }
  }
  return `<table><caption>${label}</caption><thead><tr><th>Network</th><th>Pages</th>
    <th>FCP inline</th><th>FCP link</th><th>link &minus; inline</th>
    <th>LCP inline</th><th>LCP link</th><th>link &minus; inline</th>
    <th>Bytes inline</th><th>Bytes link</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

const profileList = results
  ? results.profiles.map((p) => `<li><b>${p.label}</b>: ${p.latency} ms RTT, ${(p.down * 8 / 1e6).toFixed(1)} Mbps down${p.cpu > 1 ? `, ${p.cpu}&times; CPU slowdown` : ""}</li>`).join("")
  : "";

write("index.html", `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Inline vs linked CSS: FCP and LCP on first visit</title>
    <style>
      body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:68rem;margin:0 auto;padding:2rem 1.25rem;line-height:1.55;color:#1e293b;background:#f8fafc}
      h1{font-size:2rem;margin:0 0 .5rem}h2{margin-top:2.5rem;border-bottom:1px solid #e2e8f0;padding-bottom:.25rem}
      a{color:#4f46e5}code{font-family:ui-monospace,Menlo,monospace;font-size:.9em;background:#eef2ff;padding:.05em .3em;border-radius:3px}
      .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr));gap:1rem;margin-top:1rem}
      .card{background:#fff;border:1px solid #e2e8f0;border-radius:.75rem;padding:1rem 1.25rem}
      .card h3{margin:.25rem 0 .5rem}.tag{font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
      .t-in{color:#15803d}.t-eq{color:#64748b}.t-ln{color:#b45309}
      table{border-collapse:collapse;width:100%;font-size:.85rem;background:#fff;margin-top:1rem}
      caption{text-align:left;font-weight:600;padding:.5rem 0}
      th,td{border:1px solid #e2e8f0;padding:.35rem .5rem;text-align:left;vertical-align:top}th{background:#f1f5f9}
      .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
      .win{background:#dcfce7}.lose{background:#fee2e2}
      .small{font-size:.85rem;color:#64748b}
    </style>
  </head>
  <body>
    <p><a href="/">&larr; fast-page</a></p>
    <h1>Inline vs linked CSS</h1>
    <p>Next.js's <a href="https://nextjs.org/docs/app/api-reference/config/next-config-js/inlineCss"><code>experimental.inlineCss</code></a> swaps every <code>&lt;link rel="stylesheet"&gt;</code> for a <code>&lt;style&gt;</code> tag. The docs say this speeds up FCP and LCP for first-time visitors, with the trade-off that the CSS can't be cached. These pages measure how much it actually changes. They are plain HTML and CSS with no JavaScript.</p>

    <h2>Summary</h2>
    <div class="cards">
      <div class="card"><div class="tag t-in">Inline</div><h3>First visit on a high-latency connection</h3>
        <p>A linked stylesheet is only discovered once the HTML arrives, and then it costs a second round trip. Inlining removes that, so FCP and LCP both move earlier by about one RTT plus the CSS download. Measured with 3 KB of atomic CSS: <b>${gap("mobile", "small", "lcp")} ms</b> faster LCP on mobile and <b>${gap("3g", "small", "lcp")} ms</b> on high-latency 3G, for +${kb(htmlSize("small-inline.html") - htmlSize("small-link.html"))} of HTML.</p>
        <p><a href="/inline-css/small-inline.html">small-inline</a> &middot; <a href="/inline-css/small-link.html">small-link</a></p></div>
      <div class="card"><div class="tag t-eq">Doesn't matter</div><h3>Low latency, or CSS that isn't render-blocking</h3>
        <p>On broadband (20 ms RTT) the extra request costs ${gap("broadband", "small", "lcp")} ms, which is within run-to-run noise. CSS placed after the LCP content (for example, a stylesheet for below-the-fold widgets in the body) doesn't affect FCP or LCP either way. Measured LCP difference (link minus inline): ${gap("mobile", "belowfold", "lcp")} ms on mobile and ${gap("3g", "belowfold", "lcp")} ms on 3G.</p>
        <p><a href="/inline-css/belowfold-inline.html">belowfold-inline</a> &middot; <a href="/inline-css/belowfold-link.html">belowfold-link</a></p></div>
      <div class="card"><div class="tag t-ln">Link</div><h3>Large CSS and more than one page view</h3>
        <p>With a 250 KB bundle (${kb(sizes.large.br)} brotli), inlining still wins on the very first page (${gap("mobile", "large", "lcp")} ms on mobile). Every later page re-downloads the bundle inside its HTML, though, while the linked file comes from cache. On page 2 the linked version is <b>${-gap("mobile", "large-next", "lcp")} ms</b> faster on mobile and <b>${-gap("3g", "large-next", "lcp")} ms</b> faster on 3G.</p>
        <p><a href="/inline-css/large-inline.html">large-inline</a> &rarr; <a href="/inline-css/large-inline-next.html">page 2</a> &middot; <a href="/inline-css/large-link.html">large-link</a> &rarr; <a href="/inline-css/large-link-next.html">page 2</a></p></div>
    </div>
    <p>Rule of thumb: inlining saves about <b>one RTT per first page view</b> and costs <b>the CSS bytes on every page view after it</b>. Inline when the CSS is small enough that re-sending it is cheaper than a round trip (atomic CSS, single landing pages). Link when the bundle is large and visitors view more than one page.</p>
    <p><b>Where exactly is the line?</b> The <a href="/inline-css/sweep/">size sweep</a> measures 3&ndash;250 KB of CSS on Slow 4G, Fast 4G and cable, for first and repeat visits, with the raw data as <a href="/inline-css/sweep/data.json">JSON</a> and <a href="/inline-css/sweep/data.csv">CSV</a>.</p>

    <h2>Measured results</h2>
    <p>Median of ${results ? results.runs : "N"} cold loads per cell, in milliseconds. Each load uses a fresh browser context, so there is no HTTP cache and no warm connection. <span class="win">&nbsp;green&nbsp;</span> means inline is faster by more than 30 ms, and <span class="lose">&nbsp;red&nbsp;</span> means link is faster by more than 30 ms. "Bytes" is the total transferred (brotli) for the document plus its CSS.</p>
    <ul>${profileList}</ul>
    ${table([["small-inline.html", "small-link.html"]], "1 · Small CSS (3 KB), text LCP: inline wins")}
    ${table([["belowfold-inline.html", "belowfold-link.html"]], "2 · Below-the-fold CSS (250 KB) in the body, small critical CSS inlined in the head: doesn't matter")}
    ${table([["large-inline.html", "large-link.html"]], "3a · Large CSS (250 KB), first page of the visit: inline still wins")}
    ${table([["large-inline-next.html", "large-link-next.html"]], "3b · Large CSS, second page in the same session (CSS already cached from page 1): link wins")}
    ${results ? `<p class="small">Measured ${results.date} with ${results.browser} (headless) over a local server using brotli (quality 11), as the CDNs serving this site do. Network shaping uses Chrome DevTools throttling, which adds the RTT to every request but doesn't model TCP/TLS handshakes or slow start. Real networks add more cost to each extra request than shown here, so the "inline wins" gaps are a lower bound.</p>` : ""}

    <h2>Sizes</h2>
    <table><thead><tr><th>Asset</th><th class="num">Raw</th><th class="num">gzip</th><th class="num">brotli</th></tr></thead><tbody>
      <tr><td><a href="/inline-css/small.css">small.css</a></td><td class="num">${kb(sizes.small.raw)}</td><td class="num">${kb(sizes.small.gz)}</td><td class="num">${kb(sizes.small.br)}</td></tr>
      <tr><td><a href="/inline-css/large.css">large.css</a></td><td class="num">${kb(sizes.large.raw)}</td><td class="num">${kb(sizes.large.gz)}</td><td class="num">${kb(sizes.large.br)}</td></tr>
      <tr><td>small-inline.html / small-link.html</td><td class="num">&mdash;</td><td class="num">&mdash;</td><td class="num">${kb(htmlSize("small-inline.html"))} / ${kb(htmlSize("small-link.html"))}</td></tr>
      <tr><td>large-inline.html / large-link.html</td><td class="num">&mdash;</td><td class="num">&mdash;</td><td class="num">${kb(htmlSize("large-inline.html"))} / ${kb(htmlSize("large-link.html"))}</td></tr>
    </tbody></table>

    <h2>Why</h2>
    <ul>
      <li><b>A linked stylesheet costs one round trip plus its bytes.</b> The browser only finds the <code>&lt;link&gt;</code> after the HTML arrives, then has to request the file. Inlining saves the round trip but not the bytes.</li>
      <li><b>So the gain scales with RTT, not with CSS size.</b> 3 KB or 250 KB, inlining saves about one RTT on a first visit (${gap("mobile", "small", "lcp")} vs ${gap("mobile", "large", "lcp")} ms on mobile). The cost scales with CSS size: the bytes are re-sent on every page view.</li>
      <li><b>LCP only improves if the CSS is on its critical path.</b> Chrome blocks rendering only for content after a stylesheet, so CSS placed after the LCP content doesn't delay it, whether inlined or linked. The same is true when the LCP waits on something slower than the CSS, like an image, font, or API response.</li>
      <li><b>A long document doesn't hide the cost.</b> Chrome paints progressively, so even a 150 KB article page still waits for the linked stylesheet before its first paint.</li>
      <li><b>Caching is where linking wins.</b> Inlined CSS is part of each HTML response. Most sites serve HTML with a short cache lifetime (or none), so the CSS is downloaded on every navigation.</li>
    </ul>

    <h2>Try it yourself</h2>
    <p>In Chrome DevTools, check <i>Network &rarr; Disable cache</i>, set throttling to <i>Slow 4G</i>, and record a <i>Performance</i> trace of each page in a pair. To reproduce the table: <code>node inline-css/bench/measure.mjs &amp;&amp; node inline-css/bench/build.mjs</code>.</p>
  </body>
</html>
`);
console.log("built", pages.length + 1, "pages", sizes);
