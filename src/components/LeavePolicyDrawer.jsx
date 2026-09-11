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
    sandT:'Sandwich rule — leave on both sides of an off day',
    sandD:'If you are on leave the working day BEFORE an off block and the working day AFTER it, the off days in between are charged as leave too. Off days on their own are never charged — only when leave sits on both sides.',
    sandEg:'Example — Friday and Monday on leave, Saturday and Sunday off:',
    sandRow:'Fri leave · Sat off · Sun off · Mon leave  =  4 days deducted, not 2.',
    sandNote:'A half day counts only if it faces the off block — second half on the day before, first half on the day after. Leave only one side (Friday but not Monday) and nothing extra is deducted.',
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
    sandT:'सैंडविच नियम — छुट्टी के दिन के दोनों ओर',
    sandD:'अगर आप अवकाश (साप्ताहिक अवकाश या त्योहार) से ठीक पहले वाले कार्यदिवस और ठीक बाद वाले कार्यदिवस — दोनों पर छुट्टी लेते हैं, तो बीच के अवकाश भी छुट्टी में गिने जाते हैं। अकेले अवकाश कभी नहीं कटते — केवल तब जब दोनों तरफ छुट्टी हो।',
    sandEg:'उदाहरण — शुक्रवार और सोमवार की छुट्टी, शनि-रवि अवकाश:',
    sandRow:'शुक्र छुट्टी · शनि अवकाश · रवि अवकाश · सोम छुट्टी  =  2 नहीं, 4 दिन कटेंगे।',
    sandNote:'आधा दिन तभी गिना जाता है जब वह अवकाश की ओर हो — पहले वाले दिन का दूसरा हिस्सा, बाद वाले दिन का पहला हिस्सा। केवल एक तरफ छुट्टी लें (शुक्रवार, सोमवार नहीं) तो कुछ अतिरिक्त नहीं कटेगा।',
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
    sandT:'સેન્ડવિચ નિયમ — રજાના દિવસની બંને બાજુ',
    sandD:'જો તમે રજા (સાપ્તાહિક રજા કે તહેવાર) ની બરાબર પહેલાંના કામકાજના દિવસે અને બરાબર પછીના કામકાજના દિવસે — બંને પર રજા લો, તો વચ્ચેની રજાઓ પણ રજામાં ગણાય છે. એકલી રજાઓ ક્યારેય કપાતી નથી — ફક્ત ત્યારે જ્યારે બંને બાજુ રજા હોય.',
    sandEg:'ઉદાહરણ — શુક્રવાર અને સોમવારે રજા, શનિ-રવિ રજા:',
    sandRow:'શુક્ર રજા · શનિ રજા · રવિ રજા · સોમ રજા  =  2 નહીં, 4 દિવસ કપાશે.',
    sandNote:'અડધો દિવસ ત્યારે જ ગણાય જ્યારે તે રજા તરફ હોય — પહેલાંના દિવસનો બીજો ભાગ, પછીના દિવસનો પહેલો ભાગ. ફક્ત એક બાજુ રજા લો (શુક્રવાર, સોમવાર નહીં) તો કંઈ વધારાનું કપાશે નહીં.',
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

          {/* Sandwich rule. The single most misunderstood line on a payslip: people
              take Friday and Monday expecting 2 days and lose 4. The worked example is
              the point — the prose alone has never made it land.
              Matches sandwichDays() in src/lib/leaveLedger.js exactly: an off block is
              charged only when the working day BEFORE and the working day AFTER are
              both on leave, and a half day qualifies only if it faces the block. */}
          <div className="pd-note pd-note-sand">
            <b>{t.sandT}</b>
            <div>{t.sandD}</div>
            <div className="pd-eg-lbl">{t.sandEg}</div>
            <div className="pd-eg">
              <span className="pd-eg-d is-leave">Fri<i>leave</i></span>
              <span className="pd-eg-d is-off">Sat<i>off</i></span>
              <span className="pd-eg-d is-off">Sun<i>off</i></span>
              <span className="pd-eg-d is-leave">Mon<i>leave</i></span>
              <span className="pd-eg-eq">= 4</span>
            </div>
            <div className="pd-eg-cap">{t.sandRow}</div>
            <div className="pd-note-sub">{t.sandNote}</div>
          </div>

          <div className="pd-note">
            <b>{t.probT}</b>
            <div>{t.probD}</div>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}
