// Statement of Dues, drawn directly as a PDF — runs in Deno, no browser.
//
// Layout approved 2026-08-20 against the html2pdf version it replaces:
//   · letterhead on page 1 only; continuation pages get a slim strip, and the
//     footer prints once at the end — same as the HTML
//   · .divider is 1px #e2e8f0 grey; only the table head carries a 2px black
//     rule, and rows have no separator, just the #fcfcfd zebra
//   · "INR", never the rupee sign: the Geist subsets have no U+20B9, and an
//     embedded PDF font cannot fall back, so it would print as an empty box

import { PDFDocument, rgb } from 'https://esm.sh/pdf-lib@1.17.1'
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1'


// ── text safety ───────────────────────────────────────────────────────────
// The embedded Geist files are latin subsets. pdf-lib does NOT throw on a
// missing glyph — it quietly draws .notdef, so a Gujarati or Devanagari
// customer name renders as a row of empty boxes and nobody finds out until a
// customer asks why their statement is broken. Keep what the font can draw,
// drop the rest, and fall back to the customer code if nothing survives.
const DRAWABLE = /[\u0000-\u024F\u2010-\u2027\u20AC\u2122]/
export function safeText(v, fallback = '') {
  const out = String(v ?? '').split('').filter(ch => DRAWABLE.test(ch)).join('')
    .replace(/\s+/g, ' ').trim()
  return out || fallback
}
// Truncate to a width the column can actually hold, so nothing overruns into
// the next column or off the page edge.
export function fitText(v, font, size, maxW, fallback = '') {
  let t = safeText(v, fallback)
  if (!t || font.widthOfTextAtSize(t, size) <= maxW) return t
  const dots = '...'
  const dotsW = font.widthOfTextAtSize(dots, size)
  while (t.length > 1 && font.widthOfTextAtSize(t, size) + dotsW > maxW) t = t.slice(0, -1)
  return t.trimEnd() + dots
}

const A4 = [595.28, 841.89]
const M  = { l: 40, r: 40, t: 46, b: 48 }

const INK    = rgb(0.059, 0.090, 0.165)   // #0f172a
const MUTED  = rgb(0.278, 0.333, 0.412)   // #475569
const FAINT  = rgb(0.580, 0.639, 0.722)   // #94a3b8
const LINE   = rgb(0.886, 0.910, 0.941)   // #e2e8f0
const HAIR   = rgb(0.945, 0.960, 0.976)   // #f1f5f9
const RED    = rgb(0.725, 0.110, 0.110)   // #b91c1c
const BLUE   = rgb(0.102, 0.451, 0.910)   // #1a73e8
const ZEBRA  = rgb(0.988, 0.988, 0.992)
const PANEL  = rgb(0.973, 0.980, 0.988)   // #f8fafc

export const SSC = {
  name: 'SSC Control Pvt. Ltd.', legal: 'SSC CONTROL PRIVATE LIMITED',
  gstin: '24ABGCS0605M1ZE', cin: 'U51909GJ2021PTC122539',
  email: 'accounts.amd@ssccontrol.com',
  bank: { name: 'Kotak Mahindra Bank', acNo: '3546422480', branch: 'BPC Road, Vadodara', ifsc: 'KKBK0002751' },
}

const money = v => {
  const n = Math.abs(Number(v) || 0)
  const [i, d] = n.toFixed(2).split('.')
  let s = i
  if (i.length > 3) {
    const head = i.slice(0, -3), tail = i.slice(-3), parts = []
    let h = head
    while (h.length > 2) { parts.unshift(h.slice(-2)); h = h.slice(0, -2) }
    if (h) parts.unshift(h)
    s = parts.join(',') + ',' + tail
  }
  return (Number(v) < 0 ? '-' : '') + s + '.' + d
}
const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const dDMY = d => {
  if (!d) return '—'
  const t = new Date(d); if (isNaN(t)) return '—'
  const p = n => String(n).padStart(2, '0')
  return `${p(t.getUTCDate())}.${p(t.getUTCMonth() + 1)}.${t.getUTCFullYear()}`
}
const A = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']
const B = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety']
function conv(n){ if(!n) return ''
  if(n<20) return A[n]
  if(n<100) return B[Math.floor(n/10)]+(n%10?' '+A[n%10]:'')
  if(n<1000) return A[Math.floor(n/100)]+' Hundred'+(n%100?' '+conv(n%100):'')
  if(n<100000) return conv(Math.floor(n/1000))+' Thousand'+(n%1000?' '+conv(n%1000):'')
  if(n<10000000) return conv(Math.floor(n/100000))+' Lakh'+(n%100000?' '+conv(n%100000):'')
  return conv(Math.floor(n/10000000))+' Crore'+(n%10000000?' '+conv(n%10000000):'') }
