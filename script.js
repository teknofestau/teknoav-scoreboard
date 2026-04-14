// ════════════════════════════════════════════════════════════════
//  TEKNO AV – YARIŞMA SKORBOARDU   script.js
//
//  ╔══════════════════════════════════════════════════════════╗
//  ║  📅 YARIŞMA BAŞLANGIÇ ZAMANI — SADECE BU SATIRI DEĞİŞTİR ║
//  ║  Format: new Date("YYYY-MM-DDTHH:MM:SS")                  ║
const START_TIME = new Date("2026-04-22T14:00:00");
//  ╚══════════════════════════════════════════════════════════╝
//
//  🖼️ LOGOLARI DEĞİŞTİRMEK İÇİN: logos.js dosyasını güncelle
//     (index.html veya bu dosyaya dokunmana gerek yok)
// ════════════════════════════════════════════════════════════════

// ── AYARLAR ──────────────────────────────────────────────────
const SHEET_ID   = "1H0CHwZDOZ-TgvjJzrwSiDzgYTpn7J7kZZCNUbHFTag8";
const TEAM_SHEET = "Form Yanıtları 0";
const TASK_SHEETS = [
  { task:1, name:"Form Yanıtları 1" },
  { task:2, name:"Form Yanıtları 2" },
  { task:3, name:"Form Yanıtları 3" },
  { task:4, name:"Form Yanıtları 4" },
  { task:5, name:"Form Yanıtları 5" }
];
const TASK_NAMES = {
  1:"KÜTÜPHANE KRİPTOSU", 2:"AKADEMİK MANTIĞIN KİLİDİ",
  3:"UNUTULAN BİLGİSAYAR ŞİFRESİ", 4:"SOSYAL MEDYA", 5:"FİNAL"
};
const TEAM_COL    = "Takım adınızı giriniz.";
const TASK_POINTS = { 1:100, 2:50, 3:100, 4:100, 5:150 };
const MAX_SCORE   = Object.values(TASK_POINTS).reduce((a,b)=>a+b, 0); // 500

// ── GECİKME AYARLARI ─────────────────────────────────────────
// Hızlı mod: ilk 30 sn her 3sn, sonra her 6sn günceller

const REFRESH_FAST_MS = 3000;   // ilk periyot
const REFRESH_SLOW_MS = 6000;   // normal periyot
const FAST_DURATION   = 30000;  // 30 sn hızlı mod

const TEAM_EMOJIS = ["🤖","🦊","🐉","🦅","🐺","🦁","🐯","🐻","🦝","🐸","🦜","🐙"];

// ── STATE ─────────────────────────────────────────────────────
let winnerShown     = false;
let previousScores  = {};
let teamEmojiMap    = {};
let emojiCounter    = 0;
let tickerQueue     = [];
let tickerIdx       = 0;
let chartInstance   = null;
let isFetching      = false;   // çift istek önleyici
let lastSuccessTime = null;

// ── SHEET CACHE (aynı veri tekrar çekilmez) ───────────────────
// Her sheet için son satır sayısı ve verisi saklanır.
// Satır sayısı değişmemişse cached veri döner → gereksiz istek yok.
const sheetCache = {};   // { sheetName: { rowCount, data } }

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (typeof LOGO_ANADOLU   !== 'undefined') document.getElementById('imgAnadolu').src   = LOGO_ANADOLU;
  if (typeof LOGO_TEKNOFEST !== 'undefined') document.getElementById('imgTeknofest').src = LOGO_TEKNOFEST;

  initChart();
  startTimer();
  startTicker();
  runWithAdaptiveRefresh();
});

// ── ZAMANLAYICI ───────────────────────────────────────────────
function startTimer() {
  const valEl = document.getElementById('timerValue');
  const lblEl = document.getElementById('timerLabel');
  setInterval(() => {
    const diff = Date.now() - START_TIME.getTime();
    const abs  = Math.abs(diff);
    const sec  = Math.floor(abs / 1000);
    const hh   = String(Math.floor(sec/3600)).padStart(2,'0');
    const mm   = String(Math.floor((sec%3600)/60)).padStart(2,'0');
    const ss   = String(sec%60).padStart(2,'0');
    if (diff < 0) {
      if (valEl) valEl.textContent = `-${hh}:${mm}:${ss}`;
      if (lblEl) lblEl.textContent = '⏳ BAŞLAMASINA';
    } else {
      if (valEl) valEl.textContent = `${hh}:${mm}:${ss}`;
      if (lblEl) lblEl.textContent = '⏱ GEÇEN SÜRE';
    }
  }, 1000);
}

