/* Projektplan Haus & Hof – App-Logik
 * Datenmodell: Dokumente in drei Sammlungen
 *   projects/<id>  Projekt
 *   zeiten/<id>    Zeiteintrag
 *   config/areas   { liste: [{id,name,farbe}] }
 *   config/weights { dringlichkeit, wichtigkeit, ... }
 * Gespeichert in Supabase (Tabelle public.docs) oder im Demo-Modus nur im Speicher.
 */
(function(){
'use strict';
const cfg=window.PROJEKTPLAN_CONFIG||{};

const PALETTE=['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10'];
const DEFAULT_AREAS=[
  {id:'familie',name:'Familie',farbe:'c1'},{id:'haus',name:'Haus',farbe:'c2'},{id:'freizeit',name:'Freizeit',farbe:'c3'},
  {id:'wald',name:'Wald',farbe:'c4'},{id:'imkerei',name:'Imkerei',farbe:'c5'},{id:'bauernhof',name:'Bauernhof',farbe:'c6'},{id:'sonstiges',name:'Sonstiges',farbe:'c7'}];
const STATUS=[{id:'idee',name:'Idee'},{id:'geplant',name:'Geplant'},{id:'aktiv',name:'In Arbeit'},{id:'wartet',name:'Wartet'},{id:'erledigt',name:'Erledigt'}];
const CRITERIA=[
  {id:'dringlichkeit',name:'Dringlichkeit',hint:'Wie schnell muss es passieren? Eine nahe Frist hebt den Wert automatisch an.',lo:'kann warten',hi:'brennt'},
  {id:'wichtigkeit',name:'Wichtigkeit',hint:'Wie stark wirkt es auf Familie, Sicherheit, Werterhalt oder Ertrag?',lo:'nett zu haben',hi:'zentral'},
  {id:'freude',name:'Freude',hint:'Wie viel Lust hast du darauf? Motivation trägt Projekte.',lo:'reine Pflicht',hi:'Herzensprojekt'},
  {id:'aufwand',name:'Aufwand',inv:true,hint:'Zeit, Kraft und Schwierigkeit. Hoher Aufwand senkt die Priorität.',lo:'ein Nachmittag',hi:'viele Wochenenden'},
  {id:'kosten',name:'Kosten',inv:true,hint:'Geld und Material. Hohe Kosten senken die Priorität.',lo:'kaum',hi:'große Investition'}];
const W_LABELS={dringlichkeit:'Dringlichkeit',wichtigkeit:'Wichtigkeit',freude:'Freude',aufwand:'Aufwand (weniger = besser)',kosten:'Kosten (weniger = besser)',saison:'Saison-Zeitfenster'};
const DEFAULT_W={dringlichkeit:3,wichtigkeit:3,freude:1,aufwand:1,kosten:1,saison:2};
const MONTHS=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
const MONTHS_LONG=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const statusById=Object.fromEntries(STATUS.map(s=>[s.id,s]));

const pad=n=>String(n).padStart(2,'0');
const today=new Date(); today.setHours(0,0,0,0);
const curMonth=today.getMonth(), curYear=today.getFullYear();
const todayIso=`${curYear}-${pad(curMonth+1)}-${pad(today.getDate())}`;
const curYm=todayIso.slice(0,7);

let loaded=false;
let projects=[], zeiten=[], weights={...DEFAULT_W}, areas=DEFAULT_AREAS.slice();
let ui={area:'alle',view:'liste',showDone:false,jahr:curYear,zmonat:curYm,lastArea:''};
try{const s=JSON.parse(localStorage.getItem('pp-ui')||'null'); if(s) ui={...ui,...s,jahr:curYear,zmonat:curYm};}catch(e){}
function saveUi(){try{localStorage.setItem('pp-ui',JSON.stringify({area:ui.area,view:ui.view,showDone:ui.showDone,lastArea:ui.lastArea}));}catch(e){}}

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const area=id=>areas.find(a=>a.id===id)||{id,name:id?'Unbekannt':'Ohne Bereich',farbe:'c7'};
const dot=id=>`<span class="dot" style="--c:var(--${area(id).farbe})"></span>`;
function fmtDate(iso,opts){if(!iso)return'';const d=new Date(iso+'T00:00:00');return d.toLocaleDateString('de-DE',opts||{day:'numeric',month:'short',year:d.getFullYear()!==curYear?'numeric':undefined});}
function daysTo(iso){return Math.round((new Date(iso+'T00:00:00')-today)/864e5);}
function fmtH(n){return (Math.round((n||0)*100)/100).toLocaleString('de-DE',{maximumFractionDigits:2});}
function parseHours(v){
  v=String(v||'').trim().replace(/\s*h$/i,''); if(!v)return null;
  const m=v.match(/^(\d+):(\d{1,2})$/); if(m)return Number(m[1])+Number(m[2])/60;
  const n=Number(v.replace(',','.')); return isFinite(n)&&n>=0?n:NaN;}
function ymLabel(ym){const [y,m]=ym.split('-').map(Number); return MONTHS_LONG[m-1]+' '+y;}
function ymShift(ym,d){let [y,m]=ym.split('-').map(Number); m+=d; while(m<1){m+=12;y--;} while(m>12){m-=12;y++;} return `${y}-${pad(m)}`;}

/* ======================= Speicher ======================= */
// Einheitliche Schnittstelle: list() → [{coll,id,data}], put(coll,id,data), del(coll,id), putMany(rows)
const memoryStore={
  rows:new Map(),
  async list(){return [...this.rows.values()];},
  async put(coll,id,data){this.rows.set(coll+'/'+id,{coll,id,data});},
  async del(coll,id){this.rows.delete(coll+'/'+id);},
  async putMany(rows){rows.forEach(r=>this.rows.set(r.coll+'/'+r.id,r));},
  subscribe(){}, async signOut(){}
};
let sb=null, user=null;
const supabaseStore={
  async list(){
    const out=[]; const page=1000;
    for(let from=0;;from+=page){
      const {data,error}=await sb.from('docs').select('coll,id,data').order('coll').order('id').range(from,from+page-1);
      if(error)throw error; out.push(...data); if(data.length<page)break;
    }
    return out;
  },
  async put(coll,id,data){
    const {error}=await sb.from('docs').upsert({user_id:user.id,coll,id,data,updated_at:new Date().toISOString()},{onConflict:'user_id,coll,id'});
    if(error)throw error;
  },
  async del(coll,id){
    const {error}=await sb.from('docs').delete().eq('coll',coll).eq('id',id);
    if(error)throw error;
  },
  async putMany(rows){
    const now=new Date().toISOString();
    for(let i=0;i<rows.length;i+=500){
      const chunk=rows.slice(i,i+500).map(r=>({user_id:user.id,coll:r.coll,id:r.id,data:r.data,updated_at:now}));
      const {error}=await sb.from('docs').upsert(chunk,{onConflict:'user_id,coll,id'}); if(error)throw error;
    }
  },
  subscribe(onRow,onDelete){
    sb.channel('docs-'+user.id)
      .on('postgres_changes',{event:'*',schema:'public',table:'docs',filter:'user_id=eq.'+user.id},p=>{
        if(p.eventType==='DELETE'){ if(p.old&&p.old.coll)onDelete(p.old.coll,p.old.id); }
        else if(p.new)onRow(p.new);
      }).subscribe();
  },
  async signOut(){await sb.auth.signOut();}
};
let store=null;

function upsertLocal(arr,obj){const i=arr.findIndex(x=>x.id===obj.id); if(i>=0)arr[i]=obj; else arr.push(obj);}
function applyRow(r){
  if(r.coll==='projects')upsertLocal(projects,{id:r.id,...r.data});
  else if(r.coll==='zeiten')upsertLocal(zeiten,{id:r.id,...r.data});
  else if(r.coll==='config'){
    if(r.id==='weights')weights={...DEFAULT_W,...r.data};
    if(r.id==='areas'&&Array.isArray(r.data.liste)&&r.data.liste.length)areas=r.data.liste.slice();
  }
}
function removeLocal(coll,id){
  if(coll==='projects')projects=projects.filter(p=>p.id!==id);
  if(coll==='zeiten')zeiten=zeiten.filter(z=>z.id!==id);
}
async function loadAll(quiet){
  try{
    const rows=await store.list();
    projects=[]; zeiten=[]; weights={...DEFAULT_W}; areas=DEFAULT_AREAS.slice();
    rows.forEach(applyRow); loaded=true; if(!quiet)setBanner('');
  }catch(e){ loaded=true; setBanner('Daten konnten nicht geladen werden ('+(e.message||e)+'). Prüfe die Internetverbindung.'); }
  render(); if(sheetMode==='edit')refreshPreview();
}
function failMsg(e){return 'Speichern fehlgeschlagen ('+((e&&e.message)||'Fehler')+'). Prüfe die Internetverbindung und versuche es erneut.';}
async function putDoc(coll,obj,arr){
  const body={...obj}; delete body.id; body.geaendert=new Date().toISOString();
  upsertLocal(arr,{...obj,geaendert:body.geaendert}); render();
  try{ await store.put(coll,obj.id,body); }catch(e){ setBanner(failMsg(e)); loadAll(true); throw e; }
}
async function delDoc(coll,id){
  removeLocal(coll,id); render();
  try{ await store.del(coll,id); }catch(e){ setBanner('Löschen fehlgeschlagen ('+(e.message||e)+').'); loadAll(true); throw e; }
}
const saveProject=p=>putDoc('projects',p,projects);
const saveZeit=z=>putDoc('zeiten',z,zeiten);
let wTimer=null,aTimer=null;
function saveWeights(){ clearTimeout(wTimer); wTimer=setTimeout(async()=>{ try{await store.put('config','weights',{...weights});}catch(e){setBanner('Gewichtung konnte nicht gespeichert werden.');} },600); }
function saveAreas(){ clearTimeout(aTimer); aTimer=setTimeout(async()=>{ try{await store.put('config','areas',{liste:areas});}catch(e){setBanner('Bereiche konnten nicht gespeichert werden.');} },500); }

/* ======================= Start & Anmeldung ======================= */
function showScreen(id){ ['setup','login','app'].forEach(s=>{$('#'+s).hidden=s!==id;}); }
async function boot(){
  if(cfg.demo){ store=memoryStore; await startApp(); setBanner('Demo-Modus: Daten werden nicht gespeichert und sind nach dem Neuladen weg.'); return; }
  const configured=cfg.supabaseUrl&&cfg.supabaseAnonKey&&!/DEIN/.test(cfg.supabaseUrl+cfg.supabaseAnonKey);
  if(!configured||!window.supabase){ showScreen('setup'); return; }
  sb=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}});
  store=supabaseStore;
  sb.auth.onAuthStateChange((ev,session)=>{ if(ev==='SIGNED_OUT'){ user=null; projects=[]; zeiten=[]; loaded=false; showScreen('login'); } });
  const {data}=await sb.auth.getSession();
  if(data&&data.session){ user=data.session.user; startApp(); } else showScreen('login');
}
let started=false;
async function startApp(){
  showScreen('app'); applyHash(); render();
  await loadAll();
  if(!started){
    started=true;
    store.subscribe(r=>{applyRow(r); render(); if(sheetMode==='edit')refreshPreview();},(c,i)=>{removeLocal(c,i); render();});
    document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&user) loadAll(true); });
  }
}
$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const email=$('#l-email').value.trim(), password=$('#l-pass').value, err=$('#l-err'), btn=$('#l-btn');
  if(!email||!password){err.textContent='Bitte E-Mail und Passwort eingeben.'; err.hidden=false; return;}
  btn.disabled=true; btn.textContent='Melde an …'; err.hidden=true;
  const {data,error}=await sb.auth.signInWithPassword({email,password});
  btn.disabled=false; btn.textContent='Anmelden';
  if(error){ err.textContent=/invalid/i.test(error.message)?'E-Mail oder Passwort stimmt nicht.':'Anmeldung fehlgeschlagen: '+error.message; err.hidden=false; return; }
  user=data.user; $('#l-pass').value=''; startApp();
});

