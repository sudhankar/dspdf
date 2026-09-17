# DSPDF

**Powerful PDF Tools. 100% Private. Runs in Your Browser.**

DSPDF is a suite of client-side PDF tools — merge, split, compress, sign, edit, redact, OCR, and more. Everything runs in the user's browser. Nothing is uploaded. There is no backend, no database, no accounts.

---

## What's in the box

A single-page-app-like static site built with vanilla HTML, CSS, and JavaScript. No build step, no bundler, no framework. Open `index.html` in a browser and it works.

### Tools included (25 total)

**Organize:** Merge, Split, Rotate, Delete Pages, Extract Pages, Crop, N-up
**Convert:** JPG→PDF, PDF→JPG, HTML→PDF
**Edit & Annotate:** PDF Editor (overlay-based), Add Text, Add Image, Sign, Watermark, Highlight, Page Numbers, Header/Footer, Redact, Annotate
**Optimize:** Compress, Metadata Editor
**Security:** Protect (password), Unlock (known password)
**OCR:** OCR PDF (English + Hindi, powered by Tesseract.js)

### Site pages

Homepage, Tools directory, 15 long-form blog articles, About, Contact, FAQ, Privacy Policy, Terms, Disclaimer, Cookie Policy, DMCA, 404.

---

## Architecture

### Zero backend

DSPDF is a **static site**. There is no server-side component, no API, no database. Host it on GitHub Pages, Netlify, Vercel, Cloudflare Pages, or any web host that serves static files.

### All processing happens client-side

Files are read via the browser's `FileReader` API, processed with JavaScript libraries running in the browser, and offered as downloads via Blob URLs. No file content is ever transmitted.

You can verify this:
1. Open DevTools → Network tab → clear requests → use any tool. No outgoing request carries your file.
2. Load a tool page, disconnect from the internet, use the tool. It still works.

### Libraries used

| Library | Purpose | Version | Source |
|---|---|---|---|
| pdf-lib | PDF creation and manipulation | 1.17.1 | unpkg |
| pdf.js | PDF rendering (for previews & rasterization) | 3.11.174 | cdnjs |
| Tesseract.js | OCR (lazy-loaded) | 5.0.5 | jsdelivr |
| jsPDF | PDF generation (compression, HTML→PDF) | 2.5.1 | cdnjs |
| JSZip | ZIP packaging (split, PDF→JPG) | 3.10.1 | cdnjs |
| FileSaver.js | Download helper | 2.0.5 | cdnjs |

All are open-source and widely used. None of them transmit file content.

### Web Workers

Heavy PDF operations (merge, rotate, delete, split) run inside a Web Worker (`js/pdf-worker.js`) so the UI stays responsive. The worker loads pdf-lib via `importScripts` and communicates via `postMessage`.

### Configuration

All site-wide settings live in `js/config.js`. This is the **only file most deployers need to edit**. See the section below.

---

## Quick start (local)

Because there's no build step, you can run DSPDF with any static file server:

```bash
# Option 1: Python (comes installed on most systems)
cd dspdf
python3 -m http.server 8000

# Option 2: Node.js
npx serve .
```

Then visit `http://localhost:8000`.

⚠️ **Don't** open `index.html` directly via `file:///` — some browsers restrict `fetch` and service workers in that mode. Use a local server.

---

## Configuration — `js/config.js`

Open `js/config.js` and edit the marked values:

```javascript
window.DSPDF_CONFIG = {
  siteName: "DSPDF",

  // 👉 If your site URL is https://username.github.io/dspdf/
  //    set basePath to "/dspdf/"
  // 👉 If your site is at the root of a domain (e.g. https://dspdf.com/)
  //    set basePath to "/"
  basePath: "/",

  // 👉 Your full public URL, WITH trailing slash.
  siteUrl: "https://YOUR-USERNAME.github.io/dspdf/",

  // 👉 Your real contact email. Shown on Contact page.
  contactEmail: "hello@example.com",

  // 👉 Ads: keep false until AdSense approves your site.
  adsenseEnabled: false,
  adsenseClient: "",

  // 👉 Analytics: optional. Leave off for full privacy.
  analyticsEnabled: false,
  analyticsId: "",

  version: "1.0.0"
};
```

### ⚠️ Important: basePath and siteUrl

The single most common deployment mistake is setting `basePath` wrong. Two scenarios:

| Your deployed URL | basePath | siteUrl |
|---|---|---|
| `https://sudhankar.github.io/dspdf/` | `/dspdf/` | `https://sudhankar.github.io/dspdf/` |
| `https://sudhankar.github.io/` | `/` | `https://sudhankar.github.io/` |
| `https://dspdf.com/` | `/` | `https://dspdf.com/` |

