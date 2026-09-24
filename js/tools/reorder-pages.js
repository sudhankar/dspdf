/**
 * Reorder PDF Pages — visual thumbnails + accessible move controls.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};
  var PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  var state = { file:null, buffer:null, pdfDoc:null, order:[], selected:null };
  var progressUI = null;

  function el(id){ return document.getElementById(id); }
  function loadScript(src){
    return new Promise(function(resolve,reject){
      if(document.querySelector('script[src="'+src+'"]')) return resolve();
      var s=document.createElement("script"); s.src=src; s.onload=resolve; s.onerror=function(){reject(new Error("Could not load PDF preview library."));}; document.head.appendChild(s);
    });
  }
  function reset(){
    state.file=null; state.buffer=null; state.pdfDoc=null; state.order=[]; state.selected=null;
    el("reorder-toolbar").hidden=true; el("reorder-grid").innerHTML=""; el("reorder-alert").hidden=true;
    if(progressUI) progressUI.reset();
  }
  async function loadPdf(file){
    reset();
    if(!(file.type==="application/pdf" || /\.pdf$/i.test(file.name))){ D.showError("reorder-alert","Please choose a PDF."); return; }
    D.showInfo("reorder-alert","Loading PDF…");
    try{
      await loadScript(PDFJS_URL);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER;
      var buf=await D.fileToArrayBuffer(file);
      state.file=file; state.buffer=buf.slice(0);
      state.pdfDoc=await window.pdfjsLib.getDocument({data:buf}).promise;
      state.order=Array.from({length:state.pdfDoc.numPages},function(_,i){return i;});
      await render();
      el("reorder-toolbar").hidden=false;
      D.clearAlert("reorder-alert");
      updateControls();
    }catch(err){ log(err); D.showError("reorder-alert",D.humanError(err,"Could not open this PDF.")); }
  }
  async function render(){
    var grid=el("reorder-grid"); grid.innerHTML="";
    state.order.forEach(function(pageIndex,position){
      var wrap=document.createElement("button");
      wrap.type="button"; wrap.className="thumb reorder-thumb"; wrap.setAttribute("data-position",String(position));
      wrap.setAttribute("draggable","true"); wrap.setAttribute("aria-label","Page "+(pageIndex+1)+", position "+(position+1));
      wrap.innerHTML='<span class="reorder-drag-hint" aria-hidden="true">⋮⋮</span><span class="thumb__label">Page '+(pageIndex+1)+'</span><span class="reorder-position">'+(position+1)+'</span><div class="skeleton" style="width:100%;height:100%;position:absolute;inset:0;"></div>';
      grid.appendChild(wrap);
    });
    for(var position=0;position<state.order.length;position++){
      try{
        var page=await state.pdfDoc.getPage(state.order[position]+1);
        var vp=page.getViewport({scale:0.72});
        var canvas=document.createElement("canvas"); canvas.width=vp.width; canvas.height=vp.height;
        await page.render({canvasContext:canvas.getContext("2d"),viewport:vp}).promise;
        var w=grid.querySelector('[data-position="'+position+'"]');
        if(w){ var sk=w.querySelector(".skeleton"); if(sk) sk.remove(); w.insertBefore(canvas,w.firstChild); }
      }catch(err){log("preview",position,err);}
    }
    updateControls();
  }
  function updateControls(){
    var has=state.selected!==null;
    el("reorder-up").disabled=!has || state.selected<=0;
    el("reorder-down").disabled=!has || state.selected>=state.order.length-1;
    el("reorder-reset").disabled=!state.order.length || state.order.every(function(v,i){return v===i;});
    el("reorder-apply").disabled=state.order.length<2;
    el("reorder-count").textContent=state.order.length?"Select a page, then move it up/down or drag it to a new position.":"";
  }
  function select(position){ state.selected=position; el("reorder-grid").querySelectorAll(".reorder-thumb").forEach(function(n){n.classList.toggle("is-selected",Number(n.dataset.position)===position);}); updateControls(); }
  async function move(from,to){
    if(from===null || to<0 || to>=state.order.length || from===to) return;
    var item=state.order.splice(from,1)[0]; state.order.splice(to,0,item); state.selected=to; await render(); select(to);
  }
  function resetOrder(){ state.order=state.order.slice().sort(function(a,b){return a-b;}); state.selected=null; render(); }
  async function apply(){
    if(!state.buffer || state.order.length<2) return;
    progressUI.show(); progressUI.set(25,"Preparing reordered PDF…");
    try{
      var result=await D.runPdfOperation("reorderPages",{buffer:state.buffer.slice(0),order:state.order.slice()});
      progressUI.set(85,"Preparing download…");
      var blob=new Blob([result.bytes],{type:"application/pdf"});
      var base=(state.file.name||"document.pdf").replace(/\.pdf$/i,"");
      D.downloadBlob(blob,"dspdf-"+base+"-reordered.pdf");
      progressUI.set(100,"Done — reordered PDF downloaded.");
      if(window.dspdfToast) window.dspdfToast("Reordered PDF saved","success");
    }catch(err){progressUI.error("Reordering failed.");D.showError("reorder-alert",D.humanError(err,"Could not reorder this PDF."));}
  }
  function init(){
    progressUI=new D.ProgressUI(el("reorder-progress"));
    new D.UploadZone("#uz-reorder",{accept:"application/pdf,.pdf",onFiles:function(files){if(files[0])loadPdf(files[0]);}});
    el("reorder-grid").addEventListener("click",function(e){var t=e.target.closest("[data-position]");if(t)select(Number(t.dataset.position));});
    el("reorder-up").addEventListener("click",function(){move(state.selected,state.selected-1);});
    el("reorder-down").addEventListener("click",function(){move(state.selected,state.selected+1);});
    el("reorder-reset").addEventListener("click",resetOrder);
    el("reorder-apply").addEventListener("click",apply);
    var dragFrom=null;
    el("reorder-grid").addEventListener("dragstart",function(e){var t=e.target.closest("[data-position]");if(!t)return;dragFrom=Number(t.dataset.position);t.classList.add("is-dragging");});
    el("reorder-grid").addEventListener("dragend",function(e){var t=e.target.closest("[data-position]");if(t)t.classList.remove("is-dragging");dragFrom=null;});
    el("reorder-grid").addEventListener("dragover",function(e){e.preventDefault();var t=e.target.closest("[data-position]");if(t)t.classList.add("is-drop-target");});
    el("reorder-grid").addEventListener("dragleave",function(e){var t=e.target.closest("[data-position]");if(t)t.classList.remove("is-drop-target");});
    el("reorder-grid").addEventListener("drop",function(e){e.preventDefault();var t=e.target.closest("[data-position]");if(!t||dragFrom===null)return;var to=Number(t.dataset.position);move(dragFrom,to);});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
