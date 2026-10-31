# ChainPlus — Deployment Guide

## Live now
- GitHub Pages: https://ny48x.github.io/chainplus/
- Worker API: https://chainplus-api.miketembo828.workers.dev
- Repo: https://github.com/NY48X/chainplus

## Point your .tech domain to GitHub Pages
1. In your domain registrar (GitHub Student Pack gives you the .tech domain via Namecheap/Name.com), add these DNS records:
   - Type `A`, Host `@`, Value `185.199.108.153`
   - Type `A`, Host `@`, Value `185.199.109.153`
   - Type `A`, Host `@`, Value `185.199.110.153`
   - Type `A`, Host `@`, Value `185.199.111.153`
   - Type `CNAME`, Host `www`, Value `ny48x.github.io`
2. In the repo settings → Pages → Custom domain, enter `yourdomain.tech` and save.
3. Enable "Enforce HTTPS" once the cert provisions (takes up to 24h).

## Fix the 403s — deploy the Cloudflare Worker (free)
The site falls back to RSS when cryptocurrency.cv returns 403, but trending/categories still suffer. Deploy the worker for a fully resilient backend:

1. Sign up at cloudflare.com (free).
2. Install wrangler: `npm install -g wrangler`
3. Authenticate: `npx wrangler login`
4. Deploy: `cd worker && npx wrangler deploy`
5. You'll get a URL like `https://chainplus-api.<your-subdomain>.workers.dev`
6. Point the frontend at it: in the browser console on your site run:
   `localStorage.setItem('cp-api-base', 'https://chainplus-api.<your-subdomain>.workers.dev')`
   Or set `window.CHAINPLUS_API` in index.html before app.js loads.
7. (Optional) Bind your .tech domain to the worker for a clean API URL.

## Redeploy after changes
```
cd /home/nythrux/blockchain-news
git add -A && git commit -m "update" && git push
```
GitHub Pages rebuilds automatically.