Also update these two files to match:
- `sitemap.xml` — find/replace `YOUR-USERNAME.github.io/dspdf` with your real URL
- `robots.txt` — same

---

## Adding a new tool

Follow this recipe to add a tool page (example: `my-tool`):

### 1. Create the page

Copy any existing tool folder (e.g. `tools/rotate-pdf/`) and rename it to `tools/my-tool/`.

### 2. Update the HTML

In `tools/my-tool/index.html`, change:
- `<title>`, meta description, canonical, OG tags
- `<h1>`, intro paragraph, how-to steps, technical limitations, FAQ, related tools
- JSON-LD blocks (SoftwareApplication, BreadcrumbList, FAQPage)
- The upload zone ID, alert ID, progress ID, button IDs — any ID unique to this tool

### 3. Create the JS

Create `js/tools/my-tool.js` alongside the existing tools. Follow the pattern from `js/tools/rotate.js` or `merge.js`:

```javascript
(function () {
  "use strict";
  var D = window.DSPDF;      // shared engine (tools-engine.js)
  var log = window.dspdfLog; // debug logger

  // 1. Set up state
  // 2. Use D.UploadZone to wire up the drop area
  // 3. Use D.ProgressUI for the progress bar
  // 4. Use D.downloadBlob to deliver the output
  // 5. Handle errors via D.showError / D.humanError
})();
```

### 4. Register in the tools directory

Add a card to `tools/index.html` under the appropriate category heading.

### 5. Add to sitemap

Add a `<url>` entry in `sitemap.xml` with an appropriate priority.

### 6. Add to homepage (optional)

If the tool is a popular one, add a card to `index.html` in the "Popular PDF Tools" section.

---

## Adding a new blog article

### 1. Create the folder

```
mkdir blog/my-article-title
```

### 2. Copy the article template

Copy `blog/how-to-compress-pdf/index.html` and rename to `blog/my-article-title/index.html`.

### 3. Write your article

Replace the content inside `<article class="article">`. Keep:
- Breadcrumbs (`Home → Blog → Your Title`)
- `.eyebrow` category tag
- `<h1>` title
- `.article__meta` (author, date, read time)
- Body content with `<h2>` sections
- `.article__toc` table of contents (optional but recommended)
- FAQ section with `<details>` blocks
- `.article__byline` at the bottom

Update the JSON-LD at the top:
- `BlogPosting` with headline, description, dates, URL
- `BreadcrumbList`
- `FAQPage` if your article has an FAQ section

### 4. Add to blog index

Add a `<a class="post-card">` to `blog/index.html`.

### 5. Add to sitemap

Add a `<url>` entry in `sitemap.xml`.

---

## Updating the sitemap

Whenever you add a page, add a `<url>` block:

```xml
<url>
  <loc>https://YOUR-USERNAME.github.io/dspdf/path/to/page/</loc>
  <changefreq>monthly</changefreq>
  <priority>0.7</priority>
</url>
```

Priorities used in this project:
- Homepage: 1.0
- Tools directory + PDF Editor + Compress: 0.9
- Individual tools: 0.6–0.8
- Blog index: 0.7
- Blog posts: 0.5–0.7
- About, FAQ: 0.6
- Legal pages: 0.3–0.4

---

## Enabling AdSense

1. Wait until AdSense approves your site (this requires real content and traffic — do not apply too early).
2. Google will give you a `ca-pub-XXXXXXXX` publisher ID.
3. Edit `js/config.js`:
   ```javascript
   adsenseEnabled: true,
   adsenseClient: "ca-pub-1234567890123456",
   ```
4. Update `ads.txt` with the exact line Google provides:
   ```
   google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0
   ```
5. Add the AdSense `<ins>` code inside the commented slots throughout the site. Each slot is marked:
   ```html
   <!-- AD SLOT: Leaderboard below header -->
   <!-- 👉 OWNER: Paste AdSense <ins> code here after approval -->
   ```

Ad slots exist in:
- Below header on homepage and tool pages
- After tool interfaces
- Inside blog content (after 2nd `<h2>`)
- Footer

**Never** place ads over tool buttons or inside the tool UI. This risks policy violations.

---

## Enabling analytics

Optional. Recommended provider: Plausible or Fathom (privacy-respecting), or Google Analytics 4 (free, more invasive).

Edit `js/config.js`:
```javascript
analyticsEnabled: true,
analyticsId: "G-XXXXXXXXXX",
```

