import { useState, useEffect, useCallback, useRef } from "react";

const ASSETS = {
  NVDA:      { name: "NVIDIA Corp",    color: "#76b900", basePrice: 118.5, pip: 0.01, atr: 2.5 },
  MSFT:      { name: "Microsoft Corp", color: "#00a4ef", basePrice: 415.2, pip: 0.01, atr: 5.0 },
  "XAU/USD": { name: "Gold / USD",     color: "#ffd700", basePrice: 2345.0, pip: 0.1,  atr: 15.0 },
};
const HISTORY_LEN = 30;

// ── PIVEX CHALLENGE CONFIG ────────────────────────────────────────────────────
const PIVEX = {
  INITIAL_CAPITAL: 5000,
  PROFIT_TARGET_PCT: 10,       // +10%
  DAILY_DRAWDOWN_MAX_PCT: 4,   // -4% par jour (statique)
  GLOBAL_DRAWDOWN_MAX_PCT: 6,  // -6% global (statique)
  MIN_TRADING_DAYS: 5,
  CONSISTENCY_MAX_PCT: 50,     // aucun trade > 50% du profit total
  RECOMMENDED_RISK_PCT: 0.5,   // risque conseillé par trade
};

const fmt = (v) => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2}).format(v);
const fmtPnL = (v) => `${v>=0?"+":""}${fmt(v)}`;
const fmtPct = (v,decimals=1) => `${v>=0?"+":""}${v.toFixed(decimals)}%`;
const nowTime = () => new Date().toLocaleTimeString("fr-FR");
const todayStr = () => new Date().toISOString().split("T")[0];

function usePricesWithHistory() {
  const [prices, setPrices] = useState(() =>
    Object.fromEntries(Object.entries(ASSETS).map(([k,v])=>[k,v.basePrice]))
  );
  const histRef = useRef(
    Object.fromEntries(Object.entries(ASSETS).map(([k,v])=>[k,Array(HISTORY_LEN).fill(v.basePrice)]))
  );
  useEffect(()=>{
    const id = setInterval(()=>{
      setPrices(prev=>{
        const next={};
        Object.entries(prev).forEach(([k,v])=>{
          const a=ASSETS[k], drift=(Math.random()-0.495)*a.atr*0.15;
          const np=parseFloat((v+drift).toFixed(a.pip<0.05?2:1));
          histRef.current[k]=[...histRef.current[k].slice(1),np];
          next[k]=np;
        });
        return next;
      });
    },1000);
    return ()=>clearInterval(id);
  },[]);
  return {prices, history:histRef.current};
}

function computeIndicators(history){
  const n=history.length;
  const sma5=history.slice(-5).reduce((a,b)=>a+b,0)/5;
  const sma20=history.slice(-20).reduce((a,b)=>a+b,0)/20;
  let g=0,l=0;
  for(let i=n-14;i<n;i++){const d=history[i]-history[i-1];if(d>0)g+=d;else l-=d;}
  const rsi=100-100/(1+(l===0?100:g/l));
  const s10=history.slice(-10), m10=s10.reduce((a,b)=>a+b,0)/10;
  const vol=Math.sqrt(s10.reduce((a,b)=>a+(b-m10)**2,0)/10);
  const momentum=((history[n-1]-history[n-10])/history[n-10])*100;
  return{sma5,sma20,rsi:parseFloat(rsi.toFixed(1)),momentum:parseFloat(momentum.toFixed(3)),volatility:parseFloat(vol.toFixed(3)),trend:sma5>sma20?"HAUSSIER":sma5<sma20?"BAISSIER":"NEUTRE"};
}