// ── ADAPTİF YENİLEME (gecikmeyi minimize eder) ────────────────
function runWithAdaptiveRefresh() {
  tick(); // ilk anlık çağrı
  // İlk 30 sn hızlı
  const fastInterval = setInterval(tick, REFRESH_FAST_MS);
  setTimeout(() => {
    clearInterval(fastInterval);
    setInterval(tick, REFRESH_SLOW_MS);
  }, FAST_DURATION);
}

// ── SHEETS OKUMA (paralel + cache bypass) ─────────────────────
async function fetchSheet(name) {

  
  const url = `https://opensheet.elk.sh/${SHEET_ID}/${encodeURIComponent(name)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Sheet okunamadı: ${name}`);
  return res.json();
}

// ── TÜM SHEET'LERİ PARALEL ÇEK ───────────────────────────────
// Eskiden sırayla: ~6×800ms = ~4800ms gecikme
// Şimdi paralel:  ~800ms (sadece en yavaş istek kadar)
async function fetchAllSheets() {
  const [teamRows, ...taskRows] = await Promise.all([
    fetchSheet(TEAM_SHEET),
    ...TASK_SHEETS.map(t => fetchSheet(t.name))
  ]);
  return { teamRows, taskRows };
}

// ── TIMESTAMP PARSE ───────────────────────────────────────────
function parseTs(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (!isNaN(d)) return d;
  const m = ts.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const dt = new Date(+m[3],+m[2]-1,+m[1],+(m[4]||0),+(m[5]||0),+(m[6]||0));
    if (!isNaN(dt)) return dt;
  }
  return null;
}

function emojiFor(team) {
  if (!teamEmojiMap[team]) { teamEmojiMap[team] = TEAM_EMOJIS[emojiCounter%TEAM_EMOJIS.length]; emojiCounter++; }
  return teamEmojiMap[team];
}

// ── SKOR HESAPLAMA ────────────────────────────────────────────
async function computeScores() {
  const { teamRows, taskRows } = await fetchAllSheets();
  const teamData = {};

  for (const row of teamRows) {
    const team = (row[TEAM_COL]||'').trim();
    if (!team) continue;
    if (!teamData[team]) teamData[team] = { done:new Set(), times:{}, finishTime:null, score:0 };
  }

  for (let i=0; i<TASK_SHEETS.length; i++) {
    const t    = TASK_SHEETS[i];
    const rows = taskRows[i];
    for (const row of rows) {
      const team = (row[TEAM_COL]||row['Takım adınızı giriniz']||'').trim();
      if (!team) continue;
      const ts = row['Zaman damgası']||row['Timestamp']||row['Zaman damgası ']||null;
      const dt = parseTs(ts);
      if (!teamData[team]) teamData[team] = { done:new Set(), times:{}, finishTime:null, score:0 };
      teamData[team].done.add(t.task);
      if (dt) {
        const prev = teamData[team].times[t.task];
        if (!prev || dt<prev) teamData[team].times[t.task] = dt;
      } else if (!teamData[team].times[t.task]) {
        teamData[team].times[t.task] = null;
      }
    }
  }

  const results = [];
  for (const [team, info] of Object.entries(teamData)) {
    info.score = Array.from(info.done).reduce((s,t)=>s+(TASK_POINTS[t]||0), 0);
    const needed = [1,2,3,4,5];
    if (needed.every(k=>info.done.has(k))) {
      const times = needed.map(k=>info.times[k]).filter(x=>x instanceof Date);
      if (times.length===5) info.finishTime = new Date(Math.max(...times.map(d=>d.getTime())));
    }
    results.push({ team, score:info.score, done:Array.from(info.done).sort((a,b)=>a-b), finishTime:info.finishTime });
  }

  const finishers = results.filter(r=>r.score>=MAX_SCORE);
  let winner = null;
  const withTime = finishers.filter(f=>f.finishTime instanceof Date).sort((a,b)=>a.finishTime-b.finishTime);
  if (withTime.length)       winner = withTime[0];
  else if (finishers.length) winner = finishers.sort((a,b)=>b.score-a.score||a.team.localeCompare(b.team))[0];

  results.sort((a,b)=>{
    if (b.score!==a.score) return b.score-a.score;
    const at=a.finishTime?a.finishTime.getTime():Infinity;
    const bt=b.finishTime?b.finishTime.getTime():Infinity;
    if (at!==bt) return at-bt;
    return a.team.localeCompare(b.team);
  });

  return { results, winner };
}

