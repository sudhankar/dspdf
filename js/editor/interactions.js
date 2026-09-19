/**
 * DSPDF Editor — Interactions
 * ---------------------------
 * Handles mouse/touch/keyboard on the canvas overlay:
 *  - Selecting elements
 *  - Dragging (move) elements
 *  - Resizing via corner handles
 *  - Creating new elements with the active tool (click or drag)
 *  - Deleting, duplicating, nudging
 *  - Inline text editing
 */
(function () {
  "use strict";
  var Ed = window.DSPDFEditor;
  var state = Ed.state;
  var T = window.DSPDFEditorTools;
  var R = window.DSPDFEditorRender;
  var log = window.dspdfLog || function () {};

  var overlayLayer, hitLayer, wrap;
  var drag = null; // { mode, id, startX, startY, elem0, pointerId, handle }
  var textClickTimer = null;
  var suppressTextClick = false;
  var editingTextId = null;

  function init() {
    overlayLayer = document.getElementById("ed-overlay");
    hitLayer = document.getElementById("ed-hitlayer");
    wrap = document.getElementById("ed-canvas-wrap");

    if (!overlayLayer) return;

    overlayLayer.addEventListener("pointerdown", onOverlayPointerDown);
    overlayLayer.addEventListener("dblclick", onOverlayDoubleClick);
    overlayLayer.addEventListener("click", onOverlayClick);
    hitLayer.addEventListener("pointerdown", onHitLayerPointerDown);

    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    // Rebuild overlays on state change
    Ed.on("change", function () { if (!editingTextId) R.renderOverlays(); });
    Ed.on("select", function () { if (!editingTextId) R.renderOverlays(); });
  }

  /* ---------- Coordinate helpers ---------- */
  function normFromEvent(e) {
    var rect = wrap.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height
    };
  }

  /* ---------- Overlay pointer down (element interaction) ---------- */
  function onOverlayPointerDown(e) {
    var target = e.target.closest(".ed-elem");
    if (!target) return;

    var id = target.dataset.id;
    // Text boxes use the same interaction as other elements: single click selects
    // and drag moves; double-click edits the text. This prevents the text layer
    // from stealing pointer events and makes the box movable after editing.
    var elem = Ed.getSelected(); // fallback
    // Find the element in the current page's list
    var list = state.overlays[state.pageIndex] || [];
    var el = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { el = list[i]; break; }
    if (!el) return;

    // If clicked the delete button
    if (e.target.classList.contains("ed-delete")) {
      e.stopPropagation();
      Ed.removeElement(id);
      return;
    }

    // Select without rebuilding the DOM when it is already selected.
    // Rebuilding here used to destroy the node between the first and second
    // click, which prevented double-click editing and made dragging unreliable.
    if (state.selectedId !== id) Ed.select(id);

    var handle = e.target.dataset && e.target.dataset.h;
    drag = {
      mode: handle ? "resize" : "move",
      handle: handle || null,
      id: id,
      startPoint: normFromEvent(e),
      elem0: JSON.parse(JSON.stringify(el)),
      pointerId: e.pointerId,
      moved: false
    };
    try { overlayLayer.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  }

  /* ---------- Hit layer pointer down (creating new elements) ---------- */
  function onHitLayerPointerDown(e) {
    if (!state.activeTool) return;
    var tool = state.activeTool;
    var start = normFromEvent(e);

    if (tool === "text") {
      // Instant placement, then begin editing
      placeText(start);
      return;
    }
    if (tool === "image" || tool === "signature") {
      // These are triggered by panel buttons, not canvas drag.
      return;
    }

    // Drag-create tools
    drag = {
      mode: "create",
      tool: tool,
      startPoint: start,
      currentPoint: start,
      pointerId: e.pointerId
    };
    try { hitLayer.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  }

  function onWindowPointerMove(e) {
    if (!drag) return;
    var p = normFromEvent(e);

    if (drag.mode === "move") {
      var dx = p.x - drag.startPoint.x;
      var dy = p.y - drag.startPoint.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 0.002) return;
      drag.moved = true;
      Ed.updateElement(drag.id, {
        x: clamp01(drag.elem0.x + dx),
        y: clamp01(drag.elem0.y + dy)
      }, { commit: false });
    } else if (drag.mode === "resize") {
      var dx2 = p.x - drag.startPoint.x;
      var dy2 = p.y - drag.startPoint.y;
      resizeElement(drag.id, drag.elem0, drag.handle, dx2, dy2);
    } else if (drag.mode === "create") {
      drag.currentPoint = p;
      drawCreatePreview(drag.tool, drag.startPoint, p);
    }
  }

  function onWindowPointerUp(e) {
    if (!drag) return;
    var wasText = false;
    if (drag.mode === "move" || drag.mode === "resize") {
      var selectedEl = Ed.getSelected();
      wasText = !!(selectedEl && selectedEl.id === drag.id && selectedEl.type === "text");
      if (drag.moved) {
        Ed.pushHistory();
        suppressTextClick = true;
        setTimeout(function(){ suppressTextClick = false; }, 80);
      } else if (wasText && !suppressTextClick) {
        // A plain click on an existing text box enters edit mode.  A drag still
        // moves it, so clicking elsewhere never locks the box permanently.
        if (textClickTimer) clearTimeout(textClickTimer);
        textClickTimer = setTimeout(function(){
          textClickTimer = null;
          beginInlineEdit(drag.id, false);
        }, 80);
      }
    } else if (drag.mode === "create") {
      commitCreate(drag.tool, drag.startPoint, drag.currentPoint);
    }
    drag = null;
    clearCreatePreview();
  }

  /* ---------- Create previews ---------- */
  var previewNode = null;
  function drawCreatePreview(tool, a, b) {
    clearCreatePreview();
    var rect = wrap.getBoundingClientRect();
    var x1 = a.x * rect.width, y1 = a.y * rect.height;
    var x2 = b.x * rect.width, y2 = b.y * rect.height;
    previewNode = document.createElement("div");
    previewNode.style.cssText = "position:absolute;pointer-events:none;";
    previewNode.style.left = Math.min(x1, x2) + "px";
    previewNode.style.top = Math.min(y1, y2) + "px";
    previewNode.style.width = Math.abs(x2 - x1) + "px";
    previewNode.style.height = Math.abs(y2 - y1) + "px";

    if (tool === "highlight") {
      previewNode.style.background = document.getElementById("mark-color").value;
      previewNode.style.opacity = "0.4";
    } else if (tool === "redact") {
      previewNode.style.background = "#000";
    } else if (tool === "ellipse") {
      previewNode.style.border = "2px dashed #2563EB";
      previewNode.style.borderRadius = "50%";
    } else if (tool === "rect") {
      previewNode.style.border = "2px dashed #2563EB";
    } else if (tool === "line" || tool === "arrow") {
      previewNode.style.borderTop = "2px dashed #2563EB";
      previewNode.style.height = "1px";
      previewNode.style.top = y1 + "px";
      previewNode.style.transform = "rotate(" + (Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI) + "deg)";
      previewNode.style.transformOrigin = "0 0";
    } else if (tool === "draw") {
      previewNode.innerHTML = "";
    }
    overlayLayer.appendChild(previewNode);
  }
  function clearCreatePreview() {
    if (previewNode && previewNode.parentNode) previewNode.parentNode.removeChild(previewNode);
    previewNode = null;
  }

  /* ---------- Place text at click point ---------- */
  function placeText(point) {
    var metrics = currentPageMetrics();
    var font = document.getElementById("text-font").value;
    var size = parseInt(document.getElementById("text-size").value, 10);
    var color = document.getElementById("text-color").value;
    var align = document.getElementById("text-align").value;
    var bold = document.getElementById("text-bold").checked;

    var el = T.makeTextBox(point, {
      text: "Type here",
      font: font, fontSize: size, color: color,
      align: align, bold: bold,
      pageHeightPts: metrics.height
    });
    // Begin editing immediately
    setTimeout(function () { beginInlineEdit(el.id, true); }, 30);
    Ed.setActiveTool(null);
    clearActiveToolButtons();
  }

  /* ---------- Commit drag-created element ---------- */
  function commitCreate(tool, a, b) {
    // Filter tiny drags
    if (Math.abs(a.x - b.x) < 0.008 && Math.abs(a.y - b.y) < 0.008) {
      Ed.setActiveTool(null);
      clearActiveToolButtons();
      return;
    }

    if (tool === "rect" || tool === "ellipse") {
      T.makeRect(a, b, {
        shape: tool,
        stroke: document.getElementById("shape-stroke").value,
        fill: document.getElementById("shape-fill-on").checked
          ? document.getElementById("shape-fill").value : null,
        strokeWidth: parseInt(document.getElementById("shape-width").value, 10)
      });
    } else if (tool === "line" || tool === "arrow") {
      T.makeLine(a, b, {
        type: tool,
        stroke: document.getElementById("shape-stroke").value,
        strokeWidth: parseInt(document.getElementById("shape-width").value, 10)
      });
    } else if (tool === "highlight" || tool === "redact") {
      T.makeHighlight(a, b, {
        type: tool,
        color: document.getElementById("mark-color").value,
        opacity: parseInt(document.getElementById("mark-opacity").value, 10) / 100
      });
    } else if (tool === "draw") {
      // handled in its own stream
    }

    Ed.setActiveTool(null);
    clearActiveToolButtons();
  }

  /* ---------- Resize logic ---------- */
  function resizeElement(id, e0, handle, dx, dy) {
    var x = e0.x, y = e0.y, w = e0.w, h = e0.h;
    if (handle === "se") { w = Math.max(0.02, e0.w + dx); h = Math.max(0.02, e0.h + dy); }
    else if (handle === "sw") { x = e0.x + dx; w = Math.max(0.02, e0.w - dx); h = Math.max(0.02, e0.h + dy); }
    else if (handle === "ne") { y = e0.y + dy; w = Math.max(0.02, e0.w + dx); h = Math.max(0.02, e0.h - dy); }
    else if (handle === "nw") { x = e0.x + dx; y = e0.y + dy; w = Math.max(0.02, e0.w - dx); h = Math.max(0.02, e0.h - dy); }
    // Keep inside page
    x = clamp01(x); y = clamp01(y);
    w = Math.min(w, 1 - x);
    h = Math.min(h, 1 - y);
    Ed.updateElement(id, { x: x, y: y, w: w, h: h }, { commit: false });
  }

  /* ---------- Inline text editing ---------- */
  function onOverlayDoubleClick(e) {
    var target = e.target.closest(".ed-elem");
    if (!target) return;
    var id = target.dataset.id;
    var list = state.overlays[state.pageIndex] || [];
    var el = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { el = list[i]; break; }
    if (el && el.type === "text") {
      if (textClickTimer) { clearTimeout(textClickTimer); textClickTimer = null; }
      beginInlineEdit(id, false);
    }
  }

  function beginInlineEdit(id, selectAll) {
    var node = overlayLayer.querySelector('[data-id="' + id + '"]');
    if (!node) return;
    var content = node.querySelector(".ed-text-content");
    if (!content) return;
    if (textClickTimer) { clearTimeout(textClickTimer); textClickTimer = null; }
    if (editingTextId === id && content.isContentEditable) { content.focus(); return; }

    editingTextId = id;
    content.contentEditable = "true";
    content.classList.add("ed-text-editable");
    content.style.pointerEvents = "auto";
    content.focus();

    // Newly created placeholder text is selected once. Existing text is NOT
    // selected, so typing does not erase the previous text unexpectedly.
    var range = document.createRange();
    var sel = window.getSelection();
    sel.removeAllRanges();
    if (selectAll) {
      range.selectNodeContents(content);
      sel.addRange(range);
    } else {
      range.selectNodeContents(content);
      range.collapse(false);
      sel.addRange(range);
    }

    function finish() {
      var value = content.textContent || "";
      content.contentEditable = "false";
      content.classList.remove("ed-text-editable");
      content.style.pointerEvents = "auto";
      content.removeEventListener("blur", finish);
      content.removeEventListener("keydown", onKey);
      if (editingTextId === id) editingTextId = null;
      var current = Ed.getSelected();
      if (current && current.id === id && current.text !== value) Ed.updateElement(id, { text: value });
      else R.renderOverlays();
    }
    function onKey(ev) {
      if (ev.key === "Escape") { ev.preventDefault(); content.blur(); }
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); content.blur(); }
    }
    content.addEventListener("blur", finish);
    content.addEventListener("keydown", onKey);
  }

  /* ---------- Click (empty area) → deselect ---------- */
  function onOverlayClick(e) {
    var target = e.target.closest(".ed-elem");
    if (!target) Ed.select(null);
  }

  /* ---------- Keyboard ---------- */
  var keyState = {};
  function onKeyDown(e) {
    // ignore when typing
    var tag = (e.target.tagName || "").toLowerCase();
    var editing = e.target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
    if (editing) return;

    var mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); Ed.undo(); return; }
    if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); Ed.redo(); return; }
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); window.dispatchEvent(new Event("dspdf:save")); return; }
    if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicateSelected();
      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      if (state.selectedId) { e.preventDefault(); Ed.removeElement(state.selectedId); }
      return;
    }
    if (e.key === "Escape") {
      Ed.select(null);
      Ed.setActiveTool(null);
      clearActiveToolButtons();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (!state.selectedId) return;
      e.preventDefault();
      var step = e.shiftKey ? 0.02 : 0.005;
      var el = Ed.getSelected();
      if (!el) return;
      var patch = {};
      if (e.key === "ArrowLeft") patch.x = clamp01(el.x - step);
      if (e.key === "ArrowRight") patch.x = clamp01(el.x + step);
      if (e.key === "ArrowUp") patch.y = clamp01(el.y - step);
      if (e.key === "ArrowDown") patch.y = clamp01(el.y + step);
      Ed.updateElement(el.id, patch, { commit: false });
      keyState.nudgeCommit = true;
    }
  }

  function onKeyUp(e) {
    if (keyState.nudgeCommit && e.key.indexOf("Arrow") === 0) {
      keyState.nudgeCommit = false;
      Ed.pushHistory();
    }
  }

  function duplicateSelected() {
    var el = Ed.getSelected();
    if (!el) return;
    var copy = JSON.parse(JSON.stringify(el));
    delete copy.id;
    copy.x = clamp01(copy.x + 0.02);
    copy.y = clamp01(copy.y + 0.02);
    Ed.addElement(copy);
  }

  /* ---------- Helpers ---------- */
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function clearActiveToolButtons() {
    document.querySelectorAll(".ed-tool-btn.is-active").forEach(function (b) { b.classList.remove("is-active"); });
  }
  function currentPageMetrics() {
    var rect = wrap.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  window.DSPDFEditorInteractions = {
    init: init,
    beginInlineEdit: beginInlineEdit,
    setDrawingMode: function (on) {
      hitLayer.classList.toggle("is-drawing", !!on);
    }
  };
})();