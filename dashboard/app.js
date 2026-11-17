'use strict';
const board=window.TOKEN_RADAR;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usd=n=>'$'+new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n);
const exact=n=>'$'+new Intl.NumberFormat('en-US').format(n);
const pct=n=>n===null?'—':(n>=0?'+':'')+n.toFixed(2)+'%';
// TVL × median category market-cap/TVL × clamped growth factor × capped tracking-age factor.
function scoreProtocol(p){const v=p.value_breakdown;return Math.round(v.tvl_usd*v.comp_multiple*v.growth_factor*v.age_factor);}
let sortKey='rank',direction=1,selected=null;
const rows=board.rows;
$('metrics').innerHTML=[['198','protocols ranked','FARMABLE · RECORDS NO TOKEN'],['40','watchlist protocols','100% SNAPSHOT WATCHLIST COVERAGE'],['158','below the $50M floor','DISCOVERY BEYOND THE WATCHLIST'],['2026-11-14','snapshot','758 RECORDS SCREENED · FROZEN DATA']].map(([v,l,s])=>`<div class="metric"><strong style="${v.length>8?'font-size:22px':''}">${v}</strong><span>${l}</span><small>${s}</small></div>`).join('');
for(const [id,values] of [['category',[...new Set(rows.map(p=>p.category||'Uncategorized'))]],['chain',[...new Set(rows.flatMap(p=>p.chains))]]]) values.sort().forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;$(id).append(o);});
function render(){
 const query=$('search').value.trim().toLowerCase();
 const filtered=rows.filter(p=>(!$('category').value||(p.category||'Uncategorized')===$('category').value)&&(!$('chain').value||p.chains.includes($('chain').value))&&(!$('watchlist').checked||p.watchlist)&&p.tvl_usd>=Number($('minimum').value)&&(!query||[p.name,p.slug,p.category,...p.chains].join(' ').toLowerCase().includes(query)));
 filtered.sort((a,b)=>{const av=a[sortKey],bv=b[sortKey];if(av===null&&bv!==null)return 1;if(bv===null&&av!==null)return -1;return ((av??0)-(bv??0))*direction||a.slug.localeCompare(b.slug,'en');});
 $('result-count').textContent=filtered.length;
 $('showing').textContent=`${filtered.length} of ${rows.length} protocols · ranks remain global`;
 $('view-label').textContent=($('category').value||'ALL FARMABLE PROTOCOLS').toUpperCase();
 $('empty').hidden=filtered.length!==0;
 $('rows').innerHTML=filtered.map(p=>{const ratio=p.implied_value_usd/p.tvl_usd;return `<tr class="${p.slug===selected?'selected':''}"><td>${String(p.rank).padStart(2,'0')}</td><td><a class="name" href="#p=${encodeURIComponent(p.slug)}">${esc(p.name)}${p.watchlist?'<span class="watch" title="Snapshot watchlist">◆</span>':''}</a><span class="sub">${esc(p.category||'Uncategorized')} · ${esc(p.chains[0]||'Unspecified')}${p.chains.length>1?' +'+(p.chains.length-1):''}</span></td><td class="value" title="${exact(p.implied_value_usd)}">${usd(p.implied_value_usd)}</td><td>${usd(p.tvl_usd)}</td><td class="${p.change_7d>=0?'positive':'negative'}">${pct(p.change_7d)}</td><td>${p.age_days===null?'—':(p.age_days/365).toFixed(1)+'y'}</td><td><span class="ratio">${ratio.toFixed(2)}× <span class="bar"><i style="width:${Math.min(100,ratio*50)}%"></i></span></span></td></tr>`;}).join('');
 document.querySelectorAll('[data-sort]').forEach(b=>{b.classList.toggle('active',b.dataset.sort===sortKey);b.textContent=({rank:'Rank',implied_value_usd:'Implied value',tvl_usd:'TVL',change_7d:'7d change',age_days:'Age'})[b.dataset.sort]+(b.dataset.sort===sortKey?(direction===1?' ↑':' ↓'):' ↕');b.closest('th').setAttribute('aria-sort',b.dataset.sort===sortKey?(direction===1?'ascending':'descending'):'none');});
}
function showDetail(p){
 selected=p.slug;const v=p.value_breakdown;
 $('detail').innerHTML=`<div class="detail-head"><div class="detail-top"><span>RESEARCH FILE / ${String(p.rank).padStart(3,'0')}</span><span>${p.watchlist?'◆ WATCHLIST':'DISCOVERY'}</span></div><h2>${esc(p.name)}</h2><small>Snapshot records no token · ${esc(p.slug)}</small><div class="tags"><a class="tag" href="#category=${encodeURIComponent(p.category||'Uncategorized')}">${esc(p.category||'Uncategorized')} ↗</a>${p.chains.map(c=>`<span class="tag">${esc(c)}</span>`).join('')}</div><div class="detail-value">${usd(p.implied_value_usd)}</div><small>IMPLIED TOKEN VALUE · ENTRY’S OWN CLAIM</small></div><div class="detail-body"><h3>Follow the value</h3><table class="breakdown"><tbody>${[['TVL',exact(v.tvl_usd)],['Category comp multiple',v.comp_multiple.toFixed(6)+'×'],['Growth factor',v.growth_factor.toFixed(6)+'×'],['Age factor',v.age_factor.toFixed(6)+'×'],['Implied value',exact(p.implied_value_usd)]].map(([k,val])=>`<tr><td>${k}</td><td>${val}</td></tr>`).join('')}</tbody></table><p class="note">${p.comp_fallback?'No category comps; global median fallback.':p.comp_count+' token-bearing category comps; median market cap / TVL.'}<br>7d TVL: ${pct(p.change_7d)} · Tracked since ${esc(p.listed_at||'unknown')} (${p.age_days===null?'neutral age':p.age_days+' days'}).${scoreProtocol(p)!==p.implied_value_usd?' Includes a $1 ranking tie adjustment.':''}</p><div class="plan-title"><h3>Farm field notes</h3><span>6 STEPS / SMALL TEST FIRST</span></div><p class="note">Suggested actions for this category, conditional on current product availability. No points program or token distribution is verified by the snapshot.</p><ol class="steps">${p.farm_steps.map(s=>{const i=s.indexOf('Cost:');return `<li>${esc(i<0?s:s.slice(0,i))}${i<0?'':'<b>'+esc(s.slice(i))+'</b>'}</li>`;}).join('')}</ol><p class="note">Test capital can be lost. Gas estimates vary by chain. Never deposit solely for an unconfirmed reward.</p></div>`;
}
function route(){const params=new URLSearchParams(location.hash.slice(1));const category=params.get('category');if(category!==null){$('category').value=category;render();}const slug=params.get('p');if(slug){const p=rows.find(r=>r.slug===slug);if(p)showDetail(p);else $('detail').innerHTML='<div class="detail-body">Protocol not found. Choose a row from the radar.</div>';}else if(!selected)showDetail(rows[0]);render();}
for(const id of ['search','chain','watchlist','minimum']) $(id).addEventListener(id==='search'?'input':'change',render);
$('category').addEventListener('change',()=>{if($('category').value)location.hash='category='+encodeURIComponent($('category').value);else{history.replaceState(null,'',location.pathname+location.search);render();}});
$('reset').addEventListener('click',()=>{for(const id of ['search','category','chain'])$(id).value='';$('minimum').value='0';$('watchlist').checked=false;history.replaceState(null,'',location.pathname+location.search);render();});
$('rows').addEventListener('click',e=>{const row=e.target.closest('tr');if(row&&!e.target.closest('a'))location.hash=row.querySelector('a').hash;});
for(const b of document.querySelectorAll('[data-sort]'))b.addEventListener('click',()=>{if(sortKey===b.dataset.sort)direction*=-1;else{sortKey=b.dataset.sort;direction=sortKey==='rank'?1:-1;}render();});
$('method-toggle').addEventListener('click',()=>{const open=$('method').hidden;$('method').hidden=!open;$('method-toggle').setAttribute('aria-expanded',String(open));});
window.addEventListener('hashchange',route);route();
