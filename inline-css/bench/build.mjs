// Generates the static pages in inline-css/ (the pages themselves contain no JS).
// Usage: node inline-css/bench/build.mjs   (re-run after measure.mjs to refresh the results table)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gzipSync, brotliCompressSync } from "node:zlib";
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
      rows.push(`<tr><td>${prof.label}</td><td><a href="${inl}">${inl}</a> vs <a href="${lnk}">${lnk}</a></td>
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
        <p><a href="small-inline.html">small-inline</a> &middot; <a href="small-link.html">small-link</a></p></div>
      <div class="card"><div class="tag t-eq">Doesn't matter</div><h3>Low latency, or CSS that isn't render-blocking</h3>
        <p>On broadband (20 ms RTT) the extra request costs ${gap("broadband", "small", "lcp")} ms, which is within run-to-run noise. CSS placed after the LCP content (for example, a stylesheet for below-the-fold widgets in the body) doesn't affect FCP or LCP either way. Measured LCP difference (link minus inline): ${gap("mobile", "belowfold", "lcp")} ms on mobile and ${gap("3g", "belowfold", "lcp")} ms on 3G.</p>
        <p><a href="belowfold-inline.html">belowfold-inline</a> &middot; <a href="belowfold-link.html">belowfold-link</a></p></div>
      <div class="card"><div class="tag t-ln">Link</div><h3>Large CSS and more than one page view</h3>
        <p>With a 250 KB bundle (${kb(sizes.large.br)} brotli), inlining still wins on the very first page (${gap("mobile", "large", "lcp")} ms on mobile). Every later page re-downloads the bundle inside its HTML, though, while the linked file comes from cache. On page 2 the linked version is <b>${-gap("mobile", "large-next", "lcp")} ms</b> faster on mobile and <b>${-gap("3g", "large-next", "lcp")} ms</b> faster on 3G.</p>
        <p><a href="large-inline.html">large-inline</a> &rarr; <a href="large-inline-next.html">page 2</a> &middot; <a href="large-link.html">large-link</a> &rarr; <a href="large-link-next.html">page 2</a></p></div>
    </div>
    <p>Rule of thumb: inlining saves about <b>one RTT per first page view</b> and costs <b>the CSS bytes on every page view after it</b>. Inline when the CSS is small enough that re-sending it is cheaper than a round trip (atomic CSS, single landing pages). Link when the bundle is large and visitors view more than one page.</p>

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
      <tr><td><a href="small.css">small.css</a></td><td class="num">${kb(sizes.small.raw)}</td><td class="num">${kb(sizes.small.gz)}</td><td class="num">${kb(sizes.small.br)}</td></tr>
      <tr><td><a href="large.css">large.css</a></td><td class="num">${kb(sizes.large.raw)}</td><td class="num">${kb(sizes.large.gz)}</td><td class="num">${kb(sizes.large.br)}</td></tr>
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