// ── INITIAL DEMO TRADES ───────────────────────────────────────────────────────
const DEMO_TRADES = [ // Ton vrai trade Pivex
  {id:1,asset:"NVDA",direction:"BUY",qty:10,entryPrice:115.2,date:"2025-02-24",status:"closed",sl:112.6,tp:122.7,closePrice:121.8,source:"manual",closeReason:"TP ✅"},
  {id:2,asset:"MSFT",direction:"SELL",qty:3,entryPrice:418.0,date:"2025-02-25",status:"closed",sl:424.3,tp:405.0,closePrice:406.2,source:"copilot",closeReason:"TP ✅"},
  {id:3,asset:"XAU/USD",direction:"BUY",qty:1,entryPrice:2330.0,date:"2025-02-26",status:"closed",sl:2307.5,tp:2397.5,closePrice:2312.0,source:"copilot",closeReason:"SL ❌"},
  {id:4,asset:"NVDA",direction:"BUY",qty:8,entryPrice:117.5,date:"2025-02-27",status:"open",sl:115.1,tp:124.7,source:"copilot"},
  {id:5,asset:"MSFT",direction:"BUY",qty:3,entryPrice:414.0,date:"2025-02-28",status:"open",sl:411.4,tp:421.0,source:"manual"},
];

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App(){
  const {prices, history} = usePricesWithHistory();
  const [trades, setTrades]   = useState(DEMO_TRADES);
  const [activeTab, setActiveTab] = useState("challenge");
  const [flash, setFlash]     = useState({});
  const [alerts, setAlerts]   = useState([]);
  const prevRef = useRef(prices);

  // flash effect
  useEffect(()=>{
    const nf={};
    Object.keys(prices).forEach(k=>{if(prices[k]!==prevRef.current[k])nf[k]=prices[k]>prevRef.current[k]?"up":"down";});
    setFlash(nf); prevRef.current=prices;
    const t=setTimeout(()=>setFlash({}),500); return()=>clearTimeout(t);
  },[prices]);

  // auto SL/TP check
  useEffect(()=>{
    setTrades(prev=>prev.map(t=>{
      if(t.status!=="open")return t;
      const curr=prices[t.asset]; if(!curr)return t;
      const hitSL=t.sl&&(t.direction==="BUY"?curr<=t.sl:curr>=t.sl);
      const hitTP=t.tp&&(t.direction==="BUY"?curr>=t.tp:curr<=t.tp);
      if(hitSL||hitTP)return{...t,status:"closed",closePrice:curr,closeReason:hitTP?"TP ✅":"SL ❌"};
      return t;
    }));
  },[prices]);

  // ── CHALLENGE METRICS ──
  const calcPnL = useCallback((t)=>{
    const close = t.status==="closed" ? t.closePrice : prices[t.asset];
    return (t.direction==="BUY" ? close-t.entryPrice : t.entryPrice-close) * t.qty;
  },[prices]);

  const openTrades   = trades.filter(t=>t.status==="open");
  const closedTrades = trades.filter(t=>t.status==="closed");

  const totalPnL       = trades.reduce((s,t)=>s+calcPnL(t),0);
  const realizedPnL    = closedTrades.reduce((s,t)=>s+calcPnL(t),0);
  const unrealizedPnL  = openTrades.reduce((s,t)=>s+calcPnL(t),0);
  const currentBalance = PIVEX.INITIAL_CAPITAL + totalPnL;
  const profitPct      = (totalPnL / PIVEX.INITIAL_CAPITAL) * 100;

  // Drawdown
  const globalDrawdownAmt  = Math.min(0, totalPnL); // négatif si en perte
  const globalDrawdownPct  = (globalDrawdownAmt / PIVEX.INITIAL_CAPITAL) * 100;
  const dailyPnL = trades.filter(t=>t.status==="closed"&&t.date===todayStr()).reduce((s,t)=>s+calcPnL(t),0)
    + openTrades.reduce((s,t)=>s+calcPnL(t),0);
  const dailyDrawdownPct = Math.min(0,(dailyPnL/PIVEX.INITIAL_CAPITAL)*100);

  // Drawdown limits
  const globalDrawdownLimit = PIVEX.INITIAL_CAPITAL * (PIVEX.GLOBAL_DRAWDOWN_MAX_PCT/100);
  const dailyDrawdownLimit  = PIVEX.INITIAL_CAPITAL * (PIVEX.DAILY_DRAWDOWN_MAX_PCT/100);
  const profitTargetAmt     = PIVEX.INITIAL_CAPITAL * (PIVEX.PROFIT_TARGET_PCT/100);

  // Trading days
  const tradingDays = [...new Set(closedTrades.map(t=>t.date))].length;
  const hasOpenToday = openTrades.some(t=>t.date===todayStr());
  const effectiveTradingDays = tradingDays + (hasOpenToday?1:0);

  // Consistency rule
  const totalProfit = Math.max(0, realizedPnL);
  const biggestTrade = closedTrades.reduce((max,t)=>{ const p=calcPnL(t); return p>max?p:max; },0);
  const consistencyPct = totalProfit>0 ? (biggestTrade/totalProfit)*100 : 0;

  // Win rate
  const wins = closedTrades.filter(t=>calcPnL(t)>0).length;
  const winRate = closedTrades.length ? (wins/closedTrades.length)*100 : 0;

  // Alerts
  useEffect(()=>{
    const newAlerts=[];
    if(Math.abs(dailyDrawdownPct) >= PIVEX.DAILY_DRAWDOWN_MAX_PCT*0.75)
      newAlerts.push({level:"danger",msg:`⚠️ Drawdown journalier à ${Math.abs(dailyDrawdownPct).toFixed(1)}% — limite à 4%`});
    if(Math.abs(globalDrawdownPct) >= PIVEX.GLOBAL_DRAWDOWN_MAX_PCT*0.75)
      newAlerts.push({level:"danger",msg:`🚨 Drawdown global à ${Math.abs(globalDrawdownPct).toFixed(1)}% — limite à 6%`});
    if(consistencyPct > 50)
      newAlerts.push({level:"warn",msg:`📏 Règle cohérence: ton meilleur trade = ${consistencyPct.toFixed(0)}% du profit — continue à trader`});
    if(profitPct >= PIVEX.PROFIT_TARGET_PCT)
      newAlerts.push({level:"success",msg:`🎉 Objectif 10% atteint ! Clôture toutes les positions et contacte Pivex !`});
    setAlerts(newAlerts);
  },[dailyDrawdownPct, globalDrawdownPct, consistencyPct, profitPct]);

  const addTrade   = t => setTrades(prev=>[t,...prev]);
  const closeTrade = id => setTrades(prev=>prev.map(t=>t.id===id?{...t,status:"closed",closePrice:prices[t.asset],closeReason:"Manuel",date:todayStr()}:t));
  const deleteTrade= id => setTrades(prev=>prev.filter(t=>t.id!==id));

  const challengeData = {totalPnL,realizedPnL,unrealizedPnL,currentBalance,profitPct,globalDrawdownPct,globalDrawdownAmt,dailyDrawdownPct,dailyPnL,profitTargetAmt,globalDrawdownLimit,dailyDrawdownLimit,tradingDays:effectiveTradingDays,consistencyPct,biggestTrade,totalProfit,winRate,wins,closedTrades,openTrades};

  const TABS = [["challenge","🏆 Défi Pivex"],["copilot","🎯 Copilote"],["trades","📋 Trades"],["risk","🛡 Risk"]];

  return(
    <div style={S.root}>
      {/* HEADER */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <span style={S.logo}>⬡</span>
          <div>
            <div style={S.logoTitle}>PIVEX CHALLENGE</div>
            <div style={S.logoSub}>Copilote IA · Analyse en temps réel</div>
          </div>
        </div>
        <div style={S.headerRight}><div style={S.dot}/><span style={S.liveText}>LIVE</span></div>
      </div>

      {/* ALERTS */}
      {alerts.length>0&&(
        <div style={{padding:"8px 20px",display:"flex",flexDirection:"column",gap:4,background:"#080d17"}}>
          {alerts.map((a,i)=>(
            <div key={i} style={{padding:"8px 14px",borderRadius:6,fontSize:11,fontWeight:600,
              background:a.level==="danger"?"#450a0a":a.level==="warn"?"#422006":"#064e3b",
              color:a.level==="danger"?"#f87171":a.level==="warn"?"#fbbf24":"#4ade80",
              border:`1px solid ${a.level==="danger"?"#7f1d1d":a.level==="warn"?"#92400e":"#166534"}`}}>
              {a.msg}
            </div>
          ))}
        </div>
      )}

      {/* TICKER */}
      <div style={S.ticker}>
        {Object.entries(ASSETS).map(([sym,asset])=>{
          const ind=computeIndicators(history[sym]);
          return(
            <div key={sym} style={S.tickerCard}>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <span style={{...S.tickerSym,color:asset.color}}>{sym}</span>
                <span style={{fontSize:9,color:ind.trend==="HAUSSIER"?"#4ade80":ind.trend==="BAISSIER"?"#f87171":"#94a3b8"}}>
                  {ind.trend==="HAUSSIER"?"▲":ind.trend==="BAISSIER"?"▼":"→"} {ind.trend}
                </span>
              </div>
              <div style={{...S.tickerPrice,color:flash[sym]==="up"?"#4ade80":flash[sym]==="down"?"#f87171":"#e2e8f0",transition:"color 0.3s"}}>
                {sym==="XAU/USD"?prices[sym]?.toFixed(1):prices[sym]?.toFixed(2)}
              </div>
              <div style={{display:"flex",gap:8,marginTop:2}}>
                <span style={{fontSize:9,color:"#475569"}}>RSI <span style={{color:ind.rsi>70?"#f87171":ind.rsi<30?"#4ade80":"#94a3b8"}}>{ind.rsi}</span></span>
                <span style={{fontSize:9,color:"#475569"}}>SMA5 <span style={{color:"#94a3b8"}}>{ind.sma5.toFixed(1)}</span></span>
              </div>
            </div>
          );
        })}
      </div>

      {/* TABS */}
      <div style={S.tabs}>
        {TABS.map(([id,label])=>(
          <button key={id} onClick={()=>setActiveTab(id)}
            style={{...S.tab,...(activeTab===id?(id==="challenge"?S.tabGold:id==="copilot"?S.tabPurple:S.tabActive):{}),
              ...(activeTab!==id&&id==="challenge"?{color:"#b45309"}:{}),
              ...(activeTab!==id&&id==="copilot"?{color:"#7c3aed"}:{})}}>
            {label}
          </button>
        ))}
      </div>

      {activeTab==="challenge" && <ChallengeTab data={challengeData} trades={trades} calcPnL={calcPnL} prices={prices} onClose={closeTrade} onDelete={deleteTrade}/>}
      {activeTab==="copilot"   && <CopilotView prices={prices} history={history} openTrades={openTrades} onAddTrade={addTrade} challengeData={challengeData}/>}
      {activeTab==="trades"    && (
        <div style={S.content}>
          <div style={S.section}>
            <div style={S.sectionTitle}>HISTORIQUE COMPLET</div>
            {trades.map(t=><TradeRow key={t.id} trade={t} pnl={calcPnL(t)} prices={prices} onClose={closeTrade} onDelete={deleteTrade} showStatus/>)}
          </div>
        </div>
      )}
      {activeTab==="risk"      && <RiskManager prices={prices}/>}
    </div>
  );
}

// ── CHALLENGE TAB ─────────────────────────────────────────────────────────────
function ChallengeTab({data, trades, calcPnL, prices, onClose, onDelete}){
  const {totalPnL,profitPct,globalDrawdownPct,dailyDrawdownPct,profitTargetAmt,globalDrawdownLimit,dailyDrawdownLimit,tradingDays,consistencyPct,biggestTrade,totalProfit,winRate,currentBalance,realizedPnL,unrealizedPnL,openTrades} = data;

  const profitProgress   = Math.min(100, Math.max(0, (totalPnL/profitTargetAmt)*100));
  const dailyDDProgress  = Math.min(100, (Math.abs(dailyDrawdownPct)/4)*100);
  const globalDDProgress = Math.min(100, (Math.abs(globalDrawdownPct)/6)*100);

  const rulesStatus = [
    {label:"Objectif profit 10%",     ok: profitPct>=10,                  val: fmtPct(profitPct),       sub:`Cible: +${fmt(profitTargetAmt)}`},
    {label:"Drawdown journalier <4%", ok: Math.abs(dailyDrawdownPct)<4,   val: fmtPct(dailyDrawdownPct), sub:`Limite: -${fmt(dailyDrawdownLimit)}`},
    {label:"Drawdown global <6%",     ok: Math.abs(globalDrawdownPct)<6,  val: fmtPct(globalDrawdownPct),sub:`Limite: -${fmt(globalDrawdownLimit)}`},
    {label:"Jours de trading ≥ 5",    ok: tradingDays>=5,                 val: `${tradingDays}/5 jours`, sub:"Jours distincts"},
    {label:"Cohérence ≤ 50%",         ok: consistencyPct<=50||totalProfit===0, val:`${consistencyPct.toFixed(0)}%`,sub:"Du profit total"},
    {label:"Win rate",                ok: winRate>=50,                    val:`${winRate.toFixed(0)}%`,  sub:`${data.wins}/${data.closedTrades.length} trades`},
  ];

  return(
    <div style={S.content}>

      {/* BALANCE HERO */}
      <div style={{background:"linear-gradient(135deg,#0c1a0a,#0a1f2e)",border:"1px solid #1a2e1a",borderRadius:12,padding:"20px 24px",marginBottom:20,display:"flex",gap:30,flexWrap:"wrap",alignItems:"center"}}>
        <div>
          <div style={{fontSize:10,color:"#475569",letterSpacing:3,marginBottom:4}}>SOLDE ACTUEL</div>
          <div style={{fontSize:34,fontWeight:900,color:currentBalance>=PIVEX.INITIAL_CAPITAL?"#4ade80":"#f87171"}}>{fmt(currentBalance)}</div>
          <div style={{fontSize:12,color:"#475569",marginTop:2}}>Initial: {fmt(PIVEX.INITIAL_CAPITAL)}</div>
        </div>
        <div style={{flex:1,minWidth:200}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <span style={{fontSize:10,color:"#475569",letterSpacing:2}}>PROGRESSION OBJECTIF 10%</span>
            <span style={{fontSize:12,fontWeight:700,color:profitPct>=10?"#4ade80":profitPct>=7?"#facc15":"#e2e8f0"}}>{fmtPct(profitPct)}</span>
          </div>
          <div style={{background:"#1e293b",borderRadius:99,height:12,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${profitProgress}%`,background:profitPct>=10?"#4ade80":profitPct>=7?"#facc15":"#38bdf8",borderRadius:99,transition:"width 0.5s",boxShadow:profitPct>=10?"0 0 12px #4ade80":""}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontSize:10,color:"#334155"}}>
            <span>{fmtPnL(totalPnL)}</span><span>Cible: {fmt(profitTargetAmt)}</span>
          </div>
        </div>
        <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
          <MiniStat label="Réalisé"    value={fmtPnL(realizedPnL)}   color={realizedPnL>=0?"#4ade80":"#f87171"}/>
          <MiniStat label="Non réalisé" value={fmtPnL(unrealizedPnL)} color={unrealizedPnL>=0?"#4ade80":"#f87171"}/>
        </div>
      </div>

      {/* DRAWDOWN GAUGES */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:20}}>
        <DrawdownGauge label="DRAWDOWN JOURNALIER" value={Math.abs(dailyDrawdownPct)} max={4} limit={fmt(PIVEX.INITIAL_CAPITAL*0.04)} used={fmt(Math.abs(dailyDrawdownPct/100*PIVEX.INITIAL_CAPITAL))} progress={dailyDDProgress}/>
        <DrawdownGauge label="DRAWDOWN GLOBAL" value={Math.abs(globalDrawdownPct)} max={6} limit={fmt(PIVEX.INITIAL_CAPITAL*0.06)} used={fmt(Math.abs(globalDrawdownPct/100*PIVEX.INITIAL_CAPITAL))} progress={globalDDProgress}/>
      </div>

      {/* RULES CHECKLIST */}
      <div style={{...S.section,marginBottom:20}}>
        <div style={S.sectionTitle}>✅ STATUT DES RÈGLES PIVEX</div>
        <div style={{padding:16,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10}}>
          {rulesStatus.map((r,i)=>(
            <div key={i} style={{background:"#080d17",borderRadius:8,padding:"12px 14px",border:`1px solid ${r.ok?"#166534":"#7f1d1d"}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{fontSize:10,color:"#64748b",letterSpacing:1}}>{r.label}</span>
                <span style={{fontSize:16}}>{r.ok?"✅":"❌"}</span>
              </div>
              <div style={{fontSize:18,fontWeight:700,color:r.ok?"#4ade80":"#f87171"}}>{r.val}</div>
              <div style={{fontSize:10,color:"#334155",marginTop:2}}>{r.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* CONSISTENCY RULE */}
      <div style={{...S.section,marginBottom:20}}>
        <div style={S.sectionTitle}>📏 RÈGLE DE COHÉRENCE (MAX 50% DU PROFIT)</div>
        <div style={{padding:16}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
            <div style={{fontSize:11,color:"#64748b"}}>Meilleur trade: <span style={{color:"#e2e8f0",fontWeight:700}}>{fmt(biggestTrade)}</span></div>
            <div style={{fontSize:11,color:"#64748b"}}>Profit total: <span style={{color:"#e2e8f0",fontWeight:700}}>{fmt(totalProfit)}</span></div>
            <div style={{fontSize:11,color:consistencyPct>50?"#f87171":consistencyPct>35?"#facc15":"#4ade80",fontWeight:700}}>{consistencyPct.toFixed(0)}% du profit</div>
          </div>
          <div style={{background:"#1e293b",borderRadius:99,height:10,overflow:"hidden",position:"relative"}}>
            <div style={{height:"100%",width:`${Math.min(100,consistencyPct)}%`,background:consistencyPct>50?"#f87171":consistencyPct>35?"#facc15":"#4ade80",borderRadius:99,transition:"width 0.5s"}}/>
            <div style={{position:"absolute",top:0,left:"50%",width:2,height:"100%",background:"#ffffff20"}}/>
          </div>
          <div style={{fontSize:10,color:"#334155",marginTop:6}}>
            {consistencyPct>50?"❌ Continue à trader pour que ce trade représente ≤ 50% du total":consistencyPct>35?"⚠️ Attention — approche de la limite":"✅ Cohérence respectée"}
          </div>
        </div>
      </div>

      {/* GUIDE RAPIDE */}
      <div style={{...S.section,marginBottom:20,background:"linear-gradient(135deg,#0c1a0a,#080d17)"}}>
        <div style={{...S.sectionTitle,color:"#86efac"}}>📖 GUIDE RAPIDE — RÈGLES PIVEX</div>
        <div style={{padding:16,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {[
            ["🎯 Objectif","Atteindre +10% = +$1,000 sur $10,000","#4ade80"],
            ["📅 Jours minimum","Trader sur 5 jours distincts minimum","#38bdf8"],
            ["📉 DD journalier","Ne jamais perdre plus de $400 en une journée","#f87171"],
            ["📉 DD global","Solde ne doit jamais passer sous $9,400","#f87171"],
            ["📏 Cohérence","Aucun trade > 50% de ton profit total","#facc15"],
            ["⚠️ News trading","Évite NFP, FOMC, CPI — profits exclus","#fb923c"],
            ["💰 Risque conseillé","0.5% par trade = $50 max de risque","#a78bfa"],
            ["🚪 Clôture finale","Ferme TOUT une fois 10% atteint","#4ade80"],
          ].map(([title,desc,color],i)=>(
            <div key={i} style={{background:"#0a0f1a",borderRadius:6,padding:"10px 12px",borderLeft:`3px solid ${color}`}}>
              <div style={{fontSize:11,fontWeight:700,color,marginBottom:3}}>{title}</div>
              <div style={{fontSize:10,color:"#475569",lineHeight:1.5}}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* OPEN POSITIONS */}
      <div style={S.section}>
        <div style={S.sectionTitle}>POSITIONS OUVERTES ({openTrades.length})</div>
        {openTrades.length===0?<div style={S.empty}>Aucune position ouverte</div>:openTrades.map(t=><TradeRow key={t.id} trade={t} pnl={calcPnL(t)} prices={prices} onClose={onClose}/>)}
      </div>
    </div>
  );
}

function DrawdownGauge({label,value,max,limit,used,progress}){
  const color = value>max*0.85?"#f87171":value>max*0.6?"#fb923c":value>max*0.35?"#facc15":"#4ade80";
  return(
    <div style={{...S.section,padding:16}}>
      <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginBottom:12}}>{label}</div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
        <span style={{fontSize:22,fontWeight:700,color}}>{value.toFixed(2)}%</span>
        <span style={{fontSize:11,color:"#334155"}}>/ {max}% max</span>
      </div>
      <div style={{background:"#1e293b",borderRadius:99,height:14,overflow:"hidden",marginBottom:8}}>
        <div style={{height:"100%",width:`${progress}%`,background:`linear-gradient(90deg,#4ade80,${color})`,borderRadius:99,transition:"width 0.5s"}}/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#334155"}}>
        <span>Utilisé: <span style={{color:"#64748b"}}>{used}</span></span>
        <span>Limite: <span style={{color:"#f87171"}}>{limit}</span></span>
      </div>
      {progress>75&&<div style={{marginTop:8,padding:"5px 8px",background:"#450a0a",borderRadius:4,fontSize:10,color:"#f87171"}}>⚠️ ATTENTION — {(max-value).toFixed(2)}% restant avant limite</div>}
    </div>
  );
}

function MiniStat({label,value,color}){
  return(
    <div style={{textAlign:"center"}}>
      <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginBottom:4}}>{label}</div>
      <div style={{fontSize:14,fontWeight:700,color}}>{value}</div>
    </div>
  );
}

// ── COPILOT VIEW ──────────────────────────────────────────────────────────────
function CopilotView({prices, history, openTrades, onAddTrade, challengeData}){
  const [analyzing, setAnalyzing]=useState(false);
  const [signals, setSignals]=useState([]);
  const [globalAnalysis, setGlobalAnalysis]=useState("");
  const [lastTime, setLastTime]=useState(null);
  const [capital] = useState(PIVEX.INITIAL_CAPITAL.toString());
  const [riskPct] = useState(PIVEX.RECOMMENDED_RISK_PCT.toString());
  const [copied, setCopied]=useState({});
  const [confirmed, setConfirmed]=useState({});
  const [log, setLog]=useState([]);
  const [autoMode, setAutoMode]=useState(false);
  const intervalRef=useRef(null);
  const lastRunRef=useRef(0);

  const addLog=useCallback((type,text)=>setLog(prev=>[{time:nowTime(),type,text},...prev].slice(0,30)),[]);

  const copyToClipboard=(text,key)=>{
    navigator.clipboard.writeText(text).then(()=>{
      setCopied(p=>({...p,[key]:true}));
      setTimeout(()=>setCopied(p=>({...p,[key]:false})),2000);
    });
  };

  const confirmTrade=(signal)=>{
    const maxRisk=(PIVEX.INITIAL_CAPITAL*PIVEX.RECOMMENDED_RISK_PCT)/100;
    const slDist=Math.abs(signal.entryPrice-signal.sl);
    const qty=slDist>0?Math.max(1,Math.floor(maxRisk/slDist)):1;
    onAddTrade({id:Date.now()+Math.random(),asset:signal.asset,direction:signal.action,qty,entryPrice:signal.entryPrice,sl:signal.sl,tp:signal.tp,date:todayStr(),status:"open",source:"copilot",confidence:signal.confidence,reason:signal.reason});
    setConfirmed(p=>({...p,[signal.asset+signal.action]:true}));
    addLog("confirm",`✅ Trade confirmé: ${signal.action} ${signal.asset} x${qty}`);
  };

  const runAnalysis=useCallback(async()=>{
    if(analyzing)return;
    if(Date.now()-lastRunRef.current<15000)return;
    lastRunRef.current=Date.now();
    setAnalyzing(true); setSignals([]); setConfirmed({});

    const indMap={};
    Object.keys(ASSETS).forEach(sym=>{indMap[sym]=computeIndicators(history[sym]);});

    const marketSnapshot=Object.entries(indMap).map(([sym,ind])=>{
      const pos=openTrades.filter(t=>t.asset===sym);
      return `${sym}: Prix=${prices[sym]}, Trend=${ind.trend}, RSI=${ind.rsi}, SMA5=${ind.sma5.toFixed(2)}, SMA20=${ind.sma20.toFixed(2)}, ATR=${ASSETS[sym].atr}, Positions=${pos.length>0?pos.map(p=>`${p.direction}@${p.entryPrice}`).join(","):"aucune"}`;
    }).join("\n");

    const prompt=`Tu es un expert trader. Génère des signaux pour un trader qui les exécute MANUELLEMENT sur Pivex.

CONTEXTE DU DÉFI PIVEX:
- Capital: $${PIVEX.INITIAL_CAPITAL} | Objectif: +10% (+$${PIVEX.INITIAL_CAPITAL*0.1})
- Drawdown journalier max: 4% ($${PIVEX.INITIAL_CAPITAL*0.04}) | Global max: 6% ($${PIVEX.INITIAL_CAPITAL*0.06})
- Risque recommandé: ${PIVEX.RECOMMENDED_RISK_PCT}% par trade ($${PIVEX.INITIAL_CAPITAL*PIVEX.RECOMMENDED_RISK_PCT/100} max de risque)
- Drawdown journalier actuel: ${challengeData.dailyDrawdownPct.toFixed(2)}%
- Drawdown global actuel: ${challengeData.globalDrawdownPct.toFixed(2)}%
- Profit actuel: ${challengeData.profitPct.toFixed(2)}%

MARCHÉ EN TEMPS RÉEL:
${marketSnapshot}

RÈGLES STRICTES:
1. SL=1.5xATR | TP=3xATR (R/R minimum 1:2)
2. Ne pas ouvrir si position déjà ouverte dans même direction
3. Eviter si drawdown journalier > 3% (déjà limite)
4. HOLD si signal pas clair
5. entryPrice = prix actuel

Réponds UNIQUEMENT en JSON:
{
  "globalAnalysis": "1 phrase sur le marché + opportunités",
  "signals": [
    {
      "asset": "NVDA|MSFT|XAU/USD",
      "action": "BUY|SELL|HOLD",
      "entryPrice": 0.00,
      "sl": 0.00,
      "tp": 0.00,
      "confidence": "HIGH|MEDIUM|LOW",
      "reason": "explication française max 15 mots",
      "rr": "1:X.X",
      "urgency": "IMMÉDIAT|ATTENDRE|PASSER",
      "pivexTip": "conseil spécifique Pivex en 10 mots"
    }
  ]
}`;

    try{
      addLog("info","🔍 Analyse IA en cours...");
      const res=await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-3-5-haiku-20241022",max_tokens:1000,messages:[{role:"user",content:prompt}]})});
      const data=await res.json();
      const raw=data.content?.find(b=>b.type==="text")?.text||"";
      const jm=raw.match(/\{[\s\S]*\}/);
      if(!jm)throw new Error("Réponse invalide");
      const analysis=JSON.parse(jm[0]);
      setGlobalAnalysis(analysis.globalAnalysis);
      setSignals(analysis.signals||[]);
      setLastTime(nowTime());
      const active=analysis.signals.filter(s=>s.action!=="HOLD");
      addLog("ai",`📡 ${active.length} signal(s) — ${analysis.globalAnalysis}`);
    }catch(err){addLog("error",`❌ Erreur: ${err.message}`);}
    finally{setAnalyzing(false);}
  },[analyzing,history,prices,openTrades,challengeData,addLog]);

  useEffect(()=>{
    if(autoMode){runAnalysis();intervalRef.current=setInterval(runAnalysis,20000);}
    else clearInterval(intervalRef.current);
    return()=>clearInterval(intervalRef.current);
  },[autoMode]);

  const activeSignals=signals.filter(s=>s.action!=="HOLD");
  const holdSignals=signals.filter(s=>s.action==="HOLD");

  return(
    <div style={S.content}>
      {/* CHALLENGE STATUS BAR */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
        {[
          ["Profit","#4ade80",`${challengeData.profitPct.toFixed(2)}%`,`Cible: +10%`],
          ["DD Journalier",Math.abs(challengeData.dailyDrawdownPct)>3?"#f87171":"#4ade80",`${Math.abs(challengeData.dailyDrawdownPct).toFixed(2)}%`,"Limite: 4%"],
          ["DD Global",Math.abs(challengeData.globalDrawdownPct)>5?"#f87171":"#4ade80",`${Math.abs(challengeData.globalDrawdownPct).toFixed(2)}%`,"Limite: 6%"],
          ["Jours tradés",challengeData.tradingDays>=5?"#4ade80":"#facc15",`${challengeData.tradingDays}/5`,"Minimum requis"],
        ].map(([label,color,val,sub],i)=>(
          <div key={i} style={{background:"#0d1424",border:`1px solid #1e293b`,borderRadius:8,padding:"10px 14px"}}>
            <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginBottom:4}}>{label}</div>
            <div style={{fontSize:18,fontWeight:700,color}}>{val}</div>
            <div style={{fontSize:9,color:"#334155"}}>{sub}</div>
          </div>
        ))}
      </div>

      {/* HERO */}
      <div style={{background:"linear-gradient(135deg,#1e1b4b,#2e1065)",border:"1px solid #4c1d95",borderRadius:10,padding:"14px 18px",marginBottom:20,display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
        <div style={{fontSize:28}}>🎯</div>
        <div style={{flex:1}}>
          <div style={{fontSize:12,fontWeight:700,color:"#e2e8f0",letterSpacing:2,marginBottom:3}}>COPILOTE PIVEX — RISQUE 0.5% / TRADE</div>
          <div style={{fontSize:10,color:"#a78bfa"}}>IA analyse RSI, SMA, ATR et génère les paramètres exacts. Tu entres sur Pivex en 4 étapes.</div>
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={runAnalysis} disabled={analyzing}
            style={{...S.btnPurple,padding:"9px 18px",fontSize:11,opacity:analyzing?0.6:1,cursor:analyzing?"not-allowed":"pointer"}}>
            {analyzing?"⏳ Analyse...":"🔄 Analyser"}
          </button>
          <div style={{display:"flex",alignItems:"center",gap:8,background:"#0d1424",border:`1px solid ${autoMode?"#7c3aed":"#334155"}`,borderRadius:6,padding:"8px 14px",cursor:"pointer"}} onClick={()=>setAutoMode(v=>!v)}>
            <div style={{width:8,height:8,borderRadius:"50%",background:autoMode?"#a78bfa":"#374151",boxShadow:autoMode?"0 0 8px #a78bfa":"none"}}/>
            <span style={{fontSize:10,color:autoMode?"#a78bfa":"#475569",letterSpacing:1}}>{autoMode?"AUTO":"MANUEL"}</span>
          </div>
        </div>
      </div>

      {globalAnalysis&&(
        <div style={{background:"#0d1424",border:"1px solid #1e293b",borderRadius:8,padding:"10px 16px",marginBottom:16,fontSize:12,color:"#94a3b8",fontStyle:"italic",borderLeft:"3px solid #7c3aed"}}>
          📡 {globalAnalysis} {lastTime&&<span style={{color:"#334155",fontSize:10}}>· {lastTime}</span>}
        </div>
      )}

      {analyzing&&(<div style={{...S.section,padding:40,textAlign:"center",marginBottom:16}}><div style={{color:"#a78bfa",fontSize:13,letterSpacing:2}}>⚙️ ANALYSE EN COURS...</div></div>)}

      {signals.length===0&&!analyzing&&(
        <div style={{...S.section,padding:40,textAlign:"center",marginBottom:16}}>
          <div style={{fontSize:36,marginBottom:12}}>📡</div>
          <div style={{color:"#475569",fontSize:13}}>Clique sur <strong style={{color:"#a78bfa"}}>Analyser</strong> pour recevoir tes signaux Pivex</div>
        </div>
      )}

      {/* SIGNAL CARDS */}
      {activeSignals.length>0&&(
        <div style={{marginBottom:20}}>
          <div style={{fontSize:10,letterSpacing:3,color:"#a78bfa",marginBottom:12}}>🔥 SIGNAUX ACTIFS — PARAMÈTRES À ENTRER SUR PIVEX</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:14}}>
            {activeSignals.map((signal,i)=>{
              const asset=ASSETS[signal.asset];
              const isBuy=signal.action==="BUY";
              const acc=isBuy?"#4ade80":"#f87171";
              const bg=isBuy?"#064e3b":"#450a0a";
              const bd=isBuy?"#166534":"#7f1d1d";
              const maxRisk=(PIVEX.INITIAL_CAPITAL*PIVEX.RECOMMENDED_RISK_PCT)/100;
              const slDist=Math.abs(signal.entryPrice-signal.sl);
              const qty=slDist>0?Math.max(1,Math.floor(maxRisk/slDist)):1;
              const posValue=qty*signal.entryPrice;
              const riskAmt=qty*slDist;
              const ck=signal.asset+signal.action;
              const isConfirmed=confirmed[ck];
              const pivexText=`Actif: ${signal.asset}\nDirection: ${signal.action}\nQuantité: ${qty}\nPrix entrée: ${signal.entryPrice}\nStop Loss: ${signal.sl}\nTake Profit: ${signal.tp}\nRatio R/R: ${signal.rr}`;

              return(
                <div key={i} style={{background:"#0d1424",border:`1px solid ${bd}`,borderRadius:10,overflow:"hidden",opacity:isConfirmed?0.55:1}}>
                  <div style={{background:bg,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{display:"flex",gap:10,alignItems:"center"}}>
                      <span style={{fontSize:15,fontWeight:900,color:acc,letterSpacing:2}}>{signal.action}</span>
                      <span style={{fontSize:14,fontWeight:700,color:asset?.color}}>{signal.asset}</span>
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      {signal.urgency&&<span style={{fontSize:9,background:"#00000030",color:signal.urgency==="IMMÉDIAT"?"#fbbf24":"#94a3b8",padding:"2px 6px",borderRadius:3,letterSpacing:1}}>{signal.urgency}</span>}
                      <span style={{fontSize:9,color:signal.confidence==="HIGH"?"#4ade80":signal.confidence==="MEDIUM"?"#facc15":"#f87171",background:"#00000030",padding:"2px 6px",borderRadius:3,letterSpacing:1}}>{signal.confidence}</span>
                    </div>
                  </div>
                  <div style={{padding:"8px 14px 0",fontSize:10,color:"#94a3b8",fontStyle:"italic",borderBottom:"1px solid #1e293b",paddingBottom:8}}>
                    💡 {signal.reason}
                  </div>
                  {signal.pivexTip&&<div style={{padding:"6px 14px",fontSize:10,color:"#7c3aed",background:"#1e1b4b20",borderBottom:"1px solid #1e293b"}}>🎯 {signal.pivexTip}</div>}
                  <div style={{padding:"12px 14px"}}>
                    <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginBottom:8}}>PARAMÈTRES PIVEX ↓ (cliquer pour copier)</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:10}}>
                      {[["QUANTITÉ",qty+" unités","#38bdf8",true],["ENTRÉE",signal.entryPrice,"#e2e8f0",false],["STOP LOSS",signal.sl,"#f87171",false],["TAKE PROFIT",signal.tp,"#4ade80",false],["R/R",signal.rr,"#a78bfa",false],["RISQUE MAX",fmt(riskAmt),"#fb923c",false]].map(([l,v,c,big])=>(
                        <div key={l} style={{background:"#080d17",borderRadius:5,padding:"7px 9px",cursor:"pointer",border:"1px solid transparent",transition:"border-color 0.2s"}}
                          onMouseEnter={e=>e.currentTarget.style.borderColor="#334155"}
                          onMouseLeave={e=>e.currentTarget.style.borderColor="transparent"}
                          onClick={()=>copyToClipboard(String(v),l+i)}>
                          <div style={{fontSize:8,color:copied[l+i]?"#4ade80":"#334155",letterSpacing:1}}>{copied[l+i]?"✓ COPIÉ":l}</div>
                          <div style={{fontSize:big?16:12,fontWeight:700,color:c}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={()=>copyToClipboard(pivexText,"all"+i)}
                        style={{flex:1,padding:"8px 0",background:"#1e293b",border:"1px solid #334155",color:copied["all"+i]?"#4ade80":"#94a3b8",borderRadius:6,cursor:"pointer",fontSize:10,fontWeight:700,letterSpacing:1}}>
                        {copied["all"+i]?"✓ COPIÉ !":"📋 TOUT COPIER"}
                      </button>
                      <button onClick={()=>confirmTrade(signal)} disabled={isConfirmed}
                        style={{flex:1,padding:"8px 0",background:isConfirmed?"#1e293b":bg,border:`1px solid ${isConfirmed?"#334155":bd}`,color:isConfirmed?"#475569":acc,borderRadius:6,cursor:isConfirmed?"default":"pointer",fontSize:10,fontWeight:700,letterSpacing:1}}>
                        {isConfirmed?"✓ CONFIRMÉ":"✅ ORDRE PLACÉ"}
                      </button>
                    </div>
                    <div style={{marginTop:8,background:"#080d17",borderRadius:5,padding:"8px 10px"}}>
                      {["1. Pivex → Sélectionner "+signal.asset,"2. "+signal.action+" → Qty: "+qty+" unités","3. SL: "+signal.sl+" | TP: "+signal.tp,"4. Confirmer → Cliquer ✅ ORDRE PLACÉ"].map((step,j)=>(
                        <div key={j} style={{fontSize:10,color:"#334155",lineHeight:1.6}}>{step}</div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {holdSignals.length>0&&(
        <div style={{marginBottom:16,display:"flex",gap:8,flexWrap:"wrap"}}>
          {holdSignals.map((s,i)=>(
            <div key={i} style={{background:"#0d1424",border:"1px solid #1e293b",borderRadius:6,padding:"8px 12px",display:"flex",gap:8,alignItems:"center"}}>
              <span style={{color:ASSETS[s.asset]?.color,fontWeight:700,fontSize:12}}>{s.asset}</span>
              <span style={{fontSize:10,color:"#334155"}}>⏸ HOLD</span>
              <span style={{fontSize:10,color:"#475569"}}>{s.reason}</span>
            </div>
          ))}
        </div>
      )}

      {log.length>0&&(
        <div style={S.section}>
          <div style={{...S.sectionTitle,display:"flex",justifyContent:"space-between"}}>
            <span>📋 JOURNAL</span>
            <button onClick={()=>setLog([])} style={{fontSize:9,color:"#475569",background:"none",border:"none",cursor:"pointer"}}>EFFACER</button>
          </div>
          <div style={{maxHeight:140,overflowY:"auto"}}>
            {log.map((l,i)=>(
              <div key={i} style={{padding:"5px 14px",borderBottom:"1px solid #0d1b2a",display:"flex",gap:10}}>
                <span style={{color:"#334155",fontSize:10,minWidth:60}}>{l.time}</span>
                <span style={{fontSize:11,color:l.type==="confirm"?"#4ade80":l.type==="ai"?"#a78bfa":l.type==="error"?"#f87171":"#475569"}}>{l.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── RISK MANAGER ──────────────────────────────────────────────────────────────
function RiskManager({prices}){
  const [capital,setCapital]=useState(PIVEX.INITIAL_CAPITAL.toString());
  const [riskPct,setRiskPct]=useState(PIVEX.RECOMMENDED_RISK_PCT.toString());
  const [asset,setAsset]=useState("NVDA");
  const [sl,setSl]=useState(""); const [tp,setTp]=useState("");
  const cap=parseFloat(capital)||0, rPct=parseFloat(riskPct)||0;
  const entryVal=prices[asset];
  const slVal=parseFloat(sl)||0, tpVal=parseFloat(tp)||0;
  const maxRisk=(cap*rPct)/100;
  const slDist=slVal>0?Math.abs(entryVal-slVal):0;
  const tpDist=tpVal>0?Math.abs(tpVal-entryVal):0;
  const posSize=slDist>0?Math.floor(maxRisk/slDist):0;
  const rrRatio=tpDist>0&&slDist>0?(tpDist/slDist).toFixed(2):null;
  const rc=rPct<=0.5?"#4ade80":rPct<=1?"#38bdf8":rPct<=2?"#facc15":rPct<=3?"#fb923c":"#f87171";
  return(
    <div style={S.content}>
      <div style={{...S.section,marginBottom:20,padding:20,background:"linear-gradient(135deg,#0c1a0a,#080d17)"}}>
        <div style={{fontSize:10,letterSpacing:3,color:"#86efac",marginBottom:16}}>⚙️ PARAMÈTRES PIVEX PRÉ-CONFIGURÉS</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10}}>
          {[["Capital","$5,000","#e2e8f0"],["Risque/trade","0.5% = $25","#4ade80"],["DD journalier max","$200 (4%)","#f87171"],["DD global max","$300 (6%)","#f87171"],["Objectif profit","$500 (10%)","#4ade80"],["R/R minimum","1:2 recommandé","#a78bfa"]].map(([l,v,c])=>(
            <div key={l} style={{background:"#080d17",borderRadius:6,padding:"10px 12px",borderLeft:`3px solid ${c}`}}>
              <div style={{fontSize:9,color:"#475569",marginBottom:4}}>{l}</div>
              <div style={{fontSize:14,fontWeight:700,color:c}}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
        <div style={{...S.section,flex:1,minWidth:260,padding:20}}>
          <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginBottom:12}}>CALCULATEUR</div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <FormField label="Capital ($)"><input type="number" value={capital} onChange={e=>setCapital(e.target.value)} style={S.input}/></FormField>
            <FormField label={`Risque/trade: ${riskPct}% = ${fmt(maxRisk)}`}><input type="range" min="0.1" max="3" step="0.1" value={riskPct} onChange={e=>setRiskPct(e.target.value)} style={{accentColor:rc,cursor:"pointer"}}/></FormField>
            <FormField label="Actif"><select value={asset} onChange={e=>setAsset(e.target.value)} style={S.input}>{Object.keys(ASSETS).map(k=><option key={k}>{k}</option>)}</select></FormField>
            <FormField label={`Stop Loss (prix actuel: ${prices[asset]})`}><input type="number" step="0.01" value={sl} onChange={e=>setSl(e.target.value)} style={{...S.input,borderColor:sl?"#f87171":"#334155"}}/></FormField>
            <FormField label="Take Profit"><input type="number" step="0.01" value={tp} onChange={e=>setTp(e.target.value)} style={{...S.input,borderColor:tp?"#4ade80":"#334155"}}/></FormField>
          </div>
        </div>
        <div style={{...S.section,flex:2,minWidth:280,padding:20}}>
          <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginBottom:12}}>RÉSULTATS</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {[["Risque Max ($)",fmt(maxRisk),"#f87171"],["Dist. SL",slDist>0?`${slDist.toFixed(2)} pts`:"—","#94a3b8"],["QUANTITÉ",posSize>0?`${posSize} unités`:"—","#38bdf8"],["Valeur position",posSize>0?fmt(posSize*entryVal):"—","#94a3b8"],["Levier",posSize>0&&cap>0?`${((posSize*entryVal)/cap).toFixed(1)}x`:"—","#a78bfa"],["R/R",rrRatio?`1:${rrRatio}`:"—",rrRatio>=2?"#4ade80":"#facc15"]].map(([l,v,c])=>(
              <div key={l} style={{background:"#080d17",borderRadius:6,padding:"10px 12px"}}>
                <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginBottom:4}}>{l}</div>
                <div style={{fontSize:15,fontWeight:700,color:c}}>{v}</div>
              </div>
            ))}
          </div>
          {rrRatio&&<div style={{marginTop:12,padding:"8px 12px",background:rrRatio>=2?"#064e3b":rrRatio>=1?"#422006":"#450a0a",borderRadius:6,fontSize:11,color:rrRatio>=2?"#4ade80":rrRatio>=1?"#facc15":"#f87171"}}>{rrRatio>=2?"✅ Excellent pour Pivex (R/R ≥ 2)":rrRatio>=1?"⚠️ Acceptable — essaie d'améliorer le TP":"❌ R/R trop faible — risque de ne pas atteindre l'objectif"}</div>}
          <div style={{marginTop:12,background:"#080d17",borderRadius:6,padding:"12px",fontSize:10,color:"#475569",lineHeight:2,border:"1px solid #1e293b"}}>
            <div style={{color:"#86efac",fontWeight:700,marginBottom:6}}>🏆 MATH DU DÉFI PIVEX à 0.5%/trade:</div>
            <div>• 20 trades gagnants (R/R 1:2) = <span style={{color:"#4ade80"}}>+20%</span></div>
            <div>• 10 trades gagnants + 10 perdants (R/R 1:2) = <span style={{color:"#4ade80"}}>+10% ✅</span></div>
            <div>• Tu peux perdre <span style={{color:"#f87171"}}>12 trades de suite</span> avant d'atteindre le DD global</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SHARED COMPONENTS ─────────────────────────────────────────────────────────
function TradeRow({trade,pnl,prices,onClose,onDelete,showStatus}){
  const asset=ASSETS[trade.asset];
  return(
    <div style={{...S.tradeRow,opacity:trade.status==="closed"?0.7:1}}>
      {showStatus&&<div style={{width:6,height:6,borderRadius:"50%",background:trade.status==="open"?"#4ade80":"#64748b",flexShrink:0}}/>}
      <div style={{...S.badge,background:trade.direction==="BUY"?"#064e3b":"#450a0a",color:trade.direction==="BUY"?"#4ade80":"#f87171"}}>{trade.direction}</div>
      <div style={{color:asset?.color,fontWeight:700,minWidth:70}}>{trade.asset}</div>
      {trade.source==="copilot"&&<span style={{fontSize:9,background:"#2e1065",color:"#a78bfa",padding:"1px 5px",borderRadius:3}}>IA</span>}
      <div style={S.tradeDetail}>x{trade.qty}</div>
      <div style={S.tradeDetail}>@ {trade.entryPrice}</div>
      {trade.sl&&<div style={{...S.tradeDetail,color:"#f87171"}}>SL:{trade.sl}</div>}
      {trade.tp&&<div style={{...S.tradeDetail,color:"#4ade80"}}>TP:{trade.tp}</div>}
      {trade.closeReason&&<div style={{fontSize:10,color:"#94a3b8"}}>{trade.closeReason}</div>}
      <div style={{...S.pnl,color:pnl>=0?"#4ade80":"#f87171"}}>{fmtPnL(pnl)}</div>
      {trade.status==="open"&&onClose&&<button onClick={()=>onClose(trade.id)} style={S.btnClose}>Clôturer</button>}
      {onDelete&&<button onClick={()=>onDelete(trade.id)} style={S.btnDel}>✕</button>}
    </div>
  );
}

function FormField({label,children}){
  return <div style={{display:"flex",flexDirection:"column",gap:5}}><label style={S.label}>{label}</label>{children}</div>;
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const S={
  root:{fontFamily:"'JetBrains Mono','Fira Code',monospace",background:"#0a0f1a",minHeight:"100vh",color:"#cbd5e1",fontSize:13},
  header:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 22px",borderBottom:"1px solid #1e293b",background:"#080d17"},
  headerLeft:{display:"flex",alignItems:"center",gap:12},
  logo:{fontSize:26,color:"#f59e0b"},
  logoTitle:{fontSize:15,fontWeight:700,letterSpacing:4,color:"#fbbf24"},
  logoSub:{fontSize:10,color:"#92400e",letterSpacing:2},
  headerRight:{display:"flex",alignItems:"center",gap:6},
  dot:{width:8,height:8,borderRadius:"50%",background:"#4ade80",boxShadow:"0 0 8px #4ade80"},
  liveText:{fontSize:10,color:"#4ade80",letterSpacing:3},
  ticker:{display:"flex",background:"#080d17",borderBottom:"1px solid #1e293b"},
  tickerCard:{flex:1,padding:"10px 14px",borderRight:"1px solid #1e293b"},
  tickerSym:{fontSize:12,fontWeight:700,letterSpacing:2},
  tickerPrice:{fontSize:18,fontWeight:700,marginTop:2},
  tabs:{display:"flex",borderBottom:"1px solid #1e293b",background:"#080d17",overflowX:"auto"},
  tab:{padding:"11px 18px",background:"transparent",border:"none",color:"#475569",cursor:"pointer",fontSize:11,letterSpacing:1,whiteSpace:"nowrap"},
  tabActive:{color:"#38bdf8",borderBottom:"2px solid #38bdf8",background:"#0d1424"},
  tabGold:{color:"#fbbf24",borderBottom:"2px solid #f59e0b",background:"#0d1424"},
  tabPurple:{color:"#a78bfa",borderBottom:"2px solid #7c3aed",background:"#0d1424"},
  content:{padding:18,maxWidth:1100,margin:"0 auto"},
  section:{background:"#0d1424",border:"1px solid #1e293b",borderRadius:8,overflow:"hidden"},
  sectionTitle:{padding:"9px 14px",fontSize:9,letterSpacing:3,color:"#38bdf8",borderBottom:"1px solid #1e293b",background:"#080d17",display:"flex",justifyContent:"space-between",alignItems:"center"},
  tradeRow:{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",borderBottom:"1px solid #131d2e",flexWrap:"wrap"},
  badge:{padding:"2px 6px",borderRadius:4,fontSize:10,fontWeight:700,letterSpacing:1},
  tradeDetail:{color:"#64748b",fontSize:11},
  pnl:{fontWeight:700,fontSize:12,marginLeft:"auto"},
  btnClose:{padding:"3px 8px",background:"#1e293b",border:"1px solid #334155",color:"#94a3b8",borderRadius:4,cursor:"pointer",fontSize:10},
  btnDel:{padding:"3px 7px",background:"transparent",border:"1px solid #450a0a",color:"#f87171",borderRadius:4,cursor:"pointer",fontSize:10},
  btnPurple:{background:"linear-gradient(135deg,#7c3aed,#6d28d9)",border:"none",color:"white",borderRadius:6,cursor:"pointer",fontFamily:"inherit",fontWeight:700,letterSpacing:1},
  empty:{padding:24,textAlign:"center",color:"#334155"},
  label:{fontSize:9,color:"#475569",letterSpacing:2},
  input:{background:"#0a0f1a",border:"1px solid #334155",color:"#e2e8f0",padding:"7px 10px",borderRadius:4,fontSize:12,fontFamily:"inherit",width:"100%",boxSizing:"border-box"},
  btnSubmit:{width:"100%",padding:"10px",background:"linear-gradient(135deg,#0ea5e9,#0284c7)",border:"none",color:"white",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700,letterSpacing:2,fontFamily:"inherit"},
};
