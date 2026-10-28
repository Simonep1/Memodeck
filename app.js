'use strict';

// MemoDeck: il codice del sito viene servito da GitHub Pages;
// i contenuti dell'utente vivono solo nel suo browser o nei JSON esportati.
const STORAGE_KEY = 'memodeck.data.v1';
const COLORS = ['#7863e8','#329dba','#e3a04c','#54a68a','#de748e','#7183b8'];
const $ = (selector) => document.querySelector(selector);
const uid = () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const friendly = (value, fallback = '') => typeof value === 'string' ? value.trim() : fallback;
let storageErrorShown = false;
let toastTimer = null;
let editingCardId = null;
let editingDeckId = null;
let deleting = null;
let study = null;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {decks:[], activeDeckId:null};
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.decks)) throw Error('Formato non riconosciuto');
    return {decks:obj.decks, activeDeckId:obj.activeDeckId ?? null};
  } catch (e) {
    console.warn('Impossibile leggere i dati locali:', e);
    return {decks:[], activeDeckId:null};
  }
}
let state = load();

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) {
    console.warn('Salvataggio locale non disponibile:', e);
    if (!storageErrorShown) {
      storageErrorShown = true;
      toast('Salvataggio automatico non disponibile: usa Esporta JSON per non perdere i dati.', true);
    }
  }
}
function toast(msg, isError=false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}
function deckById(id) {return state.decks.find(d=>d.id===id);}
function activeDeck() {return deckById(state.activeDeckId);}
function countCards() {return state.decks.reduce((sum,d)=>sum+d.cards.length,0);}
function countReview() {return state.decks.reduce((sum,d)=>sum+d.cards.filter(c=>c.needsReview).length,0);}
function chosenColor(d) {return COLORS.includes(d?.color) ? d.color : COLORS[0];}
function tint(hex, alpha='20') {return `${hex}${alpha}`;}
function shortName(name) {return name.length > 30 ? name.slice(0,30) + '…' : name;}
function stopSidebar() {$('#sidebar').classList.remove('open');}

function render() {
  const nav = $('#deck-nav');
  nav.innerHTML = state.decks.length
    ? state.decks.map(d=> `<button class="deck-nav-item ${d.id===state.activeDeckId?'active':''}" type="button" data-action="select-deck" data-id="${esc(d.id)}"><span class="deck-color" style="background:${chosenColor(d)}"></span><span class="deck-nav-name">${esc(d.name)}</span><span class="deck-nav-count">${d.cards.length}</span></button>`).join('')
    : '<div style="color:#a6a9b6;font-size:11px;line-height:1.6;padding:5px 10px">Ancora nessun mazzo.</div>';
  $('#deck-count').textContent = String(state.decks.length);
  $('#sidebar-backup').disabled = state.decks.length===0;
  $('#breadcrumb-current').textContent = study ? 'Modalità studio' : activeDeck()?.name || 'Panoramica';
  $('#main-content').innerHTML = study ? studyPage() : activeDeck() ? deckPage(activeDeck()) : homePage();
}

