export interface Protocol { slug:string; name:string; category:string|null; chains:string[]; tvl_usd:number; change_7d:number|null; listed_at:string|null; mcap_usd:number|null; gecko_id:string|null; symbol:string|null }
export interface Snapshot {as_of:string; floor_usd:number; protocols:Protocol[]; watchlist:string[]}
const order = (a:string,b:string) => a<b?-1:a>b?1:0;
const median = (v:number[]) => { const a=[...v].sort((a,b)=>a-b); return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2; };
export function farmPlan(p:Protocol):string[] {
 const n=p.name, c=p.chains[0]||'the supported chain', cat=p.category||'protocol';
 let action:string, risk:string;
 if (/Prediction/i.test(cat)) { action='Read market resolution rules, settlement asset and jurisdiction restrictions; if eligible, buy at most $5 of one outcome with a limit order'; risk='Review the resolution source and dispute window; inspect exit liquidity and accept that the entire $5 position can be lost'; }
 else if (/Curator|Allocator|Yield|Manager|Vault|Farming/i.test(cat)) { action='Inspect one vault’s asset, strategy, curator fee and deposit cap; preview a $25 deposit and enter only if withdrawals and underlying exposure are clear'; risk='Review the vault’s lending or liquidity allocations and withdrawal queue; redeem a small portion to test the exit path'; }
 else if (/Lending|CDP|Credit/i.test(cat)) { action='Supply $25–50 of a supported asset to an open lending market; avoid borrowing on the first visit and record the supply rate'; risk='Check collateral rules, utilization and withdrawal liquidity; if borrowing later, keep loan-to-value below 25%'; }
 else if (/Dex|AMM/i.test(cat)) { action='Quote a $10 swap in a liquid pair, set slippage at 0.5% or less, then execute only if fees are acceptable'; risk='Compare a $25 liquidity position against simply holding the assets; inspect pool depth and impermanent-loss exposure before depositing'; }
 else if (/Derivative|Options|Perpetual/i.test(cat)) { action='Use the trading interface in read-only mode first; if eligible, fund $20 and place one minimum-size unleveraged or fully collateralized trade'; risk='Inspect liquidation, funding and close-position controls; close the test trade rather than generating artificial volume'; }
 else if (/Staking|Validator/i.test(cat)) { action='Inspect validator uptime, commission and unbonding rules; delegate $25 only if the minimum and withdrawal delay fit your budget'; risk='Review slashing exposure and test an undelegation request before increasing the position'; }
 else if (/RWA|Real|Treasury/i.test(cat)) { action='Check jurisdiction, accreditation and minimum-deposit requirements; inspect one available asset and subscribe with $25 only if eligible'; risk='Read issuer, custody and redemption terms; do not deposit if KYC or minimums make a small test impractical'; }
 else if (/Chain/i.test(cat)) { action='Use one established application in the ecosystem for a $10 transfer or swap; keep enough native gas for the return transaction'; risk='Inspect finality and the supported withdrawal route; avoid unfamiliar contracts and test a small return transfer'; }
 else { action=`Inspect an available ${cat.toLowerCase()} market or vault; preview a $25 deposit and proceed only when the underlying assets and redemption route are clear`; risk='Read strategy exposure, fees and withdrawal queues; test a partial redemption before allocating more'; }
 return [
 `${n} · Verify the official application through independent project documentation and confirm ${c} support before connecting a separate wallet. Cost: $0; time: 8 minutes.`,
 `${n} · Fund the wallet on ${c} using a route you already trust; budget $5 for gas ($15 on Ethereum), plus $25–50 test capital. Time: 10–20 minutes.`,
 `${n} on ${c} · ${action}. Cost: $0–5 fees plus the stated test capital, which remains at risk; time: 10 minutes.`,
 `${n} · ${risk}. Cost: $0 for review, $0–5 for an exit test; time: 15 minutes, plus any disclosed lockup.`,
 `${n} · Inspect the application's rewards or points page and official eligibility terms; record your transaction hash and any displayed points. No campaign is assumed. Cost: $0; time: 5 minutes weekly.`,
 `${n} · Revisit the ${cat} position after seven days, compare net fees with utility, withdraw if the test is uneconomic, and revoke unused approvals where supported. Cost: $0–5 gas; time: 10 minutes.`,
 ];
}
export function buildBoard(s:Snapshot) {
 const comps=s.protocols.filter(p=>(p.gecko_id!==null||p.symbol!==null)&&p.mcap_usd!>0&&p.tvl_usd>0);
 const ratios=comps.map(p=>p.mcap_usd!/p.tvl_usd).sort((a,b)=>a-b);
 // Interpolate the snapshot-wide 90th percentile to limit thin-category outliers.
 const percentileIndex=(ratios.length-1)*0.9;
 const lower=Math.floor(percentileIndex), upper=Math.ceil(percentileIndex);
 const multipleCap=ratios[lower]+(ratios[upper]-ratios[lower])*(percentileIndex-lower);
 const valueCap=Math.max(...s.protocols.filter(p=>(p.gecko_id!==null||p.symbol!==null)&&p.mcap_usd!>0).map(p=>p.mcap_usd!));
 const global=median(ratios);
 const categories=[...new Set(s.protocols.map(p=>p.category))];
 const multiples=new Map(categories.map(c=>{const a=comps.filter(p=>p.category===c);return [c,{multiple:Math.min(multipleCap,a.length?median(a.map(p=>p.mcap_usd!/p.tvl_usd)):global),count:a.length}];}));
 const excluded=new Set(['Bridge','Canonical Bridge','Liquid Staking','Liquid Restaking','Restaked BTC','CEX']);
 const pre=s.protocols.filter(p=>p.gecko_id===null&&p.symbol===null);
 const candidates=pre.filter(p=>!excluded.has(p.category||'')&&!/^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/i.test(p.name)&&! /\s(v\d+(\.\d+)?|\d+\.\d+)$/i.test(p.name)&&! /\b(wrapped|staked|staking)\b/i.test(p.name));
 const rows=candidates.map(p=>{
 const age=p.listed_at===null?null:Math.max(0,Math.floor((Date.parse(s.as_of)-Date.parse(p.listed_at))/86400000));
 const comp=multiples.get(p.category)!;
 const growth=1+Math.max(-50,Math.min(100,p.change_7d??0))/200;
 const ageFactor=1+Math.min(age??0,1460)/1460*0.25;
 const implied=Math.min(valueCap,Math.round(p.tvl_usd*comp.multiple*growth*ageFactor));
 return {slug:p.slug,name:p.name,category:p.category,chains:p.chains,tvl_usd:p.tvl_usd,change_7d:p.change_7d,listed_at:p.listed_at,age_days:age,watchlist:s.watchlist.includes(p.slug),comp_count:comp.count,comp_fallback:comp.count===0,implied_value_usd:implied,value_breakdown:{tvl_usd:p.tvl_usd,comp_multiple:comp.multiple,growth_factor:growth,age_factor:ageFactor,implied_value_usd:implied},farm_steps:farmPlan(p)};
 }).sort((a,b)=>b.implied_value_usd-a.implied_value_usd||b.tvl_usd-a.tvl_usd||order(a.slug,b.slug));
 let ceiling=Infinity;
 const ranked=rows.map((r,i)=>{r.implied_value_usd=Math.min(r.implied_value_usd,ceiling-1);ceiling=r.implied_value_usd;r.value_breakdown.implied_value_usd=r.implied_value_usd;return {...r,rank:i+1};});
 return {title:'Signal / Launch radar',as_of:s.as_of,floor_usd:s.floor_usd,global_comp_multiple:global,multiple_cap:multipleCap,implied_value_cap_usd:valueCap,coverage:{snapshot:s.protocols.length,ranked:ranked.length,watchlist:s.watchlist.length,excluded_pre_token:pre.length-ranked.length,token_recorded:s.protocols.length-pre.length},rows:ranked};
}
