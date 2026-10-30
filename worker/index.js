// Cloudflare Worker — ChainPulse API aggregator + cache
// Deploy: npx wrangler deploy
// Free tier: 100k requests/day, 10ms CPU per request

const RSS_FEEDS = [
  'https://cointelegraph.com/rss',
  'https://www.coindesk.com/arc/outboundfeeds/rss/',
  'https://decrypt.co/feed',
  'https://bitcoinmagazine.com/feed',
];

const UPSTREAM = 'https://cryptocurrency.cv';
const CACHE_TTL = 300; // 5 minutes

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Cache-Control': `public, max-age=${CACHE_TTL}`, ...extra },
  });
}

async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return r;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

async function fetchRSS() {
  const out = [];
  const seen = new Set();
  await Promise.all(RSS_FEEDS.map(async (url) => {
    try {
      const r = await fetchWithTimeout(
        `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`
      );
      if (!r.ok) return;
      const d = await r.json();
      if (d.status !== 'ok' || !Array.isArray(d.items)) return;
      const src = (d.feed && d.feed.title) || url;
      d.items.forEach((it) => {
        const link = it.link || it.guid || '';
        if (!link || seen.has(link)) return;
        seen.add(link);
        out.push({
          title: it.title || '',
          description: it.description || it.content || '',
          link,
          source: src,
          pubDate: it.pubDate || it.published || '',
          category: 'general',
          credibility: 0.7,
        });
      });
    } catch (e) { /* ignore */ }
  }));
  // sort by date desc
  out.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
  return out;
}

async function fetchUpstream(path) {
  try {
    const r = await fetchWithTimeout(`${UPSTREAM}${path}`);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

// Derive trending topics from article titles (word frequency)
function deriveTrending(articles) {
  const stop = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','must','can','this','that','these','those','i','you','he','she','it','we','they','what','which','who','whom','whose','when','where','why','how','all','each','every','both','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','just','about','into','over','after','before','between','under','above','up','down','out','off','then','once','here','there','any','all']);
  const counts = {};
  articles.forEach((a) => {
    const words = (a.title || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
    words.forEach((w) => {
      if (w.length < 4 || stop.has(w)) return;
      counts[w] = (counts[w] || 0) + 1;
    });
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([topic, count]) => ({
      topic: topic.charAt(0).toUpperCase() + topic.slice(1),
      count,
      sentiment: 'neutral',
      recentHeadlines: articles.filter((a) => (a.title || '').toLowerCase().includes(topic)).slice(0, 2).map((a) => a.title),
    }));
}

async function handleNews(url) {
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const params = new URL(url).searchParams;
  const limit = parseInt(params.get('limit') || '20', 10);
  const page = parseInt(params.get('page') || '1', 10);
  const cat = params.get('category');

  // Try upstream first
  let data = await fetchUpstream(`/api/news?limit=${limit}&page=${page}${cat ? `&category=${cat}` : ''}`);
  let articles = (data && (data.articles || data.results || data.news)) || null;

  if (!articles || !articles.length) {
    // Fallback to RSS
    const rss = await fetchRSS();
    articles = rss;
    data = { articles: rss, totalCount: rss.length, _fallback: true };
  }

  // Filter by category if requested (client-side)
  if (cat && cat !== 'all') {
    const q = cat.toLowerCase();
    articles = articles.filter((a) => (a.category || '').toLowerCase() === q || (a.title || '').toLowerCase().includes(q));
  }

  // Pagination
  const start = (page - 1) * limit;
  const paged = articles.slice(start, start + limit);

  const resp = json({
    articles: paged,
    totalCount: articles.length,
    page,
    limit,
    hasMore: start + limit < articles.length,
  });

  // Cache
  const toCache = resp.clone();
  await cache.put(cacheKey, toCache);
  return resp;
}

async function handleTrending(url) {
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // Try upstream
  let data = await fetchUpstream('/api/trending');
  let trending = (data && (data.trending || data.topics)) || null;

  if (!trending || !trending.length) {
    // Derive from news
    const newsData = await fetchUpstream('/api/news?limit=50&page=1');
    let articles = (newsData && (newsData.articles || newsData.results || newsData.news)) || [];
    if (!articles.length) {
      articles = await fetchRSS();
    }
    trending = deriveTrending(articles);
  }

  const resp = json({ trending });
  await cache.put(cacheKey, resp.clone());
  return resp;
}

async function handleCategories(url) {
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let data = await fetchUpstream('/api/categories');
  if (!data) {
    data = { categories: ['all', 'bitcoin', 'ethereum', 'defi', 'solana', 'nft', 'regulation', 'markets'] };
  }
  const resp = json(data);
  await cache.put(cacheKey, resp.clone());
  return resp;
}

async function handleSearch(url) {
  const params = new URL(url).searchParams;
  const q = (params.get('q') || '').toLowerCase();
  const limit = parseInt(params.get('limit') || '20', 10);

  // Get news (from cache or fetch)
  const newsUrl = new URL(url);
  newsUrl.pathname = '/api/news';
  newsUrl.search = '?limit=50&page=1';
  const newsResp = await handleNews(newsUrl);
  const newsData = await newsResp.json();
  const articles = (newsData && newsData.articles) || [];

  const filtered = articles.filter((a) =>
    (a.title || '').toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q)
  ).slice(0, limit);

  return json({ articles: filtered, totalCount: filtered.length });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const path = url.pathname;

    try {
      if (path === '/api/news' || path === '/api/news/') return await handleNews(url);
      if (path === '/api/trending' || path === '/api/trending/') return await handleTrending(url);
      if (path === '/api/categories' || path === '/api/categories/') return await handleCategories(url);
      if (path === '/api/search' || path === '/api/search/') return await handleSearch(url);
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: e.message || 'internal error' }, 500);
    }
  },
};