function metric(label,num,note){return `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${num}</div><div class="metric-note">${note}</div></div>`;}
function deckTile(d) {
 const color = chosenColor(d);
 return `<button class="deck-tile" type="button" data-action="select-deck" data-id="${esc(d.id)}"><div class="tile-top"><span class="tile-icon" style="color:${color};background:${tint(color)}">▤</span><span class="tile-arrow">↗</span></div><div><h3>${esc(shortName(d.name))}</h3><p>${esc(d.description || 'Il tuo mazzo di flashcard')}</p></div><div class="tile-bottom">◫ ${d.cards.length} ${d.cards.length === 1 ? 'carta' : 'carte'}${d.cards.some(c=>c.needsReview) ? ` · ${d.cards.filter(c=>c.needsReview).length} da ripassare` : ''}</div></button>`;
}
function homePage() {
 return `<div class="page">
  <section class="hero"><div class="hero-content"><span class="eyebrow">✦ STUDIA A MODO TUO</span><h1>Un'idea alla volta.<br>Ricorda tutto.</h1><p>Crea le tue flashcard, metti alla prova la memoria e porta sempre con te i tuoi mazzi. Nessun account, nessun cloud.</p><button class="button" data-action="new-deck" type="button">+ Crea un nuovo mazzo</button></div><div class="hero-art" aria-hidden="true"><div class="art-card back"><small>DOMANDA</small>❔</div><div class="art-card"><small>RISPOSTA</small>✦</div></div></section>
  <div class="metric-grid">${metric('I tuoi mazzi',state.decks.length,'Materie e argomenti')}${metric('Flashcard totali',countCards(),'Tutte le tue domande')}${metric('Da ripassare',countReview(),'Carte segnate da rivedere')}</div>
  <div class="section-heading"><h2>I tuoi mazzi</h2><span>${state.decks.length} ${state.decks.length===1?'mazzo':'mazzi'}</span></div>
  ${state.decks.length ? `<div class="deck-grid">${state.decks.map(deckTile).join('')}</div>` : `<div class="empty-state"><div class="empty-icon">▤</div><h3>Parti dal tuo primo mazzo</h3><p>Puoi organizzare le flashcard per corso, esame o argomento.<br>Tutto quello che scrivi rimane su questo dispositivo.</p><button class="button button-primary" data-action="new-deck" type="button">+ Crea un mazzo</button></div>`}
  ${state.decks.length ? `<div class="review-callout"><div><strong>Le tue flashcard, al sicuro.</strong><p>Scarica un backup JSON e potrai riaprire i mazzi in qualsiasi momento, anche su un altro computer.</p></div><button class="button button-primary" data-action="export-all" type="button">↓ Scarica backup</button></div>` : ''}
 </div>`;
}
function deckPage(deck){
 const reviewed = deck.cards.filter(c=>c.lastReviewedAt).length;
 const known = deck.cards.filter(c=>c.lastReviewedAt&&!c.needsReview).length;
 const need = deck.cards.filter(c=>c.needsReview).length;
 return `<div class="page">
   <div class="deck-header"><div><span class="eyebrow">IL TUO MAZZO</span><h1>${esc(deck.name)}</h1><p>${esc(deck.description || 'Aggiungi carte e inizia a ripassare.')}</p></div><div class="deck-buttons"><button class="button button-outline button-small" data-action="export-deck" type="button">↓ Esporta JSON</button><button class="button button-outline button-small" data-action="edit-deck" type="button">⚙ Gestisci</button><button class="button button-primary button-small" data-action="start-study" type="button" ${!deck.cards.length?'disabled':''}>▷ Inizia a studiare</button></div></div>
   <div class="deck-stat-row"><div class="deck-stat"><strong>${deck.cards.length}</strong><small>Carte nel mazzo</small></div><div class="deck-stat"><strong class="green">${known}</strong><small>Conosciute all'ultimo ripasso</small></div><div class="deck-stat"><strong class="accent">${need}</strong><small>Da rivedere</small></div></div>
   <div class="tools-row"><h2>Flashcard <span style="color:#aaa;font-size:12px">(${deck.cards.length})</span></h2><div class="tools-right"><input id="card-search" class="search" type="search" aria-label="Cerca flashcard" placeholder="⌕ Cerca una carta..."><button class="button button-primary button-small" type="button" data-action="new-card">+ Aggiungi carta</button></div></div>
   <div id="cards-container">${cardsList(deck.cards)}</div>
   ${deck.cards.length ? `<div class="review-callout"><div><strong>Pronto per un ripasso?</strong><p>Gira le carte, verifica le risposte e ritrova quelle da rivedere durante la sessione.</p></div><button class="button button-primary" data-action="start-study" type="button">▷ Avvia ripasso</button></div>`:''}
 </div>`;
}
function cardsList(cards){
 if (!cards.length) return `<div class="empty-state compact"><div class="empty-icon">✦</div><h3>Nessuna flashcard, per ora</h3><p>Ogni carta ha una domanda e una risposta. Prova ad aggiungerne una.</p><button class="button button-primary" data-action="new-card" type="button">+ Prima flashcard</button></div>`;
 return `<div class="cards-list">${cards.map((card,i)=>`<article class="card-row"><div class="card-column"><small>DOMANDA ${i+1}</small><p>${esc(card.front)}</p>${card.needsReview?'<span class="review-badge">Da rivedere</span>':''}</div><div class="card-column"><small>RISPOSTA</small><p>${esc(card.back)}</p></div><div class="card-actions"><button class="icon-button" aria-label="Modifica carta" title="Modifica carta" type="button" data-action="edit-card" data-id="${esc(card.id)}">✎</button><button class="icon-button danger" aria-label="Elimina carta" title="Elimina carta" type="button" data-action="delete-card" data-id="${esc(card.id)}">×</button></div></article>`).join('')}</div>`;
}
function filterCards(){
 const el = $('#card-search');
 const deck = activeDeck();
 if (!el || !deck) return;
 const q=el.value.trim().toLocaleLowerCase('it');
 const matches=deck.cards.filter(c=>c.front.toLocaleLowerCase('it').includes(q)||c.back.toLocaleLowerCase('it').includes(q));
 $('#cards-container').innerHTML=matches.length ? cardsList(matches) : '<div class="empty-state compact"><h3>Nessun risultato</h3><p>Prova un altro termine di ricerca.</p></div>';
}
function setActive(id){if (!deckById(id)) return;state.activeDeckId=id;study=null;save();render();stopSidebar();window.scrollTo(0,0);}
function goHome(){state.activeDeckId=null;study=null;save();render();stopSidebar();window.scrollTo(0,0);}

