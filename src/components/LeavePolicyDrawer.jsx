import { useState } from 'react'
import { createPortal } from 'react-dom'

/* Shared "How leave & LOP work" explainer drawer — EN / हिंदी / ગુજરાતી.
   Used on the Leave page and My Attendance. Popups = drawers (design rule);
   reuses the people-drawer / pd-* chrome from drawer.css. */

// visual style per code — shared across all languages
const STYLE = [
  { code:'P',   color:'var(--st-present)', bg:'#E9F6EF' },
  { code:'½',   color:'var(--st-half)',    bg:'#FDF3E7' },
  { code:'GL',  color:'var(--st-leave)',   bg:'#F0ECFB' },
  { code:'A',   color:'var(--st-absent)',  bg:'#FCEBEB' },
  { code:'LOP', color:'var(--st-absent)',  bg:'#FCEBEB' },
  { code:'✓',   color:'var(--st-present)', bg:'#E9F6EF' },
]

const T = {
  en: {
    name:'EN', title:'How leave & LOP work', sub:'SSC leave & attendance policy',
    intro:'Your day is split into two sessions — morning (10:00–2:00) and afternoon (2:00–6:30). Each session is half a day.',
    rows:[
      { title:'Present', desc:'Both sessions worked. In by 10:00 (grace to 10:15 = marked Late but still a full day). Out by 6:30 PM (grace 6:15) for the afternoon half.' },
      { title:'Half day', desc:'Only one session. In after 10:15 → morning lost. Out before 6:15 → afternoon lost.' },
      { title:'General Leave — paid', desc:'Leave you applied for in advance and got approved. Deducts from your 25 paid leaves a year.' },
      { title:'Absent → LOP', desc:'No punch and no approved leave. Counts as Loss of Pay. Always inform HR and apply; in a real emergency you can regularise afterwards.' },
      { title:'Loss of Pay — unpaid', desc:'Unpaid days deducted from salary — from uninformed absence, unapproved leave, or being on probation/notice. LOP does not touch your paid leave balance — it is a separate salary deduction.' },
      { title:'Regularise', desc:'An absence you justify and get approved becomes Present — no LOP.' },
    ],
    probT:'Probation & notice period',
    probD:'During your first 3 months (probation) and while on notice, every leave or absence is LOP — no paid leave applies.',
  },
  hi: {
    name:'हिंदी', title:'छुट्टी और LOP कैसे काम करते हैं', sub:'SSC छुट्टी और उपस्थिति नीति',
    intro:'आपका दिन दो सत्रों में बँटा है — सुबह (10:00–2:00) और दोपहर (2:00–6:30)। हर सत्र आधा दिन होता है।',
    rows:[
      { title:'उपस्थिति', desc:"दोनों सत्रों में उपस्थिति दर्ज हुई। सुबह १०:०० बजे तक आगमन (१०:१५ तक छूट = 'लेट' दर्ज होने पर भी पूरा दिन गिना गया)। दोपहर के सत्र के लिए शाम ६:३० बजे प्रस्थान (६:१५ बजे तक छूट)।" },
      { title:'आधा दिन', desc:'केवल एक सत्र। १०:१५ के बाद आएँ तो → सुबह का समय नहीं गिना जाता। ६:१५ से पहले जाएँ तो → दोपहर का समय नहीं गिना जाता।' },
      { title:'जनरल लीव — सवैतनिक', desc:'पहले से आवेदन की गई और मंज़ूर हुई छुट्टी। यह छुट्टी आपके साल के २५ सवैतनिक छुट्टियों के कोटे में से घटाई जाती है।' },
      { title:'अनुपस्थित → LOP', desc:'कोई पंच नहीं और कोई मंज़ूर छुट्टी नहीं। इसे वेतन कटौती (Loss of Pay) के रूप में गिना जाता है। हमेशा HR को सूचित करें और आवेदन करें; सच्ची आपात स्थिति में आप बाद में रेगुलराइज़ कर सकते हैं।' },
      { title:'Loss of Pay — बिना वेतन', desc:'बिना वेतन वाले दिन वेतन से काटे जाते हैं — बिना सूचना अनुपस्थिति, बिना मंज़ूरी छुट्टी, या प्रोबेशन/नोटिस पर होने के कारण। LOP आपके पेड लीव बैलेंस को नहीं छूता — यह एक अलग वेतन कटौती है।' },
      { title:'रेगुलराइज़', desc:'जिस अनुपस्थिति को आप उचित ठहराते हैं और मंज़ूरी पा लेते हैं वह उपस्थित बन जाती है — कोई LOP नहीं।' },
    ],
    probT:'प्रोबेशन और नोटिस पीरियड',
    probD:'आपके पहले 3 महीने (प्रोबेशन) के दौरान और नोटिस पर होने पर, हर छुट्टी या अनुपस्थिति LOP है — कोई पेड लीव लागू नहीं होती।',
  },
  gu: {
    name:'ગુજરાતી', title:'રજા અને LOP કેવી રીતે કામ કરે છે', sub:'SSC રજા અને હાજરી નીતિ',
    intro:'તમારો દિવસ બે સત્રમાં વહેંચાયેલો છે — સવાર (10:00–2:00) અને બપોર (2:00–6:30). દરેક સત્ર અડધો દિવસ છે.',
    rows:[
      { title:'હાજરી', desc:"બંને સત્રોમાં હાજરી નોંધાઈ. સવારે ૧૦:૦૦ વાગ્યા સુધીમાં આગમન (૧૦:૧૫ સુધીની છૂટછાટ = 'મોડા' તરીકે નોંધાયા છતાં આખો દિવસ ગણાયો). બપોરના સત્ર માટે સાંજે ૬:૩૦ વાગ્યે રવાના (૬:૧૫ વાગ્યાની છૂટછાટ)." },
      { title:'અડધો દિવસ', desc:'માત્ર એક સત્ર. ૧૦:૧૫ પછી આવો તો → સવારનો સમય ગણાય નહીં. ૬:૧૫ પહેલાં જાઓ તો → બપોરનો સમય ગણાય નહીં.' },
      { title:'જનરલ લીવ — પગારસહ', desc:'અગાઉથી અરજી કરેલી અને મંજૂર થયેલી રજા. આ રજા તમારા વર્ષના ૨૫ વેતનસહિત રજાઓના ક્વોટામાંથી બાદ કરવામાં આવે છે.' },
      { title:'ગેરહાજર → LOP', desc:'કોઈ પંચ નહીં અને કોઈ મંજૂર રજા નહીં. પગાર ગુમાવવા તરીકે ગણવામાં આવે છે. હંમેશા HR ને જાણ કરો અને અરજી કરો; ખરેખર કટોકટીમાં તમે પછીથી નિયમિત થઈ શકો છો.' },
      { title:'Loss of Pay — પગાર વગર', desc:'પગાર વગરના દિવસો પગારમાંથી કાપવામાં આવે છે — જાણ વગરની ગેરહાજરી, મંજૂર ન કરાયેલી રજા, અથવા પ્રોબેશન/નોટિસ પર હોવાને કારણે. LOP તમારા પેઇડ રજા બેલેન્સને સ્પર્શતું નથી — તે એક અલગ પગાર કપાત છે.' },
      { title:'રેગ્યુલરાઇઝ', desc:'તમે જે ગેરહાજરીને યોગ્ય ઠેરવો છો અને મંજૂરી મેળવો છો તે હાજર બની જાય છે - કોઈ LOP નહીં.' },
    ],
    probT:'પ્રોબેશન અને નોટિસ પીરિયડ',
    probD:'તમારા પહેલા 3 મહિના (પ્રોબેશન) દરમિયાન અને નોટિસ પર હોય ત્યારે, દરેક રજા અથવા ગેરહાજરી LOP છે - કોઈ પેઇડ રજા લાગુ પડતી નથી.',
  },
}

