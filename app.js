const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const DB_NAME = "estudaplus_local_v1";
const DB_VERSION = 1;
const DAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const SHORT_DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const TOPIC_STATUSES = [
  { value: "todo", label: "Não iniciado" },
  { value: "doing", label: "Estudando" },
  { value: "done", label: "Concluído" },
  { value: "reviewed", label: "Revisado" }
];

let db;
let state = {
  materials: [], pageNotes: [], bookmarks: [], sessions: [],
  editalSubjects: [], plannerItems: [], reviews: [], quickNotes: [],
  examName: "", goals: { dailyMinutes: 120, weeklyMinutes: 600 }
};
let currentMaterial = null;
let pdfDoc = null;
let pdfPage = 1;
let pdfZoom = 1;
let pdfBlobUrl = null;
let pdfWorkerBlobUrl = null;
let pdfWorkerReady = null;
let noteSaveTimer = null;
let timerSeconds = 25 * 60;
let timerInitialSeconds = 25 * 60;
let timerInterval = null;
let timerActive = false;
let installPrompt = null;
let editingQuickNoteId = null;

function uid() { return "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function esc(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
}
function toast(message, type = "good") {
  const element = $("#toast");
  if (!element) return;
  element.textContent = message;
  element.className = "toast show " + type;
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => element.className = "toast", 3000);
}
function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric" });
}
function formatBytes(bytes = 0) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
function localDateKey(date = new Date()) {
  const d = new Date(date);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return localDateKey(result);
}
function todayKey() { return localDateKey(new Date()); }
function material(id) { return state.materials.find(item => item.id === id); }
function noteForPage(materialId, page) { return state.pageNotes.find(item => item.materialId === materialId && item.page === page); }
function minutesText(minutes = 0) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? `${h}h${m ? " " + m + "min" : ""}` : `${m} min`;
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("files")) database.createObjectStore("files", { keyPath:"id" });
      if (!database.objectStoreNames.contains("kv")) database.createObjectStore("kv", { keyPath:"key" });
    };
    request.onsuccess = () => { db = request.result; resolve(db); };
    request.onerror = () => reject(request.error);
  });
}
function idbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function idbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("A gravação foi cancelada."));
  });
}
function idbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
function idbAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function normalizeState(saved = {}) {
  return {
    materials: Array.isArray(saved.materials) ? saved.materials : [],
    // Migra as anotações da versão anterior sem perder o conteúdo.
    pageNotes: (Array.isArray(saved.pageNotes) ? saved.pageNotes : (Array.isArray(saved.notes) ? saved.notes : [])).map(note => ({
      ...note, materialId:note.materialId || note.mid, content:note.content ?? note.text ?? "", updated:note.updated || note.date || new Date().toISOString()
    })),
    bookmarks: (Array.isArray(saved.bookmarks) ? saved.bookmarks : (Array.isArray(saved.favs) ? saved.favs : [])).map(item => ({
      ...item, materialId:item.materialId || item.mid, created:item.created || item.date || null, label:item.label || "Página importante"
    })),
    sessions: Array.isArray(saved.sessions) ? saved.sessions : [],
    editalSubjects: Array.isArray(saved.editalSubjects) ? saved.editalSubjects : [],
    plannerItems: Array.isArray(saved.plannerItems) ? saved.plannerItems : [],
    reviews: Array.isArray(saved.reviews) ? saved.reviews : [],
    quickNotes: Array.isArray(saved.quickNotes) ? saved.quickNotes : [],
    examName: typeof saved.examName === "string" ? saved.examName : "",
    goals: { dailyMinutes: Number(saved.goals?.dailyMinutes) || 120, weeklyMinutes: Number(saved.goals?.weeklyMinutes) || 600 }
  };
}
async function loadState() {
  const saved = await idbGet("kv", "state");
  if (saved?.value) state = normalizeState(saved.value);
}
async function saveState() {
  try {
    await idbPut("kv", { key:"state", value:state });
    renderStats();
  } catch (error) {
    console.error(error);
    toast("Não foi possível salvar. Verifique o espaço disponível no aparelho.", "error");
  }
}
async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch (error) { /* Persistência pode não estar disponível neste navegador. */ }
  updateStorageStatus();
}
async function updateStorageStatus() {
  const label = $("#storage-label"), fill = $("#storage-meter-fill");
  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0, quota = estimate.quota || 0;
      fill.style.width = (quota ? Math.min(100, usage / quota * 100) : 0) + "%";
      label.textContent = `${formatBytes(usage)} usados${quota ? " · limite estimado: " + formatBytes(quota) : ""}`;
    } else label.textContent = "Armazenamento local ativo";
  } catch (error) { label.textContent = "Armazenamento local ativo"; }
}

