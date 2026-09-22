/**
 * DSPDF Editor — State
 * Document model + overlay model + undo/redo history.
 */
(function () {
  "use strict";
  var HISTORY_MAX = 60;
  var state = {
    file:null, originalBytes:null, pdfDoc:null, pageCount:0, pageIndex:0,
    overlays:[], selectedId:null, activeTool:null,
    view:{zoom:1,fitMode:"width",interactionMode:"select"}, history:[], historyIndex:-1
  };
  var listeners={change:[],select:[],page:[],document:[]};
  var idCounter=1;
  function emit(name,payload){(listeners[name]||[]).forEach(function(fn){try{fn(payload);}catch(e){}});}
  function bytesToB64(bytes){var bin="", i; for(i=0;i<bytes.length;i+=0x8000) bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000)); return btoa(bin);}
  function b64ToBytes(s){var bin=atob(s), a=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return a;}
  function snapshot(){return JSON.stringify({overlays:state.overlays,selectedId:state.selectedId,pageIndex:state.pageIndex,activeTool:state.activeTool,documentBytes:state.originalBytes?bytesToB64(state.originalBytes):null,pageCount:state.pageCount});}
  function pushHistory(){var snap=snapshot(); if(state.historyIndex>=0&&state.history[state.historyIndex]===snap)return; state.history=state.history.slice(0,state.historyIndex+1); state.history.push(snap); if(state.history.length>HISTORY_MAX)state.history.shift(); state.historyIndex=state.history.length-1;}
  async function restoreHistory(){var snap=state.history[state.historyIndex];if(!snap)return;var data=JSON.parse(snap);var oldBytes=state.originalBytes,oldCount=state.pageCount; state.overlays=data.overlays||[];state.selectedId=data.selectedId||null;state.pageIndex=Math.max(0,Math.min((data.pageCount||1)-1,data.pageIndex||0));state.activeTool=data.activeTool||null; if(data.documentBytes&&window.pdfjsLib){var bytes=b64ToBytes(data.documentBytes);state.originalBytes=bytes;state.pageCount=data.pageCount||1;window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";state.pdfDoc=await window.pdfjsLib.getDocument({data:bytes.slice(0)}).promise;} emit("change");emit("select",state.selectedId);emit("page",state.pageIndex); if(oldCount!==state.pageCount || oldBytes!==state.originalBytes) emit("document");}
  function newId(prefix){return(prefix||"el")+"_"+(idCounter++)+"_"+Math.random().toString(36).slice(2,7);}
  function ensurePage(i){while(state.overlays.length<=i)state.overlays.push([]);return state.overlays[i];}
  function getSelected(){if(!state.selectedId)return null;for(var p=0;p<state.overlays.length;p++){var l=state.overlays[p]||[];for(var j=0;j<l.length;j++)if(l[j].id===state.selectedId)return l[j];}return null;}
  function addElement(el,opts){opts=opts||{};var list=ensurePage(state.pageIndex);el.id=el.id||newId(el.type);el.pageIndex=state.pageIndex;list.push(el);if(opts.select!==false)state.selectedId=el.id;if(opts.commit!==false)pushHistory();emit("change");emit("select",state.selectedId);return el;}
  function updateElement(id,patch,opts){opts=opts||{};for(var p=0;p<state.overlays.length;p++){var list=state.overlays[p];for(var i=0;i<list.length;i++)if(list[i].id===id){Object.assign(list[i],patch);if(opts.commit!==false)pushHistory();if(!opts.silent)emit("change");return list[i];}}return null;}
  function removeElement(id,opts){opts=opts||{};for(var p=0;p<state.overlays.length;p++){var list=state.overlays[p];for(var i=0;i<list.length;i++)if(list[i].id===id){list.splice(i,1);if(state.selectedId===id)state.selectedId=null;if(opts.commit!==false)pushHistory();emit("change");emit("select",null);return true;}}return false;}
  async function undo(){if(state.historyIndex<=0)return false;state.historyIndex--;await restoreHistory();return true;}
  async function redo(){if(state.historyIndex>=state.history.length-1)return false;state.historyIndex++;await restoreHistory();return true;}
  function select(id){if(state.selectedId===id)return;state.selectedId=id;emit("select",id);emit("change");}
  function setPage(idx){if(idx<0||idx>=state.pageCount)return;state.pageIndex=idx;state.selectedId=null;emit("page",idx);emit("select",null);emit("change");}
  function setActiveTool(tool){state.activeTool=tool;emit("change");}
  function setInteractionMode(mode){state.view.interactionMode=(mode==="pan"?"pan":"select");emit("change");}
  function reset(newDoc){state.file=newDoc.file;state.originalBytes=newDoc.originalBytes;state.pdfDoc=newDoc.pdfDoc;state.pageCount=newDoc.pageCount;state.pageIndex=0;state.overlays=[];state.selectedId=null;state.activeTool=null;state.history=[];state.historyIndex=-1;for(var i=0;i<newDoc.pageCount;i++)state.overlays.push([]);pushHistory();emit("change");emit("page",0);emit("select",null);}
  window.DSPDFEditor=window.DSPDFEditor||{};window.DSPDFEditor.state=state;window.DSPDFEditor.on=function(n,fn){(listeners[n]=listeners[n]||[]).push(fn)};window.DSPDFEditor.emit=emit;window.DSPDFEditor.addElement=addElement;window.DSPDFEditor.updateElement=updateElement;window.DSPDFEditor.removeElement=removeElement;window.DSPDFEditor.ensurePage=ensurePage;window.DSPDFEditor.getSelected=getSelected;window.DSPDFEditor.select=select;window.DSPDFEditor.setPage=setPage;window.DSPDFEditor.setActiveTool=setActiveTool;window.DSPDFEditor.setInteractionMode=setInteractionMode;window.DSPDFEditor.undo=undo;window.DSPDFEditor.redo=redo;window.DSPDFEditor.reset=reset;window.DSPDFEditor.pushHistory=pushHistory;
})();
