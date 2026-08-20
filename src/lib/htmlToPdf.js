// Render print-ready HTML to a PDF blob, in the browser.
//
// Lifted verbatim out of PurchaseOrderDetail.jsx, where it was proven in
// production sending POs to vendors — including the iframe isolation, the
// onclone stylesheet re-injection, and the body-padding fix for the blank
// trailing page. Shared so the WhatsApp statement sender inherits those fixes
// instead of rediscovering them.
//
// Deliberately client-side: Deno Edge Functions cannot run headless Chrome, and
// the browser doing the work costs the server nothing.

export async function htmlToPdfBlob(html, filename = "document.pdf") {
  const html2pdfMod = await import('html2pdf.js')
  const html2pdf = html2pdfMod.default || html2pdfMod
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;left:0;top:0;width:860px;height:1px;opacity:0;pointer-events:none;z-index:-1;border:0'
  document.body.appendChild(iframe)
  try {
    const doc = iframe.contentDocument
    doc.open(); doc.write(html); doc.close()

    // Wait for stylesheets and images inside the iframe to fully load
    const linkPromises = Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).map(l => new Promise(resolve => {
      if (l.sheet) return resolve()
      let done = false; const finish = () => { if (!done) { done = true; resolve() } }
      l.addEventListener('load', finish, { once: true })
      l.addEventListener('error', finish, { once: true })
      setTimeout(finish, 3000)
    }))
    const imgPromises = Array.from(doc.querySelectorAll('img')).map(img => new Promise(resolve => {
      if (img.complete && img.naturalHeight > 0) return resolve()
      let done = false; const finish = () => { if (!done) { done = true; resolve() } }
      img.addEventListener('load', finish, { once: true })
      img.addEventListener('error', finish, { once: true })
      setTimeout(finish, 4000)
    }))
    await Promise.all([...linkPromises, ...imgPromises])
    if (iframe.contentWindow?.document?.fonts?.ready) {
      try { await iframe.contentWindow.document.fonts.ready } catch (_) {}
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    await new Promise(r => setTimeout(r, 300))

    // The on-screen template adds 40px top/bottom body padding for the in-browser
    // "View PO" tab. html2canvas renders that padding on top of the jsPDF page margin,
    // which pushes the content a sliver over one A4 page -> a blank trailing page in the
    // emailed PDF. Neutralise the vertical padding for the capture only (the page margin
    // below already provides the top/bottom gutter). View PO is untouched.
    doc.body.style.paddingTop = '0'
    doc.body.style.paddingBottom = '0'

    // Grow the iframe to match content height so html2canvas can capture everything
    const contentHeight = doc.body.scrollHeight
    iframe.style.height = contentHeight + 'px'
    await new Promise(r => setTimeout(r, 100))

    // html2pdf renders by deep-cloning the captured element (doc.body) into a container in
    // the MAIN app document — but the template's CSS lives in <head><style>, which is NOT
    // inside body, so the clone arrives unstyled (only inline element styles survive). That
    // is why the emailed PDF lost all layout. Re-inject the stylesheet into html2canvas's
    // own isolated render clone via onclone: it styles the PDF without leaking the global
    // `*{}` / `body{}` rules onto the live app UI (the §6.1 style-leak we must avoid).
    const pdfCss = (html.match(/<style>([\s\S]*?)<\/style>/i) || [])[1] || ''

    const blob = await html2pdf().set({
      margin: [8, 10, 10, 10],
      filename,
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true, letterRendering: true, windowWidth: 860, logging: false,
        onclone: (clonedDoc) => {
          if (!pdfCss) return
          const s = clonedDoc.createElement('style')
          s.textContent = pdfCss
          clonedDoc.head.appendChild(s)
        } },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] },
    }).from(doc.body).outputPdf('blob')

    const sizeKB = blob ? Math.round(blob.size / 1024) : 0
    console.log('[PDF] Generated size:', sizeKB + ' KB')
    if (!blob || blob.size < 2 * 1024) return { blob: null, sizeKB }
    return { blob, sizeKB }
  } finally {
    document.body.removeChild(iframe)
  }
}