const VIEW_NAMES = {
  home:"Início", library:"Biblioteca PDF", reader:"Leitor de PDF", notebook:"Caderno",
  favorites:"Páginas favoritas", timer:"Cronômetro", edital:"Checklist do edital",
  planner:"Planejador", reviews:"Revisões", performance:"Desempenho",
  quicknotes:"Notas rápidas", goals:"Metas"
};
function setView(name) {
  $$(".view").forEach(view => view.hidden = view.id !== "view-" + name);
  $$(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === name));
  $("#breadcrumb-current").textContent = VIEW_NAMES[name] || name;
  $("#sidebar").classList.remove("open");
  if (name === "home") renderHome();
  if (name === "library") renderMaterials();
  if (name === "notebook") renderNotebook();
  if (name === "favorites") renderFavorites();
  if (name === "timer") renderTimerSessions();
  if (name === "edital") renderEdictal();
  if (name === "planner") renderPlanner();
  if (name === "reviews") renderReviews();
  if (name === "performance") renderPerformance();
  if (name === "quicknotes") renderQuickNotes();
  if (name === "goals") renderGoals();
}
function navigate(name) { setView(name); }
function bindNavigation() {
  $$(".nav-item").forEach(button => button.addEventListener("click", () => navigate(button.dataset.view)));
  $$('[data-go]').forEach(button => button.addEventListener("click", () => navigate(button.dataset.go)));
  $("#mobile-menu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
}

async function uploadPdfs(files) {
  for (const file of files) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { toast(file.name + " não parece ser um PDF.", "error"); continue; }
    if (file.size > 250 * 1024 * 1024) { toast(file.name + " ultrapassa o limite de 250 MB por arquivo.", "error"); continue; }
    const id = uid();
    try {
      await idbPut("files", { id, name:file.name, size:file.size, type:"application/pdf", added:new Date().toISOString(), blob:file });
      state.materials.unshift({ id, title:file.name.replace(/\.pdf$/i, ""), name:file.name, size:file.size, added:new Date().toISOString(), lastOpened:null, lastPage:1 });
      await saveState();
      toast("PDF adicionado à biblioteca.");
    } catch (error) {
      console.error(error);
      toast("O aparelho não conseguiu guardar este PDF. Verifique o espaço livre e tente novamente.", "error");
    }
  }
  renderMaterials(); renderHome(); updateStorageStatus();
}
async function deleteMaterial(id) {
  if (!confirm("Excluir este PDF e as anotações, favoritos e revisões relacionados?")) return;
  try { await idbDelete("files", id); } catch (error) { console.warn(error); }
  state.materials = state.materials.filter(item => item.id !== id);
  state.pageNotes = state.pageNotes.filter(item => item.materialId !== id);
  state.bookmarks = state.bookmarks.filter(item => item.materialId !== id);
  state.reviews = state.reviews.filter(item => item.materialId !== id);
  await saveState(); renderMaterials(); renderNotebook(); renderFavorites(); renderHome(); updateStorageStatus();
  toast("Material removido.");
}
function renderMaterials() {
  const query = ($("#material-search").value || "").toLowerCase().trim();
  const list = state.materials.filter(item => (item.title + " " + item.name).toLowerCase().includes(query));
  $("#material-count").textContent = state.materials.length;
  $("#materials-list").innerHTML = list.length ? list.map(item => `
    <article class="material-card"><div class="material-top"><div class="pdf-icon">PDF</div><button class="icon-delete" data-delete-material="${item.id}" aria-label="Excluir material">×</button></div>
    <h3>${esc(item.title)}</h3><p>${esc(item.name)}</p><div class="material-meta"><span>${formatBytes(item.size)}</span><span>${formatDate(item.added)}</span></div>
    <div class="material-actions"><button class="btn primary" data-open-material="${item.id}">Abrir e estudar</button></div></article>`).join("") : '<div class="empty-state">Nenhum material encontrado. Envie seu primeiro PDF para começar.</div>';
  $$('[data-open-material]').forEach(button => button.addEventListener("click", () => openReader(button.dataset.openMaterial)));
  $$('[data-delete-material]').forEach(button => button.addEventListener("click", () => deleteMaterial(button.dataset.deleteMaterial)));
}

