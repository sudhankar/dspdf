/**
 * DSPDF Editor — State
 * --------------------
 * Holds the document model, page overlays, and undo/redo history.
 *
 * Coordinates are stored as NORMALIZED values (0..1) relative to the page
 * dimensions. This decouples the model from canvas DPI so exports scale
 * correctly regardless of zoom or rendering resolution.
 */
(function () {
  "use strict";

  var HISTORY_MAX = 60;

  var state = {
    file: null,           // File object
    originalBytes: null,  // Uint8Array of original PDF
    pdfDoc: null,         // pdf.js document (for rendering)
    pageCount: 0,
    pageIndex: 0,         // current page (0-based)

    // overlays[pageIndex] = array of elements
    overlays: [],

    selectedId: null,
    activeTool: null,

    view: { zoom: 1, fitMode: "width" },

    // History stacks store full snapshots (fast enough for our sizes)
    history: [],
    historyIndex: -1
  };

  var listeners = { change: [], select: [], page: [] };
  var idCounter = 1;

  function emit(name, payload) {
    (listeners[name] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { /* swallow */ }
    });
  }

  function snapshot() {
    return JSON.stringify({
      overlays: state.overlays,
      selectedId: state.selectedId,
      pageIndex: state.pageIndex,
      activeTool: state.activeTool
    });
  }

  function pushHistory() {
    var snap = snapshot();
    if (state.historyIndex >= 0 && state.history[state.historyIndex] === snap) return;
    // truncate forward history
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snap);
    if (state.history.length > HISTORY_MAX) state.history.shift();
    state.historyIndex = state.history.length - 1;
  }

  function restoreHistory() {
    var snap = state.history[state.historyIndex];
    if (!snap) return;
    var data = JSON.parse(snap);
    state.overlays = data.overlays;
    state.selectedId = data.selectedId;
    state.pageIndex = data.pageIndex;
    state.activeTool = data.activeTool;
    emit("change");
    emit("select", state.selectedId);
    emit("page", state.pageIndex);
  }

  function newId(prefix) {
    return (prefix || "el") + "_" + (idCounter++) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function ensurePage(i) {
    while (state.overlays.length <= i) state.overlays.push([]);
    return state.overlays[i];
  }

  function getSelected() {
    if (!state.selectedId) return null;
    var list = state.overlays[state.pageIndex] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === state.selectedId) return list[i];
    }
    // search other pages
    for (var p = 0; p < state.overlays.length; p++) {
      for (var j = 0; j < state.overlays[p].length; j++) {
        if (state.overlays[p][j].id === state.selectedId) return state.overlays[p][j];
      }
    }
    return null;
  }

  function addElement(el, opts) {
    opts = opts || {};
    var list = ensurePage(state.pageIndex);
    el.id = el.id || newId(el.type);
    el.pageIndex = state.pageIndex;
    list.push(el);
    if (opts.select !== false) state.selectedId = el.id;
    if (opts.commit !== false) pushHistory();
    emit("change");
    emit("select", state.selectedId);
    return el;
  }

  function updateElement(id, patch, opts) {
    opts = opts || {};
    for (var p = 0; p < state.overlays.length; p++) {
      var list = state.overlays[p];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          Object.assign(list[i], patch);
          if (opts.commit !== false) pushHistory();
          emit("change");
          return list[i];
        }
      }
    }
    return null;
  }

  function removeElement(id, opts) {
    opts = opts || {};
    for (var p = 0; p < state.overlays.length; p++) {
      var list = state.overlays[p];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          list.splice(i, 1);
          if (state.selectedId === id) state.selectedId = null;
          if (opts.commit !== false) pushHistory();
          emit("change");
          emit("select", null);
          return true;
        }
      }
    }
    return false;
  }

  function undo() {
    if (state.historyIndex <= 0) return false;
    state.historyIndex--;
    restoreHistory();
    return true;
  }
  function redo() {
    if (state.historyIndex >= state.history.length - 1) return false;
    state.historyIndex++;
    restoreHistory();
    return true;
  }

  function select(id) {
    if (state.selectedId === id) return;
    state.selectedId = id;
    emit("select", id);
    emit("change");
  }

  function setPage(idx) {
    if (idx < 0 || idx >= state.pageCount) return;
    state.pageIndex = idx;
    state.selectedId = null;
    emit("page", idx);
    emit("select", null);
    emit("change");
  }

  function setActiveTool(tool) {
    state.activeTool = tool;
    emit("change");
  }

  function reset(newDoc) {
    state.file = newDoc.file;
    state.originalBytes = newDoc.originalBytes;
    state.pdfDoc = newDoc.pdfDoc;
    state.pageCount = newDoc.pageCount;
    state.pageIndex = 0;
    state.overlays = [];
    state.selectedId = null;
    state.activeTool = null;
    state.history = [];
    state.historyIndex = -1;
    for (var i = 0; i < newDoc.pageCount; i++) state.overlays.push([]);
    pushHistory();
    emit("change");
    emit("page", 0);
    emit("select", null);
  }

  window.DSPDFEditor = window.DSPDFEditor || {};
  window.DSPDFEditor.state = state;
  window.DSPDFEditor.on = function (name, fn) {
    (listeners[name] = listeners[name] || []).push(fn);
  };
  window.DSPDFEditor.emit = emit;
  window.DSPDFEditor.addElement = addElement;
  window.DSPDFEditor.updateElement = updateElement;
  window.DSPDFEditor.removeElement = removeElement;
  window.DSPDFEditor.ensurePage = ensurePage;
  window.DSPDFEditor.getSelected = getSelected;
  window.DSPDFEditor.select = select;
  window.DSPDFEditor.setPage = setPage;
  window.DSPDFEditor.setActiveTool = setActiveTool;
  window.DSPDFEditor.undo = undo;
  window.DSPDFEditor.redo = redo;
  window.DSPDFEditor.reset = reset;
  window.DSPDFEditor.pushHistory = pushHistory;
  window.DSPDFEditor.newId = newId;
})();