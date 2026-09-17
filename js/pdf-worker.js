/**
 * DSPDF — PDF Web Worker
 * -------------------------------------------------
 * Runs pdf-lib heavy operations off the main thread so the UI stays
 * responsive on large files.
 *
 * Communication: postMessage({ id, op, payload }) → { id, ok, result|error }
 *
 * Loaded lazily by tool pages only when needed. Loaded via importScripts
 * from a CDN (pdf-lib UMD build works inside workers when loaded as script).
 */
/* global importScripts, PDFLib */

var PDFLIB_URL = "https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js";

var libReady = null;
function ensureLib() {
  if (libReady) return libReady;
  libReady = new Promise(function (resolve, reject) {
    try {
      importScripts(PDFLIB_URL);
      resolve();
    } catch (e) {
      reject(new Error("Could not load pdf-lib in worker: " + e.message));
    }
  });
  return libReady;
}

self.onmessage = function (e) {
  var msg = e.data || {};
  var id = msg.id;
  var op = msg.op;
  var payload = msg.payload || {};

  ensureLib().then(function () {
    return run(op, payload);
  }).then(function (result) {
    // Transfer ArrayBuffer if present for speed.
    var transfer = [];
    if (result && result.bytes && result.bytes.buffer) transfer.push(result.bytes.buffer);
    self.postMessage({ id: id, ok: true, result: result }, transfer);
  }).catch(function (err) {
    self.postMessage({ id: id, ok: false, error: err && err.message ? err.message : String(err) });
  });
};

/* ---------- Operations ---------- */

function run(op, payload) {
  switch (op) {
    case "merge":           return opMerge(payload);
    case "rotate":          return opRotate(payload);
    case "deletePages":     return opDeletePages(payload);
    case "extractPages":    return opExtractPages(payload);
    case "splitEvery":      return opSplitEvery(payload);
    case "splitRange":      return opSplitRange(payload);
    case "reorderPages":    return opReorderPages(payload);
    case "compressImages":  return opCompressImages(payload); // documented below
    default:                throw new Error("Unknown worker op: " + op);
  }
}

/* Merge: payload = { buffers: [ArrayBuffer, ...] } */
async function opMerge(payload) {
  var PDFDocument = PDFLib.PDFDocument;
  var out = await PDFDocument.create();
  for (var i = 0; i < payload.buffers.length; i++) {
    var src = await PDFDocument.load(payload.buffers[i], { ignoreEncryption: false });
    var pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(function (p) { out.addPage(p); });
  }
  out.setProducer("DSPDF");
  out.setCreator("DSPDF — client-side");
  var bytes = await out.save({ useObjectStreams: true });
  return { bytes: bytes };
}

/* Rotate: payload = { buffer, rotations: {pageIndex: 90|180|270} } */
async function opRotate(payload) {
  var PDFDocument = PDFLib.PDFDocument;
  var doc = await PDFDocument.load(payload.buffer);
  var pages = doc.getPages();
  Object.keys(payload.rotations).forEach(function (idxStr) {
    var idx = parseInt(idxStr, 10);
    var delta = payload.rotations[idxStr];
    if (!pages[idx]) return;
    var current = pages[idx].getRotation().angle || 0;
    pages[idx].setRotation(PDFLib.degrees((current + delta) % 360));
  });
  doc.setProducer("DSPDF");
  var bytes = await doc.save({ useObjectStreams: true });
  return { bytes: bytes };
}

/* Delete pages: payload = { buffer, deleteIndices: [0,2,5] } */
async function opDeletePages(payload) {
  var PDFDocument = PDFLib.PDFDocument;
  var doc = await PDFDocument.load(payload.buffer);
  // Sort descending so removal doesn't shift indices
  var sorted = payload.deleteIndices.slice().sort(function (a, b) { return b - a; });
  sorted.forEach(function (i) { doc.removePage(i); });
  if (doc.getPageCount() === 0) throw new Error("You can't delete every page.");
  doc.setProducer("DSPDF");
  var bytes = await doc.save({ useObjectStreams: true });
  return { bytes: bytes, pageCount: doc.getPageCount() };
}

/* Extract pages: payload = { buffer, keepIndices: [0,3,4] } */
async function opExtractPages(payload) {
  var PDFDocument = PDFLib.PDFDocument;
  var src = await PDFDocument.load(payload.buffer);
  var out = await PDFDocument.create();
  var kept = payload.keepIndices.slice().sort(function (a, b) { return a - b; });
  var copied = await out.copyPages(src, kept);
  copied.forEach(function (p) { out.addPage(p); });
  out.setProducer("DSPDF");
  var bytes = await out.save({ useObjectStreams: true });
  return { bytes: bytes, pageCount: kept.length };
}

/* Split every N pages: payload = { buffer, chunkSize }
   Returns array of { bytes, name } — one blob per chunk. */
async function opSplitEvery(payload) {
  var PDFDocument = PDFLib.PDFDocument;
  var src = await PDFDocument.load(payload.buffer);
  var total = src.getPageCount();
  var size = Math.max(1, payload.chunkSize | 0);
  var chunks = [];
  for (var start = 0; start < total; start += size) {
    var end = Math.min(start + size, total);
    var indices = [];
    for (var i = start; i < end; i++) indices.push(i);
    var out = await PDFDocument.create();
    var copied = await out.copyPages(src, indices);
    copied.forEach(function (p) { out.addPage(p); });
    out.setProducer("DSPDF");
    var bytes = await out.save({ useObjectStreams: true });
    chunks.push({
      bytes: bytes,
      name: "pages_" + (start + 1) + "-" + end + ".pdf"
    });
  }
  return { chunks: chunks };
}

/* Split by explicit ranges: payload = { buffer, ranges: [[0,2],[5,7]] } */
async function opSplitRange(payload) {
  var PDFDocument = PDFLib.PDFDocument;
  var src = await PDFDocument.load(payload.buffer);
  var total = src.getPageCount();
  var chunks = [];
  for (var r = 0; r < payload.ranges.length; r++) {
    var range = payload.ranges[r];
    var a = Math.max(0, Math.min(total - 1, range[0]));
    var b = Math.max(a, Math.min(total - 1, range[1]));
    var indices = [];
    for (var i = a; i <= b; i++) indices.push(i);
    var out = await PDFDocument.create();
    var copied = await out.copyPages(src, indices);
    copied.forEach(function (p) { out.addPage(p); });
    out.setProducer("DSPDF");
    var bytes = await out.save({ useObjectStreams: true });
    chunks.push({
      bytes: bytes,
      name: "pages_" + (a + 1) + "-" + (b + 1) + ".pdf"
    });
  }
  return { chunks: chunks };
}

/* Reorder: payload = { buffer, order: [2,0,1,3] } — array of source indices in new order */
async function opReorderPages(payload) {
  var PDFDocument = PDFLib.PDFDocument;
  var src = await PDFDocument.load(payload.buffer);
  var out = await PDFDocument.create();
  var copied = await out.copyPages(src, payload.order);
  copied.forEach(function (p) { out.addPage(p); });
  out.setProducer("DSPDF");
  var bytes = await out.save({ useObjectStreams: true });
  return { bytes: bytes };
}

/* Real compression requires re-encoding images, which pdf-lib cannot do.
   We document this honestly: our compress tool uses pdf.js to rasterize
   pages at a chosen JPEG quality, then rebuilds the PDF from images.
   That approach is done on the main thread in compress.js — not here. */
async function opCompressImages() {
  throw new Error("Image recompression happens in compress.js on the main thread.");
}