/* ======================= Bewertung ======================= */
function effUrgency(p){
  let u=(p.scores&&p.scores.dringlichkeit)||3;
  if(p.frist){const d=daysTo(p.frist); if(d<=14)u=Math.max(u,5); else if(d<=45)u=Math.max(u,4);}
  return u;}
function seasonVal(p){
  const m=p.monate||[]; if(!m.length)return 3;
  if(m.includes(curMonth))return 5; if(m.includes((curMonth+1)%12))return 4; return 1;}
function score(p){
  const s=p.scores||{}; let sum=0,wsum=0;
  const vals={dringlichkeit:effUrgency(p),wichtigkeit:s.wichtigkeit||3,freude:s.freude||3,aufwand:6-(s.aufwand||3),kosten:6-(s.kosten||3),saison:seasonVal(p)};
  for(const k in vals){const w=Number(weights[k]??0); sum+=w*vals[k]; wsum+=w;}
  return wsum?Math.round(((sum/wsum)-1)/4*100):0;}
function seasonText(p){
  const m=p.monate||[]; if(!m.length)return'';
  if(m.includes(curMonth))return'Jetzt Saison';
  if(m.includes((curMonth+1)%12))return'Ab nächstem Monat';
  const nxt=[...Array(12).keys()].map(i=>(curMonth+i)%12).find(i=>m.includes(i));
  return'Saison ab '+MONTHS[nxt];}
function estimate(p){
  const stepSum=(p.schritte||[]).reduce((a,s)=>a+(Number(s.stunden)||0),0);
  const e=Number(p.schaetzung)||0; return e||stepSum;}
function loggedFor(id){return zeiten.reduce((a,z)=>a+(z.projekt===id?Number(z.stunden)||0:0),0);}
function planRange(p){
  let v=p.planVon||'', b=p.planBis||''; if(!v&&!b)return null; if(!v)v=b; if(!b)b=v; if(b<v)[v,b]=[b,v]; return [v,b];}
function planText(p){const r=planRange(p); if(!r)return''; const f=ym=>{const [y,m]=ym.split('-');return MONTHS[+m-1]+' '+y.slice(2);}; return r[0]===r[1]?'Geplant '+f(r[0]):'Geplant '+f(r[0])+' – '+f(r[1]);}