const words = v => { const n=Number(v)||0, r=Math.floor(n), p=Math.round((n-r)*100)
  return 'Rupees '+(conv(r)||'Zero')+(p?' and '+conv(p)+' Paise':'')+' Only' }

const BUCKETS = [
  ['Not yet due', -Infinity, 0], ['1 – 30 days', 1, 30], ['31 – 60 days', 31, 60],
  ['61 – 90 days', 61, 90], ['Over 90 days', 91, Infinity],
]
export function summarise(bills) {
  const rows = bills || [], n = v => Number(v) || 0
  const outstanding = rows.reduce((s,b)=>s+n(b.pending_inr),0)
  const pdc = rows.reduce((s,b)=>s+n(b.pdc_inr),0)
  const overdue = rows.filter(b=>b.is_overdue).reduce((s,b)=>s+n(b.pending_inr)-n(b.pdc_inr),0)
  return { billCount: rows.length, outstanding, pdc, balance: outstanding-pdc, overdue,
    notDue: outstanding-pdc-overdue, oldest: rows.reduce((m,b)=>Math.max(m,n(b.days_past_due)),0),
    hasPdc: pdc > 0,
    ageing: BUCKETS.map(([label,lo,hi]) => {
      const inB = rows.filter(b => n(b.days_past_due)>=lo && n(b.days_past_due)<=hi)
      return { label, count: inB.length,
               amount: inB.reduce((s,b)=>s+n(b.pending_inr)-n(b.pdc_inr),0) }
    }) }
}

