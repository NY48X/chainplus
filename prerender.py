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
    return f'''<article class="story reveal">
  <span class="story-cat">{cat}</span>
  <h3 class="story-title">{title}</h3>
  {"<p class=\"story-dek\">" + desc + "</p>" if desc else ""}
  <div class="story-meta"><span class="src">{src}</span></div>
</article>'''

def main():
    print("Fetching news...")
    data = fetch('/api/news?limit=8')
    arts = (data or {}).get('articles', [])[:8]
    print(f"  Got {len(arts)} articles")

    # Build prerendered headlines HTML
    cards = '\n'.join(render_story_card(a) for a in arts)
    prerender_block = f'''<!-- PRERENDERED HEADLINES (for SEO/crawlers) -->
<div id="prerendered-headlines" style="display:none" aria-hidden="true">
{cards}
</div>
<!-- END PRERENDERED -->'''

    # Inject into index.html storiesGrid as fallback
    for target_file in ['index.html', 'news.html']:
        with open(target_file) as f:
            content = f.read()
        # Replace the "Loading the latest…" placeholder if present
        if 'Loading the latest' in content:
            content = content.replace(
                '<h2>Loading the latest…</h2>',
                '<h2>Latest Crypto Headlines</h2>'
            )
        # Add prerendered block before </main> if not already present
        if 'PRERENDERED HEADLINES' not in content:
            content = content.replace('</main>', prerender_block + '\n</main>', 1)
        with open(target_file, 'w') as f:
            f.write(content)
        print(f"  Updated {target_file}")

    print("Done.")

if __name__ == '__main__':
    main()
