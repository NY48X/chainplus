const F=['https://cointelegraph.com/rss','https://www.coindesk.com/arc/outboundfeeds/rss/','https://decrypt.co/feed','https://bitcoinmagazine.com/feed'];
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Content-Type':'application/json'};
function j(d,s){s=s||200;return new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Cache-Control':'public, max-age=300'}});}
function cat(title,desc){const t=((title||'')+' '+(desc||'')).toLowerCase();if(/bitcoin|btc/.test(t))return'bitcoin';if(/ethereum|eth\b|ether/.test(t))return'ethereum';if(/solana|sol\b/.test(t))return'solana';if(/defi|dex|yield|liquidity|amm|staking/.test(t))return'defi';if(/nft|tokeniz/.test(t))return'nft';if(/regulat|sec|cftc|law|legal|court|sue|ban|policy/.test(t))return'regulation';if(/market|price|surge|rally|crash|etf|stock|trade/.test(t))return'markets';return'general';}
function tag(xml,t){const m=xml.match(new RegExp('<'+t+'[^>]*>([\\s\\S]*?)</'+t+'>','i'));return m?m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').trim():'';}
async function rss(){
  const o=[],seen=new Set();
  await Promise.all(F.map(async function(u){
    try{
      const r=await fetch(u,{headers:{'User-Agent':'ChainPlus/1.0'}});
      if(!r.ok)return;
      const x=await r.text();
      const items=x.match(/<item[\s\S]*?<\/item>/gi)||[];
      items.forEach(function(it){
        const t=tag(it,'title'),l=tag(it,'link')||tag(it,'guid'),d=tag(it,'description')||tag(it,'content:encoded'),p=tag(it,'pubDate')||tag(it,'published');
        if(!t||!l||seen.has(l))return;seen.add(l);
        o.push({title:t,description:d.replace(/<[^>]+>/g,'').slice(0,300),link:l,source:new URL(u).hostname,pubDate:p,category:cat(t,d.replace(/<[^>]+>/g,'')),credibility:0.7});
      });
    }catch(e){}
  }));
  o.sort(function(a,b){return new Date(b.pubDate||0)-new Date(a.pubDate||0);});
  return o;
}
function trend(arts){
  const st=new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','is','are','was','were','this','that','these','those','from','into','has','have']);
  const c={};
  arts.forEach(function(a){(a.title||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).forEach(function(w){if(w.length<4||st.has(w))return;c[w]=(c[w]||0)+1;});});
  return Object.entries(c).sort(function(a,b){return b[1]-a[1];}).slice(0,10).map(function(e){return{topic:e[0].charAt(0).toUpperCase()+e[0].slice(1),count:e[1],sentiment:'neutral',recentHeadlines:arts.filter(function(a){return (a.title||'').toLowerCase().includes(e[0]);}).slice(0,2).map(function(a){return a.title;})};});
}
const DISPOSABLE=new Set(['mailinator.com','guerrillamail.com','tempmail.com','throwaway.email','fakeinbox.com','trashmail.com','yopmail.com','sharklasers.com','guerrillamailblock.com','grr.la','dispostable.com','mailnesia.com','maildrop.cc','discard.email','temp-mail.org','getnada.com','mohmal.com','burpcollaborator.net','10minutemail.com','minutemail.com']);
function clamp(v,lo,hi,d){v=parseInt(v);if(isNaN(v))v=d;return Math.max(lo,Math.min(hi,v));}
async function hasMX(domain){
  try{
    const r=await fetch('https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(domain)+'&type=MX',{headers:{'Accept':'application/dns-json'}});
    if(!r.ok)return true;
    const d=await r.json();
    return Array.isArray(d.Answer)&&d.Answer.length>0;
  }catch(e){return true;}
}
async function handle(req, env){
  const u=new URL(req.url);const p=u.pathname;
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
  try{
    if(p==='/api/subscribe' && req.method==='POST'){
      try{
        const body=await req.json();
        const email=(body.email||'').trim().toLowerCase();
        if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return j({error:'invalid email format'},400);
        const domain=email.split('@')[1];
        if(DISPOSABLE.has(domain))return j({error:'disposable email not allowed'},400);
        const mx=await hasMX(domain);
        if(!mx)return j({error:'email domain has no mail server'},400);
        if(env && env.SUBSCRIBERS){
          const existing=await env.SUBSCRIBERS.get(email);
          if(existing)return j({ok:true,message:'already subscribed'});
          await env.SUBSCRIBERS.put(email, JSON.stringify({email:email,subscribedAt:new Date().toISOString()}));
        }
        // Send welcome email via Cloudflare Email Service REST API
        if(env && env.CF_API_TOKEN){
          try{
            await fetch('https://api.cloudflare.com/client/v4/accounts/'+env.CF_ACCOUNT_ID+'/email/sending/send',{
              method:'POST',
              headers:{'Authorization':'Bearer '+env.CF_API_TOKEN,'Content-Type':'application/json'},
              body:JSON.stringify({
                to:email,
                from:'welcome@chainplus.tech',
                subject:'Welcome to ChainPlus!',
                html:'<h2>Welcome to ChainPlus!</h2><p>Thanks for subscribing. You\'ll receive the top crypto headlines in your inbox.</p><p>No spam, unsubscribe anytime.</p><p>— The ChainPlus Team</p>',
                text:'Welcome to ChainPlus!\n\nThanks for subscribing. You\'ll receive the top crypto headlines in your inbox.\n\nNo spam, unsubscribe anytime.\n\n— The ChainPlus Team'
              })
            });
          }catch(e){}
        }
        return j({ok:true,message:'subscribed'});
      }catch(e){return j({error:e.message||'subscribe failed'},500);}
    }
    if(p==='/api/news'||p==='/api/news/'){
      const lim=clamp(u.searchParams.get('limit'),1,100,20);
      const pg=clamp(u.searchParams.get('page'),1,1000,1);
      const cat=u.searchParams.get('category');
      let a=await rss();
      if(cat&&cat!=='all'){const q=cat.toLowerCase();a=a.filter(function(x){return (x.category||'').toLowerCase()===q||(x.title||'').toLowerCase().includes(q);});}
      const s=(pg-1)*lim;const pgd=a.slice(s,s+lim);
      return j({articles:pgd,totalCount:a.length,page:pg,limit:lim,hasMore:s+lim<a.length,_source:'rss'});
    }
    if(p==='/api/trending'||p==='/api/trending/'){
      const a=await rss();const t=trend(a);return j({trending:t});
    }
    if(p==='/api/categories'||p==='/api/categories/'||p==='/api/news/categories'||p==='/api/news/categories/'){
      return j({categories:['all','bitcoin','ethereum','defi','solana','nft','regulation','markets']});
    }
    if(p==='/api/breaking'||p==='/api/breaking/'){
      const lim=clamp(u.searchParams.get('limit'),1,50,12);
      const a=await rss();return j({articles:a.slice(0,lim),totalCount:a.length});
    }
    if(p==='/api/fear-greed'||p==='/api/fear-greed/'){
      try{const r=await fetch('https://api.alternative.me/fng/?limit=1');if(r.ok){const d=await r.json();const v=d&&d.data&&d.data[0];if(v)return j({value:parseInt(v.value),classification:v.value_classification,timestamp:v.timestamp});}}catch(e){}
      return j({value:50,classification:'Neutral'});
    }
    if(p==='/api/search'||p==='/api/search/'){
      const q=(u.searchParams.get('q')||'').toLowerCase();
      const lim=clamp(u.searchParams.get('limit'),1,50,20);
      const a=await rss();
      const f=a.filter(function(x){return (x.title||'').toLowerCase().includes(q)||(x.description||'').toLowerCase().includes(q);}).slice(0,lim);
      return j({articles:f,totalCount:f.length});
    }
    return j({error:'not found'},404);
  }catch(e){return j({error:e.message||'internal error'},500);}
}
export default {
  async fetch(request, env) { return handle(request, env); },
  async email(message, env) {
    try {
      const from = (message.from || '').toLowerCase().trim();
      if (!from || !env || !env.SUBSCRIBERS) return;
      const raw = await env.SUBSCRIBERS.get(from);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.verified) return;
      data.verified = true;
      data.verifiedAt = new Date().toISOString();
      await env.SUBSCRIBERS.put(from, JSON.stringify(data));
    } catch (e) {}
  }
};
