# fast-page

Static HTML pages for checking how browsers load, stream, and update a document.

- `index.html` is a minimal page.
- `script-loading/` and `script-loading-timeout/` compare classic, module, async, defer, and inline scripts, with and without preloading.
- `streaming.html` streams HTML and swaps in a template.
- `dpu/` tries declarative partial updates.
- `tasks/` holds short and long main-thread tasks.
- `inline-css/` measures FCP and LCP with inline `<style>` vs linked CSS on first visit, based on the Next.js `inlineCss` trade-offs. `inline-css/bench/` has the generator and Chrome benchmark (`node inline-css/bench/measure.mjs && node inline-css/bench/build.mjs`); it is left out of deploys.

Pushes to `main` publish the site on:

- Vercel: https://fast-page.vercel.app
- Netlify: https://splendorous-concha-e646e2.netlify.app
- Cloudflare Workers: https://fast-page.to-email-max.workers.dev

This file stays in the repo and is left out of those deploys.
