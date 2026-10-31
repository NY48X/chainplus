/* ============ ChainPlus app v4 — live feed ============ */
(function(){
  'use strict';

  const API = (window.CHAINPLUS_API) || (localStorage.getItem('cp-api-base')) || 'https://chainpulse-api.miketembo828.workers.dev';
  const CG = 'https://api.coingecko.com/api/v3';
  const RSS_BACKUPS = [
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://cointelegraph.com/rss',
    'https://decrypt.co/feed',
    'https://www.theblock.co/rss.xml'
  ];
  const GH = 'https://api.github.com';

  const state = {
    cat: 'all',
    search: '',
    page: 1,
    limit: 18,
    articles: [],
    totalCount: 0,
    sources: [],
    categories: [],
    trending: [],
    fg: null,
    markets: null,
    oss: [],
    loading: false,
    hasMore: true,
    searchDebounce: null,
    pollTimer: null,
    knownLinks: new Set(),
    bookmarks: new Set(),
    sort: 'newest'
  };

  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];

  /* ---------- helpers ---------- */
  function esc(s){ return (s||'').replace(/[&<>\"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c])); }
  function timeAgo(d){
    if(!d) return '';
    const t = new Date(d).getTime();
    if(isNaN(t)) return '';
    const diff = (Date.now()-t)/1000;
    if(diff<60) return 'just now';
    if(diff<3600) return Math.floor(diff/60)+'m ago';
    if(diff<86400) return Math.floor(diff/3600)+'h ago';
    if(diff<604800) return Math.floor(diff/86400)+'d ago';
    return new Date(d).toLocaleDateString();
  }
  function credClass(c){
    if(c>=0.75) return 'cred-high';
    if(c>=0.55) return 'cred-mid';
    return 'cred-low';
  }
  function toast(msg){
    const t = $('#toast'); if(!t) return; t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(()=>t.classList.remove('show'), 3200);
  }
  function fmtNum(n){
    if(n==null) return '—';
    if(n>=1e9) return (n/1e9).toFixed(2)+'B';
    if(n>=1e6) return (n/1e6).toFixed(2)+'M';
    if(n>=1e3) return (n/1e3).toFixed(1)+'K';
    return String(n);
  }
  function fmtPrice(p){
    if(p==null) return '—';
    if(p>=1000) return '$'+p.toLocaleString(undefined,{maximumFractionDigits:0});
    if(p>=1) return '$'+p.toFixed(2);
    return '$'+p.toFixed(4);
  }
  function readTime(text){
    const words = (text||'').split(/\s+/).filter(Boolean).length;
    const mins = Math.max(1, Math.round(words/200));
    return mins + ' min read';
  }
  function stripHtml(s){ return (s||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }
  function splitSentences(t){
    const s = stripHtml(t);
    if(!s) return [];
    // Protect decimal numbers (e.g., $6.3, 3.14) from being split
    const protectedText = s.replace(/(\d)\.(\d)/g, '$1\u0001$2');
    // Split on sentence boundaries: . ! ? followed by space or end
    const parts = protectedText.split(/(?<=[.!?])\s+/);
    return parts.map(x=>x.replace(/\u0001/g, '.').trim()).filter(x=>x.length>15);
  }
  function scoreSentence(sent, idx, total, titleTokens){
    let score = 0;
    const lower = sent.toLowerCase();
    // Position: first and last sentences carry more weight
    if(idx === 0) score += 3;
    if(idx === total-1) score += 1.5;
    if(idx < 3) score += 1;
    // Length: prefer medium-length sentences (not too short/long)
    const words = sent.split(/\s+/).length;
    if(words >= 8 && words <= 35) score += 2;
    else if(words > 35) score += 0.5;
    // Numbers / data points boost (concrete findings)
    if(/\d/.test(sent)) score += 1.5;
    if(/%|\$|€|£|million|billion|trillion/i.test(sent)) score += 1;
    // Title overlap (relevance)
    titleTokens.forEach(tok=>{ if(tok.length>3 && lower.includes(tok)) score += 1.2; });
    // Keyword signals for findings/insights
    if(/because|due to|driven by|led to|resulted|caused|means|signals|indicates|suggests|shows|reveals/i.test(sent)) score += 1.5;
    if(/will|expected|forecast|outlook|next|future|plans to|aims to/i.test(sent)) score += 1;
    // Penalize boilerplate
    if(/click here|read more|subscribe|sign up|cookie|privacy policy/i.test(sent)) score -= 3;
    return score;
  }
  function buildSummary(text, title){
    const t = stripHtml(text||'');
    if(!t) return null;
    const sents = splitSentences(t);
    if(!sents.length) return null;
    const titleTokens = (title||'').toLowerCase().split(/\W+/).filter(x=>x.length>3);
    const scored = sents.map((s,i)=>({s, i, score: scoreSentence(s,i,sents.length,titleTokens)}));
    // Pick top findings (distinct, non-overlapping)
    const sorted = [...scored].sort((a,b)=>b.score-a.score);
    const findings = [];
    const used = new Set();
    for(const c of sorted){
      if(findings.length >= 5) break;
      // avoid near-duplicate
      const key = c.s.slice(0,40).toLowerCase();
      if(used.has(key)) continue;
      // skip if too similar to an already-picked sentence
      let dup = false;
      for(const f of findings){ if(similarity(f, c.s) > 0.6){ dup=true; break; } }
      if(dup) continue;
      findings.push(c.s);
      used.add(key);
    }
    // Re-order findings by original position for readability
    findings.sort((a,b)=> sents.indexOf(a) - sents.indexOf(b));
    // Insight: pick a sentence NOT already in findings, preferably the last
    const insight = pickInsight(sents, findings);
    return { findings, insight };
  }
  function pickInsight(sents, findings){
    const usedSet = new Set(findings.map(f=>f.slice(0,60).toLowerCase()));
    // Prefer a sentence not already in findings, from the end (implications)
    for(let i = sents.length-1; i >= 0; i--){
      const s = sents[i];
      if(!usedSet.has(s.slice(0,60).toLowerCase()) && s.length > 25){
        return s;
      }
    }
    return '';
  }
  function similarity(a,b){
    const wa = new Set(a.toLowerCase().split(/\W+/).filter(x=>x.length>3));
    const wb = new Set(b.toLowerCase().split(/\W+/).filter(x=>x.length>3));
    if(!wa.size || !wb.size) return 0;
    let inter=0; wa.forEach(w=>{ if(wb.has(w)) inter++; });
    return inter / Math.max(wa.size, wb.size);
  }
  /* ---------- fetch with retry ---------- */
  async function fetchRetry(url, opts={}, attempts=3){
    let last;
    for(let i=0;i<attempts;i++){
      try{
        const r = await fetch(url, opts);
        if(r.status===429 || r.status>=500){
          last = new Error('HTTP '+r.status);
          await new Promise(res=>setTimeout(res, 700*(i+1)));
          continue;
        }
        if(!r.ok) throw new Error('HTTP '+r.status);
        return r;
      }catch(e){ last=e; await new Promise(res=>setTimeout(res, 700*(i+1))); }
    }
    throw last || new Error('fetch failed');
  }
  async function api(path){
    const r = await fetchRetry(API+path, {cache:'no-store'});
    return r.json();
  }

  /* ---------- bookmarks ---------- */
  function loadBookmarks(){
    try{ const raw = localStorage.getItem('cp-bookmarks'); if(raw) state.bookmarks = new Set(JSON.parse(raw)); }catch(e){}
  }
  function saveBookmarks(){ try{ localStorage.setItem('cp-bookmarks', JSON.stringify([...state.bookmarks])); }catch(e){} }
  function toggleBookmark(link){
    if(state.bookmarks.has(link)) state.bookmarks.delete(link); else state.bookmarks.add(link);
    saveBookmarks();
    renderStories();
    toast(state.bookmarks.has(link) ? 'Saved' : 'Removed');
  }

  /* ---------- rss fallback (4 backup sources) ---------- */
  async function fetchRSSFallback(){
    const out = [];
    const seen = new Set();
    await Promise.all(RSS_BACKUPS.map(async (url)=>{
      try{
        const r = await fetch(url, {headers:{'User-Agent':'ChainPlus/1.0'}});
        if(!r.ok) return;
        const x = await r.text();
        const items = x.match(/<item[\s\S]*?<\/item>/gi) || [];
        items.forEach(it=>{
          const t = (it.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'';
          const l = ((it.match(/<link[^>]*>([\s\S]*?)<\/link>/i)||[])[1]||'').trim() || ((it.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)||[])[1]||'').trim();
          const d = (it.match(/<description[^>]*>([\s\S]*?)<\/description>/i)||[])[1]||'';
          const p = (it.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)||[])[1]||'';
          const title = t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').trim();
          const link = l.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').trim();
          if(!title || !link || seen.has(link)) return;
          seen.add(link);
          out.push({
            title: title,
            link: link,
            description: d.replace(/<[^>]+>/g,'').replace(/<!\[CDATA\[|\]\]>/g,'').slice(0,240).trim(),
            pubDate: p.trim(),
            source: new URL(url).hostname,
            category: 'general'
          });
        });
      }catch(e){ console.error('RSS backup failed:', url, e); }
    }));
    out.sort((a,b)=> new Date(b.pubDate||0) - new Date(a.pubDate||0));
    return out.slice(0, state.limit);
  }
  /* ---------- news ---------- */
  function isNewArticle(a){ return !state.knownLinks.has(a.link); }

  async function fetchNews(reset=false, opts={}){
    if(state.loading && !opts.background) return;
    if(!opts.background) state.loading = true;
    const btn = $('#loadMoreBtn');
    if(btn && !opts.background) btn.disabled = true;
    try{
      let data = null;
      let usedFallback = false;
      try {
        let path;
        if(state.search.trim()){
          path = `/api/search?q=${encodeURIComponent(state.search.trim())}&limit=${state.limit}`;
        } else if(state.cat && state.cat!=='all'){
          path = `/api/news?category=${encodeURIComponent(state.cat)}&limit=${state.limit}&page=${state.page}`;
        } else {
          path = `/api/news?limit=${state.limit}&page=${state.page}`;
        }
        data = await api(path);
        if(!data || !(data.articles||data.results||[]).length) throw new Error('empty');
      } catch(primaryErr){
        // Fallback to RSS aggregation from 4 major crypto news sources
        const fb = await fetchRSSFallback();
        if(fb && fb.length){
          data = { articles: fb, totalCount: fb.length, _fallback: true };
          usedFallback = true;
        } else {
          throw primaryErr;
        }
      }
      const isGas = (a)=> /eth\s*gas|⛽|gwei/i.test(a && a.title || '');
      const arts = (data.articles || data.results || []).filter(a=>!isGas(a));
      if(reset){
        state.articles = arts;
        state.page = 1;
        state.knownLinks = new Set(arts.map(a=>a.link));
      } else if(opts.prepend){
        const fresh = arts.filter(a=>!state.knownLinks.has(a.link));
        if(fresh.length){
          state.articles = fresh.concat(state.articles);
          fresh.forEach(a=>state.knownLinks.add(a.link));
          toast(`${fresh.length} new headline${fresh.length>1?'s':''}`);
        }
      } else {
        state.articles = state.articles.concat(arts);
      }
      state.totalCount = data.totalCount || data.total || state.articles.length;
      state.hasMore = state.articles.length < (state.totalCount || Infinity) && arts.length > 0;
      if(usedFallback) toast('Primary API unavailable — showing backup RSS feeds');
      renderStories();
      renderCompact();
      if(state.articles.length && (reset || opts.updateHero)) renderHero();
      const lu = $('#lastUpdated'); if(lu) lu.textContent = 'last fetch ' + new Date().toLocaleTimeString();
      // Cache for offline/resilience
      try { localStorage.setItem('cp-news-cache', JSON.stringify(state.articles.slice(0,60))); } catch(e){}
    }catch(e){
      console.error(e);
      // Try to load from cache
      try {
        const cached = localStorage.getItem('cp-news-cache');
        if(cached){
          const arts = JSON.parse(cached);
          if(Array.isArray(arts) && arts.length && !state.articles.length){
            state.articles = arts;
            renderStories();
            renderCompact();
            if(state.articles.length) renderHero();
            toast('Showing cached headlines (offline)');
            return;
          }
        }
      } catch(err){}
      if(e && /429/.test(String(e.message))){
        toast('Rate limited — showing cached results');
        if(state.search.trim()){
          const q = state.search.trim().toLowerCase();
          const filtered = state.articles.filter(a => (a.title||'').toLowerCase().includes(q) || (a.description||'').toLowerCase().includes(q) || (a.category||'').toLowerCase().includes(q));
          if(filtered.length && filtered.length !== state.articles.length){ renderStoriesFiltered(filtered); toast(`Filtered ${filtered.length} cached headlines`); }
        }
      } else {
        toast('Failed to load news. Retrying…');
      }
    } finally {
      if(!opts.background){ state.loading = false; if(btn) btn.disabled = false; }
      const wrap = $('#loadMoreWrap'); if(wrap) wrap.style.display = state.hasMore ? 'block' : 'none';
      const st = $('#loadStatus'); if(st) st.textContent = state.hasMore ? `${state.articles.length} of ${state.totalCount||'?'}` : 'All loaded';
    }
  }

  function renderStoriesFiltered(list){
    const grid = $('#storiesGrid'); if(!grid) return;
    grid.innerHTML = list.map((a,i)=>{
      const cred = a.credibility || (a.reputation? a.reputation/100 : 0.6);
      return `
        <article class="story reveal" data-idx="${i}">
          <span class="story-cat">${esc(a.category||'general')}</span>
          <h3 class="story-title">${esc(a.title)}</h3>
          ${a.description ? `<p class="story-dek">${esc(stripHtml(a.description))}</p>` : ''}
          <div class="story-meta">
            <span class="src">${esc(a.source||'Unknown')}</span>
            <span class="dot"></span>
            <span>${esc(a.timeAgo || timeAgo(a.pubDate))}</span>
            <span class="cred"><span class="cred-dot ${credClass(cred)}"></span>${Math.round(cred*100)}%</span>
          </div>
        </article>`;
    }).join('');
    $$('#storiesGrid .story').forEach((el,i)=>{ el.addEventListener('click', ()=> openArticle(list[i])); });
    revealIn();
  }

  function renderHero(){
    const isGas = (a)=> /eth\s*gas|⛽|gwei/i.test(a && a.title || '');
    const heroArt = state.articles.find(a=>!isGas(a)) || state.articles[0];
    const a = heroArt;
    const headline = $('.hero-headline');
    const dek = $('.hero-dek');
    const src = $('#heroSource');
    const time = $('#heroTime');
    const cat = $('#heroCat');
    const cta = $('#heroCta');
    const rail = $('#heroRail');
    if(!a){ if(headline) headline.textContent = 'No headlines yet'; return; }
    if(headline) headline.innerHTML = esc(a.title).replace(/(bitcoin|crypto|blockchain|ethereum|solana|defi|web3|nft)/gi, '<span class="accent">$1</span>');
    if(dek) dek.textContent = stripHtml(a.description||'') || 'Aggregating real-time blockchain and cryptocurrency news from over 300 verified sources.';
    if(src) src.textContent = a.source || 'Unknown';
    if(time) time.textContent = a.timeAgo || timeAgo(a.pubDate);
    if(cat) cat.textContent = (a.category||'general').toUpperCase();
    if(cta){ cta.href = a.link; }
    if(rail){
      rail.innerHTML = state.articles.slice(1,5).map(a=>`
        <article class="rail-card" data-url="${esc(a.link)}">
          <div class="rc-cat">${esc(a.category||'general')}</div>
          <h3 class="rc-title">${esc(a.title)}</h3>
          <div class="rc-meta">${esc(a.source||'')} · ${esc(a.timeAgo || timeAgo(a.pubDate))}</div>
        </article>`).join('');
      $$('#heroRail .rail-card').forEach((c,i)=>{ c.addEventListener('click', ()=> openArticle(state.articles[i+1])); });
    }
    revealIn();
  }

  function renderStories(){
    const grid = $('#storiesGrid');
    if(!grid) return;
    if(!state.articles.length){ grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No articles found. Try another category or search.</div>`; return; }
    grid.innerHTML = state.articles.map((a,i)=>{
      const cred = a.credibility || (a.reputation? a.reputation/100 : 0.6);
      const lead = (i===0 && state.page===1 && !state.search) ? ' story-lead' : '';
      const saved = state.bookmarks.has(a.link) ? ' saved' : '';
      return `
        <article class="story${lead} reveal" data-idx="${i}">
          <span class="story-cat">${esc(a.category||'general')}</span>
          <h3 class="story-title">${esc(a.title)}</h3>
          ${a.description ? `<p class="story-dek">${esc(stripHtml(a.description))}</p>` : ''}
          <div class="story-meta">
            <span class="src">${esc(a.source||'Unknown')}</span>
            <span class="dot"></span>
            <span>${esc(a.timeAgo || timeAgo(a.pubDate))}</span>
            <span class="cred"><span class="cred-dot ${credClass(cred)}"></span>${Math.round(cred*100)}%</span>
            <button class="chip bookmark-btn${saved}" data-link="${esc(a.link)}" style="margin-left:auto;padding:2px 8px;font-size:11px">${state.bookmarks.has(a.link)?'★ Saved':'☆ Save'}</button>
          </div>
        </article>`;
    }).join('');
    $$('#storiesGrid .story').forEach((el,i)=>{
      el.addEventListener('click', (e)=>{ if(e.target.closest('.bookmark-btn')) return; openArticle(state.articles[i]); });
    });
    $$('#storiesGrid .bookmark-btn').forEach(b=>{
      b.addEventListener('click', (e)=>{ e.stopPropagation(); toggleBookmark(b.dataset.link); });
    });
    revealIn();
  }

  function renderCompact(){
    const el = $('#compactList'); if(!el) return;
    el.innerHTML = state.articles.slice(0,10).map((a,i)=>`
      <div class="compact-item reveal" data-idx="${i}">
        <div class="compact-num">${String(i+1).padStart(2,'0')}</div>
        <div>
          <p class="compact-title">${esc(a.title)}</p>
          <div class="compact-meta">${esc(a.source||'')} · ${esc(a.timeAgo || timeAgo(a.pubDate))} · ${esc(a.category||'general')}</div>
        </div>
      </div>`).join('');
    $$('#compactList .compact-item').forEach((el,i)=>{ el.addEventListener('click', ()=> openArticle(state.articles[i])); });
    revealIn();
  }

  /* ---------- ticker ---------- */
  async function renderTicker(){
    try{
      const data = await api('/api/breaking?limit=12');
      const arts = data.articles || [];
      const html = arts.map(a=>`<a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.title)}</a>`).join('  ·  ');
      const track = $('#tickerTrack');
      if(track) track.innerHTML = `<span class="ticker-item">${html}  ·  ${html}</span>`;
    }catch(e){ /* keep placeholder */ }
  }

  /* ---------- categories ---------- */
  async function loadCategories(){
    try{
      const data = await api('/api/news/categories');
      state.categories = Array.isArray(data.categories) ? data.categories : (Array.isArray(data) ? data : []);
      const chips = $('#categoryChips'); if(!chips) return;
      chips.innerHTML = '';
      const all = document.createElement('button');
      all.className = 'chip active'; all.dataset.cat='all'; all.textContent='All';
      chips.appendChild(all);
      state.categories.forEach(c=>{
        const id = (typeof c === 'string') ? c : (c.id || c.name || c);
        if(id === 'all') return;
        const name = (typeof c === 'string') ? c.charAt(0).toUpperCase()+c.slice(1) : (c.name || c.id || c);
        const b = document.createElement('button');
        b.className = 'chip'; b.dataset.cat = id;
        b.textContent = name + (c.sourceCount ? ` (${c.sourceCount})` : '');
        chips.appendChild(b);
      });
      chips.addEventListener('click', (e)=>{
        const b = e.target.closest('.chip'); if(!b) return;
        $$('#categoryChips .chip').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        state.cat = b.dataset.cat;
        state.search = '';
        const si = $('#searchInput'); if(si) si.value = '';
        state.page = 1;
        fetchNews(true, {updateHero:true}).then(async ()=>{
          if(state.cat !== 'all' && state.articles.length < 8 && state.hasMore){
            try{ state.page = 2; await fetchNews(false, {}); if(state.hasMore && state.articles.length < 12){ state.page = 3; await fetchNews(false, {}); } }catch(e){ console.error(e); }
          }
          showSearchBanner(state.cat==='all' ? 'Showing all categories' : `Category: ${b.textContent.replace(/\s*\(\d+\)$/,'')} (${state.articles.length} headlines)`);
        });
      });
    }catch(e){ console.error(e); toast('Categories failed to load'); }
  }

  /* ---------- trending ---------- */
  async function loadTrending(){
    try{
      const data = await api('/api/trending');
      state.trending = data.trending || data.topics || [];
      renderTrending();
    }catch(e){ console.error(e); }
  }
  function renderTrending(){
    const el = $('#trendingList'); if(!el) return;
    if(!state.trending.length){ el.innerHTML = '<div class="muted small">No trending data.</div>'; return; }
    const max = Math.max(...state.trending.slice(0,8).map(t=>t.count||1));
    el.innerHTML = state.trending.slice(0,8).map((t,i)=>{
      const sent = (t.sentiment||'neutral').toLowerCase();
      const sentCls = sent.includes('bull')?'sent-bullish':sent.includes('bear')?'sent-bearish':'sent-neutral';
      const color = sent.includes('bull')?'var(--accent)':sent.includes('bear')?'var(--danger)':'var(--muted-2)';
      const pct = Math.round(((t.count||0)/max)*100);
      const heads = (t.recentHeadlines||[]).slice(0,2).map(h=>`<div class="small muted" style="margin-top:4px;line-height:1.3">• ${esc(h)}</div>`).join('');
      return `<div class="trend-row" data-topic="${esc(t.topic)}">
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <span class="trend-name">${esc(t.topic)}</span>
            <span class="trend-meta"><span class="trend-sent ${sentCls}">${esc(sent)}</span> ${t.count||''}</span>
          </div>
          <div class="trend-bar"><div class="trend-bar-fill" style="width:${pct}%;background:${color}"></div></div>
          ${heads}
        </div>
      </div>`;
    }).join('');
    $$('#trendingList .trend-row').forEach(it=>{
      it.addEventListener('click', ()=>{
        const topic = it.dataset.topic;
        if(topic) window.location.href = 'topic.html?topic=' + encodeURIComponent(topic);
      });
    });
  }

  /* ---------- fear & greed ---------- */
  async function loadFG(){
    try{
      const data = await api('/api/fear-greed');
      state.fg = data.current || data;
      renderFG();
    }catch(e){ console.error(e); }
  }
  function renderFG(){
    const d = state.fg; if(!d) return;
    const v = parseInt(d.value,10);
    const label = d.valueClassification || d.classification || '';
    let color = 'var(--warn)';
    if(v<=25) color='var(--danger)';
    else if(v<=45) color='var(--danger)';
    else if(v<=55) color='var(--warn)';
    else if(v<=75) color='var(--accent)';
    else color='var(--accent)';
    const circ = 2*Math.PI*58;
    const off = circ - (v/100)*circ;
    const el = $('#fgWidget'); if(!el) return;
    el.innerHTML = `
      <div class="fg-gauge">
        <div class="fg-ring">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle class="track" cx="70" cy="70" r="58"/>
            <circle class="fill" cx="70" cy="70" r="58" style="stroke:${color};stroke-dasharray:${circ};stroke-dashoffset:${off}"/>
          </svg>
          <div class="fg-center">
            <div class="fg-val" style="color:${color}">${v}</div>
            <div class="fg-cls" style="color:${color}">${esc(label)}</div>
          </div>
        </div>
        <div class="fg-hist">${(d.historical||[]).slice(0,7).map(h=>`<span>${h.value}</span>`).join('')}</div>
      </div>`;
  }

  /* ---------- markets ---------- */
  async function loadMarkets(){
    try{
      const ids = window.CP_DATA.coins.map(c=>c.id).join(',');
      const r = await fetchRetry(`${CG}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=true&price_change_percentage=24h`);
      const data = await r.json();
      const map = {};
      (Array.isArray(data)?data:[]).forEach(d=>{ map[d.id] = d; });
      state.markets = map;
      renderMarketStrip();
    }catch(e){ console.error(e); toast('Markets unavailable'); }
  }
  function renderMarketStrip(){
    const el = $('#marketStrip'); if(!el || !state.markets) return;
    el.innerHTML = window.CP_DATA.coins.map(c=>{
      const d = state.markets[c.id]; if(!d) return '';
      const chg = d.price_change_percentage_24h;
      const chgStr = (chg == null) ? '—' : `${chg>=0?'+':''}${Number(chg).toFixed(2)}%`;
      const chgCls = (chg == null) ? '' : (chg>=0?'chg-up':'chg-down');
      const spark = (d.sparkline_in_7d && d.sparkline_in_7d.price) ? sparklineSVG(d.sparkline_in_7d.price, chg>=0) : '';
      return `<div class="mkt-tile" data-sym="${c.sym}" data-id="${c.id}">
        <div class="mt-top"><div class="mt-sym">${esc(c.sym)}</div><div class="mt-chg ${chgCls}">${chgStr}</div></div>
        <div class="mt-price">${fmtPrice(d.current_price)}</div>
        <div class="mt-name">${esc(c.name)}</div>
        ${spark}
      </div>`;
    }).join('');
    $$('#marketStrip .mkt-tile').forEach(t=>{
      t.addEventListener('click', ()=>{
        const sym = t.dataset.sym;
        const q = sym.toLowerCase();
        state.search = sym; const si = $('#searchInput'); if(si) si.value = state.search;
        state.cat = 'all'; state.page = 1;
        $$('#categoryChips .chip').forEach(x=>x.classList.remove('active'));
        const all = $('#categoryChips .chip'); if(all) all.classList.add('active');
        const filtered = state.articles.filter(a => (a.title||'').toLowerCase().includes(q) || (a.description||'').toLowerCase().includes(q));
        if(filtered.length){ renderStoriesFiltered(filtered); showSearchBanner(`Showing ${filtered.length} headlines for ${sym}`); }
        else showSearchBanner(`No headlines for ${sym}`);
      });
    });
  }
  function sparklineSVG(prices, up){
    const w=120,h=32,pad=2;
    const min=Math.min(...prices), max=Math.max(...prices);
    const range = (max-min)||1;
    const pts = prices.map((p,i)=>`${(i/(prices.length-1))*(w-pad*2)+pad},${h-pad-((p-min)/range)*(h-pad*2)}`).join(' ');
    const color = up?'#22c55e':'#ef4444';
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/></svg>`;
  }

  /* ---------- open source ---------- */
  async function loadOSS(){
    try{
      const cacheKey = 'cp-oss-v2';
      const cached = sessionStorage.getItem(cacheKey);
      let items;
      if(cached){ items = JSON.parse(cached); }
      else {
        const r = await fetchRetry(`${GH}/search/repositories?q=topic:blockchain+stars:>500&sort=stars&order=desc&per_page=9`, {headers:{'Accept':'application/vnd.github+json'}});
        const d = await r.json();
        items = (d.items||[]).map(x=>({name:x.full_name,desc:x.description,stars:x.stargazers_count,url:x.html_url,lang:x.language,updated:x.updated_at}));
        try{ sessionStorage.setItem(cacheKey, JSON.stringify(items)); }catch(e){}
      }
      state.oss = items;
      renderOSS();
    }catch(e){ console.error(e); const el=$('#ossGrid'); if(el) el.innerHTML='<div class="empty" style="grid-column:1/-1">Open-source data unavailable right now.</div>'; }
  }
  function renderOSS(){
    const el = $('#ossGrid'); if(!el) return;
    if(!state.oss.length){ el.innerHTML='<div class="empty" style="grid-column:1/-1">No repositories found.</div>'; return; }
    el.innerHTML = state.oss.map(r=>`
      <a class="oss-card" href="${esc(r.url)}" target="_blank" rel="noopener">
        <div class="oss-name">${esc(r.name)}</div>
        <div class="oss-desc">${esc(r.desc||'No description.')}</div>
        <div class="oss-meta">
          <span class="star">★ ${fmtNum(r.stars)}</span>
          ${r.lang?`<span class="oss-lang">${esc(r.lang)}</span>`:''}
          ${r.updated?`<span>${timeAgo(r.updated)}</span>`:''}
        </div>
      </a>`).join('');
    revealIn();
  }

  /* ---------- search ---------- */
  function showSearchBanner(msg){
    const b = $('#searchBanner'); if(!b) return;
    b.textContent = msg; b.classList.remove('hidden');
    clearTimeout(b._t); b._t = setTimeout(()=>b.classList.add('hidden'), 4000);
  }
  const si = $('#searchInput');
  if(si){
    si.addEventListener('input', (e)=>{
      clearTimeout(state.searchDebounce);
      state.searchDebounce = setTimeout(async ()=>{
        const q = e.target.value.trim();
        if(q === state.search) return;
        state.search = q; state.page = 1;
        if(q){ state.cat = 'all'; $$('#categoryChips .chip').forEach(x=>x.classList.remove('active')); const all=$('#categoryChips .chip'); if(all) all.classList.add('active'); }
        // Client-side filter to avoid rate-limited search endpoint
        let filtered = q ? state.articles.filter(a => (a.title||'').toLowerCase().includes(q.toLowerCase()) || (a.description||'').toLowerCase().includes(q.toLowerCase())) : state.articles;
        if(q && filtered.length < 4){
          try{
            for(let p=2; p<=4 && filtered.length<8; p++){
              const data = await api(`/api/news?limit=${state.limit}&page=${p}`);
              const arts = (data.articles || data.news || []).filter(a=>!/eth\s*gas|⛽|gwei/i.test(a && a.title || ''));
              if(!arts.length) break;
              const seen = new Set(state.articles.map(a=>a.link||a.url));
              for(const a of arts){ if(!seen.has(a.link||a.url)){ state.articles.push(a); seen.add(a.link||a.url);} }
              filtered = state.articles.filter(a => (a.title||'').toLowerCase().includes(q.toLowerCase()) || (a.description||'').toLowerCase().includes(q.toLowerCase()));
            }
          }catch(err){ console.error(err); }
        }
        if(q){
          if(filtered.length){ renderStoriesFiltered(filtered); showSearchBanner(`Showing ${filtered.length} headlines for "${q}"`); }
          else { showSearchBanner(`No headlines found for "${q}"`); }
        } else {
          renderStories(); showSearchBanner('Showing all headlines');
        }
      }, 320);
    });
  }
  document.addEventListener('keydown', (e)=>{
    if(e.key==='/' && document.activeElement !== $('#searchInput')){ e.preventDefault(); if($('#searchInput')) $('#searchInput').focus(); }
    if(e.key==='Escape'){ closeModal(); if($('#searchInput')) $('#searchInput').blur(); }
  });

  /* ---------- modal ---------- */
  function openArticle(a){
    const modal = $('#modal'); const content = $('#modalContent');
    if(!modal||!content) return;
    const related = state.articles.filter(x=>x.link!==a.link && (x.category===a.category)).slice(0,3);
    const relatedHtml = related.length ? `<div style="margin-top:16px"><h4 style="font-family:var(--font-mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 8px">Related headlines</h4>${related.map(r=>`<div style="padding:6px 0;border-bottom:1px solid var(--border-soft);cursor:pointer" onclick="window.__openArticleByLink('${esc(r.link)}')"><span style="font-size:13px">${esc(r.title)}</span><span class="small muted" style="display:block">${esc(r.source||'')}</span></div>`).join('')}</div>` : '';
    const saved = state.bookmarks.has(a.link);
    content.innerHTML = `
      <div class="modal-meta">
        <span>${esc(a.category||'general')}</span><span>·</span>
        <span>${esc(a.source||'Unknown')}</span><span>·</span>
        <span>${esc(a.timeAgo || timeAgo(a.pubDate))}</span>
        <span>·</span><span>${readTime(a.description)}</span>
      </div>
      <h2>${esc(a.title)}</h2>
      <div class="modal-body">
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="chip" onclick="navigator.clipboard.writeText('${esc(a.link)}').then(()=>window.__toast('Link copied'))">Copy link</button>
          <a class="chip" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(a.title)}&url=${encodeURIComponent(a.link)}" target="_blank" rel="noopener">Share on X</a>
          <button class="chip bookmark-btn${saved?' saved':''}" onclick="window.__toggleBookmark('${esc(a.link)}')">${saved?'★ Saved':'☆ Save'}</button>
        </div>
        <p><a href="${esc(a.link)}" target="_blank" rel="noopener" class="hero-cta" style="display:inline-flex;margin-top:12px">Open original source →</a></p>
      </div>
      <div class="ai-box" id="aiBox">
        <h4>Summary</h4>
        <p id="aiText">Generating summary…</p>
      </div>
      ${relatedHtml}`;
    modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';
    fetchSummary(a);
  }
  async function translateText(text, target){
    if(!text || target==='en') return text;
    try{
      const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`);
      if(!r.ok) return text;
      const d = await r.json();
      // d[0] is array of [translated, original, ...]
      return (d[0]||[]).map(x=>x[0]).join('') || text;
    }catch(e){ return text; }
  }
  async function translateNode(el, target){
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n;
    while(n = walker.nextNode()) nodes.push(n);
    for(const tn of nodes){
      try {
        const v = tn.nodeValue.trim();
        if(v.length < 3) continue;
        const tr = await translateText(v, target);
        if(tr && tr !== v) tn.nodeValue = tn.nodeValue.replace(v, tr);
      } catch(e){ /* ignore */ }
    }
  }
  async function fetchSummary(a){
    const el = $('#aiText'); if(!el) return;
    const lang = (localStorage.getItem('cp-lang') || 'en');
    let txt = '';
    try{
      const r = await fetchRetry(`${API}/api/summarize`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({url: a.link, title: a.title})}, 2);
      if(r.ok){
        const d = await r.json();
        txt = d.summary || d.text || d.result || '';
      }
    }catch(e){ /* fall through */ }
    if(!txt){
      const bs = buildSummary(a.description || a.title || '', a.title || '');
      if(bs && bs.findings.length){
        // Render as a single paragraph of up to 5 sentences
        const para = bs.findings.slice(0,5).join(' ');
        el.textContent = para;
        if(lang !== 'en') await translateNode(el, lang);
        return;
      }
      el.textContent = 'Summary unavailable. Read the original article for full details.';
      return;
    }
    el.textContent = txt;
    if(lang !== 'en') await translateNode(el, lang);
  }
  function closeModal(){
    const m = $('#modal'); if(m){ m.classList.remove('open'); m.setAttribute('aria-hidden','true'); }
    document.body.style.overflow='';
  }
  const mb = $('#modalBackdrop'); if(mb) mb.addEventListener('click', closeModal);
  const mc = $('#modalClose'); if(mc) mc.addEventListener('click', closeModal);

  window.__openArticleByLink = (link)=>{
    const a = state.articles.find(x=>x.link===link);
    if(a) openArticle(a);
  };
  window.__toggleBookmark = (link)=>{ toggleBookmark(link); };

  /* ---------- theme ---------- */
  const themeToggle = $('#themeToggle');
  function applyTheme(t){
    if(t==='light') document.documentElement.classList.add('light'); else document.documentElement.classList.remove('light');
    localStorage.setItem('cp-theme', t);
  }
  if(themeToggle){ themeToggle.addEventListener('click', ()=>{ const cur = document.documentElement.classList.contains('light')?'light':'dark'; applyTheme(cur==='light'?'dark':'light'); }); }
  const termToggle = $('#termToggle');
  function applyTerminal(on){ if(on) document.documentElement.classList.add('terminal'); else document.documentElement.classList.remove('terminal'); localStorage.setItem('cp-terminal', on?'1':'0'); }
  if(termToggle){ termToggle.addEventListener('click', ()=>{ applyTerminal(!document.documentElement.classList.contains('terminal')); }); }
  if(localStorage.getItem('cp-terminal')==='1') applyTerminal(true);
  const langSelect = $('#langSelect');
  if(langSelect){
    const savedLang = localStorage.getItem('cp-lang') || 'en';
    langSelect.value = savedLang;
    langSelect.addEventListener('change', (e)=>{ localStorage.setItem('cp-lang', e.target.value); toast('Language set to ' + e.target.value.toUpperCase()); window.location.reload(); });
  }
  const saved = localStorage.getItem('cp-theme'); if(saved) applyTheme(saved);

  /* ---------- refresh + live poll ---------- */
  const rb = $('#refreshBtn');
  if(rb){
    rb.addEventListener('click', async ()=>{
      state.search = ''; state.cat = 'all'; const si = $('#searchInput'); if(si) si.value = '';
      $$('#categoryChips .chip').forEach(x=>x.classList.remove('active')); const all=$('#categoryChips .chip'); if(all) all.classList.add('active');
      sessionStorage.clear();
      toast('Refreshing…');
      await Promise.all([fetchNews(true,{updateHero:true}), loadTrending(), loadFG(), loadMarkets(), loadOSS()]);
      renderTicker();
      toast('Updated');
    });
  }

  // live flowing poll: prepend new articles without wiping
  async function livePoll(){
    if(state.loading || state.search.trim() || state.cat!=='all') return;
    try{
      const data = await api(`/api/news?limit=${state.limit}&page=1`);
      const isGas = (a)=> /eth\s*gas|⛽|gwei/i.test(a && a.title || '');
      const arts = (data.articles || []).filter(a=>!isGas(a));
      const fresh = arts.filter(a=>!state.knownLinks.has(a.link));
      if(fresh.length){
        state.articles = fresh.concat(state.articles);
        fresh.forEach(a=>state.knownLinks.add(a.link));
        renderStories(); renderCompact(); renderHero();
        toast(`${fresh.length} new headline${fresh.length>1?'s':''} — flowed to top`);
      }
      const lu = $('#lastUpdated'); if(lu) lu.textContent = 'live ' + new Date().toLocaleTimeString();
    }catch(e){ /* silent */ }
  }

  /* ---------- load more ---------- */
  const lb = $('#loadMoreBtn');
  if(lb){ lb.addEventListener('click', ()=>{ state.page += 1; fetchNews(false); }); }

  /* ---------- mobile menu + back to top ---------- */
  const mobileBtn = $('#mobileMenuBtn'); const mobileNav = $('#mobileNav');
  if(mobileBtn && mobileNav){
    mobileBtn.addEventListener('click', ()=>{ const open = mobileNav.classList.toggle('open'); mobileBtn.setAttribute('aria-expanded', open?'true':'false'); });
    $$('#mobileNav a').forEach(a=> a.addEventListener('click', ()=> mobileNav.classList.remove('open')));
  }
  const btt = $('#backToTop');
  if(btt){
    window.addEventListener('scroll', ()=>{ if(window.scrollY > 400) btt.classList.add('show'); else btt.classList.remove('show'); }, {passive:true});
    btt.addEventListener('click', ()=> window.scrollTo({top:0,behavior:'smooth'}));
  }

  /* ---------- reveal ---------- */
  function revealIn(){
    if(!('IntersectionObserver' in window)){ $$('.reveal').forEach(e=>e.classList.add('in')); return; }
    const io = new IntersectionObserver((entries)=>{
      entries.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
    }, {threshold:0.08, rootMargin:'0px 0px -40px 0px'});
    $$('.reveal:not(.in)').forEach(e=>io.observe(e));
  }

  window.__toast = toast;

  /* ---------- init ---------- */
  loadBookmarks();
  function applyPageMode(){
    const page = (document.body && document.body.dataset && document.body.dataset.page) || 'news';
    const marketsSec = document.getElementById('markets');
    const ossSec = document.getElementById('open-source');
    if(page === 'markets'){
      if(marketsSec && marketsSec.parentNode){ marketsSec.parentNode.insertBefore(marketsSec, marketsSec.parentNode.firstChild); }
      if(ossSec) ossSec.style.display = 'none';
    } else if(page === 'opensource'){
      if(ossSec && ossSec.parentNode){ ossSec.parentNode.insertBefore(ossSec, ossSec.parentNode.firstChild); }
      if(marketsSec) marketsSec.style.display = 'none';
    } else if(page === 'breaking'){
      if(marketsSec) marketsSec.style.display = 'none';
      if(ossSec) ossSec.style.display = 'none';
      const title = document.getElementById('sectionTitle');
      if(title) title.textContent = 'Breaking headlines';
    } else if(page === 'trending'){
      if(marketsSec) marketsSec.style.display = 'none';
      if(ossSec) ossSec.style.display = 'none';
    } else if(page === 'topic'){
      if(marketsSec) marketsSec.style.display = 'none';
      if(ossSec) ossSec.style.display = 'none';
      const params = new URLSearchParams(window.location.search);
      const topic = params.get('topic') || '';
      const title = document.getElementById('sectionTitle');
      if(title) title.textContent = topic ? `Headlines: ${topic}` : 'Topic';
      const sub = document.getElementById('sectionSub');
      if(sub) sub.textContent = topic ? `Articles matching “${topic}”` : 'Filtered headlines';
    }
  }
  async function init(){
    try { await loadCategories(); } catch(e){ console.error('categories error:', e); }
    try { await Promise.all([fetchNews(true,{updateHero:true}), loadTrending(), loadFG(), loadMarkets(), loadOSS(), renderTicker()]); } catch(e){ console.error('init load error:', e); }
    revealIn();
    state.pollTimer = setInterval(livePoll, 45000);
    applyPageMode();
    // Topic page: filter loaded articles by query topic
    const pg = (document.body && document.body.dataset && document.body.dataset.page) || 'news';
    if(pg === 'topic'){
      const params = new URLSearchParams(window.location.search);
      const topic = (params.get('topic') || '').toLowerCase();
      if(topic){
        // pull extra pages to get enough matches
        try{
          for(let p=2; p<=4; p++){
            const data = await api(`/api/news?limit=${state.limit}&page=${p}`);
            const arts = (data.articles || data.news || []).filter(a=>!/eth\\s*gas|⛽|gwei/i.test(a && a.title || ''));
            if(!arts.length) break;
            const seen = new Set(state.articles.map(a=>a.link||a.url));
            for(const a of arts){ if(!seen.has(a.link||a.url)){ state.articles.push(a); seen.add(a.link||a.url);} }
          }
        }catch(e){ console.error(e); }
        const filtered = state.articles.filter(a => (a.title||'').toLowerCase().includes(topic) || (a.description||'').toLowerCase().includes(topic));
        if(filtered.length){
          renderStoriesFiltered(filtered);
          showSearchBanner(`Showing ${filtered.length} headlines for “${params.get('topic')}”`);
        } else {
          // Fall back to the topic's recent headlines from trending payload
          let heads = [];
          try {
            if(!state.trending.length) await loadTrending();
            const t = state.trending.find(x=> (x.topic||'').toLowerCase() === topic);
            heads = (t && t.recentHeadlines) || [];
          } catch(e){}
          if(heads.length){
            const grid = $('#storiesGrid');
            if(grid) grid.innerHTML = heads.map(h=>`<article class=\"story\"><div class=\"story-body\"><h3 class=\"story-title\">${esc(h)}</h3><div class=\"story-meta\"><span class=\"muted small\">${esc(params.get('topic'))}</span></div></div></article>`).join('');
            showSearchBanner(`${heads.length} recent headlines for “${params.get('topic')}”`);
          } else if(state.articles.length){
            // Last resort: show all loaded articles
            renderStoriesFiltered(state.articles);
            showSearchBanner(`No exact matches for “${params.get('topic')}” — showing all ${state.articles.length} headlines`);
          } else {
            const grid = $('#storiesGrid');
            if(grid) grid.innerHTML = '<div class="empty">No headlines found for this topic.</div>';
            showSearchBanner(`No headlines found for “${params.get('topic')}”`);
          }
        }
      }
    }
    // Apply saved language to main content (translate titles/deks) if non-English
    const _lang = localStorage.getItem('cp-lang') || 'en';
    if(_lang !== 'en'){
      try { await translateNode($('#storiesGrid'), _lang); } catch(e){}
      try { const h = $('.hero'); if(h) await translateNode(h, _lang); } catch(e){}
    }
  }
  init().catch(e=>{ console.error(e); toast('Initialization failed'); });

})();
