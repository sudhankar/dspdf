# Deploying DSPDF to GitHub Pages

A step-by-step guide in **simple English + Hinglish**, for non-technical owners.

Agar aap ye guide follow karein, aapka site 15 minute mein live ho jayega.
(If you follow this guide, your site will be live in about 15 minutes.)

---

## What you'll need

- A GitHub account (free — sign up at https://github.com)
- The DSPDF files (all the ones we've built together)
- 15 minutes of time
- A computer with internet

You do NOT need: a domain name, a paid hosting plan, any coding knowledge, or a terminal.

---

## Overview — what we're going to do

1. Create a GitHub repository (a project folder in the cloud)
2. Upload the DSPDF files to it
3. Turn on GitHub Pages (free hosting)
4. Edit one config file so the site knows its own URL
5. Done — visit your live site

---

## Step 1: Create a GitHub repository

1. Go to https://github.com and sign in (or sign up — it's free).
2. Click the **+** icon at the top-right, then **New repository**.
3. Fill in:
   - **Repository name:** `dspdf` (or anything you like, but remember this name — we'll use it later)
   - **Description:** optional. "Private PDF tools, all client-side" is a nice one.
   - **Visibility:** **Public** (required for free GitHub Pages)
   - ❌ **Do NOT** check "Add a README file" (we already have one)
4. Click **Create repository**.

You now have an empty repository. The URL will look like:

```
https://github.com/YOUR-USERNAME/dspdf
```

Agar aap is URL ko yaad rakhein — aage kaam aayega.

**Write down your username and repo name.** You'll need them in Step 4.

---

## Step 2: Upload the DSPDF files

### Option A — Drag and drop (easiest, good for ≤100 files)

1. On your repository page, click **Add file → Upload files**.
2. Open the DSPDF folder on your computer (the one with `index.html` inside).
3. **Select all files and folders** inside the `dspdf` folder — NOT the folder itself, its contents.
4. Drag them into the GitHub upload area.
5. Wait for the upload to complete (this may take a minute).
6. Scroll down, in the "Commit changes" box type: `Initial upload`
7. Click **Commit changes**.

**Note:** GitHub's web uploader may not handle nested folders well in one go. If subfolders fail, you may need to upload them one level at a time (open `tools/` in the file picker, drag its contents, repeat for each subfolder).

### Option B — GitHub Desktop (recommended for many files)

1. Download **GitHub Desktop**: https://desktop.github.com
2. Install and sign in with your GitHub account.
3. Click **File → Clone repository** and select your `dspdf` repo.
4. Copy all DSPDF files into the cloned folder on your computer.
5. In GitHub Desktop, type a summary (`Initial upload`), click **Commit to main**, then **Push origin**.

This is easier for large file sets and any future updates.

### Option C — Command line (fastest if you know Git)

```bash
cd /path/to/dspdf
git init
git remote add origin https://github.com/YOUR-USERNAME/dspdf.git
git add .
git commit -m "Initial upload"
git branch -M main
git push -u origin main
```

---

## Step 3: Turn on GitHub Pages

1. Go to your repository page on GitHub.
2. Click **Settings** (in the top navigation bar).
3. In the left sidebar, click **Pages**.
4. Under **Source**, select **Deploy from a branch**.
5. Under **Branch**, select **main** and folder **/ (root)**.
6. Click **Save**.
7. Wait 1–3 minutes. Refresh the page. You'll see a green message:

   **"Your site is live at https://dspdf.pages.dev/"**

**Ye URL aapka live site ka address hai.** Copy karke rakhein.

### Common issues at this step

- **404 after a few minutes?** Usually the upload didn't include `index.html` at the root. Check that your repository's top-level file list includes `index.html`.
- **Site loads but the CSS is broken?** You probably skipped Step 4 (config edit). Do that now.
- **"Site is live" but the page is blank?** Open the browser console (F12) and check for errors — most likely a wrong `basePath`.

---

## Step 4: Edit `js/config.js` (⚠️ DO NOT SKIP)

This step makes the site work correctly under your GitHub Pages URL.

### 4a. Understand the "basePath" concept

GitHub Pages hosts your site at a URL like:

```
https://dspdf.pages.dev/
```

Because your site lives in a subfolder (`/dspdf/`), all internal links and assets need to know that. This is what `basePath` does.

**Examples:**

| Your live URL | basePath should be |
|---|---|
| `https://sudhankar.github.io/dspdf/` | `/dspdf/` |
| `https://priya.github.io/my-pdf-tools/` | `/my-pdf-tools/` |
| `https://username.github.io/` | `/` |
| `https://dspdf.com/` (custom domain) | `/` |

### 4b. Edit the config file

1. In your repository, navigate to `js/config.js`.
2. Click the pencil icon (✏️) at the top-right to edit.
3. Find these lines:
   ```javascript
   basePath: "/",
   siteUrl: "https://dspdf.pages.dev/",
   contactEmail: "hello@example.com",
   ```
4. Change them to your real values. For example, if your username is `sudhankar` and your repo is `dspdf`:
   ```javascript
   basePath: "/dspdf/",
   siteUrl: "https://sudhankar.github.io/dspdf/",
   contactEmail: "your-real-email@example.com",
   ```
5. Scroll to the bottom, click **Commit changes**.

### 4c. Update sitemap.xml and robots.txt

1. Open `sitemap.xml` in your repository. Click the pencil icon.
2. Use the browser's Find and Replace (Ctrl+H on Windows, Cmd+Option+F on Mac):
   - Find: `dspdf.pages.dev`
   - Replace with: `YOUR-USERNAME.github.io/YOUR-REPO-NAME` (your real username + repo)
3. Commit.
4. Open `robots.txt`, click the pencil, find the line:
   ```
   Sitemap: https://dspdf.pages.dev/sitemap.xml
   ```
   and change it to your real URL. Commit.

### 4d. Update `404.html` paths (⚠️ if using subpath)

The `404.html` file uses absolute paths (e.g. `/css/style.css`) which won't work if your site is in a subdirectory. Open `404.html`, find:

```
/css/style.css
/js/config.js
/js/main.js
/images/favicon.svg
```

Replace each with the prefixed version:

```
/dspdf/css/style.css
/dspdf/js/config.js
/dspdf/js/main.js
/dspdf/images/favicon.svg
```

And also update the internal links (`/tools/index.html` → `/dspdf/tools/index.html`, etc.).

If your site is at the root (`https://username.github.io/`), leave them as-is.

### 4e. Wait and test

GitHub Pages rebuilds within 1–2 minutes after a change. Then visit your live URL. Everything should load correctly.

**Test checklist:**
- [ ] Homepage loads with styles
- [ ] Click a tool — the tool page opens
- [ ] Drop a PDF into the merge tool — thumbnails appear
- [ ] Merge two small PDFs — output downloads
- [ ] Toggle dark/light theme — preference persists on refresh
- [ ] Visit `https://dspdf.pages.dev/sitemap.xml` — XML loads
- [ ] Visit `https://dspdf.pages.dev/robots.txt` — text loads
- [ ] Visit a nonexistent URL like `/nope` — 404 page appears

---

## Step 5: Custom domain (optional)

If you have a domain like `dspdf.com` and want to use it instead of the GitHub URL:

1. In your repository, go to **Settings → Pages**.
2. Under **Custom domain**, enter `dspdf.com` (or `www.dspdf.com`). Click Save.
3. GitHub will ask you to add DNS records at your domain registrar:
   - For apex domain (dspdf.com): add an A record pointing to the four GitHub Pages IPs (they'll show in the UI).
   - For subdomain (www.dspdf.com): add a CNAME record pointing to `YOUR-USERNAME.github.io`.
4. Wait for DNS propagation (can take up to 24 hours, usually 10 minutes).
5. Tick **Enforce HTTPS** once available.

After enabling a custom domain:

- Change `basePath` in `js/config.js` back to `/`
- Change `siteUrl` to `https://dspdf.com/`
- Update `sitemap.xml` and `robots.txt` with the new domain

---

## How to update content later

### To update a file

1. Navigate to the file in your GitHub repository.
2. Click the pencil icon (✏️).
3. Make your edits.
4. Scroll down, click **Commit changes**.
5. Wait 1–2 minutes for GitHub Pages to rebuild.

### To add a new tool

Follow the "Adding a new tool" section in `README.md`. Short version:
1. Copy an existing tool folder (e.g. `tools/rotate-pdf/`) and rename.
2. Update HTML content, JSON-LD, and page IDs.
3. Create a matching JS file in `js/tools/`.
4. Add a card to `tools/index.html`.
5. Add a `<url>` to `sitemap.xml`.

### To add a new blog article

Follow the "Adding a new blog article" section in `README.md`. Short version:
1. Copy `blog/how-to-compress-pdf/` and rename.
2. Write your content.
3. Add a `<a class="post-card">` to `blog/index.html`.
4. Add a `<url>` to `sitemap.xml`.

### To enable AdSense

See the "Enabling AdSense" section in `README.md`. Do this only after AdSense approves your site.

---

## Troubleshooting

### Problem: CSS not loading (page looks plain)

**Cause:** `basePath` is wrong in `js/config.js`, or links are hardcoded.

**Fix:** Check that `basePath` matches your deployment URL pattern (with leading and trailing slashes). Verify by opening DevTools → Network tab and looking for 404s on CSS files.

### Problem: Site shows 404 at the root URL

**Cause:** `index.html` is not at the top level of the repository.

**Fix:** Check your repository's file list. `index.html` must be at the very top, not inside a `dspdf/` subfolder. If you uploaded the folder itself instead of its contents, you need to move everything up a level (GitHub lets you do this by editing — or just re-upload).

### Problem: Tool buttons don't work

**Cause:** JavaScript didn't load, or a CDN library is blocked.

**Fix:** Open DevTools (F12) → Console tab. Look for red errors. Common issues:
- A CDN script failed to load (check the Network tab)
- Ad blocker blocking a CDN
- Browser extension interfering

### Problem: Service worker serving stale content

**Cause:** After updates, the old version may be cached.

**Fix:** Hard refresh (Ctrl+Shift+R / Cmd+Shift+R). Or open DevTools → Application → Service Workers → Unregister, then reload.

### Problem: Site won't update after commit

**Cause:** GitHub Pages takes 1–3 minutes, sometimes longer.

**Fix:** Check the **Actions** tab in your repository. There should be a deployment in progress or recently completed. If it shows a failure, click into it for details.

### Problem: "Page not found" for a tool

**Cause:** The folder URL must end in `/` because the page is at `folder/index.html`.

**Fix:** Use `/tools/merge-pdf/` (with trailing slash), not `/tools/merge-pdf`. GitHub Pages will redirect the latter to the former in most cases, but it's cleaner to always include the slash.

---

## Handy Hindi/English cheatsheet

| English | Hinglish |
|---|---|
| Repository | Project folder (GitHub pe) |
| Commit | Save changes |
| Push | Upload to GitHub |
| Branch | Version line (usually `main`) |
| Deploy | Publish / Live karna |
| Build | Website tayyar karna |
| Base URL | Site ka main address |
| Config file | Settings file |

---

## Getting help

- **GitHub Pages docs:** https://docs.github.com/en/pages
- **GitHub Community forum:** https://github.community
- **Stack Overflow** for technical issues
- **Our Contact page** for DSPDF-specific questions

If you're stuck, take a screenshot of the error message and include it in a message on the Contact page. The more detail you give, the faster we can help.

---

## Final checklist before going live

- [ ] All files uploaded to GitHub
- [ ] GitHub Pages enabled in Settings → Pages
- [ ] `js/config.js` — `basePath`, `siteUrl`, and `contactEmail` updated
- [ ] `sitemap.xml` — replaced `dspdf.pages.dev` with real URL
- [ ] `robots.txt` — sitemap URL updated
- [ ] `404.html` — absolute paths updated (if using subpath)
- [ ] Homepage loads with styles and working tool links
- [ ] At least one tool tested end-to-end (merge or split is easy)
- [ ] Mobile layout tested (resize browser or open on phone)
- [ ] Theme toggle works
- [ ] No outgoing file uploads visible in DevTools Network tab

Once all checkboxes are ticked, your site is live and private. Share the URL and enjoy.

---

**Bilkul mubarak ho — aapka DSPDF live hai!**
*(Congratulations — your DSPDF is live!)*