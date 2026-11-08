import "./style.css";
import OBR from "@owlbear-rodeo/sdk";

const EXTENSION_ID = "com.investigationboard.owlbear";
const CHANNEL = `${EXTENSION_ID}/sync`;
const MODAL_ID = `${EXTENSION_ID}/modal`;
const STORAGE_KEY = `${EXTENSION_ID}/local-backup`;
const EMPTY_BOARD = { version: 3, id: "", title: "Quadro 1", documents: [], notes: [], links: [], deleted: {}, updatedAt: 0, revision: 0, clientId: "" };
const EMPTY_WORKSPACE = { version: 4, boards: [], activeBoardId: "", deletedBoards: {}, updatedAt: 0, revision: 0, clientId: "" };
const MAX_BOARDS = 3;
const $ = (selector) => document.querySelector(selector);

const viewport = $("#viewport");
const world = $("#board-world");
const corkboard = $("#corkboard");
const cardsLayer = $("#cards");
const svg = $("#connections");
const notice = $("#notice");
const addDocButton = $("#add-doc");
const addNoteButton = $("#add-note");
const connectButton = $("#connect-mode");
const deleteButton = $("#delete-mode");
const closeButton = $("#close-board");
const rolePill = $("#role-pill");
const noteDialog = $("#note-dialog");
const noteForm = $("#note-form");
const searchInput = $("#search-cards");
const zoomLabel = $("#zoom-label");
const fileInput = $("#import-file");
const boardSelect = $("#board-select");
const boardTitleInput = $("#board-title");
const addBoardButton = $("#add-board");
const deleteBoardButton = $("#delete-board");
const toolbarToggle = $("#toolbar-toggle");

let workspace = structuredClone(EMPTY_WORKSPACE);
let board = structuredClone(EMPTY_BOARD);
let roomStorageKey = STORAGE_KEY;
let isGM = false;
let connectMode = false;
let deleteLinkMode = false;
let firstEndpoint = null;
let editingNoteId = null;
let dragState = null;
let panState = null;
let suppressClick = false;
let saveTimer = null;
let applyingRemote = false;
let lastSavedRevision = 0;
let localRevision = 0;
let clientId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
let history = [];
let future = [];
let activePointers = new Map();
let pinchState = null;
let camera = { x: 24, y: 24, scale: 1 };

