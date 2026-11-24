'use strict';

// MemoDeck: il codice del sito viene servito da GitHub Pages;
// i contenuti dell'utente vivono solo nel suo browser o nei JSON esportati.
const STORAGE_KEY = 'memodeck.data.v1'; // Dati delle versioni precedenti, migrati senza cancellarli.
const DB_NAME = 'memodeck-local-v2';
const DB_STORE = 'app';
const MAX_ORIGINAL_IMAGE = 12 * 1024 * 1024;
const MAX_EMBEDDED_IMAGE = 3 * 1024 * 1024;
const MAX_IMPORT_FILE = 120 * 1024 * 1024;
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const COLORS = ['#7863e8','#329dba','#e3a04c','#54a68a','#de748e','#7183b8'];
const $ = (selector) => document.querySelector(selector);
const uid = () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const friendly = (value, fallback = '') => typeof value === 'string' ? value.trim() : fallback;
let storageErrorShown = false;
let toastTimer = null;
let editingCardId = null;
let editingImages = {front: null, back: null};
let imageBusy = 0;
let db = null;
let saveQueue = Promise.resolve();
let editingDeckId = null;
let editingGroupId = null;
let deleting = null;
let study = null;

function loadLegacy() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {decks:[], groups:[], activeDeckId:null, activeGroupId:null};
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.decks)) throw Error('Formato non riconosciuto');
    return {decks:obj.decks, groups:[], activeDeckId:obj.activeDeckId ?? null, activeGroupId:null};
  } catch (e) {
    console.warn('Impossibile leggere i dati locali:', e);
    return {decks:[], groups:[], activeDeckId:null, activeGroupId:null};
  }
}
let state = {decks:[], groups:[], activeDeckId:null, activeGroupId:null};

function openLocalDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(Error('IndexedDB non disponibile')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || Error('Impossibile aprire IndexedDB'));
    req.onblocked = () => reject(Error('Database bloccato da un’altra scheda'));
  });
}
function readLocalDB() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get('state');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
function writeLocalDB(snapshot) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(snapshot, 'state');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || Error('Errore di salvataggio'));
    tx.onabort = () => reject(tx.error || Error('Salvataggio interrotto'));
  });
}
function reportSaveError(e) {
  console.warn('Salvataggio locale non disponibile:', e);
  if (!storageErrorShown) {
    storageErrorShown = true;
    toast('Salvataggio automatico fallito. Scarica subito un backup JSON!', true);
  }
}
function save() {
  // La coda evita che due salvataggi veloci si sovrascrivano in ordine inverso.
  const snapshot = JSON.parse(JSON.stringify(state));
  if (db) {
    saveQueue = saveQueue.catch(() => {}).then(() => writeLocalDB(snapshot));
    saveQueue.catch(reportSaveError);
    return saveQueue;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return Promise.resolve();
  } catch (e) {
    reportSaveError(e);
    return Promise.resolve();
  }
}
async function initialize() {
  try {
    db = await openLocalDB();
    const saved = await readLocalDB();
    if (saved && Array.isArray(saved.decks)) {
      state = saved;
    } else {
      state = loadLegacy();
      if (state.decks.length) await save(); // Migra i vecchi mazzi senza toccarli.
    }
  } catch (e) {
    console.warn('IndexedDB non disponibile; modalità di compatibilità:', e);
    db = null;
    state = loadLegacy();
    toast('Archivio immagini non disponibile in questo browser. Prova GitHub Pages.', true);
  }
  // I dati v1-v4 non possedevano cartelle: rimangono intatti e senza assegnazione.
  if (!Array.isArray(state.groups)) state.groups = [];
  const validGroups = new Set(state.groups.map(g => g.id));
  state.decks.forEach(d => { if (!validGroups.has(d.groupId)) d.groupId = null; });
  if (!deckById(state.activeDeckId)) state.activeDeckId = null;
  if (!groupById(state.activeGroupId)) state.activeGroupId = null;
  if (state.activeDeckId) state.activeGroupId = null;
  render();
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
function groupById(id) {return state.groups.find(g => g.id === id);}
function activeGroup() {return groupById(state.activeGroupId);}
function decksInGroup(id) {return state.decks.filter(d => d.groupId === id);}
function groupStats(group) {
  const decks = decksInGroup(group.id);
  const cards = decks.flatMap(d => d.cards);
  const known = cards.filter(c => !!c.lastReviewedAt && !c.needsReview).length;
  const unknown = cards.filter(c => !!c.needsReview).length;
  return {decks:decks.length, cards:cards.length, known, unknown, unstudied:cards.length - known - unknown,
    knownAnswers:cards.reduce((n,c)=>n+(Number(c.knownCount)||0),0),
    totalAnswers:cards.reduce((n,c)=>n+(Number(c.reviewCount)||0),0)};
}
function countCards() {return state.decks.reduce((sum,d)=>sum+d.cards.length,0);}
function countReview() {return state.decks.reduce((sum,d)=>sum+d.cards.filter(c=>c.needsReview).length,0);}
// Ogni carta compare in un solo gruppo, in base all'ultima risposta registrata.
// I clic storici sono invece registrati separatamente, anche dopo più sessioni.
function deckStats(deck) {
  const known = deck.cards.filter(c => !!c.lastReviewedAt && !c.needsReview).length;
  const unknown = deck.cards.filter(c => !!c.needsReview).length;
  const unstudied = Math.max(0, deck.cards.length - known - unknown);
  const totalAnswers = deck.cards.reduce((n,c)=>n+(Number.isSafeInteger(c.reviewCount) && c.reviewCount>0 ? c.reviewCount : 0),0);
  const knownAnswers = deck.cards.reduce((n,c)=>n+(Number.isSafeInteger(c.knownCount) && c.knownCount>0 ? c.knownCount : 0),0);
  return {known,unknown,unstudied,totalAnswers,knownAnswers,unknownAnswers:Math.max(0,totalAnswers-knownAnswers)};
}
function shuffleArray(array) {
  for (let i=array.length-1;i>0;i--) {
    const j=Math.floor(Math.random()*(i+1));
    [array[i],array[j]]=[array[j],array[i]];
  }
  return array;
}
function shuffleControl(checked, where='deck') {
  return `<label class="shuffle-control"><input type="checkbox" data-shuffle-toggle="${where}" ${checked?'checked':''}><span>Mescola le carte <small>Ordine casuale</small></span></label>`;
}
function chosenColor(d) {return COLORS.includes(d?.color) ? d.color : COLORS[0];}
function tint(hex, alpha='20') {return `${hex}${alpha}`;}
function shortName(name) {return name.length > 30 ? name.slice(0,30) + '…' : name;}
function stopSidebar() {$('#sidebar').classList.remove('open');}

function render() {
  const nav = $('#deck-nav');
  const navDeck = d => `<button class="deck-nav-item ${d.id===state.activeDeckId?'active':''}" type="button" data-action="select-deck" data-id="${esc(d.id)}"><span class="deck-color" style="background:${chosenColor(d)}"></span><span class="deck-nav-name">${esc(d.name)}</span><span class="deck-nav-count">${d.cards.length}</span></button>`;
  const folders = state.groups.map(g => {
    const decks=decksInGroup(g.id);
    return `<div class="sidebar-folder"><button type="button" class="folder-nav-item ${g.id===state.activeGroupId?'active':''}" data-action="select-group" data-id="${esc(g.id)}"><span class="folder-icon">▣</span><span class="deck-nav-name">${esc(g.name)}</span><span class="deck-nav-count">${decks.length}</span></button><div class="sidebar-folder-decks">${decks.map(navDeck).join('')}</div></div>`;
  }).join('');
  const loose = state.decks.filter(d => !groupById(d.groupId));
  nav.innerHTML = (folders ? `<div class="nav-subheading">CARTELLE</div>${folders}<div class="nav-subheading nav-separator">SENZA CARTELLA</div>` : '') +
    (loose.length ? loose.map(navDeck).join('') : '<div class="nav-empty">Nessun mazzo in questa sezione.</div>');
  $('#deck-count').textContent = String(state.decks.length);
  $('#sidebar-backup').disabled = state.decks.length===0 && state.groups.length===0;
  $('#breadcrumb-current').textContent = study ? 'Modalità studio' : activeDeck()?.name || activeGroup()?.name || 'Panoramica';
  $('#main-content').innerHTML = study ? studyPage() : activeDeck() ? deckPage(activeDeck()) : activeGroup() ? groupPage(activeGroup()) : homePage();
}

function metric(label,num,note){return `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${num}</div><div class="metric-note">${note}</div></div>`;}
function deckTile(d) {
 const color = chosenColor(d);
 const stats = deckStats(d);
 return `<button class="deck-tile" type="button" data-action="select-deck" data-id="${esc(d.id)}"><div class="tile-top"><span class="tile-icon" style="color:${color};background:${tint(color)}">▤</span><span class="tile-arrow">↗</span></div><div><h3>${esc(shortName(d.name))}</h3><p>${esc(d.description || 'Il tuo mazzo di flashcard')}</p></div><div class="tile-bottom">◫ ${d.cards.length} ${d.cards.length === 1 ? 'carta' : 'carte'}</div><div class="tile-stats"><span class="known-pill">✓ ${stats.known} la so</span><span class="unknown-pill">✕ ${stats.unknown} non la so</span><span class="new-pill">${stats.unstudied} nuove</span></div></button>`;
}
function groupTile(g) {
 const stats=groupStats(g);
 const color=chosenColor(g);
 return `<button class="deck-tile group-tile" data-action="select-group" data-id="${esc(g.id)}" type="button"><div class="tile-top"><span class="tile-icon" style="color:${color};background:${tint(color)}">▣</span><span class="tile-arrow">↗</span></div><div><h3>${esc(shortName(g.name))}</h3><p>${esc(g.description || 'Una raccolta di mazzi da studiare insieme')}</p></div><div class="tile-bottom">${stats.decks} ${stats.decks===1?'mazzo':'mazzi'} · ${stats.cards} carte</div><div class="tile-stats"><span class="known-pill">✓ ${stats.known} la so</span><span class="unknown-pill">✕ ${stats.unknown} non la so</span></div></button>`;
}
function groupPage(group) {
 const decks=decksInGroup(group.id), stats=groupStats(group);
 return `<div class="page"><div class="deck-header"><div><span class="eyebrow">CARTELLA DI MAZZI</span><h1>▣ ${esc(group.name)}</h1><p>${esc(group.description || 'Riunisci più lezioni e ripassale in una sola sessione.')}</p></div><div class="deck-buttons"><button class="button button-outline button-small" data-action="export-group" type="button">↓ Esporta cartella</button><button class="button button-outline button-small" data-action="edit-group" type="button">⚙ Gestisci</button><button class="button button-primary button-small" data-action="start-group-study" type="button" ${!stats.cards?'disabled':''}>▷ Studia tutti i mazzi</button></div></div>
 <div class="deck-stat-row"><div class="deck-stat"><strong>${stats.cards}</strong><small>${stats.decks} mazzi · totale carte</small></div><div class="deck-stat"><strong class="green">${stats.known}</strong><small>La so</small></div><div class="deck-stat"><strong class="coral">${stats.unknown}</strong><small>Non la so</small></div><div class="deck-stat"><strong class="accent">${stats.unstudied}</strong><small>Mai studiate</small></div></div>
 <p class="stats-explainer">Le statistiche sommano le carte di tutti i mazzi della cartella, una volta ciascuna. Risposte registrate: <strong>${stats.knownAnswers} «La so»</strong> · <strong>${Math.max(0,stats.totalAnswers-stats.knownAnswers)} «Non la so»</strong>.</p>
 <div class="tools-row"><h2>Mazzi in questa cartella <span class="muted-count">(${decks.length})</span></h2><button class="button button-primary button-small" data-action="new-deck-in-group" type="button">+ Nuovo mazzo qui</button></div>
 ${decks.length ? `<div class="deck-grid">${decks.map(deckTile).join('')}</div><div class="review-callout"><div><strong>Ripassa tutte le lezioni insieme.</strong><p>Ogni flashcard viene mostrata una sola volta, anche se appartiene a mazzi differenti. Le statistiche dei singoli mazzi si aggiornano automaticamente.</p>${shuffleControl(!!group.shuffleStudy,'group')}</div><button class="button button-primary" data-action="start-group-study" type="button" ${!stats.cards?'disabled':''}>▷ Studia la cartella</button></div>`:
 `<div class="empty-state compact"><div class="empty-icon">▣</div><h3>La cartella è vuota</h3><p>Crea un mazzo qui oppure modifica un mazzo esistente e assegnalo alla cartella.</p><button class="button button-primary" data-action="new-deck-in-group" type="button">+ Aggiungi il primo mazzo</button></div>`}
 </div>`;
}
function homePage() {
 const loose=state.decks.filter(d=>!groupById(d.groupId));
 return `<div class="page">
  <section class="hero"><div class="hero-content"><span class="eyebrow">✦ STUDIA A MODO TUO</span><h1>Un'idea alla volta.<br>Ricorda tutto.</h1><p>Organizza i mazzi in cartelle, ripassa le lezioni insieme e salva tutto localmente, anche le immagini.</p><div class="hero-actions"><button class="button" data-action="new-deck" type="button">+ Nuovo mazzo</button><button class="button button-hero-alt" data-action="new-group" type="button">▣ Nuova cartella</button></div></div><div class="hero-art" aria-hidden="true"><div class="art-card back"><small>DOMANDA</small>❔</div><div class="art-card"><small>RISPOSTA</small>✦</div></div></section>
  <div class="metric-grid">${metric('Cartelle',state.groups.length,'Lezioni raggruppate')}${metric('I tuoi mazzi',state.decks.length,'Tutti i tuoi argomenti')}${metric('Flashcard totali',countCards(),'Carte da studiare')}</div>
  ${state.groups.length ? `<div class="section-heading"><h2>Le tue cartelle</h2><span>${state.groups.length} ${state.groups.length===1?'cartella':'cartelle'}</span></div><div class="deck-grid">${state.groups.map(groupTile).join('')}</div>` : `<div class="section-heading"><h2>Organizza le lezioni</h2><span>Nuova funzione</span></div><div class="folder-suggestion"><div><strong>Raggruppa i mazzi in cartelle</strong><p>Ad esempio, inserisci Lezione 1, Lezione 2 e Lezione 3 in “Cryptography”, e studiale tutte insieme.</p></div><button class="button button-outline button-small" type="button" data-action="new-group">+ Crea cartella</button></div>`}
  <div class="section-heading"><h2>${state.groups.length?'Mazzi senza cartella':'I tuoi mazzi'}</h2><span>${loose.length} ${loose.length===1?'mazzo':'mazzi'}</span></div>
  ${loose.length ? `<div class="deck-grid">${loose.map(deckTile).join('')}</div>` : state.decks.length===0 && !state.groups.length ? `<div class="empty-state"><div class="empty-icon">▤</div><h3>Parti dal tuo primo mazzo</h3><p>Puoi creare flashcard con testi e immagini per ogni lezione.</p><button class="button button-primary" data-action="new-deck" type="button">+ Crea un mazzo</button></div>` : `<div class="muted-empty">${state.groups.length?'Tutti i mazzi sono già organizzati in cartelle.':'Nessun mazzo da mostrare.'}</div>`}
  ${state.decks.length ? `<div class="review-callout"><div><strong>Le tue flashcard, al sicuro.</strong><p>Il backup JSON completo conserva cartelle, mazzi, statistiche e immagini incorporate.</p></div><button class="button button-primary" data-action="export-all" type="button">↓ Scarica backup</button></div>` : ''}
 </div>`;
}
function deckPage(deck){
 const stats=deckStats(deck);
 return `<div class="page">
   <div class="deck-header"><div><span class="eyebrow">IL TUO MAZZO${groupById(deck.groupId)?` · <button class="group-inline-link" type="button" data-action="select-group" data-id="${esc(deck.groupId)}">▣ ${esc(groupById(deck.groupId).name)}</button>`:''}</span><h1>${esc(deck.name)}</h1><p>${esc(deck.description || 'Aggiungi carte e inizia a ripassare.')}</p></div><div class="deck-buttons"><button class="button button-outline button-small" data-action="export-deck" type="button">↓ Esporta JSON</button><button class="button button-outline button-small" data-action="edit-deck" type="button">⚙ Gestisci</button><button class="button button-primary button-small" data-action="start-study" type="button" ${!deck.cards.length?'disabled':''}>▷ Inizia a studiare</button></div></div>
   <div class="deck-stat-row"><div class="deck-stat"><strong>${deck.cards.length}</strong><small>Carte nel mazzo</small></div><div class="deck-stat"><strong class="green">${stats.known}</strong><small>La so</small></div><div class="deck-stat"><strong class="coral">${stats.unknown}</strong><small>Non la so</small></div><div class="deck-stat"><strong class="accent">${stats.unstudied}</strong><small>Mai studiate</small></div></div>
   <p class="stats-explainer">Ogni carta è contata una volta, in base alla tua <strong>ultima risposta</strong>. Risposte registrate nel tempo: <strong>${stats.knownAnswers} «La so»</strong> · <strong>${stats.unknownAnswers} «Non la so»</strong>.</p>
   <div class="tools-row"><h2>Flashcard <span style="color:#aaa;font-size:12px">(${deck.cards.length})</span></h2><div class="tools-right"><input id="card-search" class="search" type="search" aria-label="Cerca flashcard" placeholder="⌕ Cerca una carta..."><button class="button button-primary button-small" type="button" data-action="new-card">+ Aggiungi carta</button></div></div>
   <div id="cards-container">${cardsList(deck.cards)}</div>
   ${deck.cards.length ? `<div class="review-callout"><div><strong>Pronto per un ripasso?</strong><p>«La so» e «Non la so» vengono entrambe contate e fanno passare alla prossima carta. Nessuna carta si ripete durante la sessione.</p>${shuffleControl(!!deck.shuffleStudy)}</div><button class="button button-primary" data-action="start-study" type="button">▷ Avvia ripasso</button></div>`:''}
 </div>`;
}
// Immagini incorporate nel mazzo (data URL). Non vengono inviate a server esterni.
function isValidImage(src) {
  return typeof src === 'string' && src.length <= MAX_EMBEDDED_IMAGE * 4 / 3 + 256 &&
    /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src);
}
function cardSide(card, side, context='list') {
  const content = side === 'front' ? card.front : card.back;
  const image = side === 'front' ? card.frontImage : card.backImage;
  return `${content ? `<p class="side-text">${esc(content)}</p>` : ''}${isValidImage(image) ? `<img class="side-image ${context==='list'?'side-image-thumb':'side-image-study'}" src="${image}" alt="Immagine della ${side==='front'?'domanda':'risposta'}" ${context==='list'?'loading="lazy"':''}>` : ''}`;
}
function imagePicker(side, label) {
  return `<div class="image-picker form-field"><label for="image-${side}">${label} (facoltativa)</label>
    <input id="image-${side}" class="image-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-image-side="${side}">
    <small class="image-help">PNG, JPG, WEBP o GIF (i GIF vengono salvati come immagini statiche). L'immagine verrà ottimizzata per il salvataggio locale.</small>
    <div id="image-preview-${side}" class="image-preview"></div>
  </div>`;
}
function refreshImagePreview(side) {
  const el = $(`#image-preview-${side}`); if (!el) return;
  const image = editingImages[side];
  el.innerHTML = isValidImage(image)
    ? `<img src="${image}" alt="Anteprima dell'immagine"><button class="button button-outline button-small" type="button" data-action="remove-image" data-side="${side}">× Rimuovi immagine</button>`
    : '<span class="no-image">Nessuna immagine selezionata</span>';
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error('Lettura immagine non riuscita'));
    reader.readAsDataURL(file);
  });
}
function convertImage(file) {
  if (!file || !IMAGE_MIMES.includes(file.type)) return Promise.reject(Error('Formato non supportato: scegli PNG, JPG, WEBP o GIF.'));
  if (file.size > MAX_ORIGINAL_IMAGE) return Promise.reject(Error('L’immagine originale supera 12 MB.'));
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    const release = () => URL.revokeObjectURL(objectUrl);
    img.onerror = () => {release(); reject(Error('Impossibile aprire questa immagine.'));};
    img.onload = async () => {
      release();
      try {
        const ratio = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(done => canvas.toBlob(done, 'image/webp', 0.9));
        if (!blob) throw Error('Conversione immagine non riuscita.');
        if (blob.size > MAX_EMBEDDED_IMAGE) throw Error('Immagine troppo grande anche dopo l’ottimizzazione (limite 3 MB).');
        const encoded = await fileToDataUrl(blob);
        if (!isValidImage(encoded)) throw Error('Formato immagine non valido.');
        resolve(encoded);
      } catch (e) { reject(e); }
    };
    img.src = objectUrl;
  });
}
async function onImagePicked(input) {
  const side = input.dataset.imageSide;
  const file = input.files && input.files[0];
  if (!file || !['front','back'].includes(side)) return;
  imageBusy++;
  const submit = $('#save-card-button');
  if (submit) {submit.disabled=true; submit.textContent='Elaborazione immagine…';}
  try {
    const result = await convertImage(file);
    if ($('#card-form')) {editingImages[side] = result; refreshImagePreview(side);toast('Immagine pronta da salvare.');}
  } catch (e) { toast(e.message || 'Immagine non valida.', true); }
  finally {
    input.value=''; imageBusy--;
    if (submit && $('#card-form')) {submit.disabled = imageBusy > 0;submit.textContent=editingCardId?'Salva modifiche':'Aggiungi carta';}
  }
}
function cardsList(cards){
 if (!cards.length) return `<div class="empty-state compact"><div class="empty-icon">✦</div><h3>Nessuna flashcard, per ora</h3><p>Ogni lato può contenere testo, immagini o entrambi.</p><button class="button button-primary" data-action="new-card" type="button">+ Prima flashcard</button></div>`;
 return `<div class="cards-list">${cards.map((card,i)=>`<article class="card-row"><div class="card-column"><small>DOMANDA ${i+1}</small>${cardSide(card,'front')}${card.needsReview?'<span class="review-badge">✕ Non la so</span>':card.lastReviewedAt?'<span class="known-badge">✓ La so</span>':'<span class="unseen-badge">Mai studiata</span>'}</div><div class="card-column"><small>RISPOSTA</small>${cardSide(card,'back')}</div><div class="card-actions"><button class="icon-button" aria-label="Modifica carta" title="Modifica carta" type="button" data-action="edit-card" data-id="${esc(card.id)}">✎</button><button class="icon-button danger" aria-label="Elimina carta" title="Elimina carta" type="button" data-action="delete-card" data-id="${esc(card.id)}">×</button></div></article>`).join('')}</div>`;
}
function filterCards(){
 const el = $('#card-search');
 const deck = activeDeck();
 if (!el || !deck) return;
 const q=el.value.trim().toLocaleLowerCase('it');
 const matches=deck.cards.filter(c=>c.front.toLocaleLowerCase('it').includes(q)||c.back.toLocaleLowerCase('it').includes(q));
 $('#cards-container').innerHTML=matches.length ? cardsList(matches) : '<div class="empty-state compact"><h3>Nessun risultato</h3><p>Prova un altro termine di ricerca.</p></div>';
}
function setActive(id){if (!deckById(id)) return;state.activeDeckId=id;state.activeGroupId=null;study=null;save();render();stopSidebar();window.scrollTo(0,0);}
function selectGroup(id){if (!groupById(id)) return;state.activeGroupId=id;state.activeDeckId=null;study=null;save();render();stopSidebar();window.scrollTo(0,0);}
function goHome(){state.activeDeckId=null;state.activeGroupId=null;study=null;save();render();stopSidebar();window.scrollTo(0,0);}