Then add your analytics script snippet to `index.html` (and any page you want tracked) just before `</body>`, wrapped in a check for `DSPDF_CONFIG.analyticsEnabled`.

Since analytics is off by default, no tracking code runs unless you explicitly enable it.

---

## Customizing the design

### Colors

Open `css/style.css` and edit the CSS variables at the top:

```css
:root {
  --bg-dark: #0A1929;      /* page background (dark mode) */
  --accent:  #2563EB;      /* primary brand color */
  --success: #10B981;
  --danger:  #EF4444;
  /* ... etc */
}
```

Light-mode overrides are under `[data-theme="light"]`.

### Logo

Replace `images/logo.svg` and `images/favicon.svg` with your own. The wordmark uses `currentColor`, so it adapts to light/dark mode automatically.

### Typography

The site uses Inter from Google Fonts. To change it, edit the `<link>` tag in each page's `<head>` and update `--font-sans` in `css/style.css`.

---

## File structure

```
dspdf/
├── index.html                Homepage
├── 404.html                  Custom 404
├── sitemap.xml
├── robots.txt
├── ads.txt
├── manifest.json
├── service-worker.js
├── README.md                 This file
├── DEPLOYMENT.md             Deployment guide
├── css/
│   ├── style.css             Design system
│   ├── tools.css             Tool-specific styles
│   ├── editor.css            PDF editor styles
│   └── blog.css              Blog article styles
├── js/
│   ├── config.js             ⚠️ Site configuration
│   ├── main.js               Shared UI (theme, nav, toasts)
│   ├── tools-engine.js       File handling, upload zones, progress
│   ├── pdf-worker.js         Web Worker for pdf-lib operations
│   ├── tools/                One JS file per tool
│   └── editor/               PDF editor modules
├── tools/                    One folder per tool page
├── blog/                     One folder per article
├── about/, contact/, faq/,   Static content pages
├── privacy-policy/, terms/,
├── disclaimer/, cookie-policy/, dmca/
└── images/
    ├── logo.svg
    ├── favicon.svg
    └── icons/
```

---

## Browser support

Modern evergreen browsers:

- Chrome / Edge 90+
- Firefox 90+
- Safari 15+
- Mobile Safari (iOS 15+)
- Chrome for Android

Older browsers (Internet Explorer, pre-Chromium Edge) are not supported. Service workers and the File System Access API require modern browser versions.

---

## Known limitations

Documented honestly on the relevant tool pages, and repeated here for convenience:

- **Cannot edit existing PDF text.** No browser-based tool can, reliably. Our editor adds new content on top.
- **Custom fonts not supported in text tools.** Only standard PDF fonts (Helvetica, Times, Courier). Custom TTF embedding is on the roadmap.
- **Merge/split loses bookmarks and form fields.** Limitation of client-side pdf-lib.
- **Compression rasterizes pages.** Text becomes non-selectable after compression. Use OCR afterward to rebuild a text layer.
- **OCR struggles with handwriting.** Tesseract.js is trained on printed text. Accuracy figures on the OCR page.
- **Page reordering is not a standalone tool.** Currently achievable via extract + merge.
- **Protect PDF encryption depends on library support.** The tool checks at runtime and tells you honestly if it can't encrypt.
- **Redaction is only secure when rasterized.** Black boxes alone don't remove data.

---

## Testing checklist before deploying

- [ ] `js/config.js` — `basePath` and `siteUrl` set to your real deployment
- [ ] `sitemap.xml` — URLs updated to your real domain
- [ ] `robots.txt` — sitemap URL updated
- [ ] `images/logo.svg` and `images/favicon.svg` — replaced if customizing
- [ ] Open the site in a local server, verify homepage, tools directory, and a few tools work
- [ ] Verify a merge, a split, and a compress actually produce output
- [ ] Verify mobile layout (test at 375px width)
- [ ] Verify theme toggle persists
- [ ] Test with DevTools open — confirm no outgoing file uploads
- [ ] Test with internet disconnected after page load — confirm tools still work

---

## Contributing

DSPDF is designed to be self-hosted and self-modified. If you're running your own copy:

- The code is yours to change.
- Keep the honesty principles: don't claim features work if they don't.
- Document limitations on each tool page.
- Keep everything client-side (that's the whole point).

---

## License and attribution

Built on open-source libraries. The HTML, CSS, and JS code specific to DSPDF is yours to use, modify, and redistribute.

👉 OWNER: Add a license here if you want to formally license your own code (MIT is common for projects like this). Example:

```
MIT License

Copyright (c) 2026 [Your name]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software...
```

---

## Contact

See the Contact page on the live site, or check `js/config.js` for the configured email.