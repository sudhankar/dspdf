/** PDF → Text — browser-side text extraction with PDF.js. */
(function(){
  "use strict";
  var D=window.DSPDF, log=window.dspdfLog||function(){};
  var PDFJS_URL="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDFJS_WORKER="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  var state={file:null,pdfDoc:null};
  var progressUI=null;
  function el(id){return document.getElementById(id);}
  function loadScript(src){return new Promise(function(resolve,reject){if(window.pdfjsLib)return resolve();var s=document.createElement("script");s.src=src;s.onload=resolve;s.onerror=function(){reject(new Error("Could not load PDF reader."));};document.head.appendChild(s);});}
  async function loadPdf(file){
    D.clearAlert("p2t-alert"); el("p2t-toolbar").hidden=true;
    if(!(file.type==="application/pdf"||/\.pdf$/i.test(file.name))){D.showError("p2t-alert","Please choose a PDF.");return;}
    try{D.showInfo("p2t-alert","Reading PDF…");await loadScript(PDFJS_URL);window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER;var buf=await D.fileToArrayBuffer(file);state.file=file;state.pdfDoc=await window.pdfjsLib.getDocument({data:buf}).promise;el("p2t-info").textContent=file.name+" — "+state.pdfDoc.numPages+" page(s)";el("p2t-toolbar").hidden=false;D.clearAlert("p2t-alert");}
    catch(err){log(err);D.showError("p2t-alert",D.humanError(err,"Could not open this PDF."));}
  }
  async function extract(){
    if(!state.pdfDoc)return; progressUI.show(); progressUI.set(2,"Starting…");
    try{var chunks=[];for(var p=1;p<=state.pdfDoc.numPages;p++){var page=await state.pdfDoc.getPage(p);var tc=await page.getTextContent();var lastY=null,line="";for(var i=0;i<tc.items.length;i++){var item=tc.items[i];var y=item.transform&&item.transform.length?item.transform[5]:null;if(lastY!==null&&y!==null&&Math.abs(y-lastY)>4){if(line.trim())chunks.push(line.trim());line="";}line+=item.str||"";lastY=y;}if(line.trim())chunks.push(line.trim());chunks.push("");progressUI.set(5+(p/state.pdfDoc.numPages)*90,"Extracted page "+p+" / "+state.pdfDoc.numPages);}
      var text=chunks.join("\n").replace(/\n{3,}/g,"\n\n").trim()+"\n";var blob=new Blob([text],{type:"text/plain;charset=utf-8"});var base=(state.file.name||"document").replace(/\.pdf$/i,"");D.downloadBlob(blob,base+"-text.txt");progressUI.set(100,"Done — text extracted.");if(window.dspdfToast)window.dspdfToast("Text file saved","success");
    }catch(err){log(err);progressUI.error("Extraction failed.");D.showError("p2t-alert",D.humanError(err,"Could not extract text from this PDF."));}
  }
  function init(){progressUI=new D.ProgressUI(el("p2t-progress"));new D.UploadZone("#uz-p2t",{accept:"application/pdf,.pdf",multiple:false,onFiles:function(files){if(files[0])loadPdf(files[0]);}});el("p2t-apply").addEventListener("click",extract);}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