function modal(title,html){$('#modal-title').textContent=title;$('#modal-body').innerHTML=html;$('#modal-layer').hidden=false;document.body.style.overflow='hidden';$('.modal').focus();}
function closeModal(){ $('#modal-layer').hidden=true;$('#modal-body').innerHTML='';document.body.style.overflow=''; editingDeckId=null;editingCardId=null;deleting=null; }
function colorPicker(active){return `<div class="form-field"><label>Colore del mazzo</label><div class="color-picker">${COLORS.map(color=>`<button class="color-option ${active===color?'selected':''}" style="background:${color}" type="button" data-action="pick-color" data-color="${color}" aria-label="Seleziona colore ${color}" aria-pressed="${active===color}"></button>`).join('')}</div><input id="deck-color" type="hidden" name="color" value="${active}"></div>`;}
function deckModal(id=null){
 editingDeckId=id;
 const deck=id?deckById(id):null;
 modal(deck?'Modifica mazzo':'Nuovo mazzo',`<form id="deck-form"><div class="form-field"><label for="deck-name">Nome del mazzo</label><input id="deck-name" name="name" maxlength="100" placeholder="Es. Cryptography" required value="${esc(deck?.name || '')}"></div><div class="form-field"><label for="deck-description">Descrizione (facoltativa)</label><textarea id="deck-description" name="description" maxlength="500" rows="2" placeholder="Es. Concetti ed esercizi per l'esame">${esc(deck?.description || '')}</textarea></div>${colorPicker(chosenColor(deck))}<div class="modal-footer">${deck?'<button type="button" class="button button-danger" data-action="delete-deck">Elimina</button>':''}<button class="button button-outline" type="button" data-action="close-modal">Annulla</button><button class="button button-primary" type="submit">${deck?'Salva modifiche':'Crea mazzo'}</button></div></form>`);
 $('#deck-name').focus();
}
function cardModal(id=null){
 const deck=activeDeck(); if(!deck) return;
 editingCardId=id;
 const card=id?deck.cards.find(c=>c.id===id):null;
 modal(card?'Modifica flashcard':'Nuova flashcard',`<form id="card-form"><div class="form-field"><label for="card-front">Domanda / fronte</label><textarea id="card-front" name="front" required maxlength="5000" rows="4" placeholder="Scrivi la domanda o il concetto...">${esc(card?.front || '')}</textarea></div><div class="form-field"><label for="card-back">Risposta / retro</label><textarea id="card-back" name="back" required maxlength="10000" rows="5" placeholder="Scrivi la risposta o la spiegazione...">${esc(card?.back || '')}</textarea></div><div class="modal-footer"><button class="button button-outline" type="button" data-action="close-modal">Annulla</button><button class="button button-primary" type="submit">${card?'Salva modifiche':'Aggiungi carta'}</button></div></form>`);
 $('#card-front').focus();
}
function commitDeck(form){
 const name= friendly(form.elements.name.value).slice(0,100);
 if (!name){toast('Inserisci un nome per il mazzo.',true);return;}
 const description=friendly(form.elements.description.value).slice(0,500);
 const color=COLORS.includes(form.elements.color.value)?form.elements.color.value:COLORS[0];
 if(editingDeckId){const deck=deckById(editingDeckId);if(!deck)return;Object.assign(deck,{name,description,color});toast('Mazzo aggiornato.');}
 else{const deck={id:uid(),name,description,color,createdAt:new Date().toISOString(),cards:[]};state.decks.unshift(deck);state.activeDeckId=deck.id;toast('Mazzo creato! Aggiungi la tua prima flashcard.');}
 save();closeModal();render();
}
function commitCard(form){
 const deck=activeDeck();if(!deck)return;
 const front=friendly(form.elements.front.value).slice(0,5000),back=friendly(form.elements.back.value).slice(0,10000);
 if(!front||!back){toast('Compila sia la domanda che la risposta.',true);return;}
 if(editingCardId){const card=deck.cards.find(c=>c.id===editingCardId);if(!card)return;Object.assign(card,{front,back,updatedAt:new Date().toISOString()});toast('Flashcard modificata.');}
 else{deck.cards.push({id:uid(),front,back,createdAt:new Date().toISOString(),needsReview:false,knownCount:0,reviewCount:0,lastReviewedAt:null});toast('Flashcard aggiunta.');}
 save();closeModal();render();
}
function confirmDelete(kind,id=null){
 deleting={kind,id};
 const isDeck=kind==='deck';
 modal(isDeck?'Eliminare il mazzo?':'Eliminare la flashcard?',`<p class="modal-description">${isDeck?'Questa operazione rimuove il mazzo e tutte le sue carte da questo browser.':'Questa operazione rimuove la carta dal mazzo.'} Non potrai annullarla, salvo che tu abbia un backup JSON precedente.</p><div class="modal-footer"><button class="button button-outline" type="button" data-action="close-modal">Annulla</button><button class="button button-danger" data-action="confirm-delete" type="button">Elimina definitivamente</button></div>`);
}
function commitDelete(){if(!deleting)return;
 if(deleting.kind==='deck'){state.decks=state.decks.filter(d=>d.id!==state.activeDeckId);state.activeDeckId=null;}
 else{const deck=activeDeck();if(deck)deck.cards=deck.cards.filter(c=>c.id!==deleting.id);}
 save();closeModal();render();toast('Elemento eliminato.');
}

