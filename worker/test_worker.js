// Smoke tests for worker endpoints
// Run: node worker/test_worker.js
// Note: requires network access for RSS feeds

const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync(require('path').join(__dirname, 'index.js'), 'utf8');

const ctx = vm.createContext({});
ctx.Response = globalThis.Response;
ctx.fetch = globalThis.fetch;
ctx.URL = globalThis.URL;
ctx.AbortController = globalThis.AbortController;
ctx.setTimeout = globalThis.setTimeout;
ctx.clearTimeout = globalThis.clearTimeout;
ctx.console = console;

const codeToEval = code.replace(/addEventListener\("fetch".*/, '');
vm.runInContext(codeToEval, ctx);

const handle = ctx.handle;
const trend = ctx.trend;
const cat = ctx.cat;
const esc = ctx.esc;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('PASS: ' + name); passed++; }
  catch (e) { console.log('FAIL: ' + name + ': ' + e.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// cat() tests
test('cat: bitcoin', () => { assert(cat('Bitcoin price surges') === 'bitcoin', 'expected bitcoin, got ' + cat('Bitcoin price surges')); });
test('cat: ethereum', () => { assert(cat('Ethereum network upgrade') === 'ethereum', 'expected ethereum'); });
test('cat: defi', () => { assert(cat('New DeFi protocol launches') === 'defi', 'expected defi'); });
test('cat: regulation', () => { assert(cat('SEC sues crypto exchange') === 'regulation', 'expected regulation'); });
test('cat: markets', () => { assert(cat('Stock market rallies') === 'markets', 'expected markets'); });
test('cat: general', () => { assert(cat('Random headline') === 'general', 'expected general'); });

// esc() tests
test('esc: html entities', () => { assert(esc('<script>alert("xss")</script>') === '&lt;script&gt;alert("xss")&lt;/script&gt;', 'html not escaped'); });
test('esc: null input', () => { assert(esc(null) === '', 'null should return empty'); });
test('esc: ampersand', () => { assert(esc('a&b') === 'a&amp;b', 'ampersand not escaped'); });

// trend() tests
test('trend: empty array', () => { const r = trend([]); assert(Array.isArray(r), 'should be array'); });
test('trend: returns topics', () => {
  const arts = Array(4).fill({ title: 'Bitcoin price surges to new high', description: 'rally' });
  const r = trend(arts);
  assert(r.length > 0, 'should have topics');
});
test('trend: sentiment values valid', () => {
  const arts = Array(4).fill({ title: 'Bitcoin price surges to new high', description: 'rally' });
  const r = trend(arts);
  r.forEach(t => assert(['bullish','bearish','neutral'].includes(t.sentiment), 'invalid sentiment: ' + t.sentiment));
});

// Endpoint tests (async)
(async () => {
  const req = (path, method) => ({ url: 'https://example.com' + path, method: method || 'GET', headers: { get: () => null } });

  // /api/categories
  const r1 = await handle(req('/api/categories'), {});
  const d1 = await r1.json();
  test('endpoint: /api/categories', () => { assert(Array.isArray(d1.categories), 'categories should be array'); assert(d1.categories.includes('bitcoin'), 'should include bitcoin'); });

  // /api/news
  const r2 = await handle(req('/api/news?limit=5'), {});
  const d2 = await r2.json();
  test('endpoint: /api/news', () => { assert(Array.isArray(d2.articles), 'articles should be array'); assert(d2.articles.length > 0, 'should have articles'); });

  // /api/trending
  const r3 = await handle(req('/api/trending'), {});
  const d3 = await r3.json();
  test('endpoint: /api/trending', () => { assert(Array.isArray(d3.trending), 'trending should be array'); });

  // /api/breaking
  const r4 = await handle(req('/api/breaking?limit=3'), {});
  const d4 = await r4.json();
  test('endpoint: /api/breaking', () => { assert(Array.isArray(d4.articles), 'articles should be array'); assert(d4.articles.length <= 3, 'should respect limit'); });

  // /api/fear-greed
  const r5 = await handle(req('/api/fear-greed'), {});
  const d5 = await r5.json();
  test('endpoint: /api/fear-greed', () => { assert(typeof d5.value === 'number', 'value should be number'); });

  // /api/search
  const r6 = await handle(req('/api/search?q=bitcoin&limit=5'), {});
  const d6 = await r6.json();
  test('endpoint: /api/search', () => { assert(Array.isArray(d6.articles), 'articles should be array'); });

  // /api/search empty
  const r7 = await handle(req('/api/search?q='), {});
  const d7 = await r7.json();
  test('endpoint: /api/search empty', () => { assert(Array.isArray(d7.articles) && d7.articles.length === 0, 'empty query should return empty'); });

  // 404
  const r8 = await handle(req('/api/nonexistent'), {});
  test('endpoint: 404 for unknown path', () => { assert(r8.status === 404, 'should return 404, got ' + r8.status); });

  // OPTIONS preflight
  const r9 = await handle(req('/api/news', 'OPTIONS'), {});
  test('endpoint: OPTIONS preflight', () => { assert(r9.status === 204, 'should return 204, got ' + r9.status); });

  // NaN params
  const r10 = await handle(req('/api/news?limit=abc&page=xyz'), {});
  const d10 = await r10.json();
  test('endpoint: NaN params handled', () => { assert(d10.limit === 20, 'limit should default to 20, got ' + d10.limit); assert(d10.page === 1, 'page should default to 1, got ' + d10.page); });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
})();