function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }
function createBoard(title = `Quadro ${workspace.boards.length + 1}`) {
  return { ...clone(EMPTY_BOARD), id: uid(), title, _updatedAt: Date.now(), _updatedBy: clientId };
}
function setWorkspace(next) {
  workspace = next;
  if (!workspace.boards.length) workspace.boards = [createBoard("Quadro 1")];
  if (!workspace.boards.some((item) => item.id === workspace.activeBoardId)) workspace.activeBoardId = workspace.boards[0].id;
  board = workspace.boards.find((item) => item.id === workspace.activeBoardId) || workspace.boards[0];
  renderBoardMenu();
}
function renderBoardMenu() {
  if (!boardSelect) return;
  boardSelect.innerHTML = "";
  for (const item of workspace.boards) {
    const option = document.createElement("option"); option.value = item.id; option.textContent = item.title || "Quadro sem título"; boardSelect.append(option);
  }
  boardSelect.value = board.id;
  boardTitleInput.value = board.title || "";
  addBoardButton.disabled = workspace.boards.length >= MAX_BOARDS;
  deleteBoardButton.hidden = !isGM;
  deleteBoardButton.disabled = workspace.boards.length <= 1;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
function showNotice(message, kind = "info") {
  notice.textContent = message;
  notice.dataset.kind = kind;
  notice.classList.add("visible");
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => notice.classList.remove("visible"), 3600);
}
function checkpoint(snapshot = board) {
  history.push(clone(snapshot));
  if (history.length > 60) history.shift();
  future = [];
  updateHistoryButtons();
}
function updateHistoryButtons() {
  $("#undo-action").disabled = history.length === 0;
  $("#redo-action").disabled = future.length === 0;
}
function nextTimestamp() {
  let latest = 0;
  for (const item of [...(board.documents || []), ...(board.notes || []), ...(board.links || [])]) latest = Math.max(latest, item._updatedAt || 0);
  for (const timestamp of Object.values(board.deleted || {})) latest = Math.max(latest, Number(timestamp) || 0);
  return Math.max(Date.now(), latest + 1);
}
function markItem(item) { item._updatedAt = nextTimestamp(); item._updatedBy = clientId; }
function markDeleted(id) { board.deleted ||= {}; board.deleted[id] = nextTimestamp(); }
function findCard(id) { return board.documents.find((item) => item.id === id) || board.notes.find((item) => item.id === id); }
function cardCenter(item) {
  const element = cardsLayer.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
  const width = element?.offsetWidth || item.width || 230;
  const height = element?.offsetHeight || item.height || 170;
  return { x: item.x + width / 2, y: item.y + height / 2 };
}
function boardPointFromEvent(event) {
  const rect = corkboard.getBoundingClientRect();
  return { x: Math.max(12, (event.clientX - rect.left) / camera.scale), y: Math.max(12, (event.clientY - rect.top) / camera.scale) };
}
function applyCamera() {
  world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
  zoomLabel.textContent = `${Math.round(camera.scale * 100)}%`;
}
function zoomAt(clientX, clientY, factor) {
  const rect = viewport.getBoundingClientRect();
  const anchorX = (clientX - rect.left - camera.x) / camera.scale;
  const anchorY = (clientY - rect.top - camera.y) / camera.scale;
  const next = Math.max(0.3, Math.min(2.5, camera.scale * factor));
  camera.x = clientX - rect.left - anchorX * next;
  camera.y = clientY - rect.top - anchorY * next;
  camera.scale = next;
  applyCamera();
}
function renderConnections() {
  svg.setAttribute("viewBox", "0 0 2400 1500");
  svg.setAttribute("width", "2400");
  svg.setAttribute("height", "1500");
  svg.innerHTML = "";
  for (const link of board.links) {
    const a = findCard(link.from), b = findCard(link.to);
    if (!a || !b) continue;
    const p1 = cardCenter(a), p2 = cardCenter(b);
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "line");
    hit.setAttribute("x1", p1.x); hit.setAttribute("y1", p1.y); hit.setAttribute("x2", p2.x); hit.setAttribute("y2", p2.y);
    hit.setAttribute("class", "connection-hit-target"); hit.dataset.linkId = link.id; hit.setAttribute("pointer-events", "stroke"); group.append(hit);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", p1.x); line.setAttribute("y1", p1.y); line.setAttribute("x2", p2.x); line.setAttribute("y2", p2.y);
    line.setAttribute("class", "red-string"); line.setAttribute("stroke", link.color || "#8e1718");
    if (link.style === "dashed") line.setAttribute("stroke-dasharray", "10 7");
    if (link.style === "dotted") line.setAttribute("stroke-dasharray", "2 8");
    group.append(line);
    if (deleteLinkMode) {
      const mid = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      mid.setAttribute("cx", (p1.x + p2.x) / 2); mid.setAttribute("cy", (p1.y + p2.y) / 2); mid.setAttribute("r", "9");
      mid.setAttribute("class", "link-delete-target"); mid.dataset.linkId = link.id; group.append(mid);
    }
    svg.append(group);
  }
}
function applyFilters() {
  const query = searchInput.value.trim().toLocaleLowerCase("pt-BR");
  for (const card of cardsLayer.querySelectorAll("[data-id]")) {
    const item = findCard(card.dataset.id);
    const haystack = [item?.name, item?.body].join(" ").toLocaleLowerCase("pt-BR");
    card.classList.toggle("filtered-out", Boolean(query) && !haystack.includes(query));
  }
}
function render() {
  cardsLayer.innerHTML = "";
  for (const doc of board.documents) {
    const card = document.createElement("article");
    card.className = `evidence-card${doc.locked ? " is-locked" : ""}`;
    card.dataset.id = doc.id;
    card.style.left = `${doc.x}px`; card.style.top = `${doc.y}px`;
    card.style.width = `${doc.width || 220}px`;
    card.style.height = `${doc.height || Math.round((doc.width || 220) / (doc.aspectRatio || 0.75))}px`;
    card.innerHTML = `<img class="document-image" src="${safeText(doc.url)}" alt="${safeText(doc.name)}" draggable="false" />
      <div class="document-actions">
        <button class="mini-scale" data-scale="down" data-document="${doc.id}" title="Diminuir">−</button>
        <button class="mini-scale" data-scale="up" data-document="${doc.id}" title="Aumentar">＋</button>
        <button class="mini-lock" data-lock="${doc.id}" title="${doc.locked ? "Desbloquear" : "Bloquear"}">${doc.locked ? "🔒" : "🔓"}</button>
        ${isGM ? `<button class="mini-delete" data-delete="${doc.id}" title="Excluir">×</button>` : ""}
      </div>`;
    cardsLayer.append(card);
  }
  for (const note of board.notes) {
    const card = document.createElement("article");
    card.className = `note-card note-${note.color || "parchment"}${note.locked ? " is-locked" : ""}`;
    card.dataset.id = note.id; card.dataset.kind = "note";
    card.style.left = `${note.x}px`; card.style.top = `${note.y}px`;
    card.style.width = `${note.width || 230}px`;
    card.style.setProperty("--note-scale", String(note.scale || 1));
    card.innerHTML = `<div class="note-actions"><button class="mini-scale" data-note-scale="down" data-note="${note.id}" title="Diminuir anotação">−</button>
      <button class="mini-scale" data-note-scale="up" data-note="${note.id}" title="Aumentar anotação">＋</button>
      <button class="mini-edit" data-edit-note="${note.id}" title="Editar">✎</button>
      <button class="mini-lock" data-lock="${note.id}" title="${note.locked ? "Desbloquear" : "Bloquear"}">${note.locked ? "🔒" : "🔓"}</button>
      ${isGM ? `<button class="mini-delete" data-delete-note="${note.id}" title="Excluir">×</button>` : ""}</div>
      <p>${safeText(note.body).replace(/\n/g, "<br>")}</p>`;
    cardsLayer.append(card);
  }
  applyFilters();
  renderConnections();
}
function mergeById(localItems = [], remoteItems = [], deleted = {}) {
  const merged = new Map();
  for (const item of [...remoteItems, ...localItems]) {
    if (!item?.id || (deleted[item.id] || 0) >= (item._updatedAt || 0)) continue;
    const previous = merged.get(item.id);
    const a = previous?._updatedAt || 0, b = item._updatedAt || 0;
    if (!previous || b > a || (b === a && String(item._updatedBy || "") > String(previous._updatedBy || ""))) merged.set(item.id, item);
  }
  return [...merged.values()];
}
function mergeBoards(a, b) {
  const deleted = { ...(a.deleted || {}), ...(b.deleted || {}) };
  const merged = { ...EMPTY_BOARD, ...b, ...a, deleted };
  merged.documents = mergeById(a.documents, b.documents, deleted);
  merged.notes = mergeById(a.notes, b.notes, deleted);
  const allLinks = new Map();
  for (const link of [...(b.links || []), ...(a.links || [])]) {
    if (!link?.id || (deleted[link.id] || 0) >= (link._updatedAt || 0)) continue;
    const old = allLinks.get(link.id);
    if (!old || (link._updatedAt || 0) > (old._updatedAt || 0)) allLinks.set(link.id, link);
  }
  merged.links = [...allLinks.values()].filter((link) => merged.documents.some((x) => x.id === link.from) || merged.notes.some((x) => x.id === link.from)).filter((link) => merged.documents.some((x) => x.id === link.to) || merged.notes.some((x) => x.id === link.to));
  merged.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
  merged.revision = Math.max(a.revision || 0, b.revision || 0);
  merged.clientId = a.clientId || b.clientId || clientId;
  return merged;
}
function normalizeWorkspace(stored) {
  if (stored?.version === 4 && Array.isArray(stored.boards)) {
    const deletedBoards = stored.deletedBoards && typeof stored.deletedBoards === "object" ? stored.deletedBoards : {};
    const boards = stored.boards.filter((item) => item?.id && (deletedBoards[item.id] || 0) < (item._updatedAt || 0)).slice(0, MAX_BOARDS).map((item) => ({ ...normalizeBoard({ ...item, version: 3 }), id: item.id, title: String(item.title || "Quadro sem título"), _updatedAt: item._updatedAt || 0, _updatedBy: item._updatedBy || "" }));
    const next = { ...clone(EMPTY_WORKSPACE), ...stored, boards, deletedBoards };
    if (!boards.some((item) => item.id === next.activeBoardId)) next.activeBoardId = boards[0]?.id || "";
    return next;
  }
  // Migração automática da versão 3: o quadro antigo vira o primeiro quadro do espaço.
  if (stored && [1, 2, 3].includes(stored.version)) {
    const migrated = normalizeBoard(stored); migrated.id = "legacy-board-v3"; migrated.title = "Quadro 1"; migrated._updatedAt = stored.updatedAt || Date.now();
    return { ...clone(EMPTY_WORKSPACE), boards: [migrated], activeBoardId: migrated.id, updatedAt: stored.updatedAt || 0, revision: stored.revision || 0, clientId: stored.clientId || "" };
  }
  return clone(EMPTY_WORKSPACE);
}
function mergeWorkspaces(a, b) {
  const deletedBoards = { ...(a.deletedBoards || {}), ...(b.deletedBoards || {}) };
  const merged = new Map();
  for (const item of [...(b.boards || []), ...(a.boards || [])]) {
    if (!item?.id || (deletedBoards[item.id] || 0) >= (item._updatedAt || 0)) continue;
    const previous = merged.get(item.id);
    if (!previous) merged.set(item.id, clone(item));
    else {
      const content = mergeBoards(previous, item);
      const newer = (item._updatedAt || 0) > (previous._updatedAt || 0) ? item : previous;
      merged.set(item.id, { ...content, id: item.id, title: newer.title || previous.title, _updatedAt: Math.max(item._updatedAt || 0, previous._updatedAt || 0), _updatedBy: newer._updatedBy || "" });
    }
  }
  const boards = [...merged.values()].sort((x, y) => (x._updatedAt || 0) - (y._updatedAt || 0)).slice(-MAX_BOARDS);
  if (!boards.length) boards.push(createBoard("Quadro 1"));
  const activeBoardId = boards.some((item) => item.id === a.activeBoardId) ? a.activeBoardId : (boards.some((item) => item.id === b.activeBoardId) ? b.activeBoardId : boards[0].id);
  return { ...clone(EMPTY_WORKSPACE), ...b, ...a, version: 4, boards, activeBoardId, deletedBoards, updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0), revision: Math.max(a.revision || 0, b.revision || 0), clientId: a.clientId || b.clientId || clientId };
}
function workspaceSignature(value) { return JSON.stringify({ boards: value.boards, activeBoardId: value.activeBoardId, deletedBoards: value.deletedBoards }); }
function activateBoard(id) {
  const next = workspace.boards.find((item) => item.id === id); if (!next) return;
  workspace.activeBoardId = id; board = next; history = []; future = []; firstEndpoint = null; connectMode = false; deleteLinkMode = false;
  connectButton.classList.remove("active"); deleteButton.classList.remove("active"); corkboard.classList.remove("connecting", "deleting");
  renderBoardMenu(); render(); updateHistoryButtons(); camera = { x: 24, y: 24, scale: 1 }; applyCamera(); queueSave();
}
function addBoard() {
  if (workspace.boards.length >= MAX_BOARDS) return;
  const next = createBoard(`Quadro ${workspace.boards.length + 1}`); workspace.boards.push(next); activateBoard(next.id); renderBoardMenu(); queueSave(); showNotice("Novo quadro criado.", "success");
}
function renameBoard() {
  const title = boardTitleInput.value.trim().slice(0, 40) || "Quadro sem título";
  if (title === board.title) { boardTitleInput.value = board.title; return; }
  board.title = title; board._updatedAt = Date.now(); board._updatedBy = clientId; renderBoardMenu(); queueSave();
}
function removeBoard() {
  if (!isGM || workspace.boards.length <= 1) return;
  const removedId = board.id; workspace.deletedBoards[removedId] = Date.now();
  workspace.boards = workspace.boards.filter((item) => item.id !== removedId);
  workspace.activeBoardId = workspace.boards[0].id; board = workspace.boards[0]; history = []; future = []; renderBoardMenu(); render(); updateHistoryButtons(); queueSave(); showNotice("Quadro excluído.", "success");
}

