/**
 * DSPDF — Shared Tools Engine
 * -------------------------------------------------
 * Handles: file input, drag-drop, size formatting, progress UI,
 * download (via FileSaver), memory cleanup, error display.
 * Every tool page loads this BEFORE its own tool script.
 */
(function () {
  "use strict";

  var CFG = window.DSPDF_CONFIG || {};
  var log = window.dspdfLog || function () {};

  /* ---------- File size formatting ---------- */
  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }

  /* ---------- Human error messages ---------- */
  function humanError(err, fallback) {
    if (!err) return fallback || "Something went wrong.";
    var m = String(err.message || err);
    if (/password|encrypt/i.test(m)) return "This PDF is password-protected. Unlock it first, then try again.";
    if (/invalid|corrupt|not a pdf/i.test(m)) return "That file doesn't look like a valid PDF. Try another file.";
    if (/memory|allocation/i.test(m)) return "Your device ran out of memory for this file. Try a smaller file or a device with more RAM.";
    return fallback || m;
  }

  /* ---------- Download a Blob ---------- */
  function downloadBlob(blob, filename) {
    if (window.saveAs) {
      window.saveAs(blob, filename);
      return;
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Give the browser a moment before revoking.
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /* ---------- Global loading indicator ---------- */
  var globalLoader=null;
  var globalLoaderShownAt=0;
  var globalLoaderHideTimer=null;
  function ensureGlobalLoader(){
    if(globalLoader)return globalLoader;
    globalLoader=document.createElement("div");
    globalLoader.id="dspdf-global-loading";
    globalLoader.setAttribute("role","status");
    globalLoader.setAttribute("aria-live","polite");
    globalLoader.innerHTML='<span class="dspdf-loading-spinner" aria-hidden="true"></span><span class="dspdf-global-loading__text"></span>';
    document.body.appendChild(globalLoader);
    return globalLoader;
  }
  function showGlobalLoading(message){
    var box=ensureGlobalLoader();
    if(globalLoaderHideTimer){clearTimeout(globalLoaderHideTimer);globalLoaderHideTimer=null;}
    box.querySelector(".dspdf-global-loading__text").textContent=message||"Loading…";
    if(!box.classList.contains("is-visible")) globalLoaderShownAt=(performance&&performance.now)?performance.now():Date.now();
    box.classList.add("is-visible");
  }
  function hideGlobalLoading(){
    if(!globalLoader)return;
    var now=(performance&&performance.now)?performance.now():Date.now();
    var elapsed=now-globalLoaderShownAt, wait=Math.max(0,360-elapsed);
    if(globalLoaderHideTimer)clearTimeout(globalLoaderHideTimer);
    globalLoaderHideTimer=setTimeout(function(){globalLoader.classList.remove("is-visible");globalLoaderHideTimer=null;},wait);
  }

  /* ---------- Progress bar controller ---------- */
  function ProgressUI(el) {
    this.el = el;
    this.bar = el ? el.querySelector(".progress__bar") : null;
    this.label = el ? el.querySelector("[data-progress-label]") : null;
  }
  ProgressUI.prototype.show = function () {
    if (this.el) this.el.hidden = false;
  };
  ProgressUI.prototype.hide = function () {
    if (this.el) this.el.hidden = true;
  };
  ProgressUI.prototype.reset = function () {
    hideGlobalLoading();
    if (this.bar) {
      this.bar.style.width = "0%";
      this.bar.classList.remove("is-success", "is-error");
    }
    if (this.label) this.label.textContent = "";
    if (this.el) { this.el.hidden = true; this.el.setAttribute("aria-valuenow", "0"); }
  };
  ProgressUI.prototype.set = function (pct, label) {
    var p = Math.max(0, Math.min(100, Math.round(pct)));
    if (this.bar) {
      this.bar.style.width = p + "%";
      this.bar.classList.remove("is-success", "is-error");
      if (p === 100) this.bar.classList.add("is-success");
    }
    if (this.label && label != null) {
      var msg = String(label);
      if (/loading|reading|preparing|processing|opening|rendering/i.test(msg)) {
        showGlobalLoading(msg);
        this.label.innerHTML = '<span class="dspdf-loading-spinner" aria-hidden="true"></span><span class="dspdf-loading-text"></span>';
        this.label.querySelector(".dspdf-loading-text").textContent = msg;
      } else {
        hideGlobalLoading();
        this.label.textContent = msg;
      }
    }
    if (this.el) this.el.setAttribute("aria-valuenow", String(p));
  };
  ProgressUI.prototype.error = function (label) {
    hideGlobalLoading();
    if (this.bar) {
      this.bar.classList.remove("is-success");
      this.bar.classList.add("is-error");
    }
    if (this.label && label) this.label.textContent = label;
  };

  function getHandoffFile() {
    return new Promise(function(resolve,reject){
      if (!window.indexedDB) return resolve(null);
      var r=indexedDB.open("dspdf-local",1);
      r.onupgradeneeded=function(){ if(!r.result.objectStoreNames.contains("handoff")) r.result.createObjectStore("handoff"); };
      r.onsuccess=function(){
        var db=r.result, tx=db.transaction("handoff","readonly"), req=tx.objectStore("handoff").get("pdf");
        req.onsuccess=function(){ db.close(); var v=req.result; if(!v) return resolve(null); try { resolve(v.bytes instanceof File ? v.bytes : new File([v.bytes],v.name||"document.pdf",{type:v.type||"application/pdf"})); } catch(e){ resolve(v.bytes); } };
        req.onerror=function(){db.close();reject(req.error);};
      };
      r.onerror=function(){reject(r.error);};
    });
  }
  function clearHandoffFile() {
    try { var r=indexedDB.open("dspdf-local",1); r.onsuccess=function(){ var db=r.result,tx=db.transaction("handoff","readwrite"); tx.objectStore("handoff").delete("pdf"); tx.oncomplete=function(){db.close();}; }; } catch(e) {}
  }

  /* ---------- Upload zone controller ----------
   * Usage:
   *   const uz = DSPDF.uploadZone("#zone", {
   *     accept: ".pdf,application/pdf",
   *     multiple: true,
   *     onFiles: files => { ... }
   *   });
   */
  function UploadZone(selector, opts) {
    opts = opts || {};
    var root = typeof selector === "string" ? document.querySelector(selector) : selector;
    if (!root) throw new Error("UploadZone: root not found: " + selector);
    this.root = root;
    this.input = root.querySelector("input[type=file]");
    this.accept = opts.accept || "*";
    this.multiple = !!opts.multiple;
    this.onFiles = opts.onFiles || function () {};

    var self = this;
    if (this.input) {
      this.input.setAttribute("accept", this.accept);
      if (this.multiple) this.input.setAttribute("multiple", "");
      else this.input.removeAttribute("multiple");
      this.input.addEventListener("change", function (e) {
        self._handle(Array.prototype.slice.call(e.target.files || []));
        // Reset so re-selecting the same file fires change again
        e.target.value = "";
      });
    }

    // Click anywhere in zone (except buttons/links) opens the picker
    root.addEventListener("click", function (e) {
      if (e.target.closest("a, button")) return;
      if (self.input) self.input.click();
    });
    root.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (self.input) self.input.click();
      }
    });

    ["dragenter", "dragover"].forEach(function (ev) {
      root.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        root.classList.add("is-dragover");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      root.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        root.classList.remove("is-dragover");
      });
    });
    root.addEventListener("drop", function (e) {
      var dt = e.dataTransfer;
      if (!dt) return;
      self._handle(Array.prototype.slice.call(dt.files || []));
    });

    // Receive a PDF dropped on the homepage without asking the user to upload it again.
    if (/[?&]pdfReady=1(?:&|$)/.test(location.search)) {
      setTimeout(function () {
        getHandoffFile().then(function(file){
          if (file) { self.onFiles([file]); clearHandoffFile(); }
        }).catch(function(){});
      }, 0);
    }
  }
  UploadZone.prototype._handle = function (files) {
    if (!files.length) return;
    if (!this.multiple && files.length > 1) files = [files[0]];
    this.onFiles(files);
  };

  /* ---------- Read a File as ArrayBuffer (Promise) ---------- */
  function fileToArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error("Could not read file.")); };
      r.readAsArrayBuffer(file);
    });
  }
  function fileToDataURL(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error("Could not read file.")); };
      r.readAsDataURL(file);
    });
  }

  /* ---------- Show/hide helpers ---------- */
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }

  /* ---------- Alert helper ---------- */
  function showError(target, message) {
    hideGlobalLoading();
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) { if (window.dspdfToast) window.dspdfToast(message, "error"); return; }
    el.className = "alert alert-error";
    el.textContent = "⚠ " + message;
    el.hidden = false;
  }
  function showInfo(target, message) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return;
    var loading = /loading|reading|preparing|processing|opening|rendering/i.test(String(message || ""));
    el.className = "alert alert-info";
    el.classList.toggle("is-loading", loading);
    if (loading) {
      showGlobalLoading(message);
      el.innerHTML = '<span class="dspdf-loading-spinner" aria-hidden="true"></span><span class="dspdf-loading-text"></span>';
      el.querySelector(".dspdf-loading-text").textContent = message;
    } else {
      el.textContent = message;
    }
    el.hidden = false;
  }
  function clearAlert(target) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (el) { el.hidden = true; el.textContent = ""; el.innerHTML = ""; el.classList.remove("is-loading"); }
    hideGlobalLoading();
  }

  /* ---------- Sortable list (simple drag reorder) ----------
   * Attaches HTML5 draggable reordering to <li data-id> elements.
   * onReorder(orderedIdsArray) called after every drop.
   */
  function makeSortable(listEl, onReorder) {
    if (!listEl) return;
    var dragEl = null;
    listEl.querySelectorAll("[draggable=true]").forEach(function (li) {
      li.addEventListener("dragstart", function () {
        dragEl = li;
        li.style.opacity = "0.4";
      });
      li.addEventListener("dragend", function () {
        li.style.opacity = "";
        dragEl = null;
        if (onReorder) onReorder(getIds(listEl));
      });
    });
    listEl.addEventListener("dragover", function (e) {
      e.preventDefault();
      var after = getDragAfterElement(listEl, e.clientY);
      if (!dragEl) return;
      if (after == null) listEl.appendChild(dragEl);
      else listEl.insertBefore(dragEl, after);
    });
    function getIds(el) {
      return Array.prototype.slice.call(el.querySelectorAll("[data-id]"))
        .map(function (n) { return n.getAttribute("data-id"); });
    }
    function getDragAfterElement(container, y) {
      var els = Array.prototype.slice.call(
        container.querySelectorAll("[draggable=true]:not([style*='opacity: 0.4'])")
      );
      return els.reduce(function (closest, child) {
        var box = child.getBoundingClientRect();
        var offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
        return closest;
      }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
  }

  /* ---------- Shared PDF worker ---------- */
  function createPdfWorker() {
    var base = (window.DSPDF_CONFIG && window.DSPDF_CONFIG.url)
      ? window.DSPDF_CONFIG.url("js/pdf-worker.js")
      : "../pdf-worker.js";
    return new Worker(base);
  }

  /* ---------- Reliable PDF-lib main-thread fallback ----------
   * Some browsers/hosts block cross-origin importScripts() inside Web Workers.
   * The five page-manipulation tools therefore use PDF-lib directly in the
   * page instead of depending on a CDN-loaded worker script.
   */
  var pdfLibPromise = null;
  function loadExternalScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-dspdf-pdflib="1"]');
      if (window.PDFLib) return resolve(window.PDFLib);
      if (existing) {
        existing.addEventListener('load', function(){ resolve(window.PDFLib); });
        existing.addEventListener('error', function(){ reject(new Error('Could not load PDF library.')); });
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.dataset.dspdfPdflib = '1';
      s.onload = function(){ window.PDFLib ? resolve(window.PDFLib) : reject(new Error('PDF library loaded but is unavailable.')); };
      s.onerror = function(){ reject(new Error('Could not load PDF library.')); };
      document.head.appendChild(s);
    });
  }
  function ensurePdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (pdfLibPromise) return pdfLibPromise;
    var cdn = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
    var fallback = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js';
    pdfLibPromise = loadExternalScript(cdn).catch(function(){ return loadExternalScript(fallback); }).then(function(){
      if (!window.PDFLib) throw new Error('PDF library is unavailable.');
      return window.PDFLib;
    });
    return pdfLibPromise;
  }
  async function runPdfOperation(op, payload) {
    var PDFLib = await ensurePdfLib();
    var PDFDocument = PDFLib.PDFDocument;
    if (op === 'merge') {
      var out = await PDFDocument.create();
      for (var mi=0; mi<payload.buffers.length; mi++) {
        var src = await PDFDocument.load(payload.buffers[mi]);
        var mp = await out.copyPages(src, src.getPageIndices());
        mp.forEach(function(p){ out.addPage(p); });
      }
      out.setProducer('DSPDF'); out.setCreator('DSPDF — client-side');
      return {bytes: await out.save({useObjectStreams:true})};
    }
    if (op === 'rotate') {
      var rd = await PDFDocument.load(payload.buffer);
      var pages = rd.getPages();
      Object.keys(payload.rotations || {}).forEach(function(k){
        var i=parseInt(k,10), delta=parseInt(payload.rotations[k],10)||0;
        if (!pages[i]) return;
        var cur=pages[i].getRotation().angle || 0;
        pages[i].setRotation(PDFLib.degrees((cur + delta + 360) % 360));
      });
      rd.setProducer('DSPDF');
      return {bytes: await rd.save({useObjectStreams:true})};
    }
    if (op === 'deletePages') {
      var dd = await PDFDocument.load(payload.buffer);
      var del=(payload.deleteIndices||[]).slice().sort(function(a,b){return b-a;});
      del.forEach(function(i){ if(i>=0 && i<dd.getPageCount()) dd.removePage(i); });
      if (!dd.getPageCount()) throw new Error("You can't delete every page.");
      dd.setProducer('DSPDF');
      return {bytes: await dd.save({useObjectStreams:true}), pageCount:dd.getPageCount()};
    }
    if (op === 'extractPages') {
      var ed = await PDFDocument.load(payload.buffer);
      var eo = await PDFDocument.create();
      var keep=(payload.keepIndices||[]).slice().sort(function(a,b){return a-b;});
      if (!keep.length) throw new Error('Select at least one page.');
      var ep=await eo.copyPages(ed,keep);
      ep.forEach(function(p){eo.addPage(p);});
      eo.setProducer('DSPDF');
      return {bytes:await eo.save({useObjectStreams:true}),pageCount:keep.length};
    }
    if (op === 'splitEvery' || op === 'splitRange') {
      var sd=await PDFDocument.load(payload.buffer), total=sd.getPageCount(), chunks=[];
      var ranges=[];
      if(op==='splitEvery'){
        var size=Math.max(1,payload.chunkSize|0);
        for(var st=0;st<total;st+=size) ranges.push([st,Math.min(st+size-1,total-1)]);
      } else ranges=payload.ranges||[];
      for(var ri=0;ri<ranges.length;ri++){
        var a=Math.max(0,Math.min(total-1,ranges[ri][0])), b=Math.max(a,Math.min(total-1,ranges[ri][1])), idx=[];
        for(var x=a;x<=b;x++) idx.push(x);
        var so=await PDFDocument.create(), cp=await so.copyPages(sd,idx);
        cp.forEach(function(p){so.addPage(p);}); so.setProducer('DSPDF');
        chunks.push({bytes:await so.save({useObjectStreams:true}),name:'pages_'+(a+1)+'-'+(b+1)+'.pdf'});
      }
      return {chunks:chunks};
    }
    throw new Error('Unsupported PDF operation: '+op);
  }

  /* ---------- Public API ---------- */
  window.DSPDF = window.DSPDF || {};
  Object.assign(window.DSPDF, {
    formatBytes: formatBytes,
    humanError: humanError,
    downloadBlob: downloadBlob,
    ProgressUI: ProgressUI,
    UploadZone: UploadZone,
    fileToArrayBuffer: fileToArrayBuffer,
    fileToDataURL: fileToDataURL,
    show: show,
    hide: hide,
    showError: showError,
    showInfo: showInfo,
    clearAlert: clearAlert,
    showGlobalLoading: showGlobalLoading,
    hideGlobalLoading: hideGlobalLoading,
    makeSortable: makeSortable,
    createPdfWorker: createPdfWorker,
    ensurePdfLib: ensurePdfLib,
    runPdfOperation: runPdfOperation
  });

  log("tools-engine.js loaded");
})();