function Row({ code, color, bg, title, children }) {
  return (
    <div style={{ display:'flex', gap:11, padding:'11px 0', borderBottom:'1px solid var(--line-2)' }}>
      <span style={{ flexShrink:0, minWidth:44, height:22, borderRadius:6, background:bg, color, fontSize:11, fontWeight:600,
        display:'grid', placeItems:'center', fontFamily:"'Geist Mono',monospace" }}>{code}</span>
      <div style={{ fontSize:12.5, lineHeight:1.5 }}>
        <b style={{ color:'var(--ink)' }}>{title}</b>
        <div style={{ color:'var(--muted)', marginTop:2 }}>{children}</div>
      </div>
    </div>
  )
}

export default function LeavePolicyDrawer({ open, onClose }) {
  const [lang, setLang] = useState('en')
  if (!open) return null
  const t = T[lang]
  return createPortal(
    <>
      <div className="people-drawer-scrim" onClick={onClose} />
      <div className="people-drawer">
        <div className="pd-h">
          <div>
            <div className="pd-h-t">{t.title}</div>
            <div className="pd-h-s">{t.sub}</div>
          </div>
          <button className="pd-x" onClick={onClose}>✕</button>
        </div>
        <div className="pd-b">
          {/* language switch */}
          <div style={{ display:'inline-flex', gap:4, padding:3, background:'var(--bg)', borderRadius:9, marginBottom:14 }}>
            {Object.keys(T).map(k => (
              <button key={k} onClick={()=>setLang(k)}
                style={{ border:0, cursor:'pointer', borderRadius:7, padding:'5px 12px', fontSize:12, fontWeight:600,
                  fontFamily:'inherit', color: lang===k ? '#fff' : 'var(--muted)',
                  background: lang===k ? 'var(--accent)' : 'transparent' }}>
                {T[k].name}
              </button>
            ))}
          </div>

          <div style={{ fontSize:12.5, color:'var(--muted)', lineHeight:1.55, marginBottom:6 }}>{t.intro}</div>

          {STYLE.map((s, i) => (
            <Row key={s.code} code={s.code} color={s.color} bg={s.bg} title={t.rows[i].title}>{t.rows[i].desc}</Row>
          ))}

          <div style={{ marginTop:14, padding:'12px 14px', borderRadius:10, background:'var(--bg)', fontSize:12.5, lineHeight:1.55, color:'var(--muted)' }}>
            <b style={{ color:'var(--ink)' }}>{t.probT}</b><br/>
            {t.probD}
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}
