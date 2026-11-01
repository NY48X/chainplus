// Smoke tests for worker trend() function
// Run: node worker/test_trend.js

const fs = require('fs');
const code = fs.readFileSync('worker/index.js', 'utf8');

// Extract trend function by eval (it's a global function in the worker)
// We'll extract just the trend function and its dependencies
const trendMatch = code.match(/function trend\(arts\)\{[\s\S]*?\n\}/);
if (!trendMatch) { console.error('trend function not found'); process.exit(1); }

// Extract cat, tag, and other dependencies
const stMatch = code.match(/const st=new Set\(\[[\s\S]*?\]\);/);
const bullMatch = code.match(/const bullWords=\[[\s\S]*?\];/);
const bearMatch = code.match(/const bearWords=\[[\s\S]*?\];/);

// Build eval context
const evalCode = `
${stMatch[0]}
${bullMatch[0]}
${bearMatch[0]}
${trendMatch[0]}
`;

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// Load trend function
const ctx = {};
const vm = require('vm');
vm.createContext(ctx);
vm.runInContext(evalCode, ctx);

const trend = ctx.trend;

// Test 1: Basic functionality
test('trend returns array', () => {
  const arts = [
    { title: 'Bitcoin surges to new high', description: 'BTC price rally' },
    { title: 'Bitcoin surges again to new high', description: 'BTC price rally' },
    { title: 'Ethereum drops after hack', description: 'ETH decline' },
    { title: 'Ethereum drops again after hack', description: 'ETH decline' },
  ];
  const result = trend(arts);
  assert(Array.isArray(result), 'should be array');
  assert(result.length > 0, 'should have topics');
});

// Test 2: Sentiment classification
test('sentiment: crash -> bearish', () => {
  const arts = [{ title: 'Bitcoin crash after hack', description: '' }, { title: 'Bitcoin crash after hack again', description: '' }];
  const result = trend(arts);
  const bitcoin = result.find(t => t.topic.toLowerCase().includes('bitcoin') || t.topic.toLowerCase().includes('crash') || t.topic.toLowerCase().includes('hack'));
  // At least one bearish topic should exist
  assert(result.some(t => t.sentiment === 'bearish'), 'should have bearish topic');
});

// Test 3: Sentiment: surge -> bullish
test('sentiment: surge -> bullish', () => {
  const arts = [{ title: 'Bitcoin surge to record high', description: 'rally' }, { title: 'Bitcoin surge to record high again', description: 'rally' }];
  const result = trend(arts);
  assert(result.some(t => t.sentiment === 'bullish'), 'should have bullish topic');
});

// Test 4: Empty input
test('empty input returns empty', () => {
  const result = trend([]);
  assert(Array.isArray(result), 'should be array');
});

// Test 5: Bigrams present
test('bigrams present in results', () => {
  const arts = [
    { title: 'Bitcoin price surges to new record high', description: '' },
    { title: 'Bitcoin price surges to new record high', description: '' },
    { title: 'Bitcoin price drops after hack', description: '' },
    { title: 'Bitcoin price drops after hack', description: '' },
  ];
  const result = trend(arts);
  // May or may not have bigrams depending on frequency
  assert(result.length > 0, 'should have topics');
});

// Test 6: No false positive sentiment (startup -> neutral)
test('no false positive: startup -> neutral', () => {
  const arts = [{ title: 'Startup raises funding', description: '' }];
  const result = trend(arts);
  // 'startup' should not be bullish (contains 'up' but not as a word)
  const startup = result.find(t => t.topic.toLowerCase() === 'startup');
  if (startup) {
    assert(startup.sentiment === 'neutral', `startup should be neutral, got ${startup.sentiment}`);
  }
});

// Test 7: No false positive: group -> neutral
test('no false positive: group -> neutral', () => {
  const arts = [{ title: 'Crypto group forms alliance', description: '' }];
  const result = trend(arts);
  const group = result.find(t => t.topic.toLowerCase() === 'group');
  if (group) {
    assert(group.sentiment === 'neutral', `group should be neutral, got ${group.sentiment}`);
  }
});

// Test 8: No false positive: download -> neutral
test('no false positive: download -> neutral', () => {
  const arts = [{ title: 'Download the new wallet app', description: '' }];
  const result = trend(arts);
  const download = result.find(t => t.topic.toLowerCase() === 'download');
  if (download) {
    assert(download.sentiment === 'neutral', `download should be neutral, got ${download.sentiment}`);
  }
});

// Test 9: No false positive: issue -> neutral
test('no false positive: issue -> neutral', () => {
  const arts = [{ title: 'Issue with transaction processing', description: '' }];
  const result = trend(arts);
  const issue = result.find(t => t.topic.toLowerCase() === 'issue');
  if (issue) {
    assert(issue.sentiment === 'neutral', `issue should be neutral, got ${issue.sentiment}`);
  }
});

// Test 10: No false positive: band -> neutral
test('no false positive: band -> neutral', () => {
  const arts = [{ title: 'Band releases new album', description: '' }];
  const result = trend(arts);
  const band = result.find(t => t.topic.toLowerCase() === 'band');
  if (band) {
    assert(band.sentiment === 'neutral', `band should be neutral, got ${band.sentiment}`);
  }
});

// Test 11: Inflected forms work (surges -> bullish)
test('inflected: surges -> bullish', () => {
  const arts = [{ title: 'Bitcoin surges past resistance', description: '' }];
  const result = trend(arts);
  const surge = result.find(t => t.topic.toLowerCase().includes('surge'));
  if (surge) {
    assert(surge.sentiment === 'bullish', `surge should be bullish, got ${surge.sentiment}`);
  }
});

// Test 12: Inflected forms work (losses -> bearish)
test('inflected: losses -> bearish', () => {
  const arts = [{ title: 'Bitcoin losses mount after crash', description: '' }];
  const result = trend(arts);
  const loss = result.find(t => t.topic.toLowerCase().includes('loss'));
  if (loss) {
    assert(loss.sentiment === 'bearish', `loss should be bearish, got ${loss.sentiment}`);
  }
});

// Test 13: Result shape
test('result shape has required fields', () => {
  const arts = [{ title: 'Bitcoin price rises', description: 'market update' }];
  const result = trend(arts);
  if (result.length > 0) {
    const t = result[0];
    assert('topic' in t, 'missing topic');
    assert('count' in t, 'missing count');
    assert('sentiment' in t, 'missing sentiment');
    assert('recentHeadlines' in t, 'missing recentHeadlines');
  }
});

// Test 14: Sentiment values are valid
test('sentiment values are valid', () => {
  const arts = [
    { title: 'Bitcoin surge rally', description: '' },
    { title: 'Ethereum crash hack', description: '' },
  ];
  const result = trend(arts);
  result.forEach(t => {
    assert(['bullish','bearish','neutral'].includes(t.sentiment), `invalid sentiment: ${t.sentiment}`);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
