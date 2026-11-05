#!/usr/bin/env python3
"""Prerender initial headlines into index.html and news.html for SEO."""
import json, urllib.request, re, html, glob, os

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

def clean(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip()

def render_story_card(a):
    cat = esc(a.get('category', 'general'))
    title = esc(a.get('title', ''))
    desc = esc(clean(a.get('description') or '')[:160])
    src = esc(a.get('source', 'Unknown'))
    dek = f'<p class="story-dek">{desc}</p>' if desc else ''
    return ('<article class="story" data-prerendered="1" style="opacity:1;transform:none">\n'
            '  <span class="story-cat">' + cat + '</span>\n'
            '  <h3 class="story-title">' + title + '</h3>\n'
            '  ' + dek + '\n'
            '  <div class="story-meta"><span class="src">' + src + '</span></div>\n'
            '</article>')

def main():
    print("Fetching news...")
    data = fetch('/api/news?limit=8')
    arts = (data or {}).get('articles', [])[:8]
    print(f"  Got {len(arts)} articles")

    if not arts:
        print("No articles; aborting.")
        return

    cards = '\n'.join(render_story_card(a) for a in arts)
    ticker_items = '  ·  '.join(esc(a.get('title', '')) for a in arts[:6])
    ticker_text = ticker_items + '  ·  ' + ticker_items
    first_title = esc(arts[0].get('title', 'Latest Crypto News'))

    # Update index.html and news.html story grids + hero + ticker
    for target_file in ['index.html', 'news.html']:
        path = target_file
        with open(path) as f:
            content = f.read()

        if 'Loading the latest' in content:
            content = content.replace(
                '<h1 class="hero-headline">Loading the latest…</h1>',
                '<h1 class="hero-headline">' + first_title + '</h1>'
            )

        if '<!--STORIES_START-->' in content and '<!--STORIES_END-->' in content:
            content = re.sub(
                r'(<!--STORIES_START-->).*?(<!--STORIES_END-->)',
                r'\1\n' + cards + r'\n\2',
                content, count=1, flags=re.DOTALL
            )

        with open(path, 'w') as f:
            f.write(content)
        print(f"  Updated {target_file}")

    # Replace placeholder ticker text in ALL html files
    for path in glob.glob('*.html'):
        with open(path) as f:
            content = f.read()
        if 'Loading breaking headlines…' in content:
            content = content.replace(
                '<span class="ticker-item">Loading breaking headlines…</span>',
                '<span class="ticker-item">' + ticker_text + '</span>'
            )
            with open(path, 'w') as f:
                f.write(content)
            print(f"  Updated ticker in {path}")

    print("Done.")

if __name__ == '__main__':
    main()
