const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const state = { markets:[], account:{watchlist:[]}, tab:'all', search:'', selected:'EUR/USD', period:'1D' };
let siteSettings = { siteTitle:'Forex Trading', siteTagline:'Your clear view of the currency markets.', paymentAmount:2000, announcement:'' };
const flags = { EUR:'🇪🇺', USD:'🇺🇸', GBP:'🇬🇧', JPY:'🇯🇵', CHF:'🇨🇭', AUD:'🇦🇺', CAD:'🇨🇦', NZD:'🇳🇿' };
const fmt = (value, digits=5) => Number(value).toFixed(digits);
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
async function api(url, options={}) { const response = await fetch(url,{headers:{'Content-Type':'application/json'}, credentials:'include', ...options}); const data=await response.json(); if(!response.ok) throw new Error(data.error || 'Something went wrong.'); return data; }
function pairOf(symbol){return state.markets.find(p=>p.symbol===symbol)}
function flagPair(pair){return `<span class="instrument-flags">${flags[pair.base]||'🌐'}<i>${flags[pair.quote]||'🌐'}</i></span>`}
function drawSpark(seed=1,color='#86b679'){
  let n=seed*47+9, points=[]; for(let i=0;i<25;i++){n=(n*16807)%2147483647;points.push(4+((n%1000)/1000)*15)}
  const coords=points.map((y,i)=>`${i*3},${y}`).join(' '); return `<svg class="row-spark" viewBox="0 0 72 24" preserveAspectRatio="none"><polyline points="${coords}" fill="none" stroke="${color}" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
}
function renderMarkets(){
  const list=state.markets.filter(p=> (state.tab==='all'||(state.tab==='watchlist'?state.account.watchlist.includes(p.symbol):['EUR/USD','GBP/USD','USD/JPY','USD/CHF'].includes(p.symbol))) && `${p.symbol} ${p.name}`.toLowerCase().includes(state.search.toLowerCase()));
  $('#showingCount').textContent=list.length;
  $('#marketRows').innerHTML=list.map((p,i)=>{const up=p.change>=0, saved=state.account.watchlist.includes(p.symbol), digits=p.quote==='JPY'?3:5, bid=p.price-p.spread/10000, ask=p.price+p.spread/10000;
    return `<tr class="market-row"><td><div class="instrument">${flagPair(p)}<span class="instrument-name"><b>${p.symbol}</b><small>${p.name}</small></span></div></td><td>${fmt(bid,digits)}</td><td>${fmt(ask,digits)}</td><td><span class="delta-pill ${up?'up':'down'}">${up?'+':''}${p.change.toFixed(2)}%</span></td><td>${drawSpark(i+2,up?'#83b37c':'#d58e84')}</td><td>${p.spread.toFixed(1)} pips</td><td><button class="row-star ${saved?'saved':''}" aria-label="${saved?'Remove from':'Add to'} watchlist" data-watch="${p.symbol}">${saved?'★':'☆'}</button></td></tr>`;
  }).join('') || `<tr><td colspan="7" class="empty-position">No pairs match this view.</td></tr>`;
}
function renderMovers(){const sorted=[...state.markets].sort((a,b)=>Math.abs(b.change)-Math.abs(a.change)).slice(0,3);$('#moversList').innerHTML=sorted.map(p=>`<div class="mover-row"><div class="mover-pair"><span class="mover-flag">${flags[p.base]}</span>${p.symbol}</div><div class="mover-price">${fmt(p.price,p.quote==='JPY'?3:5)}</div><div class="mover-change ${p.change>=0?'positive':'negative'}">${p.change>=0?'+':''}${p.change.toFixed(2)}%</div></div>`).join('');}
function updateChart(){const p=pairOf(state.selected);if(!p)return;const digits=p.quote==='JPY'?3:5;$('#chartSymbol').textContent=p.symbol;$('#chartName').textContent=p.name;$('#chartPrice').textContent=fmt(p.price,digits);$('#chartChange').textContent=`${p.change>=0?'+':''}${p.change.toFixed(2)}%`;$('#chartChange').className=`chart-change ${p.change>=0?'positive':'negative'}`;$('#chartFlags').innerHTML=`${flags[p.base]}<i>${flags[p.quote]}</i>`;drawChart(p);}
function drawChart(pair){const canvas=$('#priceChart'),ctx=canvas.getContext('2d'),rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;ctx.scale(dpr,dpr);const w=rect.width,h=rect.height;let n=92017+state.selected.length*197;const vals=[];let value=.48;for(let i=0;i<80;i++){n=(n*16807)%2147483647;value+=(n/2147483647-.48)*.055+(i>41?.00045:-.00004);vals.push(Math.max(.1,Math.min(.9,value)));}const color=pair.change>=0?'#77a96e':'#cf8b80';ctx.beginPath();vals.forEach((v,i)=>{const x=i*w/(vals.length-1),y=h-v*(h-8)-4;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.lineWidth=2;ctx.strokeStyle=color;ctx.stroke();const grad=ctx.createLinearGradient(0,0,0,h);grad.addColorStop(0,pair.change>=0?'rgba(134,184,117,.18)':'rgba(207,139,128,.17)');grad.addColorStop(1,'rgba(255,255,255,0)');ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();ctx.fillStyle=grad;ctx.fill();const y=h-vals.at(-1)*(h-8)-4;ctx.beginPath();ctx.arc(w-2,y,3.2,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}
function renderAll(){renderMarkets();renderMovers();updateChart();updateConverter();if(!$('#academySimView').hidden)renderSim();}
const fallbackRates={USD:1,EUR:1/1.08432,GBP:1/1.27186,JPY:149.824,CHF:1/.88342,AUD:1/.65217,CAD:1/1.36195,NZD:1/.60983};
function updateConverter(){if(!state.markets.length)return;const from=$('#fromCurrency').value,to=$('#toCurrency').value;const rate=currencyRate(from,to),amount=Number($('#convertAmount').value)||0;$('#convertResult').value=(amount*rate).toLocaleString('en-US',{maximumFractionDigits:2});$('#rateText').textContent=`Indicative rate · 1 ${from} = ${rate.toFixed(4)} ${to}`;}
function currencyRate(from,to){const inUsd=cur=>{if(cur==='USD')return 1;const direct=state.markets.find(p=>p.base===cur&&p.quote==='USD');if(direct)return direct.price;const inverse=state.markets.find(p=>p.base==='USD'&&p.quote===cur);if(inverse)return 1/inverse.price;return fallbackRates[cur]};return inUsd(from)/inUsd(to)}
let toastTimer;function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2600)}
async function refresh(){try{const [market,account]=await Promise.all([api('/api/markets'),api('/api/account')]);state.markets=market.markets;state.account=account;renderAll();}catch(error){toast(`Unable to load market data: ${error.message}`)}}
$('#pairSearch').addEventListener('input',e=>{state.search=e.target.value;renderMarkets()});
$$('.tab').forEach(tab=>tab.addEventListener('click',()=>{$$('.tab').forEach(t=>t.classList.toggle('active',t===tab));state.tab=tab.dataset.tab;renderMarkets()}));
$('#marketRows').addEventListener('click',async e=>{const star=e.target.closest('[data-watch]');if(!star)return;const symbol=star.dataset.watch,saved=!state.account.watchlist.includes(symbol);try{const result=await api(`/api/watchlist/${encodeURIComponent(symbol)}`,{method:'PATCH',body:JSON.stringify({saved})});state.account.watchlist=result.watchlist;renderMarkets();toast(saved?`${symbol} added to your watchlist`:`${symbol} removed from your watchlist`)}catch(error){toast(error.message)}});
$$('.time-controls button[data-period]').forEach(button=>button.addEventListener('click',()=>{$$('.time-controls button[data-period]').forEach(b=>b.classList.toggle('selected',b===button));state.period=button.dataset.period;drawChart(pairOf(state.selected));}));
$$('#fromCurrency,#toCurrency,#convertAmount').forEach(el=>el.addEventListener('input',updateConverter));
$('#swapCurrencies').addEventListener('click',()=>{const from=$('#fromCurrency'),to=$('#toCurrency'),value=from.value;from.value=to.value;to.value=value;updateConverter()});
$('#refreshConversion').addEventListener('click',()=>{updateConverter();toast('Conversion rate refreshed')});
function unlockPayment(registration){currentUserId=registration.id||'guest';$('#registrationForm').hidden=true;$('#loginForm').hidden=true;$('#authSwitch').hidden=true;$('#registrationMessage').textContent='';$('#paymentForm').hidden=false;$('#paymentForm').querySelector('button').disabled=false;$('#paymentPhone').value=registration.phone||'';$('#paymentLock').textContent=`Registered as ${registration.fullName}. Complete payment to activate your account.`;$('#registeredPayer').textContent=`${registration.fullName} · ${registration.email}`;$('#profileName').textContent=registration.fullName;$('#profileStatus').textContent='Awaiting payment';$('#accountMenuEmail').textContent=registration.email;$('#logoutButton').hidden=false;startPaymentPolling(registration.id);}
function startPaymentPolling(userId){if(paymentPollTimer) clearInterval(paymentPollTimer);paymentPollTimer=setInterval(async()=>{try{const res=await api('/api/registration/me');if(res.registration.paymentStatus==='paid'){clearInterval(paymentPollTimer);$('#paymentForm').hidden=true;$('#paymentLock').textContent='Payment confirmed! Account activated.';$('#profileStatus').textContent='Active';$('#academyTab').hidden=false;toast('Payment confirmed. Account activated!');openAcademy();}else if(res.registration.paymentStatus==='pending'){$('#paymentLock').textContent='Payment sent. Waiting for confirmation...';}}catch(e){}},5000);}
let paymentPollTimer;
function unlockFullAccess(registration){currentUserId=registration.id||'guest';$('#registrationForm').hidden=true;$('#loginForm').hidden=true;$('#authSwitch').hidden=true;$('#registrationMessage').textContent='';$('#paymentForm').hidden=true;$('#paymentLock').textContent='';$('#profileName').textContent=registration.fullName;$('#profileStatus').textContent='Active';$('#accountMenuEmail').textContent=registration.email;$('#logoutButton').hidden=false;$('#academyTab').hidden=false;openAcademy();}
let authMode='register';
function applySettings(s){siteSettings={...siteSettings,...s};const amount=Number(siteSettings.paymentAmount).toLocaleString('en-US');document.title=`${siteSettings.siteTitle} — Market overview`;$('#heroTitle').textContent=siteSettings.siteTitle;$('#heroCopy').textContent=siteSettings.siteTagline;$('#registerHeading').textContent=`Create account & pay KES ${amount}`;$('#paymentHeading').textContent=`Pay KES ${amount} via M-Pesa`;$('#depositAmount').textContent=amount;const banner=$('#announcement');if(siteSettings.announcement){banner.textContent=siteSettings.announcement;banner.hidden=false;}else{banner.hidden=true;}const locked=$('#academyLocked');if(locked)locked.textContent=`Complete your KES ${amount} payment to unlock FX.`;}
function academyVideo(lesson, index) {
  if (!(lesson.video&&lesson.video.url)||lesson.video) return '';
  const autoplay = index === 0 ? '&autoplay=1&mute=1' : '';
  return `<div class="academy-video"><iframe src="https://www.youtube-nocookie.com/embed/${(lesson.video&&lesson.video.url)||lesson.video}?rel=0${autoplay}&playsinline=1&modestbranding=1" title="${escapeHtml(lesson.title)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
}
function formatLesson(raw) {
  return String(raw).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').split(/\n{2,}/).map(block => {
    if (/^-\s/m.test(block)) {
      const items = block.split('\n').filter(line => line.trim() !== '');
      return `<ul class="academy-body-list">${items.map(it => `<li>${it.replace(/^-\s+/, '')}</li>`).join('')}</ul>`;
    }
    return `<p>${block.replace(/\n/g, ' ')}</p>`;
  }).join('');
}
function quizName(title, i){return 'qz' + (title + ':' + i).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1000000007, 7);}
function renderQuiz(title, questions){
  return `<div class="academy-quiz" data-title="${escapeHtml(title)}"><div class="academy-quiz-head"><span class="academy-quiz-badge">Quiz</span><h4>Check your understanding</h4></div>` +
    questions.map((q, i) => { const name = quizName(title, i); return `<div class="quiz-q" data-answer="${q.a}"><p class="quiz-q-text">${escapeHtml(q.q)}</p>${q.o.map((o, j) => `<label class="quiz-opt"><input type="radio" name="${name}" value="${j}"><span>${escapeHtml(o)}</span></label>`).join('')}</div>`; }).join('') +
    `<div class="quiz-actions"><button type="button" class="quiz-submit">Check answers</button><span class="quiz-score" aria-live="polite"></span></div></div>`;
}
let academyModules = [];
let acadFlat = [];
let playerIndex = -1;
let playerStep = 'lesson';
let currentUserId = '';
let academyPassed = {};
function progressKey(){ return 'fxke_progress_' + (currentUserId || 'guest'); }
function loadProgress(){ try { const raw = JSON.parse(localStorage.getItem(progressKey()) || '[]'); const o = {}; if (Array.isArray(raw)) raw.forEach(t => o[t] = true); return o; } catch(e){ return {}; } }
function saveProgress(){ try { localStorage.setItem(progressKey(), Object.keys(academyPassed)); } catch(e){} }
function rebuildFlat(modules){ acadFlat = []; modules.forEach((m, mi) => m.lessons.forEach((l, li) => acadFlat.push({ title: l.title, mi, li, index: acadFlat.length }))); }
function isPassed(title){ return Boolean(academyPassed[title]); }
function isUnlocked(i){ return i === 0 || isPassed(acadFlat[i - 1].title); }
function progressCount(){ return acadFlat.filter(f => isPassed(f.title)).length; }
function nextLearningIndex(){ return acadFlat.findIndex(f => !isPassed(f.title) && isUnlocked(f.index)); }
function lessonByTitle(title){ return academyModules.flatMap(m => m.lessons).find(l => l.title === title); }
function lessonBodyHTML(lesson, li){
  const learn = lesson.objective ? `<div class="academy-learn"><span class="academy-learn-label">What you'll learn</span><p class="academy-lesson-learn">${lesson.objective}</p></div>` : '';
  const body = lesson.body ? `<div class="academy-body">${formatLesson(lesson.body)}</div>` : '';
  return `<div class="player-lesson-head"><span class="academy-level">${lesson.minutes} min read</span><h3>${escapeHtml(lesson.title)}</h3><p>Step 1 — read the lesson, then take the quiz to continue.</p></div>${learn}${body}${academyVideo(lesson, li)}<div class="player-quiz-wrap" id="playerQuizWrap" hidden></div>`;
}
function renderSyllabus(){
  if (!acadFlat.length) return;
  const total = acadFlat.length, done = progressCount(), nextUp = nextLearningIndex(), pct = Math.round(done / total * 100);
  const totalMin = academyModules.reduce((n, m) => n + m.lessons.reduce((s, l) => s + l.minutes, 0), 0);
  $('#academyStats').innerHTML = `<div class="academy-stat"><b>${academyModules.length}</b><span>Modules</span></div><div class="academy-stat"><b>${done}<i class="syl-sub">/${total}</i></b><span>Topics done</span></div><div class="academy-stat"><b>${Math.round(totalMin / 60 * 10) / 10}h</b><span>Total time</span></div><div class="academy-stat"><b>${pct}%</b><span>Complete</span></div>`;
  const cont = $('#continueBtn');
  if (done === total) { cont.textContent = 'Course complete — all topics passed ✓'; cont.disabled = true; }
  else { cont.textContent = nextUp === -1 ? 'Continue learning →' : `Continue: ${acadFlat[nextUp].title} →`; cont.disabled = false; }
  const row = (l, g) => { const passed = isPassed(l.title), unlocked = isUnlocked(g.index), next = g.index === nextUp; const state = passed ? 'done' : unlocked ? (next ? 'now' : 'open') : 'locked'; const label = passed ? 'Completed' : unlocked ? (next ? 'Start here' : 'Ready to learn') : 'Complete the previous topic'; const icon = passed ? '✓' : unlocked ? '▶' : '🔒'; return `<button class="syl-row ${state}" type="button" data-flat="${g.index}"><span class="syl-no">${String(g.index + 1).padStart(2, '0')}</span><span class="syl-title"><b>${escapeHtml(l.title)}</b><small>${l.minutes} min · ${label}</small></span><span class="syl-go" aria-hidden="true">${icon}</span></button>`; };
  $('#academyModules').innerHTML = academyModules.map((m, mi) => {
    const mDone = m.lessons.filter(l => isPassed(l.title)).length;
    return `<article class="academy-module"><header class="academy-module-head"><div class="academy-module-no">${String(mi + 1).padStart(2, '0')}</div><div class="academy-module-title"><h3>${escapeHtml(m.title)}</h3><p>${escapeHtml(m.summary)}</p></div><div class="academy-module-meta"><span class="academy-level">${escapeHtml(m.level)}</span><small>${mDone}/${m.lessons.length} topics done</small></div></header><ul class="academy-lessons">${m.lessons.map(l => { const g = acadFlat.find(f => f.title === l.title); return row(l, g); }).join('')}</ul></article>`;
  }).join('');
}
function renderAcademy(modules){
  academyModules = modules;
  rebuildFlat(modules);
  academyPassed = loadProgress();
  showSyllabus();
}
function showSyllabus(){
  renderSyllabus();
  $('#academyPlayer').hidden = true;
  $('#academySyllabus').hidden = false;
  playerIndex = -1;
  $('#academy').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function openLesson(i){
  if (i < 0 || i >= acadFlat.length) return;
  if (!isUnlocked(i)) { toast('Complete the previous topic first to unlock this one.'); return; }
  playerIndex = i;
  playerStep = 'lesson';
  const f = acadFlat[i], m = academyModules[f.mi], lesson = m.lessons[f.li];
  $('#playerModule').textContent = `Module ${f.mi + 1} · ${m.title}`;
  $('#playerPosition').textContent = `Topic ${i + 1} of ${acadFlat.length}`;
  $('#playerContent').innerHTML = lessonBodyHTML(lesson, f.li);
  $('#playerPrev').hidden = i === 0;
  $('#playerNext').hidden = false;
  $('#playerNext').disabled = false;
  $('#playerNext').textContent = 'Take the quiz →';
  $('#academySyllabus').hidden = true;
  $('#academyPlayer').hidden = false;
  $('#academyPlayer').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function stepToQuiz(){
  const f = acadFlat[playerIndex], lesson = academyModules[f.mi].lessons[f.li];
  const wrap = $('#playerQuizWrap');
  wrap.innerHTML = renderQuiz(lesson.title, lesson.quiz || []);
  wrap.hidden = false;
  playerStep = 'quiz';
  if (isPassed(lesson.title)) {
    $('#playerNext').hidden = false;
    $('#playerNext').disabled = false;
    $('#playerNext').textContent = playerIndex === acadFlat.length - 1 ? 'Finish course ✓' : 'Next topic →';
  } else {
    $('#playerNext').hidden = true;
  }
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function resetQuiz(quiz, title){
  const lesson = lessonByTitle(title);
  if (!lesson) return;
  const holder = document.createElement('div');
  holder.innerHTML = renderQuiz(title, lesson.quiz || []);
  quiz.replaceWith(holder.firstElementChild);
}
function handleNext(){
  if (playerStep === 'lesson') { stepToQuiz(); return; }
  if (playerIndex === acadFlat.length - 1) { showSyllabus(); return; }
  openLesson(playerIndex + 1);
}
function handlePrev(){
  if (playerStep === 'quiz') {
    playerStep = 'lesson';
    $('#playerQuizWrap').hidden = true;
    $('#playerNext').hidden = false;
    $('#playerNext').disabled = false;
    $('#playerNext').textContent = 'Take the quiz →';
    return;
  }
  if (playerIndex > 0) openLesson(playerIndex - 1);
}
let academyLoaded=false,academyLoading=false;
async function openAcademy(){const panel=$('#academy');panel.hidden=false;$('#academyLocked').hidden=true;$('#academyBadge').hidden=false;$('#academyClose').hidden=false;$('#academyTitle').textContent='FXKE';panel.scrollIntoView({behavior:'smooth',block:'start'});if(academyLoaded||academyLoading)return;academyLoading=true;$('#academyModules').innerHTML='<p class="academy-loading">Loading your lessons…</p>';try{const data=await api('/api/academy');renderAcademy(data.modules);academyLoaded=true;}catch(error){$('#academyModules').innerHTML='';$('#academyLocked').hidden=false;$('#academyLocked').textContent=error.message;toast(error.message)}finally{academyLoading=false;}}
function closeAcademy(){$('#academy').hidden=true;academyLoaded=false;}
$('#academyTab').addEventListener('click',openAcademy);
$('#academyClose').addEventListener('click',closeAcademy);
$('#academyModules').addEventListener('click', e => {
  const row = e.target.closest('.syl-row');
  if (!row) return;
  const i = Number(row.dataset.flat);
  if (!isUnlocked(i)) { toast('Complete the previous topic first to unlock this one.'); return; }
  openLesson(i);
});
$('#academyLessonsView').addEventListener('click', e => {
  const btn = e.target.closest('.quiz-submit');
  if (!btn) return;
  const quiz = btn.closest('.academy-quiz');
  if (!quiz || !quiz.dataset.title) return;
  const title = quiz.dataset.title;
  if (quiz.dataset.failed === '1') { resetQuiz(quiz, title); return; }
  const questions = [...quiz.querySelectorAll('.quiz-q')];
  const total = questions.length;
  let correct = 0;
  questions.forEach(qBlock => {
    const name = 'input[name="' + qBlock.querySelector('input').name + '"]';
    const answer = Number(qBlock.dataset.answer);
    const chosen = quiz.querySelector(name + ':checked');
    quiz.querySelectorAll(name).forEach(input => {
      const label = input.closest('.quiz-opt');
      if (Number(input.value) === answer) label.classList.add('correct');
      else if (input.checked) label.classList.add('wrong');
      input.disabled = true;
    });
    if (chosen && Number(chosen.value) === answer) correct++;
  });
  const need = Math.ceil(total / 2);
  const pass = correct >= need;
  const scoreEl = quiz.querySelector('.quiz-score');
  if (pass) {
    if (!isPassed(title)) { academyPassed[title] = true; saveProgress(); toast('Topic completed — the next one is unlocked!'); }
    scoreEl.textContent = `${correct} of ${total} correct. ${correct === total ? 'Perfect!' : 'Well done — you passed.'}`;
    scoreEl.classList.add('great');
    btn.disabled = true;
    btn.textContent = correct === total ? 'Perfect score!' : 'Passed';
    $('#playerNext').hidden = false;
    $('#playerNext').disabled = false;
    $('#playerNext').textContent = playerIndex === acadFlat.length - 1 ? 'Finish course ✓' : 'Next topic →';
  } else {
    scoreEl.textContent = `You scored ${correct} of ${total}. You need at least ${need} to pass. Review the lesson and retake.`;
    scoreEl.classList.remove('great');
    quiz.dataset.failed = '1';
    btn.textContent = 'Retake quiz';
    btn.disabled = false;
  }
});
$('#playerNext').addEventListener('click', handleNext);
$('#playerPrev').addEventListener('click', handlePrev);
$('#playerBack').addEventListener('click', showSyllabus);
$('#continueBtn').addEventListener('click', () => { const i = nextLearningIndex(); i === -1 ? showSyllabus() : openLesson(i); });
$$('.academy-tab-btn').forEach(btn => btn.addEventListener('click', () => {
  $$('.academy-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
  const isSim = btn.dataset.atab === 'simulator';
  $('#academyLessonsView').hidden = isSim;
  $('#academySimView').hidden = !isSim;
  if (isSim) renderSim();
}));
const sim = { cash: 1000, positions: [], closed: [] };
const SIM_KEY = 'fxke_sim_v2';
function loadSim(){try{const saved = JSON.parse(localStorage.getItem(SIM_KEY) || '{}');sim.cash = Number(saved.cash) || 1000;sim.positions = Array.isArray(saved.positions) ? saved.positions : [];sim.closed = Array.isArray(saved.closed) ? saved.closed : [];}catch(e){sim.cash = 1000;sim.positions = [];sim.closed = [];}}
function saveSim(){try{localStorage.setItem(SIM_KEY, JSON.stringify(sim));}catch(e){}}
function fmtUsd(v){return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });}
function signedUsd(v){return (v >= 0 ? '+' : '') + fmtUsd(v);}
function spreadPrice(p){return p.quote === 'JPY' ? p.spread * 0.01 : p.spread * 0.0001;}
function digitsOf(p){return p.quote === 'JPY' ? 3 : 5;}
function positionPnl(pos){const p = pairOf(pos.symbol); if (!p) return 0; const exit = pos.dir === 'long' ? p.price - spreadPrice(p) / 2 : p.price + spreadPrice(p) / 2; return pos.dir === 'long' ? pos.size * (exit - pos.entry) / pos.entry : pos.size * (pos.entry - exit) / pos.entry;}
function pnlClass(v){return v > 0 ? 'positive' : v < 0 ? 'negative' : 'neutral';}
function placeSimTrade(dir, rawSize){
  const symbol = state.simPair, p = pairOf(symbol);
  if (!p) { toast('Market data is still loading.'); return; }
  const size = Math.round(Number(rawSize));
  if (!(size >= 10)) { toast('Minimum size is $10.'); return; }
  if (size > sim.cash) { toast(`You only have ${fmtUsd(Math.floor(sim.cash))} available.`); return; }
  const mid = p.price, half = spreadPrice(p) / 2;
  const entry = dir === 'long' ? mid + half : mid - half;
  sim.cash -= size;
  sim.positions.push({ id: Date.now() + '' + Math.floor(Math.random() * 900) + Math.floor(Math.random() * 90), symbol, dir, size, entry, opened: new Date().toISOString() });
  saveSim(); renderSim();
  toast(`${dir === 'long' ? 'Bought' : 'Sold'} ${symbol} ${fmt(entry, digitsOf(p))} · ${fmtUsd(size)} virtual`);
}
function closePosition(id){
  const idx = sim.positions.findIndex(pos => pos.id === id);
  if (idx < 0) return;
  const pos = sim.positions[idx], p = pairOf(pos.symbol);
  const pnl = p ? positionPnl(pos) : 0;
  sim.cash += pos.size + pnl;
  sim.closed.unshift({ symbol: pos.symbol, dir: pos.dir, size: pos.size, entry: pos.entry, exit: p ? p.price : pos.entry, pnl: Math.round(pnl * 100) / 100, closed: new Date().toISOString() });
  sim.positions.splice(idx, 1);
  saveSim(); renderSim();
  toast(`Closed ${pos.symbol} · ${signedUsd(pnl)}`);
}
function renderSim(){
  if ($('#academySimView').hidden) return;
  const sel = $('#simPair');
  if (state.markets.length && sel.options.length !== state.markets.length) {
    const current = state.simPair || sel.value;
    sel.innerHTML = state.markets.map(p => `<option value="${p.symbol}">${p.symbol}</option>`).join('');
    const target = state.markets.some(p => p.symbol === current) ? current : state.markets[0].symbol;
    sel.value = target; state.simPair = target;
  }
  let float = 0;
  sim.positions.forEach(pos => { float += positionPnl(pos); });
  const realized = sim.closed.reduce((n, r) => n + r.pnl, 0);
  $('#simEquity').textContent = fmtUsd(sim.cash + float);
  $('#simCash').textContent = fmtUsd(sim.cash);
  $('#simFloat').textContent = signedUsd(float);
  $('#simRealized').textContent = signedUsd(realized);
  $('#simPositions').innerHTML = sim.positions.length === 0 ? '<p class="sim-empty">No open positions. Place one above.</p>'
    : sim.positions.map(pos => { const p = pairOf(pos.symbol); const pnl = positionPnl(pos); const digits = p ? digitsOf(p) : 5; return `
<div class="position-row">
  <div class="pos-main"><span class="pos-symbol">${pos.symbol}</span><span class="pos-dir ${pos.dir}">${pos.dir === 'long' ? 'LONG' : 'SHORT'}</span><small>${fmtUsd(pos.size)}</small></div>
  <div class="pos-prices"><span>${fmt(pos.entry, digits)}</span><span class="pnl ${pnlClass(pnl)}">${signedUsd(pnl)}</span></div>
  <button class="sim-close" type="button" data-close="${pos.id}">Close</button>
</div>`; }).join('');
  $('#simHistory').innerHTML = sim.closed.length === 0 ? '<p class="sim-empty">No trades yet.</p>'
    : sim.closed.slice(0, 25).map(r => `
<div class="history-row"><span class="pos-symbol">${r.symbol}</span><span class="pos-dir ${r.dir}">${r.dir === 'long' ? 'LONG' : 'SHORT'}</span><small>${new Date(r.closed).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small><span class="pnl ${pnlClass(r.pnl)}">${signedUsd(r.pnl)}</span></div>`).join('');
}
$('#simForm').addEventListener('submit', e => { e.preventDefault(); placeSimTrade($('#simDir').value, $('#simSize').value); });
$('#simPositions').addEventListener('click', e => { const btn = e.target.closest('[data-close]'); if (btn) closePosition(btn.dataset.close); });
$('#simPair').addEventListener('change', e => { state.simPair = e.target.value; });
$$('.sim-quick button').forEach(btn => btn.addEventListener('click', () => { $('#simSize').value = btn.dataset.size; }));
$('#authSwitch').addEventListener('click',()=>{authMode=authMode==='register'?'login':'register';$('#registrationForm').hidden=authMode==='login';$('#loginForm').hidden=authMode!=='login';$('#authPrompt').textContent=authMode==='login'?'New to Forex Trading?':'Already registered?';$('#authSwitch').textContent=authMode==='login'?'Create account':'Sign in';$('#registrationMessage').textContent='';$('#loginMessage').textContent=''});
$('#registrationForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button'),message=$('#registrationMessage');button.disabled=true;message.textContent='Creating your account…';try{const result=await api('/api/register',{method:'POST',body:JSON.stringify({fullName:$('#registerName').value,email:$('#registerEmail').value,phone:$('#registerPhone').value,password:$('#registerPassword').value})});$('#registerPassword').value='';unlockPayment(result.registration)}catch(error){message.textContent=error.message}finally{button.disabled=false}});
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button'),message=$('#loginMessage');button.disabled=true;message.textContent='Signing in…';try{const result=await api('/api/login',{method:'POST',body:JSON.stringify({email:$('#loginEmail').value,password:$('#loginPassword').value})});$('#loginPassword').value='';if(result.registration.paymentStatus==='paid'){unlockFullAccess(result.registration)}else{unlockPayment(result.registration)}}catch(error){message.textContent=error.message}finally{button.disabled=false}});
$('#paymentForm').addEventListener('submit',async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button'),message=$('#paymentMessage');const phone=$('#paymentPhone').value.trim();if(!phone){message.textContent='Enter your M-Pesa phone number.';return}button.disabled=true;message.textContent='Sending payment prompt…';try{const result=await api('/api/payments/stkpush',{method:'POST',body:JSON.stringify({phone})});message.textContent=result.message;button.textContent='Prompt sent';}catch(error){message.textContent=error.message;button.disabled=false}});
$('#profileButton').addEventListener('click',()=>{const menu=$('#accountMenu'),open=menu.hidden;menu.hidden=!open;$('#profileButton').setAttribute('aria-expanded',String(open))});
$('#logoutButton').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST',body:JSON.stringify({})});if(paymentPollTimer) clearInterval(paymentPollTimer);$('#accountMenu').hidden=true;$('#profileButton').setAttribute('aria-expanded','false');$('#profileName').textContent='Trading account';$('#profileStatus').textContent='Not connected';$('#accountMenuEmail').textContent='Signed out';$('#logoutButton').hidden=true;$('#paymentForm').hidden=true;$('#paymentMessage').textContent='';$('#paymentLock').textContent='Sign in or register to continue to payment.';$('#registerName').value='';$('#registerEmail').value='';$('#registerPhone').value='';$('#registrationForm').hidden=false;$('#authSwitch').hidden=false;authMode='register';$('#authPrompt').textContent='Already registered?';$('#authSwitch').textContent='Sign in';$('#academyTab').hidden=true;$('#academy').hidden=true;$('#academyModules').innerHTML='';$('#academyStats').innerHTML='';$('#academyLocked').hidden=false;$('#academyLocked').textContent=`Complete your KES ${Number(siteSettings.paymentAmount).toLocaleString('en-US')} payment to unlock FX.`;academyLoaded=false;toast('You are signed out')}catch(error){toast(error.message)}});
$('#filterToggle').addEventListener('click',()=>{const tabs=$('.table-tabs');tabs.scrollIntoView({behavior:'smooth',block:'center'});toast('Choose All pairs, Watchlist, or Majors below')});
const sidebar=$('.sidebar'),backdrop=$('#sidebarBackdrop'),hamburger=$('#hamburgerBtn');
function openDrawer(){sidebar.classList.add('open');backdrop.hidden=false;document.body.classList.add('drawer-open');hamburger.setAttribute('aria-expanded','true')}
function closeDrawer(){sidebar.classList.remove('open');backdrop.hidden=true;document.body.classList.remove('drawer-open');hamburger.setAttribute('aria-expanded','false')}
hamburger.addEventListener('click',()=>{sidebar.classList.contains('open')?closeDrawer():openDrawer()});
backdrop.addEventListener('click',closeDrawer);
sidebar.querySelectorAll('.nav-item').forEach(item=>item.addEventListener('click',()=>{if(window.innerWidth<=768)closeDrawer()}));
window.addEventListener('resize',()=>{if(window.innerWidth>768)closeDrawer()});
$('#marketRows').addEventListener('dblclick',e=>{const row=e.target.closest('tr');const index=[...$('#marketRows').children].indexOf(row);const list=state.markets.filter(p=>(state.tab==='all'||(state.tab==='watchlist'?state.account.watchlist.includes(p.symbol):['EUR/USD','GBP/USD','USD/JPY','USD/CHF'].includes(p.symbol)))&&`${p.symbol} ${p.name}`.toLowerCase().includes(state.search.toLowerCase()));if(list[index]){state.selected=list[index].symbol;updateChart()}});
window.addEventListener('resize',()=>drawChart(pairOf(state.selected)));api('/api/registration/me').then(result=>{if(result.registration.paymentStatus==='paid'){unlockFullAccess(result.registration)}else{unlockPayment(result.registration)}}).catch(()=>{});api('/api/settings').then(result=>applySettings(result.settings)).catch(()=>{});api('/api/admin/session').then(result=>{if(result.authenticated){const onboarding=document.querySelector('.onboarding-card');if(onboarding)onboarding.hidden=true;$('#academyTab').hidden=false;openAcademy();toast('Admin preview: FX Academy unlocked')}}).catch(()=>{});refresh();setInterval(refresh,15000);loadSim();
