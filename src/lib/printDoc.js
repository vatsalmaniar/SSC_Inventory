// Shared writer for print/report documents opened via window.open('', '_blank').
//
// Desktop: writes the document exactly as before — new tab, print dialogs, no change.
// Phone / installed PWA (standalone): the opened window has NO tab bar or back
// button, so users got stranded on challans/reports. On those screens we inject
// a fixed "← Back to SSC" + "Print / Save PDF" bar into the document itself.
// The bar is hidden in @media print, so printed/PDF output is untouched.

function isMobileDoc() {
  try {
    return window.matchMedia('(max-width: 820px)').matches
      || window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true
  } catch { return false }
}

function docBar() {
  // Absolute app URL captured from the opener context — the written document's
  // base is about:blank, so relative URLs there are unreliable.
  const appHome = JSON.stringify(window.location.origin + '/')
  return '' +
    '<div id="ssc-docbar">' +
      '<button id="ssc-doc-back" type="button">&larr; Back to SSC</button>' +
      '<button id="ssc-doc-print" type="button">Print / Save PDF</button>' +
    '</div>' +
    '<style>' +
      '#ssc-docbar{position:fixed;top:0;left:0;right:0;z-index:99999;display:flex;gap:8px;padding:10px 12px;background:#0B1B30;box-shadow:0 2px 12px rgba(0,0,0,.25);font-family:\'Geist\',\'DM Sans\',system-ui,sans-serif;}' +
      '#ssc-docbar button{flex:1;border:0;border-radius:8px;padding:12px 10px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;}' +
      '#ssc-doc-back{background:#1a73e8;color:#fff;}' +
      '#ssc-doc-print{background:rgba(255,255,255,.14);color:#fff;}' +
      'body{margin-top:64px !important;}' +
      '@media print{#ssc-docbar{display:none !important;}body{margin-top:0 !important;}}' +
    '</style>' +
    '<scr' + 'ipt>' +
      'document.getElementById("ssc-doc-back").addEventListener("click",function(){' +
        'try{window.close()}catch(e){}' +
        'setTimeout(function(){if(!window.closed){if(history.length>1){history.back()}else{location.href=' + appHome + '}}},200)' +
      '});' +
      'document.getElementById("ssc-doc-print").addEventListener("click",function(){window.print()});' +
    '</scr' + 'ipt>'
}

export function writeDoc(w, html) {
  if (!w) return
  let out = html
  if (isMobileDoc()) {
    const bar = docBar()
    const m = out.match(/<body[^>]*>/i)
    out = m ? out.replace(m[0], m[0] + bar) : bar + out
  }
  w.document.open()
  w.document.write(out)
  w.document.close()
}