async function configurePdfWorker() {
  if (pdfWorkerReady) return pdfWorkerReady;
  pdfWorkerReady = (async () => {
    if (!window.pdfjsLib) throw new Error("A biblioteca do leitor PDF não carregou. Conecte-se à internet e reabra o Estuda+.");
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    try {
      const response = await fetch(PDFJS_WORKER, { cache:"force-cache" });
      if (response.ok) {
        const workerCode = await response.text();
        if (pdfWorkerBlobUrl) URL.revokeObjectURL(pdfWorkerBlobUrl);
        pdfWorkerBlobUrl = URL.createObjectURL(new Blob([workerCode], { type:"text/javascript" }));
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerBlobUrl;
      }
    } catch (error) { /* A URL do worker permanece como alternativa. */ }
    return true;
  })();
  try { return await pdfWorkerReady; } catch (error) { pdfWorkerReady = null; throw error; }
}
async function openReader(id) {
  if (currentMaterial) await saveCurrentPageNote(false);
  const item = material(id);
  if (!item) { toast("Material não encontrado.", "error"); return; }
  try {
    if (!window.pdfjsLib) throw new Error("O leitor PDF ainda não está disponível. Abra o Estuda+ uma vez com internet para carregar o leitor.");
    await configurePdfWorker();
    const record = await idbGet("files", id);
    if (!record?.blob) throw new Error("O PDF não foi encontrado no armazenamento deste aparelho.");
    if (pdfDoc) { try { await pdfDoc.destroy(); } catch (error) {} }
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    pdfBlobUrl = URL.createObjectURL(record.blob);
    currentMaterial = item; pdfDoc = null; pdfPage = Math.max(1, Number(item.lastPage) || 1); pdfZoom = 1;
    $("#reader-title").textContent = item.title;
    $("#reader-filename").textContent = item.name;
    $("#pdf-stage").innerHTML = '<div class="empty-state">Preparando as páginas do PDF…</div>';
    navigate("reader");
    const buffer = await record.blob.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data:new Uint8Array(buffer), useWorkerFetch:false, isEvalSupported:false }).promise;
    pdfPage = Math.min(pdfPage, pdfDoc.numPages);
    $("#page-total").textContent = "/ " + pdfDoc.numPages;
    $("#pdf-status-text").textContent = pdfDoc.numPages + " páginas · Leitor Estuda+";
    item.lastOpened = new Date().toISOString(); item.lastPage = pdfPage;
    await saveState();
    await renderPdfPage();
  } catch (error) {
    console.error(error);
    $("#pdf-stage").innerHTML = `<div class="empty-state">${esc(error.message || "Não foi possível abrir este PDF.")}</div>`;
    toast(error.message || "Erro ao abrir o PDF.", "error");
  }
}
async function renderPdfPage() {
  if (!pdfDoc) return;
  $("#page-input").value = pdfPage;
  $("#page-input").max = pdfDoc.numPages;
  $("#page-prev").disabled = pdfPage <= 1;
  $("#page-next").disabled = pdfPage >= pdfDoc.numPages;
  const stage = $("#pdf-stage");
  stage.innerHTML = '<div class="empty-state">Renderizando página ' + pdfPage + '…</div>';
  try {
    const page = await pdfDoc.getPage(pdfPage);
    const base = page.getViewport({ scale:1 });
    const available = Math.max(260, stage.clientWidth - 24);
    const scale = Math.max(.35, Math.min(3, available / base.width * pdfZoom));
    const viewport = page.getViewport({ scale });
    const wrapper = document.createElement("div");
    wrapper.className = "pdf-page"; wrapper.id = "pdf-page";
    wrapper.style.width = viewport.width + "px"; wrapper.style.height = viewport.height + "px";
    const canvas = document.createElement("canvas");
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = viewport.width + "px"; canvas.style.height = viewport.height + "px";
    wrapper.appendChild(canvas);
    await page.render({ canvasContext:canvas.getContext("2d", { alpha:false }), viewport, transform:ratio !== 1 ? [ratio,0,0,ratio,0,0] : null }).promise;
    stage.innerHTML = ""; stage.appendChild(wrapper);
    $("#pdf-status-text").textContent = "Página " + pdfPage + " de " + pdfDoc.numPages;
    $("#reader-page-hint").textContent = "Anotações salvas por página";
    await renderReaderTools();
  } catch (error) {
    console.error(error);
    stage.innerHTML = '<div class="empty-state">Não foi possível renderizar esta página. Tente diminuir o zoom ou abrir o PDF novamente.</div>';
  }
}
async function changePdfPage(page) {
  if (!pdfDoc) return;
  await saveCurrentPageNote(false);
  pdfPage = Math.max(1, Math.min(pdfDoc.numPages, Number(page) || 1));
  if (currentMaterial) { currentMaterial.lastPage = pdfPage; await saveState(); }
  await renderPdfPage();
}
async function saveCurrentPageNote(showToast = false) {
  if (!currentMaterial) return;
  clearTimeout(noteSaveTimer);
  const content = $("#page-note").value.trim();
  const index = state.pageNotes.findIndex(note => note.materialId === currentMaterial.id && note.page === pdfPage);
  if (!content && index >= 0) state.pageNotes.splice(index, 1);
  else if (content && index >= 0) { state.pageNotes[index].content = content; state.pageNotes[index].updated = new Date().toISOString(); }
  else if (content) state.pageNotes.push({ id:uid(), materialId:currentMaterial.id, page:pdfPage, content, updated:new Date().toISOString() });
  await saveState();
  if (showToast) toast(content ? "Anotação salva nesta página." : "Anotação removida.");
}
async function renderReaderTools() {
  if (!currentMaterial) return;
  const note = noteForPage(currentMaterial.id, pdfPage);
  if (document.activeElement !== $("#page-note")) $("#page-note").value = note ? note.content : "";
  const bookmark = state.bookmarks.find(item => item.materialId === currentMaterial.id && item.page === pdfPage);
  $("#save-bookmark").textContent = bookmark ? "★ Página salva nos favoritos" : "☆ Salvar página favorita";
  const books = state.bookmarks.filter(item => item.materialId === currentMaterial.id).sort((a,b) => a.page - b.page);
  $("#page-bookmarks").innerHTML = books.length ? books.map(item => `<div class="tiny-item"><span>☆ Página ${item.page} · ${esc(item.label || "Favorita")}</span><button data-bookmark-page="${item.id}">Abrir</button></div>`).join("") : '<span class="helper-text">Nenhuma página favorita nesta apostila.</span>';
  $$('[data-bookmark-page]').forEach(button => button.addEventListener("click", () => changePdfPage(books.find(item => item.id === button.dataset.bookmarkPage)?.page || 1)));
}
async function saveBookmark() {
  if (!currentMaterial) return;
  const existingIndex = state.bookmarks.findIndex(item => item.materialId === currentMaterial.id && item.page === pdfPage);
  if (existingIndex >= 0) {
    state.bookmarks.splice(existingIndex, 1);
    toast("Página removida dos favoritos.");
  } else {
    state.bookmarks.push({ id:uid(), materialId:currentMaterial.id, page:pdfPage, label:"Página importante", created:new Date().toISOString() });
    toast("Página adicionada aos favoritos.");
  }
  await saveState(); await renderReaderTools(); renderFavorites();
}

function renderNotebook() {
  const query = ($("#notes-search").value || "").toLowerCase().trim();
  const notes = [...state.pageNotes].sort((a,b) => new Date(b.updated || 0) - new Date(a.updated || 0)).filter(item => {
    const title = material(item.materialId)?.title || "";
    return (title + " " + item.content).toLowerCase().includes(query);
  });
  $("#notes-count").textContent = state.pageNotes.length;
  $("#notes-list").innerHTML = notes.length ? notes.map(item => `
    <article class="note-card"><div class="note-card-head"><div><b>${esc(material(item.materialId)?.title || "Material removido")}</b><small>Página ${item.page} · Atualizado ${formatDate(item.updated)}</small></div></div>
    <p>${esc(item.content)}</p><div class="note-actions"><button data-open-note="${item.id}">Abrir página →</button><button data-review-note="${item.id}">Agendar revisões</button></div></article>`).join("") : '<div class="empty-state">Nenhuma anotação encontrada. Abra uma apostila e escreva no caderno da página.</div>';
  $$('[data-open-note]').forEach(button => button.addEventListener("click", async () => {
    const item = state.pageNotes.find(note => note.id === button.dataset.openNote);
    if (item) { await openReader(item.materialId); if (pdfDoc) await changePdfPage(item.page); }
  }));
  $$('[data-review-note]').forEach(button => button.addEventListener("click", () => scheduleNoteReviews(button.dataset.reviewNote)));
}
function renderFavorites() {
  const items = [...state.bookmarks].sort((a,b) => new Date(b.created || 0) - new Date(a.created || 0));
  $("#favorites-count").textContent = items.length;
  $("#favorites-list").innerHTML = items.length ? items.map(item => `
    <article class="note-card"><div class="note-card-head"><div><b>${esc(material(item.materialId)?.title || "Material removido")}</b><small>Página ${item.page} · ${formatDate(item.created)}</small></div></div>
    <p>${esc(item.label || "Página importante")}</p><div class="note-actions"><button data-open-favorite="${item.id}">Abrir página →</button><button data-remove-favorite="${item.id}">Remover</button></div></article>`).join("") : '<div class="empty-state">Você ainda não salvou páginas favoritas. Abra uma apostila e toque em “Salvar página favorita”.</div>';
  $$('[data-open-favorite]').forEach(button => button.addEventListener("click", async () => {
    const item = state.bookmarks.find(bookmark => bookmark.id === button.dataset.openFavorite);
    if (item && material(item.materialId)) { await openReader(item.materialId); if (pdfDoc) await changePdfPage(item.page); }
  }));
  $$('[data-remove-favorite]').forEach(button => button.addEventListener("click", async () => {
    state.bookmarks = state.bookmarks.filter(item => item.id !== button.dataset.removeFavorite);
    await saveState(); renderFavorites();
  }));
}
function exportNotebook() {
  const lines = ["ESTUDA+ — MEU CADERNO", ""];
  state.pageNotes.forEach(item => lines.push((material(item.materialId)?.title || "Material") + " — Página " + item.page, item.content, ""));
  lines.push("PÁGINAS FAVORITAS", "");
  state.bookmarks.forEach(item => lines.push((material(item.materialId)?.title || "Material") + " — Página " + item.page, item.label || "Página importante", ""));
  downloadBlob(new Blob([lines.join("\n")], { type:"text/plain;charset=utf-8" }), "meu-caderno-estuda-plus.txt");
}

