# ChainPulse — Live Blockchain & Crypto News

A real-time blockchain and cryptocurrency news website. Headlines and short excerpts from 300+ sources, live market data, trending topics, fear & greed index, and trending open-source projects — with flowing live updates (no full-page refresh).

## Run locally

```bash
cd blockchain-news
python3 -m http.server 8080
# open http://localhost:8080
```

No build step, no dependencies.

## Data sources

- **News**: Free Crypto News API (cryptocurrency.cv) — no API key, CORS open. 300+ RSS/Atom feeds, 26 categories, breaking, trending, sources, fear & greed.
- **Markets**: CoinGecko free API (prices, 24h change).
- **Open source**: GitHub Search API (trending blockchain repos, cached 1h).

## Features

- Live flowing feed: polls every 45s and prepends new headlines to the top without a full refresh.
- Clickable trending topics (search + client-side fallback when rate-limited).
- All 26 categories with source counts.
- Markets grid with price + 24h change; click a coin to filter headlines.
- Fear & Greed gauge with 7-day history.
- Trending open-source repos from GitHub (stars, language, recency).
- Article modal with excerpt-based summary (API + client-side fallback), read time, related headlines, bookmark/save (localStorage).
- Dark/light theme, keyboard shortcuts (/ search, Esc close), mobile menu, back-to-top, reveal animations.
- AdSense-ready compliance surface (privacy, terms, about, contact, methodology, FAQ, ads.txt, robots.txt, sitemap.xml, marked ad slots).

## AdSense readiness

- Original-value additions: categorization, ranking, market context, editorial notes, methodology page explaining collection and update cadence.
- Only headlines + short excerpts shown; full articles linked to original publishers.
- Pages: About, Contact, Privacy Policy, Terms of Use, Methodology, FAQ.
- ads.txt (replace placeholder publisher ID), robots.txt, sitemap.xml.
- Ad slots marked in HTML (Advertisement placeholders) — paste AdSense code there.
- Fast, no pop-ups, clear navigation, responsive.

## How news is updated

- On load: latest headlines fetched immediately.
- Live poll every 45s: new items prepend to the top (no full refresh).
- Manual refresh button clears cache and re-fetches.
- Breaking ticker: items from the last 2 hours.

## Files

- `index.html` — main news + markets + open source
- `about.html`, `contact.html`, `privacy.html`, `terms.html`, `methodology.html`, `faq.html`
- `ads.txt`, `robots.txt`, `sitemap.xml`
- `styles.css`, `app.js`, `data.js`

Not financial advice.