function startStudy(){
 const deck=activeDeck();if(!deck||!deck.cards.length)return;
 const queue=deck.cards.map(c=>c.id);
 for(let i=queue.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[queue[i],queue[j]]=[queue[j],queue[i]];}
 study={deckId:deck.id,queue,index:0,flipped:false,mastered:new Set(),total:queue.length,retries:0,answered:0};
 render();window.scrollTo(0,0);
}
function studyPage(){
 const deck=deckById(study.deckId);if(!deck){study=null;return homePage();}
 if(study.index>=study.queue.length){
  return `<div class="page"><div class="study-finish"><div class="finish-icon">✦</div><h2>Ottimo ripasso!</h2><p>Hai completato tutte le <strong>${study.total}</strong> carte del mazzo <strong>${esc(deck.name)}</strong>. Hai segnato <strong>${study.retries}</strong> ${study.retries===1?'risposta':'risposte'} da rivedere durante la sessione.</p><button class="button button-primary" type="button" data-action="restart-study">▷ Ripassa ancora</button><button class="button button-outline" type="button" data-action="exit-study">Torna al mazzo</button></div></div>`;
 }
 const id=study.queue[study.index];const card=deck.cards.find(c=>c.id===id);
 if(!card){study.index++;return studyPage();}
 const percent=Math.round(study.mastered.size/study.total*100);
 return `<div class="page"><div class="study-top"><div><span class="eyebrow">MODALITÀ STUDIO</span><h1>${esc(deck.name)}</h1><p>Gira la carta e verifica quanto ricordi.</p></div><button class="button button-outline button-small" data-action="exit-study" type="button">← Esci</button></div>
 <div class="study-progress"><span>${study.mastered.size} di ${study.total} carte acquisite</span><strong>${percent}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
 <div class="flashcard-wrap"><div class="flashcard" id="study-card" role="button" aria-label="Gira la flashcard" tabindex="0" data-action="flip-card"><div class="flashcard-face"><div class="face-label">DOMANDA</div><div class="face-text">${esc(card.front)}</div><div class="face-hint">↻ Clicca sulla carta per vedere la risposta</div></div><div class="flashcard-face back"><div class="face-label">RISPOSTA</div><div class="face-text">${esc(card.back)}</div><div class="face-hint">↻ Clicca per tornare alla domanda</div></div></div></div>
 <div class="study-controls"><button class="button button-danger" data-action="mark-wrong" type="button" id="study-wrong" disabled>↻ Da rivedere</button><button class="button button-subtle" data-action="flip-card" type="button" id="study-toggle">Mostra risposta</button><button class="button button-primary" data-action="mark-correct" type="button" id="study-correct" disabled>✓ La so</button></div>
 <p class="keyboard-tip">Scorciatoie: <strong>Spazio</strong> gira · <strong>1</strong> da rivedere · <strong>2</strong> la so · <strong>Esc</strong> esci</p></div>`;
}
function flipCard(){if(!study||study.index>=study.queue.length)return;
 study.flipped=!study.flipped;
 $('#study-card')?.classList.toggle('flipped',study.flipped);
 $('#study-wrong').disabled=!study.flipped;
 $('#study-correct').disabled=!study.flipped;
 $('#study-toggle').textContent=study.flipped?'Mostra domanda':'Mostra risposta';
}
function answerCard(correct){
 if(!study||!study.flipped)return;
 const deck=deckById(study.deckId);if(!deck)return;
 const id=study.queue[study.index];const card=deck.cards.find(c=>c.id===id);
 if(!card){study.index++;render();return;}
 card.reviewCount=(Number(card.reviewCount)||0)+1;
 card.lastReviewedAt=new Date().toISOString();
 if(correct){card.knownCount=(Number(card.knownCount)||0)+1;card.needsReview=false;study.mastered.add(id);}
 else{card.needsReview=true;study.queue.push(id);study.retries++;}
 study.answered++;study.index++;study.flipped=false;save();render();
}