function renderStats() {
  const totalMinutes = state.sessions.reduce((sum, item) => sum + (Number(item.minutes) || 0), 0);
  $("#stat-materials").textContent = state.materials.length;
  $("#stat-notes").textContent = state.pageNotes.length;
  $("#stat-hours").textContent = Math.floor(totalMinutes / 60) + "h";
  $("#stat-minutes").textContent = totalMinutes + " minutos registrados";
}
function getTodayMinutes() {
  return state.sessions.filter(item => localDateKey(item.date) === todayKey()).reduce((sum,item) => sum + (Number(item.minutes) || 0), 0);
}
function getWeekMinutes() {
  const today = new Date();
  const start = new Date(today); start.setDate(today.getDate() - 6); start.setHours(0,0,0,0);
  return state.sessions.filter(item => new Date(item.date) >= start).reduce((sum,item) => sum + (Number(item.minutes) || 0), 0);
}
function renderHome() {
  renderStats();
  const recent = [...state.materials].sort((a,b) => new Date(b.lastOpened || b.added) - new Date(a.lastOpened || a.added)).slice(0,3);
  $("#recent-materials").innerHTML = recent.length ? recent.map(item => `<div class="recent-item"><span class="pdf-icon">PDF</span><div><b>${esc(item.title)}</b><small>${formatBytes(item.size)}</small></div><button data-recent-open="${item.id}">Abrir</button></div>`).join("") : '<div class="empty-state">Seus materiais aparecerão aqui quando você adicionar o primeiro.</div>';
  $$('[data-recent-open]').forEach(button => button.addEventListener("click", () => openReader(button.dataset.recentOpen)));
  const today = new Date().getDay();
  const next = state.plannerItems.filter(item => Number(item.day) === today).sort((a,b) => a.time.localeCompare(b.time))[0];
  $("#home-next-study").textContent = next ? `${next.time} · ${next.subject} · ${next.duration} minutos. Separe seu material e prepare-se para estudar.` : "Nenhum horário cadastrado para hoje. Adicione seus horários no Planejador para organizar sua rotina.";
  const goal = state.goals.dailyMinutes || 120, done = getTodayMinutes(), percent = Math.min(100, Math.round(done / goal * 100));
  $("#home-goal-progress").innerHTML = `<div class="goal-progress-line"><b>${minutesText(done)} de ${minutesText(goal)}</b><span>${percent}%</span></div><div class="progress-track"><i style="width:${percent}%"></i></div>`;
}

function updateTimerDisplay() {
  const minutes = Math.floor(timerSeconds / 60), seconds = timerSeconds % 60;
  $("#timer-display").textContent = String(minutes).padStart(2,"0") + ":" + String(seconds).padStart(2,"0");
}
function resetTimer() {
  clearInterval(timerInterval); timerActive = false;
  timerSeconds = Number($("#timer-length").value) * 60;
  timerInitialSeconds = timerSeconds;
  $("#timer-start").textContent = "Começar"; $("#timer-state").textContent = "Pronto para começar";
  updateTimerDisplay();
}
async function recordTimerSession(minutes) {
  if (minutes < 1) { toast("Estude pelo menos 1 minuto para registrar a sessão.", "error"); return; }
  state.sessions.push({ id:uid(), minutes, subject:$("#timer-subject").value.trim() || "Geral", date:new Date().toISOString() });
  await saveState(); renderTimerSessions(); renderHome(); renderPerformance(); renderGoals();
  toast("Sessão registrada no seu desempenho. Parabéns!");
}
async function finishTimer(completed = false) {
  if (!timerActive && timerSeconds === 0) return;
  clearInterval(timerInterval); timerActive = false;
  const elapsed = completed ? Math.round(timerInitialSeconds / 60) : Math.floor((timerInitialSeconds - timerSeconds) / 60);
  $("#timer-start").textContent = "Começar";
  $("#timer-state").textContent = completed ? "Sessão concluída!" : "Sessão finalizada";
  await recordTimerSession(elapsed);
  timerSeconds = 0; updateTimerDisplay();
}
function toggleTimer() {
  if (timerActive) {
    clearInterval(timerInterval); timerActive = false;
    $("#timer-start").textContent = "Continuar"; $("#timer-state").textContent = "Pausado"; return;
  }
  if (timerSeconds <= 0) resetTimer();
  timerActive = true; $("#timer-start").textContent = "Pausar"; $("#timer-state").textContent = "Em concentração";
  timerInterval = setInterval(() => {
    timerSeconds--; updateTimerDisplay();
    if (timerSeconds <= 0) finishTimer(true);
  }, 1000);
}
function renderTimerSessions() {
  const sessions = [...state.sessions].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0,8);
  $("#timer-recent-sessions").innerHTML = sessions.length ? sessions.map(item => `<div class="simple-row"><div><b>${esc(item.subject || "Geral")}</b><small>${formatDate(item.date)}</small></div><strong>${minutesText(item.minutes)}</strong></div>`).join("") : '<div class="empty-state">Suas sessões concluídas aparecerão aqui.</div>';
}