function modal(title,html){$('#modal-title').textContent=title;$('#modal-body').innerHTML=html;$('#modal-layer').hidden=false;document.body.style.overflow='hidden';$('.modal').focus();}
function closeModal(){ $('#modal-layer').hidden=true;$('#modal-body').innerHTML='';document.body.style.overflow=''; editingDeckId=null;editingGroupId=null;editingCardId=null;deleting=null; }
function colorPicker(active){return `<div class="form-field"><label>Colore</label><div class="color-picker">${COLORS.map(color=>`<button class="color-option ${active===color?'selected':''}" style="background:${color}" type="button" data-action="pick-color" data-color="${color}" aria-label="Seleziona colore ${color}" aria-pressed="${active===color}"></button>`).join('')}</div><input id="deck-color" type="hidden" name="color" value="${active}"></div>`;}
function groupModal(id=null) {
 editingGroupId=id;
 const group=id?groupById(id):null;
 modal(group?'Modifica cartella':'Nuova cartella',`<form id="group-form"><div class="form-field"><label for="group-name">Nome della cartella</label><input id="group-name" name="name" maxlength="100" placeholder="Es. Cryptography" required value="${esc(group?.name||'')}"></div><div class="form-field"><label for="group-description">Descrizione (facoltativa)</label><textarea id="group-description" name="description" maxlength="500" rows="2" placeholder="Es. Tutte le lezioni del corso">${esc(group?.description||'')}</textarea></div>${colorPicker(chosenColor(group))}<div class="modal-footer">${group?'<button class="button button-danger" type="button" data-action="delete-group">Elimina cartella</button>':''}<button class="button button-outline" type="button" data-action="close-modal">Annulla</button><button class="button button-primary" type="submit">${group?'Salva':'Crea cartella'}</button></div></form>`);
 $('#group-name').focus();
}
function commitGroup(form) {
 const name=friendly(form.elements.name.value).slice(0,100);
 if(!name){toast('Inserisci un nome per la cartella.',true);return;}
 const description=friendly(form.elements.description.value).slice(0,500);
 const color=COLORS.includes(form.elements.color.value)?form.elements.color.value:COLORS[0];
 if(editingGroupId) {const group=groupById(editingGroupId);if(!group)return;Object.assign(group,{name,description,color});toast('Cartella aggiornata.');}
 else {const group={id:uid(),name,description,color,shuffleStudy:false,createdAt:new Date().toISOString()};state.groups.unshift(group);state.activeGroupId=group.id;state.activeDeckId=null;toast('Cartella creata. Puoi aggiungere mazzi nuovi o esistenti.');}
 save();closeModal();render();
}
function groupSelector(selected=null){return `<div class="form-field"><label for="deck-group">Cartella (facoltativa)</label><select id="deck-group" name="groupId"><option value="">Nessuna cartella</option>${state.groups.map(g=>`<option value="${esc(g.id)}" ${selected===g.id?'selected':''}>${esc(g.name)}</option>`).join('')}</select><small class="image-help">Puoi spostare un mazzo in un'altra cartella quando vuoi, senza perdere le flashcard.</small></div>`;}
function deckModal(id=null,selectedGroupId=null){
 editingDeckId=id;
 const deck=id?deckById(id):null;
 modal(deck?'Modifica mazzo':'Nuovo mazzo',`<form id="deck-form"><div class="form-field"><label for="deck-name">Nome del mazzo</label><input id="deck-name" name="name" maxlength="100" placeholder="Es. Cryptography" required value="${esc(deck?.name || '')}"></div><div class="form-field"><label for="deck-description">Descrizione (facoltativa)</label><textarea id="deck-description" name="description" maxlength="500" rows="2" placeholder="Es. Concetti ed esercizi per l'esame">${esc(deck?.description || '')}</textarea></div>${colorPicker(chosenColor(deck))}${groupSelector(deck?.groupId||selectedGroupId)}<div class="modal-footer">${deck?'<button type="button" class="button button-danger" data-action="delete-deck">Elimina</button>':''}<button class="button button-outline" type="button" data-action="close-modal">Annulla</button><button class="button button-primary" type="submit">${deck?'Salva modifiche':'Crea mazzo'}</button></div></form>`);
 $('#deck-name').focus();
}
function cardModal(id=null){
 const deck=activeDeck(); if(!deck) return;
 editingCardId=id;
 const card=id?deck.cards.find(c=>c.id===id):null;
 editingImages = {front:card?.frontImage || null, back:card?.backImage || null};
 imageBusy=0;
 modal(card?'Modifica flashcard':'Nuova flashcard',`<form id="card-form">
  <div class="form-field"><label for="card-front">Domanda / fronte</label><textarea id="card-front" name="front" maxlength="5000" rows="3" placeholder="Scrivi la domanda o aggiungi un'immagine…">${esc(card?.front || '')}</textarea></div>
  ${imagePicker('front','Immagine della domanda')}
  <div class="form-field"><label for="card-back">Risposta / retro</label><textarea id="card-back" name="back" maxlength="10000" rows="4" placeholder="Scrivi la risposta o aggiungi un'immagine…">${esc(card?.back || '')}</textarea></div>
  ${imagePicker('back','Immagine della risposta')}
  <div class="modal-footer"><button class="button button-outline" type="button" data-action="close-modal">Annulla</button><button id="save-card-button" class="button button-primary" type="submit">${card?'Salva modifiche':'Aggiungi carta'}</button></div>
 </form>`);
 refreshImagePreview('front');refreshImagePreview('back');
 $('#card-front').focus();
}
function commitDeck(form){
 const name= friendly(form.elements.name.value).slice(0,100);
 if (!name){toast('Inserisci un nome per il mazzo.',true);return;}
 const description=friendly(form.elements.description.value).slice(0,500);
 const color=COLORS.includes(form.elements.color.value)?form.elements.color.value:COLORS[0];
 const groupId=groupById(form.elements.groupId.value)?.id || null;
 if(editingDeckId){const deck=deckById(editingDeckId);if(!deck)return;Object.assign(deck,{name,description,color,groupId});toast('Mazzo aggiornato.');}
 else{const deck={id:uid(),name,description,color,groupId,shuffleStudy:false,createdAt:new Date().toISOString(),cards:[]};state.decks.unshift(deck);state.activeDeckId=deck.id;state.activeGroupId=null;toast('Mazzo creato! Aggiungi la tua prima flashcard.');}
 save();closeModal();render();
}
async function commitCard(form){
 const deck=activeDeck();if(!deck || imageBusy > 0) return;
 const front=friendly(form.elements.front.value).slice(0,5000);
 const back=friendly(form.elements.back.value).slice(0,10000);
 const frontImage=editingImages.front, backImage=editingImages.back;
 if ((!front && !frontImage) || (!back && !backImage)) {toast('Ogni lato deve avere almeno un testo o un’immagine.',true);return;}
 if (editingCardId) {
   const card=deck.cards.find(c=>c.id===editingCardId);if(!card)return;
   Object.assign(card,{front,back,frontImage,backImage,updatedAt:new Date().toISOString()});
 } else {
   deck.cards.push({id:uid(),front,back,frontImage,backImage,createdAt:new Date().toISOString(),needsReview:false,knownCount:0,reviewCount:0,lastReviewedAt:null});
 }
 try {await save();toast(editingCardId?'Flashcard modificata.':'Flashcard aggiunta.');}
 catch (e) {toast('Non è stato possibile salvare la carta: scarica un backup prima di chiudere.',true);}
 closeModal();render();
}
function confirmDelete(kind,id=null){
 deleting={kind,id};
 const title=kind==='group'?'Eliminare la cartella?':kind==='deck'?'Eliminare il mazzo?':'Eliminare la flashcard?';
 const message=kind==='group'?'I mazzi e tutte le loro flashcard verranno conservati e spostati in «Senza cartella».':kind==='deck'?'Questa operazione rimuove il mazzo e tutte le sue carte da questo browser.':'Questa operazione rimuove la carta dal mazzo.';
 modal(title,`<p class="modal-description">${message} ${kind==='group'?'':'Non potrai annullarla, salvo che tu abbia un backup JSON precedente.'}</p><div class="modal-footer"><button class="button button-outline" type="button" data-action="close-modal">Annulla</button><button class="button button-danger" data-action="confirm-delete" type="button">${kind==='group'?'Elimina solo la cartella':'Elimina definitivamente'}</button></div>`);
}
function commitDelete(){if(!deleting)return;
 if(deleting.kind==='group'){
  const id=deleting.id || state.activeGroupId;
  state.groups=state.groups.filter(g=>g.id!==id);
  state.decks.forEach(d=>{if(d.groupId===id)d.groupId=null;});
  state.activeGroupId=null;
 }else if(deleting.kind==='deck'){state.decks=state.decks.filter(d=>d.id!==state.activeDeckId);state.activeDeckId=null;}
 else{const deck=activeDeck();if(deck)deck.cards=deck.cards.filter(c=>c.id!==deleting.id);}
 save();closeModal();render();toast('Elemento eliminato.');
}