function makeDownload(content,fileName){
 try{
  const blob = new Blob([JSON.stringify(content,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');anchor.href=url;anchor.download=fileName;document.body.append(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
  toast('File JSON pronto: controlla la cartella Download.');
 }catch(e){console.error(e);toast('Non è stato possibile scaricare il file.',true);}
}
function fileSafe(name){return (name||'mazzo').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,60).replace(/^-|-$/g,'')||'mazzo';}
function exportDeck(){const deck=activeDeck();if(!deck)return;
 makeDownload({format:'memodeck',version:1,type:'deck',exportedAt:new Date().toISOString(),deck},`flashcard-${fileSafe(deck.name)}.json`);
}
function exportAll(){if(!state.decks.length){toast('Non ci sono mazzi da esportare.',true);return;}
 makeDownload({format:'memodeck',version:1,type:'backup',exportedAt:new Date().toISOString(),decks:state.decks},'memodeck-backup.json');
}
function sanitiseIncomingDeck(d){
 if(!d||typeof d.name!=='string'||!Array.isArray(d.cards)||d.cards.length>20000)throw new Error('Mazzo non valido');
 const name=d.name.trim().slice(0,100);if(!name)throw Error('Nome del mazzo mancante');
 return {id:uid(),name,description:friendly(d.description).slice(0,500),color:COLORS.includes(d.color)?d.color:COLORS[0],createdAt:new Date().toISOString(),cards:d.cards.map(c=>{
  if(!c||typeof c.front!=='string'||typeof c.back!=='string'||!c.front.trim()||!c.back.trim())throw new Error('Flashcard non valida');
  return {id:uid(),front:c.front.slice(0,5000),back:c.back.slice(0,10000),createdAt:new Date().toISOString(),needsReview:!!c.needsReview,knownCount:Number.isSafeInteger(c.knownCount)&&c.knownCount>=0?c.knownCount:0,reviewCount:Number.isSafeInteger(c.reviewCount)&&c.reviewCount>=0?c.reviewCount:0,lastReviewedAt:typeof c.lastReviewedAt==='string'?c.lastReviewedAt:null};
 })};
}
async function importFile(file){
 if(!file)return;
 if(file.size>8*1024*1024){toast('File troppo grande (massimo 8 MB).',true);return;}
 try{
  const parsed=JSON.parse(await file.text());
  if(parsed?.format!=='memodeck'||parsed?.version!==1)throw Error('Questo file non è un backup MemoDeck valido.');
  const inputDecks=parsed.type==='deck'?[parsed.deck]:parsed.type==='backup'?parsed.decks:null;
  if(!Array.isArray(inputDecks)||inputDecks.length>100)throw Error('Elenco dei mazzi non valido.');
  const decks=inputDecks.map(sanitiseIncomingDeck); // Valida tutto prima di modificare i dati salvati.
  if(!decks.length)throw Error('Il file non contiene mazzi.');
  state.decks=[...decks,...state.decks];state.activeDeckId=decks[0].id;study=null;save();render();stopSidebar();
  toast(`${decks.length} ${decks.length===1?'mazzo importato':'mazzi importati'} senza sovrascrivere i precedenti.`);
 }catch(e){console.error(e);toast(`Importazione fallita: ${e.message||'file non valido'}`,true);}
}

// Eventi delegati: funzionano anche per le carte generate dinamicamente.
document.addEventListener('click', (event)=>{
 const trigger=event.target.closest('[data-action]');
 if(!trigger)return;
 const action=trigger.dataset.action;
 switch(action){
 case 'new-deck':deckModal();break;
 case 'select-deck':setActive(trigger.dataset.id);break;
 case 'edit-deck':deckModal(state.activeDeckId);break;
 case 'delete-deck':confirmDelete('deck');break;
 case 'new-card':cardModal();break;
 case 'edit-card':cardModal(trigger.dataset.id);break;
 case 'delete-card':confirmDelete('card',trigger.dataset.id);break;
 case 'confirm-delete':commitDelete();break;
 case 'close-modal':closeModal();break;
 case 'pick-color':{
  $('#deck-color').value=trigger.dataset.color;
  document.querySelectorAll('.color-option').forEach(el=>{const selected=el===trigger;el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected));});break;
 }
 case 'start-study':case 'restart-study':startStudy();break;
 case 'exit-study':study=null;render();break;
 case 'flip-card':flipCard();break;
 case 'mark-wrong':answerCard(false);break;
 case 'mark-correct':answerCard(true);break;
 case 'export-deck':exportDeck();break;
 case 'export-all':exportAll();break;
 case 'go-home':goHome();break;
 }
});
document.addEventListener('submit',event=>{
 if(event.target.id==='deck-form'){event.preventDefault();commitDeck(event.target);}
 if(event.target.id==='card-form'){event.preventDefault();commitCard(event.target);}
});
document.addEventListener('input',event=>{if(event.target.id==='card-search')filterCards();});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&!$('#modal-layer').hidden){closeModal();return;}
 if(event.key==='Escape'&&study){study=null;render();return;}
 if(!study||!$('#modal-layer').hidden||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
 if(event.code==='Space'){event.preventDefault();flipCard();return;}
 if(event.key==='1'){event.preventDefault();answerCard(false);}
 if(event.key==='2'){event.preventDefault();answerCard(true);}
 if(event.key==='Enter'&&document.activeElement?.id==='study-card'){event.preventDefault();flipCard();}
});
$('#mobile-menu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
$('#sidebar-new-deck').addEventListener('click',()=>{stopSidebar();deckModal();});
$('#topbar-new-deck').addEventListener('click',()=>deckModal());
$('#sidebar-backup').addEventListener('click',exportAll);
$('#sidebar-import').addEventListener('click',()=>$('#import-file').click());
$('#import-file').addEventListener('change',async e=>{await importFile(e.target.files?.[0]);e.target.value='';});
$('.brand').addEventListener('click',e=>{e.preventDefault();goHome();});

// In caso di dati rimossi o mazzo attivo non valido, mostra la homepage.
if(!deckById(state.activeDeckId))state.activeDeckId=null;
render();
