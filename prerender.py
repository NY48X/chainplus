#!/usr/bin/env python3
"""Prerender initial headlines into index.html and news.html for SEO."""
import json, urllib.request, re, html

API = 'https://chainpulse-api.miketembo828.workers.dev'

def fetch(path):
    try:
        with urllib.request.urlopen(urllib.request.Request(API + path, headers={'User-Agent':'Mozilla/5.0'}), timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"  fetch error {path}: {e}")
        return None

def esc(s):
    return html.escape(str(s or ''))

def render_story_card(a):
    cat = esc(a.get('category', 'general'))
    title = esc(a.get('title', ''))
    desc = esc((a.get('description') or '')[:160])
    src = esc(a.get('source', 'Unknown'))
    link = esc(a.get('link', '#'))
    dek = f'<p class="story-dek">{desc}</p>' if desc else ''
    return f'''<article class="story" data-prerendered="1" style="opacity:1;transform:none">
  <span class="story-cat">{cat}</span>
  <h3 class="story-title">{title}</h3>
  {dek}
  <div class="story-meta"><span class="src">{src}</span></div>
</article>'''

def render_top_mover(coin, data, is_gainer=True):
    sym = esc(coin.get('sym', ''))
    name = esc(coin.get('name', ''))
    price = data.get('current_price', 0)
    chg = data.get('price_change_percentage_24h', 0) or 0
    cls = 'chg-up' if chg >= 0 else 'chg-down'
    sign = '+' if chg >= 0 else ''
    return f'<div class="mover-row"><span class="mover-sym">{sym}</span><span class="mover-name">{name}</span><span class="mover-price">${price:,.2f}</span><span class="mover-chg {cls}">{sign}{chg:.2f}%</span></div>'

def main():
    print("Fetching news...")
    data = fetch('/api/news?limit=8')
    arts = (data or {}).get('articles', [])[:8]
    print(f"  Got {len(arts)} articles")

    print("Fetching markets...")
    mdata = fetch('/api/markets?limit=20')
    coins = (mdata or {}).get('coins', [])[:20] if mdata else []
    market_data = {}
    if mdata:
        for c in (mdata.get('data') or mdata.get('markets') or []):
            market_data[c.get('id', c.get('symbol', ''))] = c
    print(f"  Got {len(market_data)} market entries")

    # Build prerendered headlines HTML for storiesGrid
    cards = '\n'.join(render_story_card(a) for a in arts)
    prerender_block = f'''<!-- PRERENDERED HEADLINES (for SEO/crawlers) -->
<div id="prerendered-headlines">
{cards}
</div>
<!-- END PRERENDERED -->'''

    for target_file in ['index.html', 'news.html']:
        with open(target_file) as f:
            content = f.read()

        # Replace "Loading the latest…" hero headline with first article title
        if arts and 'Loading the latest' in content:
            first_title = esc(arts[0].get('title', 'Latest Crypto News'))
            content = content.replace(
                '<h1 class="hero-headline">Loading the latest…</h1>',
                f'<h1 class="hero-headline">{first_title}</h1>'
            )

        # Replace ticker placeholder
        if arts and 'Loading breaking headlines' in content:
            ticker_items = '  ·  '.join(esc(a.get('title', '')) for a in arts[:6])
            content = content.replace(
                '<span class="ticker-item">Loading breaking headlines…</span>',
                f'<span class="ticker-item">{ticker_items}  ·  {ticker_items}</span>'
            )

        # Replace skeleton cards in #storiesGrid with prerendered content
        if '<div id="storiesGrid"' in content:
            content = re.sub(
                r'(<div id="storiesGrid"[^>]*>)(.*?)(</div>)',
                r'\1\n' + cards + r'\n\3',
                content, count=1, flags=re.DOTALL
            )

        # Remove old hidden prerender block if present
        content = re.sub(r'<!-- PRERENDERED HEADLINES.*?<!-- END PRERENDERED -->\n?', '', content, flags=re.DOTALL)

        # Add new prerender block before </main>
        if 'PRERENDERED HEADLINES' not in content:
            content = content.replace('</main>', prerender_block + '\n</main>', 1)

        with open(target_file, 'w') as f:
            f.write(content)
        print(f"  Updated {target_file}")

    print("Done.")

if __name__ == '__main__':
    main()