export async function buildDuesStatementPdf({ customer, bills, asOn, assets }) {
  const s = summarise(bills)
  const sorted = [...(bills||[])].sort((a,b) =>
    String(a.due_date||a.bill_date||'').localeCompare(String(b.due_date||b.bill_date||'')))

  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const R  = await pdf.embedFont(assets.regular,  { subset: true })
  const SB = await pdf.embedFont(assets.semibold, { subset: true })
  const MR = await pdf.embedFont(assets.mono,     { subset: true })
  const MB = await pdf.embedFont(assets.monoBold, { subset: true })
  const logo = assets.logo ? await pdf.embedPng(assets.logo) : null

  let page, y
  const W = A4[0], H = A4[1]
  const right = W - M.r

  const T = (txt, x, yy, { f = R, size = 9, color = INK, align = 'left', width = 0 } = {}) => {
    const str = safeText(txt)
    if (!str) return
    let px = x
    if (align !== 'left') {
      const w = f.widthOfTextAtSize(str, size)
      px = align === 'right' ? x - w : x - w / 2
    }
    page.drawText(str, { x: px, y: yy, size, font: f, color })
  }

  // Mixed-weight text that wraps on word boundaries, the way the HTML does.
  // Hand-splitting lines produced breaks mid-phrase and a ragged right edge.
  const flow = (runs, x, yStart, maxW, size, lead) => {
    let cx = x, cy = yStart
    runs.forEach(({ t, f = R, color = MUTED }) => {
      // keep the spaces: they are what the line breaks on
      const parts = String(t).split(/(\s+)/).filter(p => p !== '')
      parts.forEach(word => {
        const w = f.widthOfTextAtSize(word, size)
        if (/^\s+$/.test(word)) {
          if (cx > x) cx += w      // never start a line with a space
          return
        }
        if (cx + w > x + maxW) { cx = x; cy -= lead }
        page.drawText(word, { x: cx, y: cy, size, font: f, color })
        cx += w
      })
    })
    return cy
  }
  const rule = (x1, yy, x2, color = LINE, thickness = 0.7) =>
    page.drawLine({ start:{x:x1,y:yy}, end:{x:x2,y:yy}, thickness, color })
  const box = (x, yy, w, h, color) => page.drawRectangle({ x, y: yy, width: w, height: h, color })

  // ── page furniture ──────────────────────────────────────────────────────
  const footer = () => {
    let fy = M.b + 26
    rule(M.l, fy + 8, right)
    const L = [`${SSC.name}  |  GSTIN: ${SSC.gstin}  |  CIN: ${SSC.cin}`,
               'Ahmedabad: E/12, Siddhivinayak Towers, Off. SG Highway, Makarba, Ahmedabad – 380 051',
               'Baroda: 31 GIDC Estate, B/h Bank Of Baroda, Makarpura, Vadodara – 390 010']
    L.forEach((t,i) => T(t, M.l, fy - i*8, { size: 6.5, color: FAINT }))
    const Rt = [SSC.email, 'www.ssccontrol.com', 'Subject to Vadodara Jurisdiction']
    Rt.forEach((t,i) => T(t, right, fy - i*8, { size: 6.5, color: FAINT, align: 'right' }))
  }
  // Page 1 gets the letterhead. Continuation pages get a one-line strip — the
  // HTML version does not repeat the header either, only the table head.
  const contStrip = () => {
    T(fitText(`${customer?.customer_name || ''} · Statement of Dues as on ${dDMY(asOn)}`, R, 8, right - M.l - 70),
      M.l, y - 10, { size: 8, color: MUTED })
    T('continued', right, y - 10, { size: 8, color: FAINT, align: 'right' })
    y -= 20
    rule(M.l, y, right)
    y -= 18
  }
  const newPage = (mode) => {
    page = pdf.addPage(A4)
    y = H - M.t
    if (mode === 'full') header()
    else if (mode === 'cont') contStrip()
  }
  const header = () => {
    // Both columns are measured, then y drops below whichever is taller. The
    // previous version assumed a fixed header height and the title ended up
    // sitting on the divider rule.
    let ry = y + 4
    if (logo) {
      const lw = 82, lh = (logo.height / logo.width) * lw
      page.drawImage(logo, { x: right - lw, y: ry - lh, width: lw, height: lh })
      ry -= lh + 18
    }
    box(right - 56, ry - 9, 56, 13, rgb(0.937,0.965,1))
    T('ACCOUNTS', right - 28, ry - 5, { f: SB, size: 6.8, color: rgb(0.114,0.306,0.847), align: 'center' })
    ry -= 40
    T('Statement of Dues', right, ry, { f: SB, size: 21, align: 'right' })
    const rightBottom = ry - 8

    let ly = y - 12
    T(SSC.name, M.l, ly, { f: SB, size: 14 });                                        ly -= 15
    T('Engineering Industry. Powering Progress.', M.l, ly, { size: 8, color: MUTED }); ly -= 15
    T('Industrial Automation  |  Product Distribution  |  Safety Solutions  |  Robotics',
      M.l, ly, { size: 7.2, color: MUTED });                                          ly -= 17
    ;['E/12, Siddhivinayak Towers, B/H DCP Office',
      'Off. SG Highway, Makarba, Ahmedabad – 380 051',
      `GSTIN: ${SSC.gstin}`].forEach(t => { T(t, M.l, ly, { size: 7.4, color: MUTED }); ly -= 11 })
    const leftBottom = ly

    y = Math.min(leftBottom, rightBottom) - 16
    rule(M.l, y, right)          // .divider — 1px #e2e8f0
    y -= 20
  }

  // ── page 1 ──────────────────────────────────────────────────────────────
  newPage('full')

  // Statement For / Reference
  const colR = M.l + 300
  T('STATEMENT FOR', M.l, y, { f: SB, size: 6.5, color: FAINT })
  T('REFERENCE',     colR, y, { f: SB, size: 6.5, color: FAINT })
  y -= 17
  T(fitText(customer?.customer_name, SB, 11.5, colR - M.l - 20, customer?.customer_id || '—'),
    M.l, y, { f: SB, size: 11.5 })
  const ref = [
    ['Statement Date', dDMY(asOn)],
    ['Open Bills', String(s.billCount)],
    ['Oldest Overdue', s.oldest > 0 ? `${s.oldest} days` : '—'],
    ...(customer?.whatsapp_name || customer?.poc_name ? [['Kind Attn.', customer.whatsapp_name || customer.poc_name]] : []),
    ...(customer?.account_owner ? [['Your SSC Contact', customer.account_owner]] : []),
  ]
  ref.forEach(([k,v], i) => {
    T(k, colR, y - i*15.5, { size: 8.3, color: MUTED })
    T(v, right, y - i*15.5, { f: SB, size: 8.3, align: 'right' })
  })
  let ly = y - 15
  // Label grey, value bold and dark — the HTML puts the ID in <strong> with the
  // mono face, and the GSTIN in <strong>. Flat grey lost that emphasis.
  if (customer?.customer_id) {
    T('Customer ID: ', M.l, ly, { size: 8, color: MUTED })
    T(customer.customer_id, M.l + R.widthOfTextAtSize('Customer ID: ', 8), ly, { f: MB, size: 8, color: INK })
    ly -= 14
  }
  const addr = String(customer?.billing_address || '').replace(/\s*,\s*,/g, ',').trim()
  if (addr) {
    const wrap = []
    let cur = ''
    addr.split(/,\s*/).forEach(part => {
      if (R.widthOfTextAtSize(cur + part, 7.5) > 250) { wrap.push(cur.replace(/,\s*$/,'')); cur = '' }
      cur += part + ', '
    })
    if (cur) wrap.push(cur.replace(/,\s*$/,''))
    wrap.slice(0,3).forEach(l => { T(l, M.l, ly, { size: 8, color: MUTED }); ly -= 13 })
  }
  if (customer?.gst) {
    T('GSTIN: ', M.l, ly, { size: 8, color: MUTED })
    T(customer.gst, M.l + R.widthOfTextAtSize('GSTIN: ', 8), ly, { f: SB, size: 8, color: INK })
    ly -= 14
  }
  y = Math.min(ly, y - ref.length*15.5) - 16
  rule(M.l, y, right); y -= 20

  // terms strip
  T(`Payment terms: `, M.l, y, { size: 7.5, color: MUTED })
  T(customer?.credit_terms || '—', M.l + 68, y, { f: SB, size: 7.5 })
  T(`Statement as on: `, M.l + 150, y, { size: 7.5, color: MUTED })
  T(dDMY(asOn), M.l + 232, y, { f: SB, size: 7.5 })
  T(`Currency: `, M.l + 300, y, { size: 7.5, color: MUTED })
  T('INR', M.l + 345, y, { f: SB, size: 7.5 })
  y -= 26

  // ── bill table ──────────────────────────────────────────────────────────
  const hasPdc = s.hasPdc
  const cols = hasPdc
    ? [{k:'#',x:M.l,w:22},{k:'BILL DATE',x:M.l+24,w:58,a:'center'},{k:'BILL NO.',x:M.l+86,w:80},
       {k:'DUE DATE',x:M.l+170,w:58,a:'center'},{k:'DAYS OVERDUE',x:M.l+232,w:70,a:'center'},
       {k:'POST-DATED',x:M.l+372,w:70,a:'right'},{k:'AMOUNT DUE',x:right,w:70,a:'right'}]
    : [{k:'#',x:M.l,w:22},{k:'BILL DATE',x:M.l+30,w:60,a:'center'},{k:'BILL NO.',x:M.l+100,w:90},
       {k:'DUE DATE',x:M.l+200,w:60,a:'center'},{k:'DAYS OVERDUE',x:M.l+290,w:70,a:'center'},
       {k:'AMOUNT DUE',x:right,w:80,a:'right'}]

  const tableHead = () => {
    cols.forEach(c => T(c.k, c.a === 'right' ? c.x : c.a === 'center' ? c.x + c.w/2 : c.x, y,
      { f: SB, size: 7, color: MUTED, align: c.a === 'right' ? 'right' : c.a === 'center' ? 'center' : 'left' }))
    y -= 8
    rule(M.l, y, right, INK, 1.6)   // thead border-bottom: 2px #0f172a
    y -= 18
  }
  tableHead()

  // BILL NO. must stay inside its own column — an unusually long reference
  // was running straight over DUE DATE.
  const refW = (hasPdc ? 84 : 100) - 10
  sorted.forEach((b, i) => {
    if (y < M.b + 70) { newPage('cont'); tableHead() }
    if (i % 2 === 1) box(M.l, y - 8, right - M.l, 20, ZEBRA)
    const bal = (Number(b.pending_inr)||0) - (Number(b.pdc_inr)||0)
    const cells = hasPdc
      ? [String(i+1), dDMY(b.bill_date), fitText(String(b.bill_ref||'—').toUpperCase(), MR, 8.4, refW, '—'), dDMY(b.due_date),
         b.is_overdue ? String(b.days_past_due) : 'Within terms',
         b.pdc_inr ? money(b.pdc_inr) : '—', money(bal)]
      : [String(i+1), dDMY(b.bill_date), fitText(String(b.bill_ref||'—').toUpperCase(), MR, 8.4, refW, '—'), dDMY(b.due_date),
         b.is_overdue ? String(b.days_past_due) : 'Within terms', money(bal)]
    cells.forEach((txt, ci) => {
      const c = cols[ci]
      const isRef  = ci === 2
      const isLast = ci === cells.length - 1
      const isDays = c.k === 'DAYS OVERDUE'
      T(txt, c.a === 'right' ? c.x : c.a === 'center' ? c.x + c.w/2 : c.x, y, {
        f: isLast ? MB : isRef ? MR : R,
        size: isDays && !b.is_overdue ? 7.6 : 8.4,
        color: ci === 0 ? FAINT : isDays ? (b.is_overdue ? RED : MUTED) : INK,
        align: c.a === 'right' ? 'right' : c.a === 'center' ? 'center' : 'left',
      })
    })
    y -= 20
  })

  // ── ageing + totals ─────────────────────────────────────────────────────
  if (y < M.b + 190) newPage('cont')
  y -= 8
  const ageX = M.l, totX = M.l + 300
  T('AGEING (DAYS PAST DUE)', ageX, y, { f: SB, size: 7, color: MUTED })
  T('BILLS',  ageX + 168, y, { f: SB, size: 7, color: MUTED, align: 'center' })
  T('AMOUNT', ageX + 250, y, { f: SB, size: 7, color: MUTED, align: 'right' })
  let ay = y - 8
  rule(ageX, ay, ageX + 250); ay -= 15
  s.ageing.forEach(a => {
    T(a.label, ageX, ay, { size: 8.4 })
    T(String(a.count), ageX + 168, ay, { size: 8.4, align: 'center' })
    T(a.amount ? money(a.amount) : '—', ageX + 250, ay, { f: MR, size: 8.4, align: 'right' })
    ay -= 7; rule(ageX, ay, ageX + 250, HAIR); ay -= 14
  })

  let ty = y
  const totRow = (label, val, opt = {}) => {
    T(label, totX, ty, { size: 8.6, color: opt.red ? RED : MUTED })
    T(val, right, ty, { f: opt.bold ? MB : MR, size: opt.bold ? 9.6 : 8.6,
                        color: opt.red ? RED : INK, align: 'right' })
    ty -= 15
  }
  totRow('Total Outstanding', money(s.outstanding))
  if (hasPdc) totRow('Less: Post-Dated Cheques Received', '(-) ' + money(s.pdc))
  totRow('Not Yet Due', money(s.notDue))
  totRow('Overdue', money(s.overdue), { red: true })
  ty += 5; rule(totX, ty, right, INK, 1.2); ty -= 15
  T('Balance Due', totX, ty, { f: SB, size: 10.5 })
  // "INR", not "₹": the self-hosted Geist files are latin subsets with no
  // U+20B9. A browser silently substitutes another font for it; an embedded
  // PDF font cannot, and you get a tofu box on the most important number.
  T('INR ' + money(s.balance), right, ty, { f: MB, size: 11, align: 'right' })

  y = Math.min(ay, ty) - 24

  // words
  if (y < M.b + 120) newPage('cont')
  box(M.l, y - 8, right - M.l, 26, PANEL)
  box(M.l, y - 8, 3, 26, LINE)
  T('Balance due in words: ', M.l + 11, y + 3, { size: 8, color: MUTED })
  T(words(s.balance), M.l + 101, y + 3, { f: SB, size: 8 })
  y -= 44

  // payment details + queries
  if (y < M.b + 110) newPage('cont')
  page.drawRectangle({ x: M.l, y: y - 58, width: right - M.l, height: 74,
                       borderColor: LINE, borderWidth: 0.7, color: rgb(1,1,1) })
  T('PAYMENT DETAILS', M.l + 10, y, { f: SB, size: 6.3, color: FAINT })
  T('FOR QUERIES',     totX + 10, y, { f: SB, size: 6.3, color: FAINT })
  const pay = [['Bank', SSC.bank.name], ['A/c No.', SSC.bank.acNo],
               ['Branch & IFSC', `${SSC.bank.branch} · ${SSC.bank.ifsc}`]]
  pay.forEach(([k,v], i) => {
    T(k, M.l + 10, y - 17 - i*15, { size: 8, color: MUTED })
    T(v, totX - 10, y - 17 - i*15, { f: i ? MR : SB, size: 8, align: 'right' })
  })
  T('Accounts', totX + 10, y - 17, { size: 8, color: MUTED })
  T(SSC.email, right - 10, y - 17, { f: SB, size: 8, align: 'right' })
  if (customer?.account_owner) {
    T('Your SSC Contact', totX + 10, y - 32, { size: 8, color: MUTED })
    T(customer.account_owner, right - 10, y - 32, { f: SB, size: 8, align: 'right' })
  }
  y -= 84

  // note
  if (y < M.b + 90) newPage('cont')
  const noteRuns = [
    { t: 'Please note:', f: SB, color: INK },
    { t: ` This statement reflects our books as on ${dDMY(asOn)}. Payments made or cheques in transit after this date may not be reflected — ` },
    { t: 'kindly ignore this statement if payment has already been released.', f: SB, color: INK },
    { t: ' Any discrepancy in the above bills may kindly be intimated to us within ' },
    { t: '7 days', f: SB, color: INK },
    { t: ', after which the balances will be treated as confirmed. Kindly quote the bill number(s) while making payment.' },
  ]
  // measure first so the panel is exactly as tall as the text
  const noteW = right - M.l - 24
  let probeY = 0, probeX = 0
  noteRuns.forEach(({ t, f = R }) => {
    String(t).split(/(\s+)/).filter(p => p !== '').forEach(word => {
      const w = f.widthOfTextAtSize(word, 7.8)
      if (/^\s+$/.test(word)) { if (probeX > 0) probeX += w; return }
      if (probeX + w > noteW) { probeX = 0; probeY -= 12.5 }
      probeX += w
    })
  })
  const noteH = -probeY + 30
  box(M.l, y + 10 - noteH, right - M.l, noteH, PANEL)
  box(M.l, y + 10 - noteH, 3, noteH, BLUE)
  flow(noteRuns, M.l + 12, y, noteW, 7.8, 12.5)
  y = y + 10 - noteH - 22

  // signatures
  if (y < M.b + 60) newPage('cont')
  rule(M.l, y + 12, right)
  const sigW = (right - M.l) / 2
  ;[['Prepared By', 'Accounts'], ['Authorised Signatory', `For ${SSC.legal}`]].forEach(([a,b2], i) => {
    const cx = M.l + sigW*i + sigW/2
    rule(cx - 78, y - 18, cx + 78, FAINT)
    T(a,  cx, y - 30, { f: SB, size: 8, align: 'center' })
    T(b2, cx, y - 41, { size: 7.5, color: MUTED, align: 'center' })
  })

  footer()
  return await pdf.save()
}