// ── GRAFİK ────────────────────────────────────────────────────
function initChart() {
  const ctx = document.getElementById('scoreChart');
  if (!ctx) return;
  chartInstance = new Chart(ctx, {
    type:'bar',
    data:{ labels:[], datasets:[{
      label:'Puan', data:[],
      backgroundColor:['rgba(255,215,64,.75)','rgba(77,170,255,.75)','rgba(155,89,255,.75)',
                        'rgba(57,255,143,.75)','rgba(255,61,106,.75)','rgba(18,232,255,.75)',
                        'rgba(255,140,0,.75)','rgba(200,200,200,.5)'],
      borderColor:    ['rgba(255,215,64,1)','rgba(77,170,255,1)','rgba(155,89,255,1)',
                       'rgba(57,255,143,1)','rgba(255,61,106,1)','rgba(18,232,255,1)',
                       'rgba(255,140,0,1)','rgba(200,200,200,.8)'],
      borderWidth:1, borderRadius:5
    }]},
    options:{
      responsive:true, maintainAspectRatio:false,
      animation:{ duration:700, easing:'easeOutQuart' },
      plugins:{
        legend:{ display:false },
        tooltip:{ backgroundColor:'rgba(6,10,22,.96)', titleColor:'#12E8FF', bodyColor:'#E8F4FF',
          borderColor:'rgba(18,232,255,.25)', borderWidth:1,
          titleFont:{ family:'Orbitron', size:10 },
          callbacks:{ label:ctx=>` ${ctx.raw} puan` } }
      },
      scales:{
        x:{ ticks:{ color:'rgba(232,244,255,.55)', font:{ family:'Exo 2', size:10, weight:'700' }, maxRotation:28 }, grid:{ color:'rgba(255,255,255,.04)' } },
        y:{ beginAtZero:true, max:MAX_SCORE, ticks:{ color:'rgba(232,244,255,.45)', font:{ family:'Orbitron', size:9 }, stepSize:100 }, grid:{ color:'rgba(255,255,255,.05)' } }
      }
    }
  });
}

function updateChart(results) {
  if (!chartInstance) return;
  const top = results.slice(0,8);
  chartInstance.data.labels = top.map(r=>{ const w=r.team.split(' '); return w.length>2?w.slice(0,2).join(' ')+'…':r.team; });
  chartInstance.data.datasets[0].data = top.map(r=>r.score);
  chartInstance.update();
}

// ── GÖREV LİSTESİ ─────────────────────────────────────────────
function renderTaskList(results) {
  const container = document.querySelector('.tasks');
  if (!container) return;
  const titleEl = container.querySelector('.side-title');
  container.innerHTML = '';
  if (titleEl) container.appendChild(titleEl);
  const taskCount={};
  for (let i=1;i<=5;i++) taskCount[i]=0;
  for (const r of results) for (const d of r.done) taskCount[d]=(taskCount[d]||0)+1;
  const total = results.length||1;
  for (let i=1;i<=5;i++) {
    const cnt=taskCount[i]||0, pct=Math.round((cnt/total)*100);
    let tCls='neu',tSym='–';
    if (cnt===0)      { tCls='bad'; tSym='!'; }
    else if (pct>=50) { tCls='ok';  tSym='✓'; }
    else              { tCls='mid'; tSym='◐'; }
    let rCls='task-row';
    if (i===5) rCls+=' danger-task';
    else if (pct>0&&pct<50) rCls+=' active-task';
    const div=document.createElement('div');
    div.className=rCls;
    div.innerHTML=`<span class="task-num">${i}</span><span class="task-name-text">GÖREV ${i}: ${TASK_NAMES[i]}</span><span class="task-count-badge">${cnt}/${total}</span><span class="task-tick ${tCls}">${tSym}</span>`;
    container.appendChild(div);
  }
}

// ── TICKER ────────────────────────────────────────────────────
function pushTicker(msg) {
  tickerQueue.push(msg);
  if (tickerQueue.length>30) tickerQueue.shift();
}

function startTicker() {
  setInterval(()=>{
    if (tickerQueue.length===0) return;
    const el = document.getElementById('tickerText');
    if (!el) return;
    tickerIdx=(tickerIdx+1)%tickerQueue.length;
    el.classList.add('fade-out');
    setTimeout(()=>{ el.textContent=tickerQueue[tickerIdx]; el.classList.remove('fade-out'); }, 360);
  }, 4500);
}

// ── DURUM GÖSTERGESİ ──────────────────────────────────────────
function setStatus(state) {
  // state: 'loading' | 'ok' | 'error'
  const dot = document.getElementById('refreshDot');
  const lbl = document.getElementById('refreshLabel');
  if (!dot||!lbl) return;
  dot.className = 'refresh-dot ' + (state==='loading'?'loading':state==='error'?'error':'');
  lbl.textContent = state==='loading'?'GÜNCELLENIYOR':state==='error'?'BAĞLANTI HATASI':'CANLI';
}