function studyContext() {
 if(!study)return null;
 const owner=study.type==='group'?groupById(study.ownerId):deckById(study.ownerId);
 return owner?{owner,isGroup:study.type==='group'}:null;
}
function startStudy(type='deck'){
 const owner=type==='group'?activeGroup():activeDeck();
 if(!owner)return;
 const queue=type==='group'
  ? decksInGroup(owner.id).flatMap(d=>d.cards.map(c=>({deckId:d.id,cardId:c.id})))
  : owner.cards.map(c=>({deckId:owner.id,cardId:c.id}));
 if(!queue.length)return;
 if(owner.shuffleStudy)shuffleArray(queue);
 study={type,ownerId:owner.id,queue,index:0,flipped:false,total:queue.length,answered:0,sessionKnown:0,sessionUnknown:0};
 render();window.scrollTo(0,0);
}
// Mescoliamo soltanto le carte ancora da vedere; la carta attuale non cambia.
function setStudyShuffle(enabled) {
 const context=studyContext();
 const owner=context?.owner || activeDeck() || activeGroup();
 if(!owner)return;
 owner.shuffleStudy=enabled;
 if(study && study.index < study.queue.length) {
   const currentAndDone=study.queue.slice(0,study.index+1);
   const remaining=study.queue.slice(study.index+1);
   if(enabled)shuffleArray(remaining);
   else {
     const ordered=study.type==='group'
       ? decksInGroup(owner.id).flatMap(d=>d.cards.map(c=>`${d.id}:${c.id}`))
       : owner.cards.map(c=>`${owner.id}:${c.id}`);
     const position=new Map(ordered.map((key,i)=>[key,i]));
     remaining.sort((a,b)=>(position.get(`${a.deckId}:${a.cardId}`)??Infinity)-(position.get(`${b.deckId}:${b.cardId}`)??Infinity));
   }
   study.queue=currentAndDone.concat(remaining);
 }
 save();render();
}
function studyPage(){
 const context=studyContext();if(!context){study=null;return homePage();}
 const {owner,isGroup}=context;
 if(study.index>=study.queue.length){
  return `<div class="page"><div class="study-finish"><div class="finish-icon">✦</div><h2>Ripasso completato!</h2><p>Hai studiato <strong>${study.total}</strong> carte ${isGroup?'dei mazzi nella cartella':'del mazzo'} <strong>${esc(owner.name)}</strong>. Anche le risposte «Non la so» sono state conteggiate.</p><div class="finish-stats"><div><strong class="green">${study.sessionKnown}</strong><small>La so</small></div><div><strong class="coral">${study.sessionUnknown}</strong><small>Non la so</small></div></div><button class="button button-primary" type="button" data-action="restart-study">▷ Ripassa ancora</button><button class="button button-outline" type="button" data-action="exit-study">${isGroup?'Torna alla cartella':'Torna al mazzo'}</button></div></div>`;
 }
 const entry=study.queue[study.index];const deck=deckById(entry.deckId);
 const card=deck?.cards.find(c=>c.id===entry.cardId);
 if(!card){study.index++;study.total--;return studyPage();}
 const percent=Math.round(study.answered/study.total*100);
 return `<div class="page"><div class="study-top"><div><span class="eyebrow">${isGroup?'RIPASSO DELLA CARTELLA':'MODALITÀ STUDIO'}</span><h1>${esc(owner.name)}</h1><p>${isGroup?`Carta del mazzo: <strong>${esc(deck.name)}</strong> · `:''}Ogni risposta viene conteggiata e passa alla prossima carta.</p></div><button class="button button-outline button-small" data-action="exit-study" type="button">← Esci</button></div>
 <div class="study-options">${shuffleControl(!!owner.shuffleStudy,'study')}<div class="live-study-stats"><span class="known-pill">✓ ${study.sessionKnown} la so</span><span class="unknown-pill">✕ ${study.sessionUnknown} non la so</span></div></div>
 <div class="study-progress"><span>${study.answered} di ${study.total} carte studiate</span><strong>${percent}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
 <div class="flashcard-wrap"><div class="flashcard ${study.flipped?'flipped':''}" id="study-card" role="button" aria-label="Gira la flashcard" tabindex="0" data-action="flip-card"><div class="flashcard-face"><div class="face-label">DOMANDA</div><div class="face-body">${cardSide(card,'front','study')}</div><div class="face-hint">↻ Clicca sulla carta per vedere la risposta</div></div><div class="flashcard-face back"><div class="face-label">RISPOSTA</div><div class="face-body">${cardSide(card,'back','study')}</div><div class="face-hint">↻ Clicca per tornare alla domanda</div></div></div></div>
 <div class="study-controls"><button class="button button-danger" data-action="mark-wrong" type="button" id="study-wrong">✕ Non la so</button><button class="button button-subtle" data-action="flip-card" type="button" id="study-toggle">${study.flipped?'Mostra domanda':'Mostra risposta'}</button><button class="button button-primary" data-action="mark-correct" type="button" id="study-correct">✓ La so</button></div>
 <p class="keyboard-tip">Scorciatoie: <strong>Spazio</strong> gira · <strong>1</strong> non la so · <strong>2</strong> la so · <strong>Esc</strong> esci</p></div>`;
}
function flipCard(){if(!study||study.index>=study.queue.length)return;
 study.flipped=!study.flipped;
 $('#study-card')?.classList.toggle('flipped',study.flipped);
 $('#study-toggle').textContent=study.flipped?'Mostra domanda':'Mostra risposta';
}
function answerCard(correct){
 if(!study||study.index>=study.queue.length)return;
 const entry=study.queue[study.index];
 const deck=deckById(entry.deckId);const card=deck?.cards.find(c=>c.id===entry.cardId);
 if(!card){study.index++;render();return;}
 card.reviewCount=(Number(card.reviewCount)||0)+1;
 card.lastReviewedAt=new Date().toISOString();
 if(correct){card.knownCount=(Number(card.knownCount)||0)+1;card.needsReview=false;study.sessionKnown++;}
 else{card.needsReview=true;study.sessionUnknown++;}
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
 makeDownload({format:'memodeck',version:3,type:'deck',exportedAt:new Date().toISOString(),deck},`flashcard-${fileSafe(deck.name)}.json`);
}
function exportGroup(){const group=activeGroup();if(!group)return;
 makeDownload({format:'memodeck',version:3,type:'group',exportedAt:new Date().toISOString(),group,decks:decksInGroup(group.id)},`cartella-${fileSafe(group.name)}.json`);
}
function exportAll(){if(!state.decks.length&&!state.groups.length){toast('Non ci sono dati da esportare.',true);return;}
 makeDownload({format:'memodeck',version:3,type:'backup',exportedAt:new Date().toISOString(),groups:state.groups,decks:state.decks},'memodeck-backup.json');
}
function sanitiseIncomingGroup(g) {
 if(!g||typeof g.name!=='string'||!g.name.trim())throw Error('Cartella non valida');
 return {id:uid(),name:g.name.trim().slice(0,100),description:friendly(g.description).slice(0,500),color:COLORS.includes(g.color)?g.color:COLORS[0],shuffleStudy:!!g.shuffleStudy,createdAt:new Date().toISOString()};
}
function sanitiseIncomingDeck(d){
 if(!d||typeof d.name!=='string'||!Array.isArray(d.cards)||d.cards.length>20000)throw new Error('Mazzo non valido');
 const name=d.name.trim().slice(0,100);if(!name)throw Error('Nome del mazzo mancante');
 return {id:uid(),name,description:friendly(d.description).slice(0,500),color:COLORS.includes(d.color)?d.color:COLORS[0],groupId:null,shuffleStudy:!!d.shuffleStudy,createdAt:new Date().toISOString(),cards:d.cards.map(c=>{
  if(!c||typeof c.front!=='string'||typeof c.back!=='string')throw new Error('Flashcard non valida');
  if (c.frontImage != null && !isValidImage(c.frontImage)) throw Error('Immagine domanda non valida');
  if (c.backImage != null && !isValidImage(c.backImage)) throw Error('Immagine risposta non valida');
  if ((!c.front.trim() && !c.frontImage) || (!c.back.trim() && !c.backImage)) throw new Error('Ogni lato deve avere testo o immagine');
  return {id:uid(),front:c.front.slice(0,5000),back:c.back.slice(0,10000),frontImage:c.frontImage || null,backImage:c.backImage || null,createdAt:new Date().toISOString(),needsReview:!!c.needsReview,knownCount:Number.isSafeInteger(c.knownCount)&&c.knownCount>=0?c.knownCount:0,reviewCount:Number.isSafeInteger(c.reviewCount)&&c.reviewCount>=0?c.reviewCount:0,lastReviewedAt:typeof c.lastReviewedAt==='string'?c.lastReviewedAt:null};
 })};
}
async function importFile(file){
 if(!file)return;
 if(file.size>MAX_IMPORT_FILE){toast('File troppo grande (massimo 120 MB).',true);return;}
 try{
  const parsed=JSON.parse(await file.text());
  if(parsed?.format!=='memodeck'||![1,2,3].includes(parsed?.version))throw Error('Questo file non è un backup MemoDeck valido.');
  let inputDecks, inputGroups;
  if(parsed.type==='deck'){inputDecks=[parsed.deck];inputGroups=[];}
  else if(parsed.type==='group' && parsed.version===3){inputDecks=parsed.decks;inputGroups=[parsed.group];}
  else if(parsed.type==='backup'){inputDecks=parsed.decks;inputGroups=parsed.version===3?parsed.groups:[];}
  else throw Error('Tipo di file JSON non valido.');
  if(!Array.isArray(inputDecks)||inputDecks.length>100||!Array.isArray(inputGroups)||inputGroups.length>100)throw Error('Elenco mazzi o cartelle non valido.');
  if(!inputDecks.length&&!inputGroups.length)throw Error('Il file è vuoto.');
  const groups=inputGroups.map(sanitiseIncomingGroup);
  const idMap=new Map(inputGroups.map((g,i)=>[g.id,groups[i].id]));
  const decks=inputDecks.map((input,i)=>{
    const d=sanitiseIncomingDeck(input);
    d.groupId=idMap.get(input.groupId) || (parsed.type==='group'?groups[0]?.id:null) || null;
    return d;
  });
  // Tutto viene convalidato prima di aggiornare il database, mantenendo i dati precedenti.
  state.groups=[...groups,...state.groups];state.decks=[...decks,...state.decks];
  state.activeGroupId=groups[0]?.id||null;state.activeDeckId=state.activeGroupId?null:(decks[0]?.id||null);study=null;
  await save();render();stopSidebar();
  toast(`Importati ${decks.length} mazzi e ${groups.length} cartelle, immagini comprese.`);
 }catch(e){console.error(e);toast(`Importazione fallita: ${e.message||'file non valido'}`,true);}
}