/* ======================= Ansicht ======================= */
function setBanner(t){const b=$('#banner'); b.textContent=t||''; b.hidden=!t;}
let toastT=null;
function toast(t){const el=$('#toast'); el.textContent=t; el.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>el.hidden=true,2600);}
const VIEWS=['liste','matrix','jahr','zeiten'];
function applyHash(){
  const h=location.hash.slice(1);
  if(VIEWS.includes(h)){ui.view=h;}
  if(h==='erfassen'){ setTimeout(()=>{ if(!$('#app').hidden) openTime(null); },0); }
}
window.addEventListener('hashchange',()=>{ if($('#app').hidden)return; applyHash(); render(); });
function setView(v){ui.view=v; saveUi(); if(location.hash!=='#'+v) history.replaceState(null,'','#'+v); render();}

function filtered(){ return projects.filter(p=>(ui.area==='alle'||p.bereich===ui.area)&&(ui.showDone||p.status!=='erledigt')); }
function ranked(){ return filtered().map(p=>({p,s:score(p)})).sort((a,b)=>(a.p.status==='erledigt')-(b.p.status==='erledigt')||b.s-a.s); }
function render(){
  if($('#app').hidden)return;
  const counts={}; projects.forEach(p=>{if(p.status!=='erledigt')counts[p.bereich]=(counts[p.bereich]||0)+1;});
  $('#areaChips').innerHTML=[{id:'alle',name:'Alle'},...areas].map(a=>
    `<button type="button" class="chip" data-area="${esc(a.id)}" aria-pressed="${ui.area===a.id}">${a.id!=='alle'?dot(a.id):''}${esc(a.name)}${a.id!=='alle'&&counts[a.id]?` <span class="mono">${counts[a.id]}</span>`:''}</button>`).join('');
  $('#showDone').checked=ui.showDone;
  $('#doneToggle').hidden=ui.view==='zeiten';
  document.querySelectorAll('.seg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.view===ui.view));

  const open=projects.filter(p=>p.status!=='erledigt');
  const monthH=zeiten.filter(z=>(z.datum||'').startsWith(curYm)).reduce((a,z)=>a+(Number(z.stunden)||0),0);
  $('#summary').innerHTML=[['Offen',open.length],['In Arbeit',open.filter(p=>p.status==='aktiv').length],['Jetzt Saison',open.filter(p=>(p.monate||[]).includes(curMonth)).length],['Erfasst im '+MONTHS[curMonth],fmtH(monthH)+' h']]
    .map(([k,v])=>`<div class="sum"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  const main=$('#main');
  if(!loaded){main.innerHTML='<div class="empty">Daten werden geladen …</div>';return;}
  if(ui.view==='zeiten'){renderZeiten(main);return;}
  if(!projects.length){
    main.innerHTML=`<div class="empty"><h2>Noch keine Projekte</h2><p class="note">Lege dein erstes Vorhaben an oder importiere einen Export unter Einstellungen → Daten.</p><button class="btn primary" type="button" data-new>+ Erstes Projekt anlegen</button></div>`;return;}
  if(ui.view==='jahr'){renderJahr(main);return;}
  const items=ranked();
  if(!items.length){main.innerHTML='<div class="empty">In diesem Bereich gibt es keine offenen Projekte.</div>';return;}
  if(ui.view==='matrix'){renderMatrix(main,items);return;}
  main.innerHTML='<div class="list">'+items.map(({p,s},i)=>{
    const a=area(p.bereich), st=statusById[p.status]||STATUS[0];
    const steps=p.schritte||[], doneN=steps.filter(x=>x.erledigt).length, nxt=steps.find(x=>!x.erledigt);
    const est=estimate(p), lg=loggedFor(p.id);
    const meta=[];
    const sea=seasonText(p); if(sea)meta.push(`<span class="${sea==='Jetzt Saison'?'season':''}">${sea}</span>`);
    const pt=planText(p); if(pt)meta.push(`<span>${pt}</span>`);
    if(p.frist){const d=daysTo(p.frist); meta.push(`<span class="${d<=14?'warn':''}">Frist ${fmtDate(p.frist)}${d<0?' (überfällig)':d<=45?` (${d} Tg.)`:''}</span>`);}
    if(nxt&&nxt.faellig){const d=daysTo(nxt.faellig); meta.push(`<span class="${d<0?'warn':''}">Nächster Schritt bis ${fmtDate(nxt.faellig)}</span>`);}
    return `<div class="card ${p.status==='erledigt'?'done':''}" role="button" tabindex="0" data-open="${esc(p.id)}">
      <div class="rank">${p.status==='erledigt'?'✓':i+1}</div>
      <div class="body">
        <div class="titlerow"><span class="ptitle">${esc(p.titel||'Ohne Titel')}</span>
          <span class="tag">${dot(p.bereich)}${esc(a.name)}</span>
          <span class="pill ${st.id}">${esc(st.name)}</span></div>
        ${meta.length?`<div class="meta">${meta.join('')}</div>`:''}
        ${nxt?`<label class="next" data-stop><input type="checkbox" data-tick="${esc(p.id)}" data-step="${esc(nxt.id)}"><span class="lbl">Nächster Schritt</span><span class="txt">${esc(nxt.text)}${nxt.stunden?` · ${fmtH(nxt.stunden)} h`:''}</span></label>`:''}
      </div>
      <div class="scorebox"><div class="score">${s}<small> /100</small></div><div class="bar"><i style="width:${s}%"></i></div>
        <div class="progress">${steps.length?`${doneN}/${steps.length} Schritte`:'keine Schritte'}${est||lg?`<br>${fmtH(lg)}${est?` / ${fmtH(est)}`:''} h`:''}</div>
        <button class="btn small" type="button" data-ztime="${esc(p.id)}">+ Zeit</button></div>
    </div>`;}).join('')+'</div>';
}
function renderMatrix(main,items){
  const q={q1:[],q2:[],q3:[],q4:[]};
  items.filter(x=>x.p.status!=='erledigt').forEach(x=>{
    const u=effUrgency(x.p)>=4, w=((x.p.scores||{}).wichtigkeit||3)>=4;
    q[w&&u?'q1':w?'q2':u?'q3':'q4'].push(x);});
  const box=(id,t,d)=>`<div class="quad ${id}"><header><h3>${t}</h3><p>${d}</p></header><div class="qitems">${
    q[id].length?q[id].map(({p,s})=>`<button type="button" class="qitem" data-open="${esc(p.id)}">${dot(p.bereich)}<span>${esc(p.titel)}</span><b class="mono">${s}</b></button>`).join(''):'<span class="qempty">Nichts hier.</span>'}</div></div>`;
  main.innerHTML=`<div class="matrix">
    <div class="axis y">Wichtig ≥ 4</div>${box('q1','Sofort angehen','wichtig &amp; dringend')}${box('q2','Fest einplanen','wichtig, nicht dringend')}
    <div class="axis y">Weniger wichtig</div>${box('q3','Schnell erledigen','dringend, weniger wichtig')}${box('q4','Später oder streichen','weder noch')}
    <div></div><div class="axis">Dringend ≥ 4 (inkl. Frist)</div><div class="axis">Nicht dringend</div></div>`;
}
function renderJahr(main){
  const Y=ui.jahr, yms=[...Array(12).keys()].map(m=>`${Y}-${pad(m+1)}`);
  const inYear=p=>{const r=planRange(p); return (r&&r[0]<=`${Y}-12`&&r[1]>=`${Y}-01`)||(p.monate||[]).length||(p.frist&&p.frist.startsWith(String(Y)));};
  const list=filtered().filter(inYear).sort((a,b)=>((planRange(a)||['9999'])[0]).localeCompare((planRange(b)||['9999'])[0])||score(b)-score(a));
  const noPlan=filtered().filter(p=>p.status!=='erledigt'&&!planRange(p)).length;
  const planned=Array(12).fill(0), logged=Array(12).fill(0);
  filtered().forEach(p=>{const r=planRange(p), e=estimate(p); if(!r||!e||p.status==='erledigt')return;
    let n=0; for(let ym=r[0]; ym<=r[1]; ym=ymShift(ym,1))n++;
    yms.forEach((ym,i)=>{if(ym>=r[0]&&ym<=r[1])planned[i]+=e/n;});});
  zeiten.forEach(z=>{if(ui.area!=='alle'&&z.bereich!==ui.area)return; const i=yms.indexOf((z.datum||'').slice(0,7)); if(i>=0)logged[i]+=Number(z.stunden)||0;});
  const groups=[]; areas.concat([{id:'__x'}]).forEach(a=>{const ps=list.filter(p=>a.id==='__x'?!areas.some(x=>x.id===p.bereich):p.bereich===a.id); if(ps.length)groups.push([a,ps]);});
  const row=p=>{const r=planRange(p), c=`var(--${area(p.bereich).farbe})`;
    return `<tr data-open="${esc(p.id)}"><th class="name" scope="row"><span class="t">${esc(p.titel)}</span><small>${estimate(p)?fmtH(estimate(p))+' h geschätzt':'ohne Schätzung'}</small></th>${yms.map((ym,i)=>{
      const inR=r&&ym>=r[0]&&ym<=r[1], sea=(p.monate||[]).includes(i), now=ym===curYm, fr=p.frist&&p.frist.startsWith(ym);
      return `<td class="${sea?'sea':''} ${now?'now':''}">${inR?`<i class="plan ${ym===r[0]?'s':''} ${ym===r[1]?'e':''}" style="--c:${c}"></i>`:''}${fr?`<b class="fr" title="Frist ${fmtDate(p.frist)}">◆</b>`:''}</td>`;}).join('')}</tr>`;};
  main.innerHTML=`<div class="section">
    <div class="navbar"><button class="btn small" type="button" data-ynav="-1" aria-label="Vorjahr">‹</button><h2 class="mono">${Y}</h2><button class="btn small" type="button" data-ynav="1" aria-label="Folgejahr">›</button>
      <div class="legend"><span><i style="background:var(--accent)"></i>Geplanter Zeitraum</span><span><i style="background:var(--honey-soft);border:1px solid var(--honey)"></i>Saison</span><span><b style="color:var(--danger)">◆</b> Frist</span></div></div>
    ${list.length?`<div class="gantt-wrap"><table class="gantt"><thead><tr><th class="name">Projekt</th>${MONTHS.map((m,i)=>`<th class="${yms[i]===curYm?'now':''}">${m}</th>`).join('')}</tr></thead>
    <tbody>${groups.map(([a,ps])=>`<tr class="grp"><th colspan="13">${a.id==='__x'?'Ohne Bereich':dot(a.id)+' '+esc(a.name)}</th></tr>${ps.map(row).join('')}`).join('')}</tbody>
    <tfoot><tr><th class="name">Geplant (h)</th>${planned.map(v=>`<td>${v?fmtH(Math.round(v)):'–'}</td>`).join('')}</tr>
      <tr><th class="name">Erfasst (h)</th>${logged.map(v=>`<td>${v?fmtH(v):'–'}</td>`).join('')}</tr></tfoot></table></div>`
    :`<div class="empty">Für ${Y} ist noch nichts eingeplant. Trage in einem Projekt „Geplant von / bis“, eine Frist oder Saisonmonate ein.</div>`}
    <p class="note">${noPlan?`${noPlan} offene Projekte haben noch keinen geplanten Zeitraum. `:''}„Geplant (h)“ verteilt die Zeitschätzung gleichmäßig über den geplanten Zeitraum. So siehst du, in welchen Monaten du dir zu viel vornimmst.</p>
  </div>`;
}
function renderZeiten(main){
  const ym=ui.zmonat;
  const inArea=z=>ui.area==='alle'||z.bereich===ui.area;
  const month=zeiten.filter(z=>(z.datum||'').startsWith(ym)&&inArea(z)).sort((a,b)=>(b.datum||'').localeCompare(a.datum||'')||(b.erstellt||'').localeCompare(a.erstellt||''));
  const total=month.reduce((a,z)=>a+(Number(z.stunden)||0),0);
  const yearTotal=zeiten.filter(z=>(z.datum||'').startsWith(ym.slice(0,4))&&inArea(z)).reduce((a,z)=>a+(Number(z.stunden)||0),0);
  const byArea={}; month.forEach(z=>byArea[z.bereich]=(byArea[z.bereich]||0)+(Number(z.stunden)||0));
  const aRows=Object.entries(byArea).sort((a,b)=>b[1]-a[1]); const max=Math.max(1,...aRows.map(r=>r[1]));
  const days={}; month.forEach(z=>(days[z.datum]=days[z.datum]||[]).push(z));
  const pName=id=>{const p=projects.find(x=>x.id===id); return p?p.titel:'';};
  main.innerHTML=`<div class="section">
    <div class="navbar" style="justify-content:space-between"><div class="navbar"><button class="btn small" type="button" data-znav="-1" aria-label="Vormonat">‹</button><h2>${ymLabel(ym)}</h2><button class="btn small" type="button" data-znav="1" aria-label="Folgemonat">›</button></div>
      <button class="btn honey" type="button" data-ztime="">+ Zeit erfassen</button></div>
    <div class="tgrid">
      <div class="panel"><div class="row two" style="gap:10px"><div><div class="flabel">Summe ${MONTHS[+ym.slice(5)-1]}</div><div class="score">${fmtH(total)}<small> h</small></div></div><div><div class="flabel">Summe ${ym.slice(0,4)}</div><div class="score">${fmtH(yearTotal)}<small> h</small></div></div></div>
        <hr class="sep"><div class="flabel">Nach Bereich</div>
        ${aRows.length?`<div class="abars">${aRows.map(([id,h])=>`<div class="abar"><span class="n">${dot(id)}${esc(area(id).name)}</span><span class="b"><i style="width:${h/max*100}%;--c:var(--${area(id).farbe})"></i></span><span class="h">${fmtH(h)} h</span></div>`).join('')}</div>`:'<p class="note">Noch keine Stunden in diesem Monat.</p>'}
      </div>
      <div class="days">${Object.keys(days).length?Object.keys(days).sort().reverse().map(d=>`<div class="day"><h3><span>${fmtDate(d,{weekday:'short',day:'numeric',month:'short'})}</span><span class="mono">${fmtH(days[d].reduce((a,z)=>a+(Number(z.stunden)||0),0))} h</span></h3>
        ${days[d].map(z=>`<button type="button" class="entry" data-zedit="${esc(z.id)}"><span class="h">${fmtH(z.stunden)} h</span><span class="d"><span class="l1">${dot(z.bereich)}${esc(area(z.bereich).name)}${z.projekt&&pName(z.projekt)?' · '+esc(pName(z.projekt)):''}</span>${z.beschreibung?`<span class="l2">${esc(z.beschreibung)}</span>`:''}</span></button>`).join('')}</div>`).join('')
        :`<div class="empty">Keine Einträge in ${ymLabel(ym)}.<button class="btn honey" type="button" data-ztime="">+ Zeit erfassen</button></div>`}</div>
    </div>
  </div>`;
}

/* ======================= Seitenblatt: Projekt ======================= */
let editing=null, editingZ=null, sheetMode=null, confirmDel=false, pendingImport=null;
function openSheet(){ $('#overlay').hidden=false; document.body.style.overflow='hidden'; }
function closeSheet(){ $('#overlay').hidden=true; document.body.style.overflow=''; editing=null; editingZ=null; sheetMode=null; confirmDel=false; pendingImport=null; if(location.hash==='#erfassen') history.replaceState(null,'','#'+ui.view); }
function newProject(){
  return {id:uid(),titel:'',bereich:ui.area!=='alle'?ui.area:(areas[0]||{}).id||'sonstiges',status:'idee',beschreibung:'',frist:'',monate:[],planVon:'',planBis:'',schaetzung:null,
    scores:{dringlichkeit:3,wichtigkeit:3,freude:3,aufwand:3,kosten:3},schritte:[],erstellt:new Date().toISOString()};
}
function openEditor(id){
  const src=id?projects.find(p=>p.id===id):null;
  editing=src?JSON.parse(JSON.stringify(src)):newProject();
  editing.scores={dringlichkeit:3,wichtigkeit:3,freude:3,aufwand:3,kosten:3,...(editing.scores||{})};
  editing.schritte=editing.schritte||[]; editing.monate=editing.monate||[];
  editing._new=!src; sheetMode='edit'; confirmDel=false; renderEditor(); openSheet();
  if(editing._new) setTimeout(()=>{const f=$('#f-titel'); if(f)f.focus();},50);
}
function areaOptions(sel){
  const list=areas.slice(); if(sel&&!areas.some(a=>a.id===sel))list.push(area(sel));
  return list.map(a=>`<option value="${esc(a.id)}" ${sel===a.id?'selected':''}>${esc(a.name)}</option>`).join('');}
function renderEditor(){
  const p=editing, lg=p._new?0:loggedFor(p.id), est=estimate(p), nE=zeiten.filter(z=>z.projekt===p.id).length;
  $('#sheet').innerHTML=`
  <div class="sheet-head"><h2 id="sheetTitle">${p._new?'Neues Projekt':'Projekt bearbeiten'}</h2><button class="iconbtn" type="button" data-close aria-label="Schließen">✕</button></div>
  <div class="sheet-body">
    <div class="field"><label for="f-titel">Titel</label><input class="big" type="text" id="f-titel" value="${esc(p.titel)}" placeholder="z. B. Zaun an der Weide erneuern"></div>
    <div class="row">
      <div class="field"><label for="f-bereich">Bereich</label><select id="f-bereich">${areaOptions(p.bereich)}</select></div>
      <div class="field"><label for="f-status">Status</label><select id="f-status">${STATUS.map(s=>`<option value="${s.id}" ${p.status===s.id?'selected':''}>${s.name}</option>`).join('')}</select></div>
      <div class="field"><label for="f-frist">Frist</label><input type="date" id="f-frist" value="${esc(p.frist||'')}"></div>
    </div>
    <div class="row">
      <div class="field"><label for="f-schaetzung">Zeitschätzung (h)</label><input type="text" inputmode="decimal" id="f-schaetzung" value="${p.schaetzung?fmtH(p.schaetzung):''}" placeholder="${(p.schritte||[]).some(s=>s.stunden)?'Summe Schritte: '+fmtH(estimate({schritte:p.schritte})):'z. B. 16'}"></div>
      <div class="field"><label for="f-planVon">Geplant von</label><input type="month" id="f-planVon" value="${esc(p.planVon||'')}" placeholder="JJJJ-MM"></div>
      <div class="field"><label for="f-planBis">Geplant bis</label><input type="month" id="f-planBis" value="${esc(p.planBis||'')}" placeholder="JJJJ-MM"></div>
    </div>
    <div class="field"><label for="f-beschreibung">Ziel &amp; Notizen</label><textarea id="f-beschreibung" placeholder="Was soll am Ende erreicht sein? Material, Ansprechpartner, Ideen …">${esc(p.beschreibung)}</textarea></div>

    ${p._new?'':`<div class="timebox"><div class="line"><span class="flabel">Erfasste Zeit</span><span class="mono">${fmtH(lg)} h${est?` von ${fmtH(est)} h geschätzt`:''}</span></div>
      ${est?`<div class="bar time"><i style="width:${Math.min(100,lg/est*100)}%"></i></div>`:''}
      <div class="line"><span class="note">${nE?`${nE} Einträge.`:'Noch keine Zeit auf dieses Projekt gebucht.'}${est&&lg>est?' Die Schätzung ist überschritten.':''}</span></div></div>`}

    <div class="scorepreview"><span class="flabel">Priorität</span><div class="bar"><i id="pv-bar"></i></div><span class="score" id="pv-score"></span></div>

    <div class="field"><span class="flabel">Bewertung (1–5)</span>
      <div class="crits">${CRITERIA.map(c=>`<div class="crit"><span class="name">${c.name}</span>
        <div class="scale" role="group" aria-label="${c.name}">${[1,2,3,4,5].map(v=>`<button type="button" data-crit="${c.id}" data-v="${v}" aria-pressed="${p.scores[c.id]===v}">${v}</button>`).join('')}</div>
        <div class="scale-ends"><span>${c.lo}</span><span>${c.hi}</span></div>
        <div class="hint">${c.hint}</div></div>`).join('')}</div>
    </div>

    <div class="field"><span class="flabel">Saison-Zeitfenster</span>
      <p class="note">In welchen Monaten lässt sich das Projekt sinnvoll umsetzen? Leer lassen, wenn es das ganze Jahr geht.</p>
      <div class="months" role="group" aria-label="Monate">${MONTHS.map((m,i)=>`<button type="button" data-month="${i}" class="${i===curMonth?'now':''}" aria-pressed="${p.monate.includes(i)}">${m}</button>`).join('')}</div>
    </div>

    <div class="field"><span class="flabel">Projektschritte</span>
      <div class="steps" id="steps"></div>
      <div class="addstep"><input type="text" id="f-newstep" placeholder="Nächsten Schritt hinzufügen und Enter drücken"><button class="btn" type="button" id="btn-addstep">Hinzufügen</button></div>
    </div>
  </div>
  <div class="sheet-foot">
    <div>${p._new?'':(confirmDel?`<span style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap"><span>Endgültig löschen?</span><button class="btn danger solid small" type="button" data-delyes>Löschen</button><button class="btn small" type="button" data-delno>Abbrechen</button></span>`:`<button class="btn danger" type="button" data-del>Projekt löschen</button>`)}</div>
    <div class="actions"><button class="btn ghost" type="button" data-close>Abbrechen</button><button class="btn primary" type="button" data-save>Speichern</button></div>
  </div>`;
  renderSteps(); refreshPreview();
}
function renderSteps(){
  const el=$('#steps'); if(!el)return;
  const st=editing.schritte;
  el.innerHTML=st.length?st.map((s,i)=>`<div class="step ${s.erledigt?'done':''}">
    <input type="checkbox" data-sdone="${i}" ${s.erledigt?'checked':''} aria-label="Erledigt">
    <input type="text" data-stext="${i}" value="${esc(s.text)}" aria-label="Schritt ${i+1}">
    <input type="text" class="sh" inputmode="decimal" data-sh="${i}" value="${s.stunden?fmtH(s.stunden):''}" placeholder="h" aria-label="Geschätzte Stunden">
    <input type="date" data-sdue="${i}" value="${esc(s.faellig||'')}" aria-label="Fällig am">
    <div class="ctrl"><button class="iconbtn" type="button" data-sup="${i}" aria-label="Nach oben" ${i===0?'disabled':''}>↑</button><button class="iconbtn" type="button" data-sdown="${i}" aria-label="Nach unten" ${i===st.length-1?'disabled':''}>↓</button><button class="iconbtn" type="button" data-sdel="${i}" aria-label="Schritt entfernen">✕</button></div>
  </div>`).join(''):'<p class="note">Noch keine Schritte. Zerlege das Projekt in kleine, machbare Aufgaben, gern mit geschätzten Stunden.</p>';
}
function refreshPreview(){ if(!editing||!$('#pv-score'))return; const s=score(editing); $('#pv-score').innerHTML=`${s}<small> /100</small>`; $('#pv-bar').style.width=s+'%'; }
function readForm(){
  editing.titel=$('#f-titel').value.trim(); editing.bereich=$('#f-bereich').value; editing.status=$('#f-status').value;
  editing.frist=$('#f-frist').value; editing.beschreibung=$('#f-beschreibung').value;
  editing.planVon=$('#f-planVon').value.trim(); editing.planBis=$('#f-planBis').value.trim();
  const h=parseHours($('#f-schaetzung').value); editing.schaetzung=(h&&!isNaN(h))?h:null;
}
function addStep(){ const i=$('#f-newstep'); const t=i.value.trim(); if(!t)return; editing.schritte.push({id:uid(),text:t,erledigt:false,faellig:'',stunden:null}); i.value=''; renderSteps(); i.focus(); }

/* ======================= Seitenblatt: Zeit ======================= */
function openTime(id,preset){
  const src=id?zeiten.find(z=>z.id===id):null;
  if(src) editingZ={...src,_new:false};
  else{
    const pr=preset&&projects.find(p=>p.id===preset);
    const ar=pr?pr.bereich:(ui.area!=='alle'?ui.area:(ui.lastArea&&areas.some(a=>a.id===ui.lastArea)?ui.lastArea:(areas[0]||{}).id));
    editingZ={id:uid(),datum:todayIso,stunden:null,beschreibung:'',bereich:ar,projekt:pr?pr.id:'',_new:true};
  }
  sheetMode='zeit'; confirmDel=false; renderTime(); openSheet();
  if(editingZ._new) setTimeout(()=>{const f=$('#z-stunden'); if(f)f.focus();},60);
}
function projectOptions(){
  const z=editingZ, list=projects.filter(p=>p.bereich===z.bereich&&(p.status!=='erledigt'||p.id===z.projekt)).sort((a,b)=>score(b)-score(a));
  const cur=z.projekt&&!list.some(p=>p.id===z.projekt)?projects.find(p=>p.id===z.projekt):null;
  return `<option value="">Kein bestimmtes Projekt</option>`+(cur?[cur]:[]).concat(list).map(p=>`<option value="${esc(p.id)}" ${p.id===z.projekt?'selected':''}>${esc(p.titel)}</option>`).join('');
}
function renderTime(){
  const z=editingZ;
  $('#sheet').innerHTML=`
  <div class="sheet-head"><h2 id="sheetTitle">${z._new?'Zeit erfassen':'Eintrag bearbeiten'}</h2><button class="iconbtn" type="button" data-close aria-label="Schließen">✕</button></div>
  <div class="sheet-body">
    <div class="row two">
      <div class="field"><label for="z-datum">Datum</label><input type="date" id="z-datum" value="${esc(z.datum)}"></div>
      <div class="field"><label for="z-stunden">Stunden</label><input class="hours" type="text" inputmode="decimal" id="z-stunden" value="${z.stunden?fmtH(z.stunden):''}" placeholder="0" autocomplete="off"></div>
    </div>
    <div class="quick" role="group" aria-label="Schnellauswahl Stunden">${[0.5,1,1.5,2,3,4,8].map(h=>`<button type="button" data-qh="${h}">${fmtH(h)} h</button>`).join('')}</div>
    <p class="note" style="margin-top:-12px">Auch „1:30“ oder „1,5“ geht.</p>
    <div class="field"><span class="flabel">Bereich</span><div class="areapick" role="group" aria-label="Bereich">${areas.map(a=>`<button type="button" data-zarea="${esc(a.id)}" aria-pressed="${z.bereich===a.id}">${dot(a.id)}${esc(a.name)}</button>`).join('')}</div></div>
    <div class="field"><label for="z-projekt">Projekt (optional)</label><select id="z-projekt">${projectOptions()}</select></div>
    <div class="field"><label for="z-beschreibung">Beschreibung</label><textarea id="z-beschreibung" rows="2" placeholder="Was hast du gemacht?">${esc(z.beschreibung)}</textarea></div>
    <p class="err" id="z-err" hidden></p>
  </div>
  <div class="sheet-foot">
    <div>${z._new?'':(confirmDel?`<span style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap"><span>Eintrag löschen?</span><button class="btn danger solid small" type="button" data-zdelyes>Löschen</button><button class="btn small" type="button" data-delno>Abbrechen</button></span>`:`<button class="btn danger" type="button" data-zdel>Löschen</button>`)}</div>
    <div class="actions"><button class="btn ghost" type="button" data-close>Abbrechen</button><button class="btn primary" type="button" data-zsave>Speichern</button></div>
  </div>`;
}
function readTime(){
  const z=editingZ; z.datum=$('#z-datum').value; z.projekt=$('#z-projekt').value; z.beschreibung=$('#z-beschreibung').value.trim();
  z.stunden=parseHours($('#z-stunden').value);
}

/* ======================= Seitenblatt: Einstellungen ======================= */
function usage(id){return projects.filter(p=>p.bereich===id).length+zeiten.filter(z=>z.bereich===id).length;}
function renderSettings(){
  sheetMode='settings';
  const imp=pendingImport;
  $('#sheet').innerHTML=`<div class="sheet-head"><h2 id="sheetTitle">Einstellungen</h2><button class="iconbtn" type="button" data-close aria-label="Schließen">✕</button></div>
  <div class="sheet-body">
    <div class="section"><h3>Bereiche</h3>
      <p class="note">Benenne Bereiche um, gib ihnen eine Farbe oder lege neue an. Ein Bereich lässt sich nur löschen, wenn kein Projekt und keine Zeit mehr daran hängt.</p>
      <div class="arealist">${areas.map((a,i)=>{const u=usage(a.id); return `<div class="arow">
        <input type="text" data-aname="${i}" value="${esc(a.name)}" aria-label="Name des Bereichs">
        <div class="swatches" role="group" aria-label="Farbe">${PALETTE.map(c=>`<button type="button" data-acolor="${i}" data-c="${c}" style="--c:var(--${c})" aria-pressed="${a.farbe===c}" aria-label="Farbe ${c}"></button>`).join('')}</div>
        ${u?`<span class="used" title="${u} Projekte/Zeiteinträge">${u}× genutzt</span>`:`<button class="iconbtn" type="button" data-adel="${i}" aria-label="Bereich löschen">✕</button>`}</div>`;}).join('')}</div>
      <div class="addstep"><input type="text" id="f-newarea" placeholder="Neuer Bereich, z. B. Garten"><button class="btn" type="button" id="btn-addarea">Anlegen</button></div>
    </div>
    <hr class="sep">
    <div class="section"><h3>Gewichtung der Priorität</h3>
      <p class="note">Wie stark zählt jedes Kriterium? 0 schaltet es ab. Die Rangliste ändert sich sofort.</p>
      <div class="weights">${Object.keys(DEFAULT_W).map(k=>`<div class="wrow"><label for="w-${k}">${W_LABELS[k]}</label><input type="range" min="0" max="5" step="1" id="w-${k}" data-w="${k}" value="${weights[k]??0}"><span class="mono" id="wv-${k}">${weights[k]??0}</span></div>`).join('')}</div>
      <p class="note">Jedes Kriterium hat einen Wert von 1 bis 5. Aufwand und Kosten zählen umgekehrt. Die Saison zählt 5, wenn jetzt Saison ist, 4 im Monat davor, 1 außerhalb und 3 ohne Zeitfenster. Eine Frist in den nächsten 14 Tagen setzt die Dringlichkeit auf 5, in 45 Tagen auf mindestens 4. Der gewichtete Durchschnitt wird auf 0–100 umgerechnet.</p>
      <div><button class="btn small" type="button" data-wreset>Standard-Gewichtung</button></div>
    </div>
    <hr class="sep">
    <div class="section"><h3>Daten</h3>
      <p class="note">Sichere regelmäßig einen Export. Beim Import werden Einträge mit gleicher ID überschrieben, alles andere bleibt erhalten.</p>
      <div class="actions"><button class="btn" type="button" data-export>Export herunterladen</button><button class="btn" type="button" data-import>Export importieren …</button></div>
      ${imp?`<div class="confirm"><span>Gefunden: <b>${imp.counts.projects}</b> Projekte, <b>${imp.counts.zeiten}</b> Zeiteinträge${imp.counts.config?', Bereiche/Gewichtung':''}. Jetzt importieren?</span>
        <div class="actions"><button class="btn primary small" type="button" data-impyes>Importieren</button><button class="btn small" type="button" data-impno>Abbrechen</button></div></div>`:''}
    </div>
    ${cfg.demo?'':`<hr class="sep"><div class="section"><h3>Konto</h3><p class="note">Angemeldet als ${esc(user&&user.email)}.</p><div><button class="btn" type="button" data-logout>Abmelden</button></div></div>`}
  </div>
  <div class="sheet-foot"><span></span><button class="btn primary" type="button" data-close>Fertig</button></div>`;
}
function addArea(){
  const i=$('#f-newarea'); const n=i.value.trim(); if(!n)return;
  const used=areas.map(a=>a.farbe); const farbe=PALETTE.find(c=>!used.includes(c))||PALETTE[areas.length%PALETTE.length];
  const id=n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,30)||'bereich';
  areas=areas.concat([{id:areas.some(a=>a.id===id)?id+'-'+uid().slice(-4):id,name:n,farbe}]);
  saveAreas(); renderSettings(); render(); const f=$('#f-newarea'); if(f)f.focus();
}
function exportData(){
  const strip=o=>{const c={...o}; delete c.id; return c;};
  const out={format:'projektplan-export',version:1,exportiert:todayIso,
    projects:projects.map(p=>({id:p.id,...strip(p)})),zeiten:zeiten.map(z=>({id:z.id,...strip(z)})),
    config:{areas:{liste:areas},weights:{...weights}}};
  const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`projektplan-export-${todayIso}.json`;
  document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},1000);
  toast('Export heruntergeladen');
}
function parseImport(text){
  const d=JSON.parse(text);
  if(!d||d.format!=='projektplan-export')throw new Error('Das ist keine Export-Datei des Projektplans.');
  const rows=[];
  (d.projects||[]).forEach(p=>{if(p&&p.id){const c={...p}; delete c.id; rows.push({coll:'projects',id:String(p.id),data:c});}});
  (d.zeiten||[]).forEach(z=>{if(z&&z.id){const c={...z}; delete c.id; rows.push({coll:'zeiten',id:String(z.id),data:c});}});
  let conf=0;
  if(d.config&&d.config.areas&&Array.isArray(d.config.areas.liste)){rows.push({coll:'config',id:'areas',data:{liste:d.config.areas.liste}}); conf++;}
  if(d.config&&d.config.weights){rows.push({coll:'config',id:'weights',data:d.config.weights}); conf++;}
  return {rows,counts:{projects:rows.filter(r=>r.coll==='projects').length,zeiten:rows.filter(r=>r.coll==='zeiten').length,config:conf}};
}
$('#importFile').addEventListener('change',async e=>{
  const f=e.target.files&&e.target.files[0]; e.target.value=''; if(!f)return;
  try{ pendingImport=parseImport(await f.text()); renderSettings(); }
  catch(err){ pendingImport=null; renderSettings(); toast(err.message&&err.message.startsWith('Das ist')?err.message:'Datei konnte nicht gelesen werden.'); }
});

/* ======================= Ereignisse ======================= */
document.addEventListener('click',async e=>{
  const t=e.target.closest('button,[data-open],[data-stop]'); if(!t||$('#app').hidden&&!t.closest('#overlay'))return;
  if(t.dataset.area!==undefined&&t.classList.contains('chip')){ui.area=t.dataset.area; saveUi(); render(); return;}
  if(t.dataset.view){setView(t.dataset.view); return;}
  if(t.id==='btn-new'||t.hasAttribute('data-new')){openEditor(null);return;}
  if(t.id==='btn-settings'){pendingImport=null; renderSettings(); openSheet(); return;}
  if(t.id==='btn-time'||t.id==='fab'){openTime(null);return;}
  if(t.dataset.ztime!==undefined){openTime(null,t.dataset.ztime||null);return;}
  if(t.dataset.zedit){openTime(t.dataset.zedit);return;}
  if(t.dataset.ynav){ui.jahr+=Number(t.dataset.ynav); render(); return;}
  if(t.dataset.znav){ui.zmonat=ymShift(ui.zmonat,Number(t.dataset.znav)); render(); return;}
  if(t.hasAttribute('data-stop'))return;
  if(t.dataset.open){openEditor(t.dataset.open);return;}
  if(t.hasAttribute('data-close')){closeSheet();return;}
  // Einstellungen
  if(t.hasAttribute('data-wreset')){weights={...DEFAULT_W}; renderSettings(); render(); saveWeights(); return;}
  if(t.dataset.acolor!==undefined){const i=+t.dataset.acolor; areas=areas.map((a,j)=>j===i?{...a,farbe:t.dataset.c}:a); saveAreas(); renderSettings(); render(); return;}
  if(t.dataset.adel!==undefined){const i=+t.dataset.adel; if(usage(areas[i].id))return; areas=areas.filter((_,j)=>j!==i); if(ui.area!=='alle'&&!areas.some(a=>a.id===ui.area))ui.area='alle'; saveAreas(); renderSettings(); render(); return;}
  if(t.id==='btn-addarea'){addArea();return;}
  if(t.hasAttribute('data-export')){exportData();return;}
  if(t.hasAttribute('data-import')){$('#importFile').click();return;}
  if(t.hasAttribute('data-impno')){pendingImport=null; renderSettings(); return;}
  if(t.hasAttribute('data-impyes')&&pendingImport){
    const imp=pendingImport; t.disabled=true; t.textContent='Importiert …';
    try{ await store.putMany(imp.rows); pendingImport=null; await loadAll(); renderSettings(); toast(`${imp.counts.projects} Projekte und ${imp.counts.zeiten} Zeiten importiert`); }
    catch(err){ t.disabled=false; t.textContent='Importieren'; setBanner('Import fehlgeschlagen ('+(err.message||err)+').'); }
    return;}
  if(t.hasAttribute('data-logout')){closeSheet(); await store.signOut(); return;}
  // Zeit
  if(sheetMode==='zeit'&&editingZ){
    if(t.dataset.qh){$('#z-stunden').value=fmtH(Number(t.dataset.qh)); return;}
    if(t.dataset.zarea){readTime(); editingZ.bereich=t.dataset.zarea; const p=projects.find(x=>x.id===editingZ.projekt); if(p&&p.bereich!==editingZ.bereich)editingZ.projekt='';
      document.querySelectorAll('[data-zarea]').forEach(b=>b.setAttribute('aria-pressed',b===t)); $('#z-projekt').innerHTML=projectOptions(); return;}
    if(t.hasAttribute('data-zdel')){readTime(); confirmDel=true; renderTime(); return;}
    if(t.hasAttribute('data-delno')){confirmDel=false; renderTime(); return;}
    if(t.hasAttribute('data-zdelyes')){const id=editingZ.id; closeSheet(); try{await delDoc('zeiten',id); toast('Eintrag gelöscht');}catch(err){} return;}
    if(t.hasAttribute('data-zsave')){
      readTime(); const err=$('#z-err');
      const bad=!editingZ.stunden||isNaN(editingZ.stunden)?'Bitte die Stunden eintragen, z. B. 1,5 oder 1:30.':!editingZ.datum?'Bitte ein Datum wählen.':!editingZ.bereich?'Bitte einen Bereich wählen.':'';
      if(bad){err.textContent=bad; err.hidden=false; return;}
      const z={...editingZ}; delete z._new; z.stunden=Math.round(z.stunden*100)/100; if(!z.erstellt)z.erstellt=new Date().toISOString();
      ui.lastArea=z.bereich; saveUi();
      t.disabled=true; t.textContent='Speichert …';
      try{await saveZeit(z); closeSheet(); toast(`Gespeichert: ${fmtH(z.stunden)} h ${area(z.bereich).name}`);}catch(e2){t.disabled=false; t.textContent='Speichern';}
      return;}
    return;
  }
  // Projekt
  if(!editing)return;
  if(t.dataset.crit){readForm(); editing.scores[t.dataset.crit]=Number(t.dataset.v); t.parentElement.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b===t)); refreshPreview(); return;}
  if(t.dataset.month!==undefined){const m=Number(t.dataset.month); const a=editing.monate; const i=a.indexOf(m); i>=0?a.splice(i,1):a.push(m); a.sort((x,y)=>x-y); t.setAttribute('aria-pressed',i<0); refreshPreview(); return;}
  if(t.id==='btn-addstep'){addStep();return;}
  const st=editing.schritte;
  if(t.dataset.sup){const i=+t.dataset.sup; [st[i-1],st[i]]=[st[i],st[i-1]]; renderSteps(); return;}
  if(t.dataset.sdown){const i=+t.dataset.sdown; [st[i+1],st[i]]=[st[i],st[i+1]]; renderSteps(); return;}
  if(t.dataset.sdel){st.splice(+t.dataset.sdel,1); renderSteps(); return;}
  if(t.hasAttribute('data-del')){readForm(); confirmDel=true; renderEditor(); return;}
  if(t.hasAttribute('data-delno')){confirmDel=false; renderEditor(); return;}
  if(t.hasAttribute('data-delyes')){const id=editing.id; closeSheet(); try{await delDoc('projects',id); toast('Projekt gelöscht');}catch(err){} return;}
  if(t.hasAttribute('data-save')){
    readForm(); if(!editing.titel){const f=$('#f-titel'); f.focus(); f.placeholder='Bitte einen Titel eingeben'; return;}
    const p={...editing}; delete p._new; if(p.status==='erledigt'&&!p.abgeschlossen)p.abgeschlossen=todayIso;
    t.disabled=true; t.textContent='Speichert …';
    try{await saveProject(p); closeSheet();}catch(err){t.disabled=false; t.textContent='Speichern';}
    return;}
});
document.addEventListener('change',async e=>{
  const t=e.target;
  if(t.id==='showDone'){ui.showDone=t.checked; saveUi(); render(); return;}
  if(t.dataset.tick){
    const p=projects.find(x=>x.id===t.dataset.tick); if(!p)return;
    const copy=JSON.parse(JSON.stringify(p)); const s=copy.schritte.find(x=>x.id===t.dataset.step); if(s)s.erledigt=true;
    if(copy.status==='idee'||copy.status==='geplant')copy.status='aktiv';
    t.disabled=true; try{await saveProject(copy); toast('Schritt erledigt');}catch(err){t.checked=false; t.disabled=false;} return;}
  if(t.dataset.aname!==undefined){const i=+t.dataset.aname, n=t.value.trim(); if(!n){t.value=areas[i].name;return;} areas=areas.map((a,j)=>j===i?{...a,name:n}:a); saveAreas(); render(); return;}
  if(!editing)return;
  if(t.dataset.sdone!==undefined){editing.schritte[+t.dataset.sdone].erledigt=t.checked; t.closest('.step').classList.toggle('done',t.checked); return;}
  if(t.dataset.sdue!==undefined){editing.schritte[+t.dataset.sdue].faellig=t.value; return;}
  if(t.dataset.sh!==undefined){const h=parseHours(t.value); editing.schritte[+t.dataset.sh].stunden=(h&&!isNaN(h))?h:null; return;}
  if(t.id==='f-frist'){editing.frist=t.value; refreshPreview(); return;}
});
document.addEventListener('input',e=>{
  const t=e.target;
  if(t.dataset.w){weights[t.dataset.w]=Number(t.value); $('#wv-'+t.dataset.w).textContent=t.value; render(); saveWeights(); return;}
  if(editing&&t.dataset.stext!==undefined){editing.schritte[+t.dataset.stext].text=t.value;}
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!$('#overlay').hidden){closeSheet();return;}
  if(e.key==='Enter'&&e.target.id==='f-newstep'){e.preventDefault(); addStep(); return;}
  if(e.key==='Enter'&&e.target.id==='f-newarea'){e.preventDefault(); addArea(); return;}
  if(e.key==='Enter'&&e.target.id==='z-stunden'){e.preventDefault(); const b=document.querySelector('[data-zsave]'); if(b)b.click(); return;}
  if((e.key==='Enter'||e.key===' ')&&e.target.matches('.card[data-open]')){e.preventDefault(); openEditor(e.target.dataset.open);}
});
$('#overlay').addEventListener('mousedown',e=>{ if(e.target.id==='overlay') closeSheet(); });

// Offline-Start und "Zum Startbildschirm hinzufügen"
if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost')){
  window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}

boot();
})();