function renderEdictal() {
  $("#exam-name").value = state.examName || "";
  const allTopics = state.editalSubjects.flatMap(subject => subject.topics || []);
  const done = allTopics.filter(topic => topic.status === "done" || topic.status === "reviewed").length;
  const percent = allTopics.length ? Math.round(done / allTopics.length * 100) : 0;
  $("#edital-progress-text").textContent = percent + "% concluído";
  $("#edital-progress-sub").textContent = `${done} de ${allTopics.length} assuntos concluídos ou revisados`;
  $("#edital-progress-bar").style.width = percent + "%";
  $("#edital-subjects").innerHTML = state.editalSubjects.length ? state.editalSubjects.map(subject => {
    const topics = subject.topics || [];
    const completed = topics.filter(topic => topic.status === "done" || topic.status === "reviewed").length;
    return `<article class="subject-card"><div class="subject-head"><h3>${esc(subject.name)}</h3><small>${completed}/${topics.length} concluídos</small><button data-delete-subject="${subject.id}" title="Excluir matéria">Excluir</button></div>
      <div class="topic-list">${topics.length ? topics.map(topic => `<div class="topic-row"><span>${esc(topic.name)}</span><select data-topic-status="${topic.id}" data-subject-id="${subject.id}">${TOPIC_STATUSES.map(status => `<option value="${status.value}" ${topic.status === status.value ? "selected" : ""}>${status.label}</option>`).join("")}</select><button class="topic-delete" data-delete-topic="${topic.id}" data-subject-id="${subject.id}" title="Excluir assunto">×</button></div>`).join("") : '<p class="helper-text">Adicione os assuntos desta matéria abaixo.</p>'}</div>
      <div class="add-topic"><input data-topic-input="${subject.id}" placeholder="Novo assunto do edital"><button class="btn outline" data-add-topic="${subject.id}">＋ Assunto</button></div></article>`;
  }).join("") : '<div class="empty-state">Cadastre sua primeira matéria para começar a acompanhar o edital.</div>';
  $$('[data-delete-subject]').forEach(button => button.addEventListener("click", async () => {
    if (!confirm("Excluir esta matéria e seus assuntos do checklist?")) return;
    state.editalSubjects = state.editalSubjects.filter(item => item.id !== button.dataset.deleteSubject);
    await saveState(); renderEdictal();
  }));
  $$('[data-add-topic]').forEach(button => button.addEventListener("click", async () => {
    const input = $(`[data-topic-input="${button.dataset.addTopic}"]`), name = input.value.trim();
    if (!name) { toast("Digite o nome do assunto.", "error"); return; }
    const subject = state.editalSubjects.find(item => item.id === button.dataset.addTopic);
    if (subject) { subject.topics.push({ id:uid(), name, status:"todo" }); await saveState(); renderEdictal(); }
  }));
  $$('[data-topic-status]').forEach(select => select.addEventListener("change", async () => {
    const subject = state.editalSubjects.find(item => item.id === select.dataset.subjectId);
    const topic = subject?.topics.find(item => item.id === select.dataset.topicStatus);
    if (topic) { topic.status = select.value; await saveState(); renderEdictal(); }
  }));
  $$('[data-delete-topic]').forEach(button => button.addEventListener("click", async () => {
    const subject = state.editalSubjects.find(item => item.id === button.dataset.subjectId);
    if (subject) { subject.topics = subject.topics.filter(topic => topic.id !== button.dataset.deleteTopic); await saveState(); renderEdictal(); }
  }));
}
async function addSubject() {
  const input = $("#new-subject"), name = input.value.trim();
  if (!name) { toast("Digite o nome da matéria.", "error"); return; }
  state.editalSubjects.push({ id:uid(), name, topics:[] }); input.value = "";
  await saveState(); renderEdictal();
}

function renderPlanner() {
  $("#week-planner").innerHTML = DAYS.map((day, index) => {
    const items = state.plannerItems.filter(item => Number(item.day) === index).sort((a,b) => a.time.localeCompare(b.time));
    return `<article class="day-card"><h3>${day}</h3>${items.length ? items.map(item => `<div class="plan-item"><span class="plan-time">${esc(item.time)}</span><span class="plan-detail"><b>${esc(item.subject)}</b><small>${item.duration} minutos</small></span><button data-delete-plan="${item.id}" title="Excluir horário">×</button></div>`).join("") : '<p class="helper-text">Nenhum horário planejado.</p>'}</article>`;
  }).join("");
  $$('[data-delete-plan]').forEach(button => button.addEventListener("click", async () => {
    state.plannerItems = state.plannerItems.filter(item => item.id !== button.dataset.deletePlan);
    await saveState(); renderPlanner(); renderHome();
  }));
}
async function addPlanItem() {
  const subject = $("#plan-subject").value.trim();
  if (!subject) { toast("Informe a matéria do horário.", "error"); return; }
  state.plannerItems.push({ id:uid(), day:Number($("#plan-day").value), time:$("#plan-time").value || "19:00", subject, duration:Number($("#plan-duration").value) });
  $("#plan-subject").value = "";
  await saveState(); renderPlanner(); renderHome(); toast("Horário adicionado ao planejamento.");
}