// Eventi delegati: funzionano anche per le carte generate dinamicamente.
document.addEventListener('click', (event)=>{
 const trigger=event.target.closest('[data-action]');
 if(!trigger)return;
 const action=trigger.dataset.action;
 switch(action){
 case 'new-deck':deckModal();break;
 case 'new-deck-in-group':deckModal(null,state.activeGroupId);break;
 case 'new-group':groupModal();break;
 case 'select-group':selectGroup(trigger.dataset.id);break;
 case 'edit-group':groupModal(state.activeGroupId);break;
 case 'delete-group':confirmDelete('group',state.activeGroupId);break;
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
 case 'start-study':startStudy('deck');break;
 case 'start-group-study':startStudy('group');break;
 case 'restart-study':startStudy(study?.type||'deck');break;
 case 'exit-study':study=null;render();break;
 case 'flip-card':flipCard();break;
 case 'mark-wrong':answerCard(false);break;
 case 'mark-correct':answerCard(true);break;
 case 'export-deck':exportDeck();break;
 case 'export-group':exportGroup();break;
 case 'export-all':exportAll();break;
 case 'remove-image': if (['front','back'].includes(trigger.dataset.side)) {editingImages[trigger.dataset.side]=null;refreshImagePreview(trigger.dataset.side);}break;
 case 'go-home':goHome();break;
 }
});
document.addEventListener('submit',event=>{
 if(event.target.id==='deck-form'){event.preventDefault();commitDeck(event.target);}
 if(event.target.id==='group-form'){event.preventDefault();commitGroup(event.target);}
 if(event.target.id==='card-form'){event.preventDefault();commitCard(event.target);}
});
document.addEventListener('input',event=>{if(event.target.id==='card-search')filterCards();});
document.addEventListener('change',event=>{if(event.target.matches('[data-image-side]'))onImagePicked(event.target);if(event.target.matches('[data-shuffle-toggle]'))setStudyShuffle(event.target.checked);});
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
$('#sidebar-new-group').addEventListener('click',()=>{stopSidebar();groupModal();});
$('#topbar-new-deck').addEventListener('click',()=>deckModal());
$('#sidebar-backup').addEventListener('click',exportAll);
$('#sidebar-import').addEventListener('click',()=>$('#import-file').click());
$('#import-file').addEventListener('change',async e=>{await importFile(e.target.files?.[0]);e.target.value='';});
$('.brand').addEventListener('click',e=>{e.preventDefault();goHome();});

// I mazzi legacy vengono migrati in IndexedDB prima del primo rendering.
initialize();