function queueSave() {
  if (applyingRemote) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveBoard, 500);
}
async function saveBoard() {
  try {
    const beforeMerge = workspaceSignature(workspace);
    const latestMetadata = await OBR.room.getMetadata();
    const latest = latestMetadata?.[EXTENSION_ID];
    if (latest) setWorkspace(mergeWorkspaces(workspace, normalizeWorkspace(latest)));
    if (workspaceSignature(workspace) !== beforeMerge) { history = []; future = []; updateHistoryButtons(); render(); }
  } catch (error) { console.warn("Não foi possível reconciliar a versão remota antes de salvar:", error); }
  const next = clone(workspace);
  next.version = 4; next.updatedAt = Date.now(); next.revision = Math.max(++localRevision, (workspace.revision || 0) + 1); next.clientId = clientId;
  const payload = { [EXTENSION_ID]: next };
  localStorage.setItem(roomStorageKey, JSON.stringify(next));
  const bytes = new Blob([JSON.stringify(payload)]).size;
  if (bytes > 13500) { showNotice(`Quadros com ${(bytes / 1024).toFixed(1)} KB: o limite de metadados do Owlbear está próximo. Exporte uma cópia e reduza imagens/documentos.`, "error"); return; }
  try {
    await OBR.room.setMetadata(payload);
    workspace.updatedAt = next.updatedAt; workspace.revision = next.revision; workspace.clientId = clientId;
    lastSavedRevision = next.revision; localStorage.setItem(roomStorageKey, JSON.stringify(workspace));
    await OBR.broadcast.sendMessage(CHANNEL, { type: "board-updated", revision: next.revision, clientId });
    showNotice("Alterações salvas e compartilhadas.", "success");
  } catch (error) { console.error(error); showNotice("Não foi possível salvar. Verifique a conexão com a sala.", "error"); }
}
function normalizeBoard(stored) {
  if (!stored || ![1, 2, 3].includes(stored.version)) return clone(EMPTY_BOARD);
  const migrateSize = Number(stored.version) < 3;
  return { ...clone(EMPTY_BOARD), ...stored, version: 3,
    documents: Array.isArray(stored.documents) ? stored.documents.map((x) => {
      const { category, ...item } = x;
      const aspectRatio = Number(x.aspectRatio) > 0 ? Number(x.aspectRatio) : (Number(x.width) > 0 && Number(x.height) > 0 ? Number(x.width) / Number(x.height) : 0.75);
      const oldWidth = Number(x.width) || 220;
      const width = Math.min(2376, 1476 * aspectRatio, Math.max(280, migrateSize ? oldWidth * 1.5 : oldWidth));
      const height = Math.round(width / aspectRatio);
      return { ...item, x: Math.max(12, Math.min(2400 - width - 12, Number(x.x) || 12)), y: Math.max(12, Math.min(1500 - height - 12, Number(x.y) || 12)), width, height, aspectRatio, _updatedAt: x._updatedAt || stored.updatedAt || 0 };
    }) : [],
    notes: Array.isArray(stored.notes) ? stored.notes.map((x) => { const { title, category, ...item } = x; const width = Math.min(2376, Math.max(280, migrateSize ? (Number(x.width) || 230) * 1.3 : (Number(x.width) || 300)));
      return { ...item, x: Math.max(12, Math.min(2400 - width - 12, Number(x.x) || 12)), y: Math.max(12, Math.min(1500 - (Number(x.height) || 190) - 12, Number(x.y) || 12)), color: x.color === "cream" ? "parchment" : (x.color || "parchment"), width, scale: Math.max(1, Number(x.scale) || 1), _updatedAt: x._updatedAt || stored.updatedAt || 0 }; }) : [],
    links: Array.isArray(stored.links) ? stored.links.map((x) => ({ ...x, _updatedAt: x._updatedAt || stored.updatedAt || 0 })) : [],
    deleted: stored.deleted && typeof stored.deleted === "object" ? stored.deleted : {} };
}
async function loadBoard() {
  const metadata = await OBR.room.getMetadata();
  const stored = metadata?.[EXTENSION_ID]; let backup = null;
  try { const raw = localStorage.getItem(roomStorageKey); if (raw) backup = normalizeWorkspace(JSON.parse(raw)); } catch { /* backup local inválido */ }
  const remote = stored ? normalizeWorkspace(stored) : null;
  const loaded = remote && backup ? mergeWorkspaces(remote, backup) : (remote || backup || clone(EMPTY_WORKSPACE));
  if (!loaded.boards.length) { const initial = createBoard("Quadro 1"); loaded.boards = [initial]; loaded.activeBoardId = initial.id; }
  setWorkspace(loaded); workspace.clientId = clientId; lastSavedRevision = workspace.revision || 0;
  localStorage.setItem(roomStorageKey, JSON.stringify(workspace)); render(); applyCamera();
  if (backup && (!stored || workspaceSignature(workspace) !== workspaceSignature(remote))) queueSave();
}
function applyRemoteBoard(metadata) {
  const stored = metadata?.[EXTENSION_ID]; if (!stored || stored.version < 1) return;
  const incoming = normalizeWorkspace(stored); const merged = mergeWorkspaces(workspace, incoming);
  const changed = workspaceSignature(merged) !== workspaceSignature(workspace); if (!changed) return;
  const hasLocalChangesMissingRemotely = workspaceSignature(merged) !== workspaceSignature(incoming);
  applyingRemote = true; setWorkspace(merged); lastSavedRevision = Math.max(lastSavedRevision, incoming.revision || 0);
  // Evita que um desfazer baseado em um estado antigo sobrescreva alterações remotas recém-recebidas.
  history = []; future = []; updateHistoryButtons();
  render(); applyingRemote = false; localStorage.setItem(roomStorageKey, JSON.stringify(workspace));
  if (hasLocalChangesMissingRemotely) queueSave();
}
async function addDocuments() {
  addDocButton.disabled = true;
  try {
    let downloads;
    try { downloads = await OBR.assets.downloadImages(true, " ", "NOTE"); }
    catch (error) { console.warn("Seletor NOTE indisponível; tentando seletor geral", error); downloads = await OBR.assets.downloadImages(true, " "); }
    if (!Array.isArray(downloads) || !downloads.length) { showNotice("Nenhum documento selecionado."); return; }
    const valid = downloads.filter((item) => item?.image?.url && Number(item.image.width) > 0 && Number(item.image.height) > 0);
    if (!valid.length) { showNotice("Owlbear não retornou imagens utilizáveis.", "error"); return; }
    checkpoint();
    for (const item of valid) {
      const w = Number(item.image.width) || 600, h = Number(item.image.height) || 800;
      const aspectRatio = w / h;
      const width = Math.min(420, 1476 * aspectRatio, Math.max(320, w * (360 / Math.max(w, h))));
      const doc = { id: uid(), name: item.name || "Documento sem título", url: item.image.url, width, height: Math.round(width / aspectRatio), aspectRatio,
        x: Math.min(2400 - width - 12, 80 + (board.documents.length % 4) * 560), y: Math.min(1500 - Math.round(width / aspectRatio) - 12, 80 + Math.floor(board.documents.length / 4) * 500), locked: false };
      markItem(doc); board.documents.push(doc);
    }
    render(); queueSave(); showNotice(`${valid.length} documento(s) importado(s).`, "success");
  } catch (error) { console.error(error); showNotice("Não foi possível abrir o seletor de imagens do Owlbear.", "error"); }
  finally { addDocButton.disabled = false; }
}
function openNoteDialog(note = null) {
  editingNoteId = note?.id || null;
  $("#note-dialog-title").textContent = note ? "Editar anotação" : "Nova anotação";
  $("#note-body").value = note?.body || "";
  $("#note-color").value = note?.color || "parchment";
  noteDialog.hidden = false; $("#note-body").focus();
}
function closeNoteDialog() { noteDialog.hidden = true; editingNoteId = null; }
function saveNoteFromDialog(event) {
  event.preventDefault();
  const body = $("#note-body").value.trim();
  const color = $("#note-color").value;
  if (!body) { showNotice("Escreva alguma informação na anotação.", "error"); return; }
  checkpoint();
  if (editingNoteId) {
    const note = board.notes.find((item) => item.id === editingNoteId);
    if (note) { Object.assign(note, { body, color }); markItem(note); }
  } else {
    const offset = board.notes.length * 24;
    const note = { id: uid(), body, color, x: Math.min(2400 - 312, 150 + offset), y: Math.min(1500 - 202, 150 + offset), width: 300, height: 190, scale: 1, locked: false };
    markItem(note); board.notes.push(note);
  }
  closeNoteDialog(); render(); queueSave();
}
function onCardClick(event) {
  if (suppressClick) { suppressClick = false; return; }
  const target = event.target;
  const scaleButton = target.closest("[data-scale]");
  const lockId = target.closest("[data-lock]")?.dataset.lock;
  const deleteDocId = target.closest("[data-delete]")?.dataset.delete;
  const deleteNoteId = target.closest("[data-delete-note]")?.dataset.deleteNote;
  const editNoteId = target.closest("[data-edit-note]")?.dataset.editNote;
  if (scaleButton) {
    const doc = board.documents.find((item) => item.id === scaleButton.dataset.document); if (!doc) return;
    checkpoint(); const ratio = doc.aspectRatio || ((doc.width || 220) / (doc.height || 293));
    const maxWidth = Math.min(1100, 2376, 1476 * ratio);
    doc.width = Math.min(maxWidth, Math.max(Math.min(280, maxWidth), (doc.width || 340) + (scaleButton.dataset.scale === "up" ? 40 : -40)));
    doc.height = Math.round(doc.width / ratio); markItem(doc); render(); queueSave(); return;
  }
  const noteScaleButton = target.closest("[data-note-scale]");
  if (noteScaleButton) {
    const note = board.notes.find((item) => item.id === noteScaleButton.dataset.note); if (!note) return;
    checkpoint();
    const currentWidth = note.width || 300;
    note.width = Math.max(220, Math.min(650, currentWidth + (noteScaleButton.dataset.noteScale === "up" ? 35 : -35)));
    note.scale = Math.max(1, Math.min(1.5, note.width / 300));
    markItem(note); render(); queueSave(); return;
  }
  if (lockId) { const item = findCard(lockId); if (!item) return; checkpoint(); item.locked = !item.locked; markItem(item); render(); queueSave(); return; }
  if (deleteDocId && isGM) { checkpoint(); markDeleted(deleteDocId); for (const link of board.links.filter((x) => x.from === deleteDocId || x.to === deleteDocId)) markDeleted(link.id); board.documents = board.documents.filter((x) => x.id !== deleteDocId); board.links = board.links.filter((x) => x.from !== deleteDocId && x.to !== deleteDocId); render(); queueSave(); return; }
  if (deleteNoteId && isGM) { checkpoint(); markDeleted(deleteNoteId); for (const link of board.links.filter((x) => x.from === deleteNoteId || x.to === deleteNoteId)) markDeleted(link.id); board.notes = board.notes.filter((x) => x.id !== deleteNoteId); board.links = board.links.filter((x) => x.from !== deleteNoteId && x.to !== deleteNoteId); render(); queueSave(); return; }
  if (editNoteId) { const note = board.notes.find((x) => x.id === editNoteId); if (note) openNoteDialog(note); return; }
  const card = target.closest(".evidence-card, .note-card"); if (!card) return;
  const id = card.dataset.id;
  if (deleteLinkMode && isGM) { showNotice("Clique sobre uma linha para removê-la."); return; }
  if (connectMode) {
    if (!firstEndpoint) { firstEndpoint = id; card.classList.add("connection-selected"); showNotice("Agora selecione o segundo cartão."); }
    else if (firstEndpoint === id) { firstEndpoint = null; render(); showNotice("Seleção cancelada."); }
    else {
      const existing = board.links.find((x) => (x.from === firstEndpoint && x.to === id) || (x.from === id && x.to === firstEndpoint));
      checkpoint();
      if (existing) { existing.color = $("#link-color").value; existing.style = $("#link-style").value; markItem(existing); }
      else { const link = { id: uid(), from: firstEndpoint, to: id, color: $("#link-color").value, style: $("#link-style").value }; markItem(link); board.links.push(link); }
      firstEndpoint = null; render(); queueSave(); showNotice(existing ? "Estilo da conexão atualizado." : "Conexão criada.", "success");
    }
  }
}
function onPointerDown(event) {
  if (event.target.closest?.(".zoom-controls, button, input, select, textarea")) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
  if (activePointers.size === 2) {
    dragState = null; panState = null;
    const points = [...activePointers.values()];
    pinchState = { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), scale: camera.scale,
      midX: (points[0].x + points[1].x) / 2, midY: (points[0].y + points[1].y) / 2 };
    event.preventDefault(); return;
  }
  // Não capture o ponteiro sobre uma linha no modo de exclusão: isso retargeteia o click
  // para o viewport e impede que o SVG receba o evento de remoção.
  if (deleteLinkMode && event.target.closest?.("[data-link-id]")) return;
  const card = event.target.closest?.(".evidence-card, .note-card");
  // No modo de conexão, deixe o clique chegar ao listener delegado dos cartões.
  // Capturar o ponteiro no viewport aqui retargeteia o click e impedia selecionar os cartões.
  if (card && connectMode) { return; }
  if (card && !event.target.closest("button") && !connectMode && !deleteLinkMode) {
    const item = findCard(card.dataset.id); if (!item || item.locked) return;
    const point = boardPointFromEvent(event);
    dragState = { id: item.id, startX: point.x, startY: point.y, itemX: item.x, itemY: item.y, moved: false, before: clone(board), pointerId: event.pointerId };
    try { card.setPointerCapture(event.pointerId); } catch { /* captura não disponível */ }
    event.preventDefault(); return;
  }
  if (event.pointerType === "touch" || event.button === 1 || event.button === 0) {
    panState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, cameraX: camera.x, cameraY: camera.y, moved: false };
    try { viewport.setPointerCapture(event.pointerId); } catch { /* captura não disponível */ }
    if (event.pointerType === "touch" || event.button === 1) event.preventDefault();
  }
}
function onPointerMove(event) {
  if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
  if (pinchState && activePointers.size >= 2) {
    const points = [...activePointers.values()];
    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    const midX = (points[0].x + points[1].x) / 2, midY = (points[0].y + points[1].y) / 2;
    const ratio = distance / Math.max(1, pinchState.distance);
    zoomAt(pinchState.midX, pinchState.midY, ratio);
    camera.x += midX - pinchState.midX; camera.y += midY - pinchState.midY;
    pinchState = { distance, scale: camera.scale, midX, midY }; applyCamera(); event.preventDefault(); return;
  }
  if (dragState) {
    const point = boardPointFromEvent(event); const dx = point.x - dragState.startX, dy = point.y - dragState.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragState.moved = true;
    if (!dragState.moved) return;
    const item = findCard(dragState.id); if (!item) return;
    const card = cardsLayer.querySelector(`[data-id="${CSS.escape(dragState.id)}"]`);
    const cardWidth = card?.offsetWidth || item.width || 230; const cardHeight = card?.offsetHeight || item.height || 190;
    item.x = Math.max(12, Math.min(2400 - cardWidth - 12, dragState.itemX + dx)); item.y = Math.max(12, Math.min(1500 - cardHeight - 12, dragState.itemY + dy));
    if (card) { card.style.left = `${item.x}px`; card.style.top = `${item.y}px`; }
    renderConnections(); return;
  }
  if (panState && panState.pointerId === event.pointerId) {
    const dx = event.clientX - panState.startX, dy = event.clientY - panState.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) panState.moved = true;
    camera.x = panState.cameraX + dx; camera.y = panState.cameraY + dy; applyCamera();
  }
}
function onPointerUp(event) {
  activePointers.delete(event.pointerId);
  if (activePointers.size < 2) pinchState = null;
  if (dragState && dragState.pointerId === event.pointerId) {
    if (dragState.moved) { checkpoint(dragState.before); const item = findCard(dragState.id); if (item) markItem(item); suppressClick = true; queueSave(); }
    dragState = null;
  }
  if (panState && panState.pointerId === event.pointerId) { panState = null; }
}
function onSvgClick(event) {
  const target = event.target.closest?.("[data-link-id]"); if (!target || !deleteLinkMode) return;
  event.preventDefault(); event.stopPropagation();
  const id = target.dataset.linkId; checkpoint(); markDeleted(id); board.links = board.links.filter((x) => x.id !== id); render(); queueSave(); showNotice("Conexão removida.", "success");
}
function restoreHistorySnapshot(snapshot) {
  board = clone(snapshot);
  board.deleted ||= {};
  for (const item of [...board.documents, ...board.notes, ...board.links]) {
    delete board.deleted[item.id];
    markItem(item);
  }
}
function undo() {
  if (!history.length) return;
  future.push(clone(board)); restoreHistorySnapshot(history.pop()); render(); updateHistoryButtons(); queueSave(); showNotice("Última alteração desfeita.");
}
function redo() {
  if (!future.length) return;
  history.push(clone(board)); restoreHistorySnapshot(future.pop()); render(); updateHistoryButtons(); queueSave(); showNotice("Alteração refeita.");
}
function exportBoard() {
  const blob = new Blob([JSON.stringify({ format: "investigation-board", version: 4, exportedAt: new Date().toISOString(), workspace }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `investigation-board-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  showNotice("Cópia de segurança exportada.", "success");
}
function importBoard(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result); const importedWorkspace = data.workspace ? normalizeWorkspace(data.workspace) : (data.board ? normalizeWorkspace(data.board) : normalizeWorkspace(data)); const imported = importedWorkspace.boards[0];
      if (!Array.isArray(imported.documents) || !Array.isArray(imported.notes) || !Array.isArray(imported.links)) throw new Error("Formato inválido");
      checkpoint();
      const oldItems = [...board.documents, ...board.notes, ...board.links];
      const newIds = new Set([...imported.documents, ...imported.notes, ...imported.links].map((item) => item.id));
      imported.deleted = { ...(board.deleted || {}), ...(imported.deleted || {}) };
      const latestTimestamp = Math.max(Date.now(), ...oldItems.map((item) => item._updatedAt || 0), ...Object.values(imported.deleted).map((value) => Number(value) || 0)) + 1;
      for (const item of oldItems) if (!newIds.has(item.id)) imported.deleted[item.id] = latestTimestamp;
      setWorkspace(importedWorkspace); board = importedWorkspace.boards[0]; workspace.activeBoardId = board.id;
      for (const item of [...board.documents, ...board.notes, ...board.links]) markItem(item);
      renderBoardMenu(); render(); queueSave(); showNotice("Investigação importada e pronta para sincronizar.", "success");
    } catch (error) { console.error(error); showNotice("Arquivo inválido ou incompatível.", "error"); }
  };
  reader.readAsText(file);
}
async function init() {
  await new Promise((resolve) => OBR.onReady(resolve));
  roomStorageKey = `${STORAGE_KEY}/${OBR.room.id || "unknown-room"}`;
  isGM = (await OBR.player.getRole()) === "GM";
  rolePill.textContent = isGM ? "Mestre" : "Jogador"; rolePill.classList.toggle("gm", isGM);
  await loadBoard();
  OBR.room.onMetadataChange((metadata) => applyRemoteBoard(metadata));
  OBR.broadcast.onMessage(CHANNEL, async (event) => {
    if (event.data?.type === "board-updated") applyRemoteBoard(await OBR.room.getMetadata());
  });
  toolbarToggle.addEventListener("click", () => {
    const expanded = toolbarToggle.getAttribute("aria-expanded") !== "true";
    toolbarToggle.setAttribute("aria-expanded", String(expanded));
    toolbarToggle.title = expanded ? "Ocultar opções" : "Mostrar mais opções";
    toolbarToggle.querySelector(".sr-only").textContent = expanded ? "Ocultar opções" : "Mostrar mais opções";
    document.body.classList.toggle("toolbar-expanded", expanded);
  });
  addDocButton.addEventListener("click", addDocuments);
  boardSelect.addEventListener("change", () => activateBoard(boardSelect.value));
  boardTitleInput.addEventListener("change", renameBoard);
  boardTitleInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); boardTitleInput.blur(); } });
  addBoardButton.addEventListener("click", addBoard);
  deleteBoardButton.addEventListener("click", removeBoard);
  addNoteButton.addEventListener("click", () => openNoteDialog());
  connectButton.addEventListener("click", () => {
    connectMode = !connectMode;
    if (connectMode) { deleteLinkMode = false; deleteButton.classList.remove("active"); deleteButton.setAttribute("aria-pressed", "false"); deleteButton.querySelector(".button-label").textContent = "Desconectar"; corkboard.classList.remove("deleting"); }
    firstEndpoint = null; connectButton.classList.toggle("active", connectMode); connectButton.setAttribute("aria-pressed", String(connectMode));
    connectButton.querySelector(".button-label").textContent = connectMode ? "Sair" : "Linhas"; corkboard.classList.toggle("connecting", connectMode); render();
    showNotice(connectMode ? "Modo conexão ativo: selecione dois cartões." : "Modo conexão desativado.");
  });
  deleteButton.addEventListener("click", () => {
    deleteLinkMode = !deleteLinkMode;
    if (deleteLinkMode) { connectMode = false; firstEndpoint = null; connectButton.classList.remove("active"); connectButton.setAttribute("aria-pressed", "false"); connectButton.querySelector(".button-label").textContent = "Linhas"; corkboard.classList.remove("connecting"); }
    deleteButton.classList.toggle("active", deleteLinkMode); deleteButton.setAttribute("aria-pressed", String(deleteLinkMode));
    deleteButton.querySelector(".button-label").textContent = deleteLinkMode ? "Sair" : "Desconectar"; corkboard.classList.toggle("deleting", deleteLinkMode); render();
    showNotice(deleteLinkMode ? "Clique em uma linha para removê-la." : "Modo de exclusão desativado.");
  });
  closeButton.addEventListener("click", async () => { closeButton.disabled = true; try { await OBR.modal.close(MODAL_ID); } catch (error) { console.error(error); showNotice("Não foi possível fechar o quadro.", "error"); closeButton.disabled = false; } });
  cardsLayer.addEventListener("click", onCardClick);
  viewport.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  viewport.addEventListener("wheel", (event) => { event.preventDefault(); const factor = Math.exp(-event.deltaY * 0.0015); zoomAt(event.clientX, event.clientY, factor); }, { passive: false });
  svg.addEventListener("click", onSvgClick);
  noteForm.addEventListener("submit", saveNoteFromDialog);
  $("#cancel-note").addEventListener("click", closeNoteDialog);
  noteDialog.addEventListener("click", (event) => { if (event.target === noteDialog) closeNoteDialog(); });
  $("#zoom-in").addEventListener("click", () => { const r = viewport.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2); });
  $("#zoom-out").addEventListener("click", () => { const r = viewport.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2); });
  $("#zoom-reset").addEventListener("click", () => { camera = { x: 24, y: 24, scale: 1 }; applyCamera(); });
  $("#undo-action").addEventListener("click", undo); $("#redo-action").addEventListener("click", redo);
  $("#export-action").addEventListener("click", exportBoard);
  $("#import-action").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => { if (fileInput.files?.[0]) importBoard(fileInput.files[0]); fileInput.value = ""; });
  searchInput.addEventListener("input", applyFilters);
  deleteButton.hidden = false;
  updateHistoryButtons(); applyCamera();

}
init().catch((error) => { console.error(error); showNotice("Falha ao iniciar. Abra a extensão dentro de uma sala do Owlbear.", "error"); rolePill.textContent = "Sem conexão"; });