function scheduleNoteReviews(noteId) {
  const note = state.pageNotes.find(item => item.id === noteId);
  if (!note) return;
  const subject = material(note.materialId)?.title || "Revisão de apostila";
  const title = `Página ${note.page}: ${note.content.slice(0, 75)}${note.content.length > 75 ? "…" : ""}`;
  const created = new Date();
  [1,7,30].forEach(days => state.reviews.push({ id:uid(), subject, topic:title, materialId:note.materialId, page:note.page, dueDate:addDays(created, days), interval:days, done:false, created:created.toISOString() }));
  saveState().then(() => { renderReviews(); toast("Três revisões agendadas: 1, 7 e 30 dias."); });
}
function renderReviews() {
  const filter = $("#review-filter").value || "pending";
  const items = [...state.reviews].filter(item => filter === "all" || (filter === "done" ? item.done : !item.done)).sort((a,b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  $("#reviews-count").textContent = state.reviews.filter(item => !item.done).length;
  $("#reviews-list").innerHTML = items.length ? items.map(item => {
    const due = new Date(item.dueDate + "T12:00:00");
    const overdue = !item.done && item.dueDate < todayKey();
    return `<article class="review-card"><div class="review-date">${due.toLocaleDateString("pt-BR", {day:"2-digit",month:"short"})}</div><div class="review-info"><b>${esc(item.topic)}</b><small>${esc(item.subject)}${item.interval ? " · Revisão de " + item.interval + " dia(s)" : ""}${overdue ? " · Atrasada" : ""}</small></div><div class="review-actions">${item.materialId && material(item.materialId) ? `<button data-open-review="${item.id}">Abrir</button>` : ""}<button data-toggle-review="${item.id}">${item.done ? "Reabrir" : "Concluir"}</button><button class="delete" data-delete-review="${item.id}">×</button></div></article>`;
  }).join("") : '<div class="empty-state">Nenhuma revisão nesta lista. Agende uma revisão manual ou a partir das anotações do PDF.</div>';
  $$('[data-toggle-review]').forEach(button => button.addEventListener("click", async () => {
    const item = state.reviews.find(review => review.id === button.dataset.toggleReview);
    if (item) item.done = !item.done;
    await saveState(); renderReviews(); renderGoals();
  }));
  $$('[data-delete-review]').forEach(button => button.addEventListener("click", async () => {
    state.reviews = state.reviews.filter(item => item.id !== button.dataset.deleteReview);
    await saveState(); renderReviews();
  }));
  $$('[data-open-review]').forEach(button => button.addEventListener("click", async () => {
    const item = state.reviews.find(review => review.id === button.dataset.openReview);
    if (item?.materialId && material(item.materialId)) { await openReader(item.materialId); if (pdfDoc) await changePdfPage(item.page); }
  }));
}
async function addManualReview() {
  const subject = $("#review-subject").value.trim(), topic = $("#review-topic").value.trim(), dueDate = $("#review-date").value;
  if (!subject || !topic || !dueDate) { toast("Preencha matéria, assunto e data.", "error"); return; }
  state.reviews.push({ id:uid(), subject, topic, dueDate, done:false, created:new Date().toISOString() });
  $("#review-subject").value = ""; $("#review-topic").value = "";
  await saveState(); renderReviews(); toast("Revisão agendada.");
}
async function scheduleCurrentPageReviews() {
  if (!currentMaterial) return;
  await saveCurrentPageNote(false);
  const note = noteForPage(currentMaterial.id, pdfPage);
  if (!note?.content) { toast("Escreva uma anotação nesta página antes de agendar a revisão.", "error"); return; }
  scheduleNoteReviews(note.id);
}

function renderPerformance() {
  const total = state.sessions.reduce((sum,item) => sum + (Number(item.minutes) || 0), 0);
  const week = getWeekMinutes();
  $("#perf-total").textContent = Math.floor(total / 60) + "h";
  $("#perf-total-min").textContent = total + " minutos";
  $("#perf-week").textContent = minutesText(week);
  $("#perf-sessions").textContent = state.sessions.length;
  const days = [];
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(); date.setDate(date.getDate() - offset);
    const key = localDateKey(date);
    const minutes = state.sessions.filter(item => localDateKey(item.date) === key).reduce((sum,item) => sum + (Number(item.minutes) || 0), 0);
    days.push({ key, label:SHORT_DAYS[date.getDay()], minutes });
  }
  const max = Math.max(60, ...days.map(day => day.minutes));
  $("#weekly-chart").innerHTML = days.map(day => `<div class="chart-day"><small>${day.minutes ? minutesText(day.minutes) : "0 min"}</small><div class="chart-bar-wrap"><div class="chart-bar" style="height:${Math.max(day.minutes ? 5 : 1, day.minutes / max * 100)}%"></div></div><b>${day.label}</b></div>`).join("");
  const grouped = {};
  state.sessions.forEach(item => grouped[item.subject || "Geral"] = (grouped[item.subject || "Geral"] || 0) + (Number(item.minutes) || 0));
  const subjects = Object.entries(grouped).sort((a,b) => b[1] - a[1]);
  $("#subject-performance").innerHTML = subjects.length ? subjects.map(([name,minutes]) => `<div class="simple-row"><div><b>${esc(name)}</b><small>${state.sessions.filter(item => (item.subject || "Geral") === name).length} sessões</small></div><strong>${minutesText(minutes)}</strong></div>`).join("") : '<div class="empty-state">Conclua uma sessão no cronômetro para ver seu desempenho.</div>';
}

function renderQuickNotes() {
  const query = ($("#quicknotes-search").value || "").toLowerCase().trim();
  const items = [...state.quickNotes].sort((a,b) => new Date(b.updated || b.created) - new Date(a.updated || a.created)).filter(item => (item.title + " " + item.content).toLowerCase().includes(query));
  $("#quicknotes-count").textContent = state.quickNotes.length;
  $("#quicknotes-list").innerHTML = items.length ? items.map(item => `<article class="quicknote-card"><h3>${esc(item.title)}</h3><small>${formatDate(item.updated || item.created)}</small><p>${esc(item.content)}</p><div class="quicknote-actions"><button data-edit-quicknote="${item.id}">Editar</button><button class="delete" data-delete-quicknote="${item.id}">Excluir</button></div></article>`).join("") : '<div class="empty-state">Nenhuma nota rápida. Use o formulário para registrar uma informação importante.</div>';
  $$('[data-edit-quicknote]').forEach(button => button.addEventListener("click", () => {
    const item = state.quickNotes.find(note => note.id === button.dataset.editQuicknote);
    if (!item) return;
    editingQuickNoteId = item.id; $("#quick-title").value = item.title; $("#quick-content").value = item.content; $("#save-quicknote").textContent = "Salvar alterações";
    $("#quick-title").focus(); window.scrollTo({ top:0, behavior:"smooth" });
  }));
  $$('[data-delete-quicknote]').forEach(button => button.addEventListener("click", async () => {
    state.quickNotes = state.quickNotes.filter(item => item.id !== button.dataset.deleteQuicknote);
    await saveState(); renderQuickNotes();
  }));
}
async function saveQuickNote() {
  const title = $("#quick-title").value.trim(), content = $("#quick-content").value.trim();
  if (!title || !content) { toast("Preencha o título e o conteúdo da nota.", "error"); return; }
  if (editingQuickNoteId) {
    const item = state.quickNotes.find(note => note.id === editingQuickNoteId);
    if (item) { item.title = title; item.content = content; item.updated = new Date().toISOString(); }
  } else state.quickNotes.unshift({ id:uid(), title, content, created:new Date().toISOString(), updated:new Date().toISOString() });
  editingQuickNoteId = null; $("#quick-title").value = ""; $("#quick-content").value = ""; $("#save-quicknote").textContent = "＋ Salvar nota";
  await saveState(); renderQuickNotes(); toast("Nota salva automaticamente no aparelho.");
}

function renderGoals() {
  $("#goal-daily").value = state.goals.dailyMinutes;
  $("#goal-weekly").value = state.goals.weeklyMinutes;
  const daily = state.goals.dailyMinutes || 120, weekly = state.goals.weeklyMinutes || 600;
  const today = getTodayMinutes(), week = getWeekMinutes();
  const pendingReviews = state.reviews.filter(item => !item.done && item.dueDate <= todayKey()).length;
  const dailyPercent = Math.min(100, Math.round(today / daily * 100));
  const weeklyPercent = Math.min(100, Math.round(week / weekly * 100));
  $("#goal-cards").innerHTML = `
    <article class="goal-card"><h3>Meta diária</h3><strong>${dailyPercent}%</strong><small>${minutesText(today)} de ${minutesText(daily)}</small><div class="progress-track"><i style="width:${dailyPercent}%"></i></div></article>
    <article class="goal-card"><h3>Meta semanal</h3><strong>${weeklyPercent}%</strong><small>${minutesText(week)} de ${minutesText(weekly)}</small><div class="progress-track"><i style="width:${weeklyPercent}%"></i></div></article>
    <article class="goal-card"><h3>Revisões para hoje</h3><strong>${pendingReviews}</strong><small>Revisões pendentes com vencimento até hoje</small><button class="btn soft full" data-go="reviews">Ver revisões</button></article>
    <article class="goal-card"><h3>Assuntos concluídos</h3><strong>${state.editalSubjects.flatMap(subject => subject.topics || []).filter(topic => topic.status === "done" || topic.status === "reviewed").length}</strong><small>No checklist do edital</small><button class="btn soft full" data-go="edital">Ver edital</button></article>`;
  $$("#goal-cards [data-go]").forEach(button => button.addEventListener("click", () => navigate(button.dataset.go)));
}
async function saveGoals() {
  const dailyMinutes = Number($("#goal-daily").value), weeklyMinutes = Number($("#goal-weekly").value);
  if (!dailyMinutes || !weeklyMinutes || dailyMinutes < 10 || weeklyMinutes < 30) { toast("Informe metas válidas: pelo menos 10 minutos por dia e 30 por semana.", "error"); return; }
  state.goals = { dailyMinutes, weeklyMinutes };
  await saveState(); renderGoals(); renderHome(); toast("Metas atualizadas.");
}

async function backupData() {
  try {
    const records = await idbAll("files");
    const total = records.reduce((sum,item) => sum + (item.size || 0), 0);
    if (total > 120 * 1024 * 1024 && !confirm("Seus PDFs somam " + formatBytes(total) + ". O backup pode exigir bastante memória. Deseja continuar?")) return;
    const files = [];
    for (const item of records) {
      const bytes = new Uint8Array(await item.blob.arrayBuffer());
      let binary = "";
      for (let i=0; i<bytes.length; i+=0x8000) binary += String.fromCharCode(...bytes.subarray(i,i+0x8000));
      files.push({ id:item.id, name:item.name, size:item.size, added:item.added, base64:btoa(binary) });
    }
    const payload = { app:"Estuda+", version:2, created:new Date().toISOString(), state, files };
    downloadBlob(new Blob([JSON.stringify(payload)], {type:"application/json"}), "backup-estuda-plus.json");
    toast("Backup criado. Guarde o arquivo em local seguro.");
  } catch (error) { console.error(error); toast("Não foi possível criar o backup. Verifique o espaço livre.", "error"); }
}
async function restoreData(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (payload.app !== "Estuda+" || !payload.state) throw new Error("Arquivo de backup inválido.");
    if (!confirm("Restaurar este backup? Os dados atuais serão substituídos.")) return;
    for (const item of await idbAll("files")) await idbDelete("files", item.id);
    state = normalizeState(payload.state);
    for (const item of payload.files || []) {
      const binary = atob(item.base64), bytes = new Uint8Array(binary.length);
      for (let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
      await idbPut("files", { id:item.id, name:item.name, size:item.size, added:item.added, type:"application/pdf", blob:new Blob([bytes], {type:"application/pdf"}) });
    }
    await saveState(); renderEverything(); navigate("home"); updateStorageStatus(); toast("Backup restaurado com sucesso.");
  } catch (error) { toast("Não foi possível restaurar: " + error.message, "error"); }
}

function showInstallInstructions() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  $("#install-instructions").textContent = ios ? "No iPhone ou iPad, instale pelo menu Compartilhar do Safari." : "Adicione o Estuda+ à tela inicial para abrir como aplicativo.";
  $("#install-steps").innerHTML = ios ? "<li>Abra este endereço no Safari.</li><li>Toque no botão Compartilhar.</li><li>Escolha “Adicionar à Tela de Início”.</li><li>Confirme em “Adicionar”.</li>" : "<li>Abra este endereço no Chrome.</li><li>Toque em “Instalar app” ou abra o menu do navegador.</li><li>Escolha “Instalar aplicativo” ou “Adicionar à tela inicial”.</li>";
  $("#install-modal").hidden = false;
}
async function installApp() {
  if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $("#install-btn").hidden = true; }
  else showInstallInstructions();
}
function registerPwa() {
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("./sw.js").then(() => {
      $("#connection-status").textContent = navigator.onLine ? "Pronto para offline" : "Modo offline";
      $("#connection-status").classList.toggle("online", navigator.onLine);
    }).catch(error => console.warn("Service worker:", error));
  }
  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); installPrompt = event; $("#install-btn").hidden = false; });
  window.addEventListener("appinstalled", () => { $("#install-btn").hidden = true; toast("Estuda+ instalado!"); });
  $("#install-btn").addEventListener("click", installApp);
  $("#close-install-modal").addEventListener("click", () => $("#install-modal").hidden = true);
  $("#install-modal-ok").addEventListener("click", () => $("#install-modal").hidden = true);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (!isStandalone && /iphone|ipad|ipod/i.test(navigator.userAgent)) $("#install-btn").hidden = false;
  window.addEventListener("online", () => { $("#connection-status").textContent = "Conectado"; $("#connection-status").classList.add("online"); });
  window.addEventListener("offline", () => { $("#connection-status").textContent = "Modo offline"; $("#connection-status").classList.remove("online"); });
}