function updateLastUpdateTime() {
  const el = document.getElementById('lastUpdate');
  if (!el) return;
  const now = new Date();
  const h = String(now.getHours()).padStart(2,'0');
  const m = String(now.getMinutes()).padStart(2,'0');
  const s = String(now.getSeconds()).padStart(2,'0');
  el.textContent = `Son: ${h}:${m}:${s}`;
}

// ── WINNER ────────────────────────────────────────────────────
function showWinner(team, time) {
  document.getElementById('winnerName').textContent = team;
  document.getElementById('winnerTime').textContent = time?`Süre: ${time}`:'';
  document.getElementById('winnerPopup').classList.remove('hidden');
  if (typeof confetti==='function') {
    confetti({ particleCount:220, spread:130, origin:{y:.55} });
    setTimeout(()=>confetti({ particleCount:100, spread:80, origin:{y:.65} }), 800);
  }
}

// ── LEADERBOARD ───────────────────────────────────────────────
const rankCls   = i => ['gold','silver','bronze'][i]||'';
const pointsCls = i => ['gold','silver','bronze'][i]||'';

function renderLeaderboard(results, winner) {
  const el = document.getElementById('leaderboardRows');
  if (!el) return;

  // Puan değişimlerini yakala → ticker
  for (const r of results) {
    const prev = previousScores[r.team];
    if (prev!==undefined && r.score>prev) {
      const gained  = r.score-prev;
      const taskId  = Object.entries(TASK_POINTS).find(([,p])=>p===gained)?.[0];
      const taskLbl = taskId?` Görev ${taskId}'i Tamamladı`:'';
      pushTicker(`${emojiFor(r.team)} ${r.team}${taskLbl} → +${gained} Puan  |  Toplam: ${r.score} puan`);
    }
    previousScores[r.team]=r.score;
  }

  el.innerHTML='';
  results.forEach((r,i)=>{
    const missions=[1,2,3,4,5].map(g=>`<span class="m ${r.done.includes(g)?'done':''}">${'G'+g}</span>`).join('');
    const isWinner = winner&&winner.team===r.team;
    const allDone  = r.done.length===5;
    const sCls  = isWinner?'leader':allDone?'done-st':'';
    const sTxt  = isWinner?'👑 KAZANAN':allDone?'✅ BİTİRDİ':'⚡ Devam Ediyor';
    const pct   = Math.round((r.score/MAX_SCORE)*100);
    const div = document.createElement('div');
    div.className='row';
    div.innerHTML=`
      <div class="rank ${rankCls(i)}">${i+1}</div>
      <div class="team">
        <div class="team-badge">${emojiFor(r.team)}</div>
        <div class="team-info">
          <div class="team-name">${r.team}</div>
          <div class="team-progress"><div class="progress-bar" style="width:${pct}%"></div></div>
        </div>
      </div>
      <div class="missions">${missions}</div>
      <div class="points ${pointsCls(i)}">${r.score}</div>
      <div class="status ${sCls}">${sTxt}</div>
    `;
    el.appendChild(div);
  });

  const tickerEl=document.getElementById('tickerText');
  if (tickerEl&&tickerQueue.length>0) tickerEl.textContent=tickerQueue[tickerQueue.length-1];

  if (winner&&!winnerShown) {
    winnerShown=true;
    let shortTime='';
    if (winner.finishTime instanceof Date) {
      const sec=Math.floor((winner.finishTime-START_TIME)/1000);
      shortTime=[Math.floor(sec/3600),Math.floor((sec%3600)/60),sec%60].map(n=>String(n).padStart(2,'0')).join(':');
    }
    pushTicker(`🏁 KAZANAN: ${winner.team}${shortTime?' — SÜRE: '+shortTime:''}`);
    showWinner(winner.team, shortTime);
  }
}

// ── ANA DÖNGÜ ─────────────────────────────────────────────────
async function tick() {
  if (isFetching) return;   // önceki istek bitmeden yenisini başlatma
  isFetching = true;
  setStatus('loading');

  try {
    const { results, winner } = await computeScores();
    renderLeaderboard(results, winner);
    renderTaskList(results);
    updateChart(results);
    updateLastUpdateTime();
    setStatus('ok');
    lastSuccessTime = Date.now();
  } catch(e) {
    setStatus('error');
    const t=document.getElementById('tickerText');
    if (t) t.textContent='⚠️ Veri okunamadı – Sheets paylaşımını kontrol et.';
    console.error('tick error:', e);
  } finally {
    isFetching = false;
  }
}