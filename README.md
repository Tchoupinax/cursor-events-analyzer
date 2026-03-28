# Cursor usage analyzer

A small web app that turns your **Cursor team usage CSV** into charts and totals: spend over time, cost by model, tokens, and more. Everything runs **in the browser**—your file never leaves your machine.

---

### What it does

- Parses the usage export (dates, users, models, tokens, cost).
- Shows KPIs and charts: daily cost, events, cost by model, billing kind, top users, and the priciest single requests.
- Supports **light** and **dark** theme (preference is saved locally).

### Get your CSV

1. Open [Cursor billing & usage](https://cursor.com/dashboard/billing).
2. Download or export your usage data as **CSV** (same format as the dashboard export).

### Run locally

```bash
npm install
npm run dev
```

Then open the URL shown in the terminal (usually `http://localhost:5173`) and drop your file on the page.

**Production build:**

```bash
npm run build
npm run preview   # optional: test the build locally
```

Output is static files in `dist/`—you can host them on any static host.

### Deploy to GitHub Pages

1. In the repo: **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.
2. Push to `main` (or `master`). The workflow in `.github/workflows/deploy-pages.yml` builds the site and publishes it.
3. The app is served at `https://<user>.github.io/<repo>/` for normal projects, or at `https://<user>.github.io/` if the repo is named `<user>.github.io`.

The workflow sets the correct Vite `base` path automatically. To test a production build locally with a subpath:

```bash
GITHUB_PAGES_BASE=/your-repo/ npm run build
npm run preview
```

---

### Stack

React, TypeScript, Vite, Recharts, Papa Parse.

### Privacy

No server, no upload: parsing and aggregation happen entirely in your browser.