function renderEverything() {
  renderHome(); renderMaterials(); renderNotebook(); renderFavorites(); renderTimerSessions();
  renderEdictal(); renderPlanner(); renderReviews(); renderPerformance(); renderQuickNotes(); renderGoals();
}
function bindEvents() {
  bindNavigation();
  $("#upload-trigger").addEventListener("click", () => $("#pdf-files").click());
  $("#upload-trigger-2").addEventListener("click", () => $("#pdf-files").click());
  $("#pdf-files").addEventListener("change", event => { uploadPdfs([...event.target.files]); event.target.value = ""; });
  $("#material-search").addEventListener("input", renderMaterials);
  $("#page-prev").addEventListener("click", () => changePdfPage(pdfPage - 1));
  $("#page-next").addEventListener("click", () => changePdfPage(pdfPage + 1));
  $("#page-input").addEventListener("change", () => changePdfPage($("#page-input").value));
  $("#page-input").addEventListener("keydown", event => { if (event.key === "Enter") changePdfPage($("#page-input").value); });
  $("#zoom-in").addEventListener("click", () => { pdfZoom = Math.min(2.5, pdfZoom + .2); renderPdfPage(); });
  $("#zoom-out").addEventListener("click", () => { pdfZoom = Math.max(.6, pdfZoom - .2); renderPdfPage(); });
  $("#zoom-fit").addEventListener("click", () => { pdfZoom = 1; renderPdfPage(); });
  $("#download-pdf").addEventListener("click", async () => { if (!currentMaterial) return; const record = await idbGet("files", currentMaterial.id); if (record?.blob) downloadBlob(record.blob, record.name); });
  $("#save-note").addEventListener("click", () => saveCurrentPageNote(true));
  $("#page-note").addEventListener("input", () => { clearTimeout(noteSaveTimer); noteSaveTimer = setTimeout(() => saveCurrentPageNote(false), 450); });
  $("#page-note").addEventListener("blur", () => { if (currentMaterial) saveCurrentPageNote(false); });
  $("#save-bookmark").addEventListener("click", saveBookmark);
  $("#schedule-page-review").addEventListener("click", scheduleCurrentPageReviews);
  $("#export-notes").addEventListener("click", exportNotebook);
  $("#notes-search").addEventListener("input", renderNotebook);
  $("#timer-start").addEventListener("click", toggleTimer);
  $("#timer-reset").addEventListener("click", resetTimer);
  $("#timer-finish").addEventListener("click", () => finishTimer(false));
  $("#timer-length").addEventListener("change", () => { if (!timerActive) resetTimer(); });
  $("#save-exam-name").addEventListener("click", async () => { state.examName = $("#exam-name").value.trim(); await saveState(); toast("Nome do concurso salvo."); });
  $("#add-subject").addEventListener("click", addSubject);
  $("#new-subject").addEventListener("keydown", event => { if (event.key === "Enter") addSubject(); });
  $("#add-plan").addEventListener("click", addPlanItem);
  $("#add-review").addEventListener("click", addManualReview);
  $("#review-filter").addEventListener("change", renderReviews);
  $("#save-quicknote").addEventListener("click", saveQuickNote);
  $("#quicknotes-search").addEventListener("input", renderQuickNotes);
  $("#save-goals").addEventListener("click", saveGoals);
  $("#backup-btn").addEventListener("click", backupData);
  $("#restore-btn").addEventListener("click", () => $("#restore-file").click());
  $("#restore-file").addEventListener("change", event => { if (event.target.files[0]) restoreData(event.target.files[0]); event.target.value = ""; });
  window.addEventListener("resize", () => { if (!$("#view-reader").hidden && pdfDoc) renderPdfPage(); });
}

async function init() {
  try {
    await openDatabase();
    await loadState();
    await saveState(); // Migra anotações/favoritos antigos e remove definitivamente os dados das ferramentas descontinuadas.
    await requestPersistentStorage();
  } catch (error) {
    console.error(error);
    toast("Não foi possível iniciar o armazenamento local neste navegador.", "error");
  }
  bindEvents();
  registerPwa();
  renderEverything();
  $("#review-date").value = todayKey();
  updateTimerDisplay();
  $("#connection-status").textContent = navigator.onLine ? "Conectado" : "Modo offline";
  $("#connection-status").classList.toggle("online", navigator.onLine);
  if (!window.pdfjsLib) toast("O leitor PDF precisa ser carregado na primeira abertura com internet.", "error");
}
init();