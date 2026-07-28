// SSC Employee Guide — content, reproduced VERBATIM from Handbook.pdf (v1.0, July 2026).
// Do not change the policy wording here. System-mapping + FY holiday list handled separately.
// Each text field may be a plain string (English) or { en, hi, gu }; the renderer falls back
// to English when hi/gu are not yet filled. Hindi & Gujarati are being added in passes.

export const HB_META = {
  title: { en: 'Employee Guide', hi: 'कर्मचारी गाइड', gu: 'કર્મચારી ગાઇડ' },
  company: 'SSC Control Pvt. Ltd.',
  version: '1.0',
  issued: { en: 'July 2026', hi: 'जुलाई 2026', gu: 'જુલાઈ 2026' },
  tagline: {
    en: 'Policies, benefits, and everyday practices — everything you need to know about working at SSC, in one place.',
    hi: 'नीतियाँ, लाभ और रोज़मर्रा की प्रथाएँ — SSC में काम करने के बारे में आपको जो कुछ जानना है, एक ही जगह पर।',
    gu: 'નીતિઓ, લાભો અને રોજિંદી પ્રથાઓ — SSC માં કામ કરવા વિશે તમારે જે જાણવું જોઈએ તે બધું, એક જ જગ્યાએ.',
  },
  note: { en: 'Internal circulation only', hi: 'केवल आंतरिक प्रसार', gu: 'ફક્ત આંતરિક પરિભ્રમણ' },
}

export const HB_PARTS = [
  { id: 'A', title: { en: 'Welcome & Culture', hi: 'स्वागत और संस्कृति', gu: 'સ્વાગત અને સંસ્કૃતિ' } },
  { id: 'B', title: { en: 'Working at SSC', hi: 'SSC में काम करना', gu: 'SSC માં કામ કરવું' } },
  { id: 'C', title: { en: 'Travel, Assets & Resources', hi: 'यात्रा, संपत्ति और संसाधन', gu: 'મુસાફરી, સંપત્તિ અને સંસાધનો' } },
  { id: 'D', title: { en: 'Workplace & Employment Lifecycle', hi: 'कार्यस्थल और रोज़गार जीवनचक्र', gu: 'કાર્યસ્થળ અને રોજગાર જીવનચક્ર' } },
  { id: 'E', title: { en: 'Pay & Benefits', hi: 'वेतन और लाभ', gu: 'પગાર અને લાભ' } },
]

// block helpers: p=paragraph, h=sub-heading, ul=bullet list, table, callout(faq/note/warn), kv=table w/ 2 cols
const S = arr => arr   // identity, for readability

export const HB_SECTIONS = [
  // ── PART A ──────────────────────────────────────────────
  { part:'A', n:1, title:{ en:'Welcome to SSC', hi:'SSC में आपका स्वागत है', gu:'SSC માં આપનું સ્વાગત છે' }, body:S([
    { t:'p', text:{ en:'Dear Team Member,', hi:'प्रिय टीम सदस्य,', gu:'પ્રિય ટીમ સભ્ય,' } },
    { t:'p', text:{ en:'Welcome to SSC Control Pvt. Ltd. (referred to as “SSC” or “the Company” in this guide). We are glad to have you as part of our journey, and we hope your time here is rewarding, both professionally and personally.' } },
    { t:'p', text:{ en:'This guide brings together, in one place, the policies, benefits, and everyday practices that apply to everyone at SSC. It is meant to be a quick reference — something you can open when you have a question about leave, travel, IT equipment, or anything in between — rather than a document you read once and file away.' } },
    { t:'p', text:{ en:'If anything here is unclear, or if your situation isn’t covered, please reach out to the People & Culture Team. We would rather clarify a doubt than have you guess.' } },
    { t:'p', text:{ en:'Wishing you a great journey with SSC.\nPeople & Culture Team' } },
    { t:'h', text:{ en:'Who we are' } },
    { t:'p', text:{ en:'SSC Control Pvt. Ltd. is a 60-year-old organisation and one of India’s most trusted names in electrical, automation, and engineering solutions. We work alongside machine builders, OEMs, panel builders, and industrial enterprises — delivering quality products, deep technical expertise, and dependable service. Today, we are evolving beyond distribution into a future-ready engineering company driven by innovation, technology, and a service-first mindset.' } },
    { t:'stats', items:[ ['60+','Years of Trust'], ['15+','Brand Partners'], ['4','Solution Verticals'], ['3','Offices'] ] },
    { t:'kv', title:{ en:'Vision & Mission' }, rows:[
      ['Our Vision','To become a leading engineering company, built on innovation, a service-first approach, and people at our core — driving automation and electrification solutions that contribute to nation building.'],
      ['Our Mission','To deliver smart, reliable, and innovative automation and electrification solutions through engineering excellence — with people at the heart of everything we do and a strong focus on shared success.'],
    ]},
  ])},

  { part:'A', n:2, title:{ en:'About This Guide', hi:'इस गाइड के बारे में', gu:'આ ગાઇડ વિશે' }, body:S([
    { t:'h', text:{ en:'Applicability' } },
    { t:'p', text:{ en:'This guide applies to all employees of SSC Control Pvt. Ltd., across all locations, functions, and levels, unless a specific policy states otherwise (for example, where a benefit is tied to grade, designation, or confirmation status).' } },
    { t:'h', text:{ en:'How to use this guide' } },
    { t:'ul', items:[
      { en:'This guide replaces earlier informal emails, letters, or verbal communication on the same subjects.' },
      { en:'Where your specific offer letter, appointment letter, or a written contract states a different term for you individually, that document will prevail over this guide.' },
      { en:'Policies here are administrative guidelines, not a contract of employment, and do not override applicable Indian labour law.' },
    ]},
    { t:'h', text:{ en:'Review, updates & acknowledgment' } },
    { t:'p', text:{ en:'SSC reviews and updates this guide from time to time to stay compliant with law and aligned with how we actually work. Material changes will be communicated in advance wherever practical. Every employee is required to read this guide and confirm, in the format shared by the People & Culture Team, that they have read, understood, and agree to abide by it.' } },
  ])},

  { part:'A', n:3, title:{ en:'Workplace Culture, Conduct & Mutual Respect', hi:'कार्यस्थल संस्कृति, आचरण और पारस्परिक सम्मान', gu:'કાર્યસ્થળ સંસ્કૃતિ, વર્તન અને પરસ્પર આદર' }, body:S([
    { t:'p', text:{ en:'SSC is built on the idea that people do their best work in an environment where they feel respected, safe, and heard. Every employee — regardless of role or seniority — is expected to uphold this culture.', hi:'SSC इस विचार पर आधारित है कि लोग ऐसे माहौल में अपना सर्वश्रेष्ठ काम करते हैं जहाँ वे सम्मानित, सुरक्षित और सुने हुए महसूस करते हैं। हर कर्मचारी से — चाहे उसकी भूमिका या वरिष्ठता कुछ भी हो — इस संस्कृति को बनाए रखने की अपेक्षा की जाती है।', gu:'SSC આ વિચાર પર બનેલું છે કે લોકો એવા વાતાવરણમાં પોતાનું શ્રેષ્ઠ કામ કરે છે જ્યાં તેઓ આદરણીય, સુરક્ષિત અને સાંભળવામાં આવેલા અનુભવે છે. દરેક કર્મચારી પાસેથી — ભૂમિકા કે વરિષ્ઠતા ગમે તે હોય — આ સંસ્કૃતિ જાળવવાની અપેક્ષા રાખવામાં આવે છે.' } },
    { t:'h', text:{ en:'Our expectations', hi:'हमारी अपेक्षाएँ', gu:'અમારી અપેક્ષાઓ' } },
    { t:'ul', items:[
      { en:'Treat every colleague, vendor, and client with courtesy and professionalism, irrespective of designation, gender, religion, caste, region, or background.', hi:'हर सहकर्मी, विक्रेता और ग्राहक के साथ पदनाम, लिंग, धर्म, जाति, क्षेत्र या पृष्ठभूमि की परवाह किए बिना शिष्टाचार और व्यावसायिकता से पेश आएँ।', gu:'દરેક સહકર્મી, વિક્રેતા અને ગ્રાહક સાથે હોદ્દો, લિંગ, ધર્મ, જાતિ, પ્રદેશ કે પૃષ્ઠભૂમિને ધ્યાનમાં લીધા વિના શિષ્ટાચાર અને વ્યાવસાયિકતાથી વર્તો.' },
      { en:'Communicate constructively. Disagreements are normal; disrespect is not.', hi:'रचनात्मक ढंग से संवाद करें। असहमति सामान्य है; अनादर नहीं।', gu:'રચનાત્મક રીતે વાતચીત કરો. મતભેદ સામાન્ય છે; અનાદર નથી.' },
      { en:'Give credit where it is due, and be generous in helping colleagues succeed.', hi:'जहाँ श्रेय बनता है वहाँ श्रेय दें, और सहकर्मियों को सफल होने में मदद करने में उदार रहें।', gu:'જ્યાં શ્રેય મળવો જોઈએ ત્યાં શ્રેય આપો, અને સહકર્મીઓને સફળ થવામાં મદદ કરવામાં ઉદાર બનો.' },
      { en:'Protect confidential company, client, and colleague information at all times (see Section 18).', hi:'कंपनी, ग्राहक और सहकर्मियों की गोपनीय जानकारी को हर समय सुरक्षित रखें (धारा 18 देखें)।', gu:'કંપની, ગ્રાહક અને સહકર્મીઓની ગોપનીય માહિતી હંમેશા સુરક્ષિત રાખો (વિભાગ 18 જુઓ).' },
      { en:'Follow the reporting hierarchy for official matters, while feeling free to escalate genuine concerns through the grievance channel below.', hi:'आधिकारिक मामलों के लिए रिपोर्टिंग पदानुक्रम का पालन करें, साथ ही वास्तविक चिंताओं को नीचे दिए गए शिकायत चैनल के माध्यम से उठाने के लिए स्वतंत्र महसूस करें।', gu:'સત્તાવાર બાબતો માટે રિપોર્ટિંગ પદાનુક્રમનું પાલન કરો, સાથે જ સાચી ચિંતાઓને નીચે આપેલા ફરિયાદ ચેનલ દ્વારા ઉઠાવવા માટે મુક્ત અનુભવો.' },
    ]},
    { t:'h', text:{ en:'Zero tolerance for harassment & discrimination', hi:'उत्पीड़न और भेदभाव के प्रति शून्य सहनशीलता', gu:'સતામણી અને ભેદભાવ સામે શૂન્ય સહનશીલતા' } },
    { t:'p', text:{ en:'SSC has zero tolerance for any form of harassment, bullying, intimidation, or discrimination — including sexual harassment — at the workplace, at company events, or in any work-related communication (including calls, messages, and email).', hi:'SSC कार्यस्थल पर, कंपनी के आयोजनों में, या किसी भी काम से संबंधित संचार (कॉल, संदेश और ईमेल सहित) में किसी भी प्रकार के उत्पीड़न, धमकाने, डराने या भेदभाव — जिसमें यौन उत्पीड़न भी शामिल है — के प्रति शून्य सहनशीलता रखता है।', gu:'SSC કાર્યસ્થળ પર, કંપનીના કાર્યક્રમોમાં, અથવા કામ સંબંધિત કોઈપણ સંચાર (કૉલ, સંદેશ અને ઈમેલ સહિત)માં કોઈપણ પ્રકારની સતામણી, ધમકાવવા, ડરાવવા કે ભેદભાવ — જેમાં જાતીય સતામણી પણ સામેલ છે — સામે શૂન્ય સહનશીલતા રાખે છે.' } },
    { t:'ul', items:[
      { en:'SSC is committed to maintaining a workplace free of sexual harassment in line with the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013. An Internal Committee (IC) will be constituted, and its contact details will be displayed and shared separately by the People & Culture Team.', hi:'SSC कार्यस्थल पर महिलाओं का यौन उत्पीड़न (रोकथाम, प्रतिषेध और निवारण) अधिनियम, 2013 के अनुरूप यौन उत्पीड़न से मुक्त कार्यस्थल बनाए रखने के लिए प्रतिबद्ध है। एक आंतरिक समिति (IC) गठित की जाएगी, और उसके संपर्क विवरण People & Culture टीम द्वारा अलग से प्रदर्शित और साझा किए जाएँगे।', gu:'SSC કાર્યસ્થળે મહિલાઓની જાતીય સતામણી (નિવારણ, પ્રતિબંધ અને નિવારણ) અધિનિયમ, 2013 અનુસાર જાતીય સતામણીથી મુક્ત કાર્યસ્થળ જાળવવા માટે પ્રતિબદ્ધ છે. એક આંતરિક સમિતિ (IC) રચવામાં આવશે, અને તેની સંપર્ક વિગતો People & Culture ટીમ દ્વારા અલગથી પ્રદર્શિત અને શેર કરવામાં આવશે.' },
      { en:'Any employee facing or witnessing harassment or discrimination is encouraged to report it — to their reporting manager, the People & Culture Team, or (for sexual harassment complaints) directly to the Internal Committee.', hi:'उत्पीड़न या भेदभाव का सामना करने वाले या उसे देखने वाले किसी भी कर्मचारी को इसकी सूचना देने के लिए प्रोत्साहित किया जाता है — अपने रिपोर्टिंग मैनेजर को, People & Culture टीम को, या (यौन उत्पीड़न की शिकायतों के लिए) सीधे आंतरिक समिति को।', gu:'સતામણી કે ભેદભાવનો સામનો કરનાર કે તેને જોનાર કોઈપણ કર્મચારીને તેની જાણ કરવા પ્રોત્સાહિત કરવામાં આવે છે — પોતાના રિપોર્ટિંગ મેનેજરને, People & Culture ટીમને, અથવા (જાતીય સતામણીની ફરિયાદો માટે) સીધા આંતરિક સમિતિને.' },
      { en:'Retaliation against anyone who raises a genuine concern in good faith will itself be treated as a disciplinary matter.', hi:'सद्भावना से वास्तविक चिंता उठाने वाले किसी भी व्यक्ति के खिलाफ प्रतिशोध को स्वयं एक अनुशासनात्मक मामला माना जाएगा।', gu:'સદ્ભાવનાથી સાચી ચિંતા ઉઠાવનાર કોઈપણ વ્યક્તિ સામે વેર લેવાને પોતે જ એક શિસ્તભંગની બાબત ગણવામાં આવશે.' },
    ]},
    { t:'h', text:{ en:'Grievance redressal', hi:'शिकायत निवारण', gu:'ફરિયાદ નિવારણ' } },
    { t:'p', text:{ en:'If you have a concern about a policy, a colleague, or your work environment, raise it with your reporting manager first. If the matter involves your manager, or you are not comfortable doing so, you can reach out directly to our designated point of contact for grievance redressal:', hi:'यदि आपको किसी नीति, सहकर्मी, या अपने कार्य वातावरण के बारे में कोई चिंता है, तो पहले इसे अपने रिपोर्टिंग मैनेजर के साथ उठाएँ। यदि मामला आपके मैनेजर से संबंधित है, या आप ऐसा करने में सहज नहीं हैं, तो आप शिकायत निवारण के लिए हमारे नामित संपर्क व्यक्ति से सीधे संपर्क कर सकते हैं:', gu:'જો તમને કોઈ નીતિ, સહકર્મી, કે તમારા કાર્ય વાતાવરણ વિશે કોઈ ચિંતા હોય, તો પહેલા તેને તમારા રિપોર્ટિંગ મેનેજર સાથે ઉઠાવો. જો બાબત તમારા મેનેજરને લગતી હોય, અથવા તમે એમ કરવામાં સહજ ન હો, તો તમે ફરિયાદ નિવારણ માટે અમારા નિયુક્ત સંપર્ક વ્યક્તિનો સીધો સંપર્ક કરી શકો છો:' } },
    { t:'kv', rows:[ [{ en:'Point of Contact', hi:'संपर्क व्यक्ति', gu:'સંપર્ક વ્યક્તિ' }, { en:'Mr. Ankit Dave — Head of Operations — 7486048264', hi:'श्री अंकित दवे — हेड ऑफ ऑपरेशंस — 7486048264', gu:'શ્રી અંકિત દવે — હેડ ઓફ ઓપરેશન્સ — 7486048264' }] ] },
    { t:'p', text:{ en:'All grievances will be treated confidentially to the extent possible.', hi:'सभी शिकायतों को यथासंभव गोपनीय रखा जाएगा।', gu:'બધી ફરિયાદોને શક્ય તેટલી ગોપનીય રાખવામાં આવશે.' } },
  ])},

  // ── PART B ──────────────────────────────────────────────
  { part:'B', n:4, title:{ en:'Attendance, Biometric & Working Hours', hi:'उपस्थिति, बायोमेट्रिक और कार्य के घंटे', gu:'હાજરી, બાયોમેટ્રિક અને કામના કલાકો' }, body:S([
    { t:'h', text:{ en:'Working hours', hi:'कार्य के घंटे', gu:'કામના કલાકો' } },
    { t:'ul', items:[
      { en:'Official office timing is 10:00 AM to 6:30 PM, Monday to Saturday.', hi:'आधिकारिक कार्यालय समय सोमवार से शनिवार, सुबह 10:00 बजे से शाम 6:30 बजे तक है।', gu:'સત્તાવાર ઓફિસ સમય સોમવારથી શનિવાર, સવારે 10:00 થી સાંજે 6:30 છે.' },
      { en:'The 2nd and 4th Saturday of every month is a full holiday — you are not expected in office on these days.', hi:'हर महीने का दूसरा और चौथा शनिवार पूर्ण अवकाश है — इन दिनों आपसे कार्यालय आने की अपेक्षा नहीं है।', gu:'દર મહિનાનો બીજો અને ચોથો શનિવાર પૂર્ણ રજા છે — આ દિવસોમાં તમારે ઓફિસ આવવાની અપેક્ષા નથી.' },
      { en:'Your day is split into two sessions, and each session counts as half a day.', hi:'आपका दिन दो सत्रों में बँटा है, और हर सत्र आधे दिन के रूप में गिना जाता है।', gu:'તમારો દિવસ બે સત્રમાં વહેંચાયેલો છે, અને દરેક સત્ર અડધા દિવસ તરીકે ગણાય છે.' },
    ]},
    { t:'kv', rows:[
      ['Morning Session','10:00 – 2:00 · First half of the day'],
      ['Afternoon Session','2:00 – 6:30 · Second half of the day'],
    ]},
    { t:'h', text:{ en:'Biometric attendance', hi:'बायोमेट्रिक उपस्थिति', gu:'બાયોમેટ્રિક હાજરી' } },
    { t:'ul', items:[
      { en:'Biometric login is compulsory for every employee, both while entering and while leaving office.', hi:'बायोमेट्रिक लॉगिन हर कर्मचारी के लिए अनिवार्य है, कार्यालय में प्रवेश करते समय और निकलते समय दोनों।', gu:'બાયોમેટ્રિક લોગિન દરેક કર્મચારી માટે ફરજિયાત છે, ઓફિસમાં પ્રવેશતી અને નીકળતી વખતે બંને.' },
      { en:'The Sales team, when on field, must punch their attendance from the SSC ERP — People Section instead of the office biometric device.', hi:'सेल्स टीम, फील्ड पर होने पर, कार्यालय बायोमेट्रिक डिवाइस के बजाय SSC ERP — People Section से अपनी उपस्थिति दर्ज करे।', gu:'સેલ્સ ટીમ, ફિલ્ડ પર હોય ત્યારે, ઓફિસ બાયોમેટ્રિક ડિવાઇસને બદલે SSC ERP — People Section થી હાજરી પંચ કરે.' },
      { en:'Forgetting to punch your attendance is treated as your own oversight — it is not, by itself, grounds for regularisation.', hi:'उपस्थिति दर्ज करना भूल जाना आपकी अपनी चूक मानी जाती है — यह अपने आप में नियमितीकरण का आधार नहीं है।', gu:'હાજરી પંચ કરવાનું ભૂલી જવું એ તમારી પોતાની ભૂલ ગણાય છે — તે એકલું નિયમિતીકરણનું કારણ નથી.' },
      { en:'Regularisation is considered only in genuine and emergency circumstances (for example, a biometric device malfunction, or a Company-approved field visit/off-site assignment) — never simply because you forgot to punch.', hi:'नियमितीकरण केवल वास्तविक और आपातकालीन परिस्थितियों में विचारित होता है (उदाहरण के लिए, बायोमेट्रिक डिवाइस की खराबी, या कंपनी-अनुमोदित फील्ड विज़िट/ऑफ-साइट असाइनमेंट) — कभी भी केवल इसलिए नहीं कि आप पंच करना भूल गए।', gu:'નિયમિતીકરણ ફક્ત વાસ્તવિક અને કટોકટીની પરિસ્થિતિમાં જ ધ્યાનમાં લેવાય છે (દા.ત., બાયોમેટ્રિક ડિવાઇસ ખરાબી, અથવા કંપની-મંજૂર ફિલ્ડ વિઝિટ/ઓફ-સાઇટ સોંપણી) — ક્યારેય ફક્ત તમે પંચ કરવાનું ભૂલી ગયા એટલા માટે નહીં.' },
    ]},
    { t:'h', text:{ en:'How your day is marked', hi:'आपका दिन कैसे चिह्नित होता है', gu:'તમારો દિવસ કેવી રીતે ચિહ્નિત થાય છે' } },
    { t:'table', head:['Code','What it means'], rows:[
      ['P', { en:'Present. Both sessions worked. In by 10:00 (grace to 10:15 = marked Late but still a full day). Out by 6:30 PM (grace 6:15) for the afternoon half.', hi:'उपस्थित। दोनों सत्र काम किए। 10:00 तक आगमन (10:15 तक छूट = "लेट" पर भी पूरा दिन)। दोपहर के आधे के लिए 6:30 बजे तक (6:15 तक छूट) प्रस्थान।', gu:'હાજર. બંને સત્ર કામ કર્યું. 10:00 સુધીમાં આગમન (10:15 સુધી છૂટ = "લેટ" પણ પૂરો દિવસ). બપોરના અડધા માટે 6:30 વાગ્યા સુધી (6:15 સુધી છૂટ) પ્રસ્થાન.' }],
      ['½', { en:'Half day. Only one session. In after 10:15 → morning lost. Out before 6:15 → afternoon lost.', hi:'आधा दिन। केवल एक सत्र। 10:15 के बाद आगमन → सुबह गई। 6:15 से पहले प्रस्थान → दोपहर गई।', gu:'અડધો દિવસ. માત્ર એક સત્ર. 10:15 પછી આગમન → સવાર ગઈ. 6:15 પહેલાં પ્રસ્થાન → બપોર ગઈ.' }],
      ['GL', { en:'General Leave — paid. Leave you applied for in advance and got approved. Deducts from your 25 paid leaves a year.', hi:'जनरल लीव — सवैतनिक। पहले से आवेदन कर के स्वीकृत छुट्टी। साल की आपकी 25 सवैतनिक छुट्टियों से कटती है।', gu:'જનરલ લીવ — પગારસહ. અગાઉથી અરજી કરી મંજૂર કરાવેલી રજા. વર્ષની તમારી 25 પગારસહ રજામાંથી કપાય છે.' }],
      ['A', { en:'Absent → LOP. No punch and no approved leave. Counts as Loss of Pay. Always inform HR and apply; in a real emergency you can regularise afterwards.', hi:'अनुपस्थित → LOP। न पंच, न स्वीकृत छुट्टी। Loss of Pay मानी जाती है। हमेशा HR को सूचित कर के आवेदन करें; सच्ची आपात स्थिति में बाद में नियमित कर सकते हैं।', gu:'ગેરહાજર → LOP. ન પંચ, ન મંજૂર રજા. Loss of Pay ગણાય. હંમેશા HR ને જાણ કરી અરજી કરો; સાચી ઈમરજન્સીમાં પછીથી નિયમિત કરી શકો.' }],
      ['LOP', { en:'Loss of Pay — unpaid. Unpaid days deducted from salary — from uninformed absence, unapproved leave, or being on probation/notice. LOP does not touch your paid-leave balance; it is a separate salary deduction.', hi:'Loss of Pay — बिना वेतन। वेतन से कटने वाले बिना-वेतन दिन — बिना सूचना अनुपस्थिति, बिना स्वीकृति छुट्टी, या प्रोबेशन/नोटिस के कारण। LOP आपकी सवैतनिक छुट्टी को नहीं छूता; यह अलग वेतन कटौती है।', gu:'Loss of Pay — પગાર વગર. પગારમાંથી કપાતા પગાર-વગરના દિવસો — જાણ વગરની ગેરહાજરી, મંજૂરી વગરની રજા, અથવા પ્રોબેશન/નોટિસના કારણે. LOP તમારી પગારસહ રજાને અડતું નથી; તે અલગ પગાર કપાત છે.' }],
      ['✓', { en:'Regularise. An absence you justify and get approved becomes Present — no LOP.', hi:'नियमित करें। जिस अनुपस्थिति का कारण देकर आप स्वीकृति पा लेते हैं वह "उपस्थित" बन जाती है — कोई LOP नहीं।', gu:'નિયમિત કરો. જે ગેરહાજરીનું કારણ આપી તમે મંજૂરી મેળવો તે "હાજર" બની જાય — કોઈ LOP નહીં.' }],
    ]},
    { t:'h', text:{ en:'Late arrival', hi:'देर से आगमन', gu:'મોડું આગમન' } },
    { t:'p', text:{ en:'If you arrive after 10:15 AM, a half-day’s leave will be deducted for that day. There is no regularisation for late arrival, regardless of the reason.', hi:'यदि आप सुबह 10:15 के बाद आते हैं, तो उस दिन के लिए आधे दिन की छुट्टी काटी जाएगी। देर से आगमन के लिए कोई नियमितीकरण नहीं है, कारण चाहे जो भी हो।', gu:'જો તમે સવારે 10:15 પછી આવો, તો તે દિવસ માટે અડધા દિવસની રજા કપાશે. મોડા આગમન માટે કોઈ નિયમિતીકરણ નથી, કારણ ગમે તે હોય.' } },
    { t:'h', text:{ en:'Regularisation & applying — SSC ERP, People Section' } },
    { t:'ul', items:[
      { en:'Use the SSC ERP — People Section to apply for leave and to raise attendance regularisations.' },
      { en:'It is the employee’s responsibility to ensure any regularisation is approved on the same day.' },
    ]},
    { t:'h', text:{ en:'Work from home' } },
    { t:'p', text:{ en:'SSC does not have a work-from-home policy. Attendance is in person at your assigned office, except for Company-approved field visits or off-site assignments.' } },
    { t:'h', text:{ en:'Excessive absenteeism & lateness' } },
    { t:'ul', items:[
      { en:'Repeated or excessive absence or lateness may lead to disciplinary action, up to and including termination of employment.' },
      { en:'If you are absent for 3 consecutive days without informing your manager or the People & Culture Team, the Company will treat this as voluntary abandonment of your position (deemed resignation), subject to applicable law.' },
    ]},
    { t:'callout', kind:'warn', title:{ en:'Your responsibilities — three things only you can do' }, items:[
      { en:'Get your leave approved in the SSC ERP — People Section before you go on leave.' },
      { en:'Get any attendance regularisation approved on the same day.' },
      { en:'Submit your expenses regularly — by the end of each month.' },
    ], foot:{ en:'If any of these is missed, the HR department / Company shall not be responsible for it, and necessary actions or decisions may be taken accordingly — which the employee shall have to agree to.' } },
    { t:'callout', kind:'warn', title:{ en:'Probation & notice period' }, text:{ en:'During your first 3 months (probation) and while serving notice, every leave or absence is LOP — no paid leave applies.' } },
    { t:'callout', kind:'faq', items:[
      { q:{ en:'I was in office all day but forgot to punch — can this be corrected?' }, a:{ en:'No. Registering your attendance is your own responsibility. Forgetting to punch is not treated as a genuine or emergency case, so it will not be regularised.' } },
      { q:{ en:'I reached office at 10:20 AM — what happens to my day?' }, a:{ en:'You are marked Late but still get a full day, provided you complete both sessions. Only if you arrive after the morning session or leave before 6:15 PM is a half-day deducted.' } },
      { q:{ en:'I’m in Sales and was on a client site all day — how do I mark attendance?' }, a:{ en:'Punch your attendance from the SSC ERP — People Section while on field.' } },
    ]},
  ])},

  { part:'B', n:5, title:{ en:'Dress Code', hi:'ड्रेस कोड', gu:'ડ્રેસ કોડ' }, body:S([
    { t:'ul', items:[
      { en:'Employees must wear the official SSC dress/uniform issued to them.' },
      { en:'Employees who have not yet received their official SSC dress should wear professional attire suitable for a client-facing workplace, until it is issued.' },
      { en:'The SSC-branded T-shirt is issued only after an employee has successfully completed their probation period (i.e., upon confirmation).' },
    ]},
    { t:'callout', kind:'faq', items:[
      { q:{ en:'I haven’t received my SSC dress yet — what should I wear?' }, a:{ en:'Professional attire, until Admin/the People & Culture Team issues your official SSC dress.' } },
      { q:{ en:'When do I get my SSC T-shirt?' }, a:{ en:'On successful completion of your probation period and confirmation — see Section 15.' } },
    ]},
  ])},

  { part:'B', n:6, title:{ en:'Leave Policy', hi:'छुट्टी नीति', gu:'રજા નીતિ' }, body:S([
    { t:'p', text:{ en:'All employees are eligible for 25 paid General Leaves in each financial year. SSC keeps leave simple — there is a single leave type, General Leave (GL), which you may use for any genuine need: personal work, a family matter, illness, or an unplanned emergency. Leave is a benefit — please plan and apply for it responsibly.', hi:'सभी कर्मचारी हर वित्तीय वर्ष में 25 सवैतनिक जनरल लीव के पात्र हैं। SSC छुट्टी को सरल रखता है — एक ही प्रकार की छुट्टी, जनरल लीव (GL), जिसे आप किसी भी वास्तविक ज़रूरत के लिए उपयोग कर सकते हैं: व्यक्तिगत काम, पारिवारिक मामला, बीमारी, या अनियोजित आपात स्थिति। छुट्टी एक लाभ है — कृपया इसे ज़िम्मेदारी से योजना बनाकर लें।', gu:'બધા કર્મચારીઓ દરેક નાણાકીય વર્ષમાં 25 પગારસહ જનરલ લીવ માટે પાત્ર છે. SSC રજાને સરળ રાખે છે — એક જ પ્રકારની રજા, જનરલ લીવ (GL), જે તમે કોઈપણ સાચી જરૂરિયાત માટે વાપરી શકો: અંગત કામ, કૌટુંબિક બાબત, બીમારી, અથવા અણધારી ઈમરજન્સી. રજા એક લાભ છે — કૃપા કરીને જવાબદારીપૂર્વક આયોજન કરી અરજી કરો.' } },
    { t:'h', text:{ en:'Apply & get approval — every time', hi:'आवेदन करें और मंज़ूरी लें — हर बार', gu:'અરજી કરો અને મંજૂરી લો — દર વખતે' } },
    { t:'ul', items:[
      { en:'All leave must be applied for and logged in the SSC ERP — People Section before you go on leave.', hi:'सभी छुट्टियों के लिए छुट्टी पर जाने से पहले SSC ERP — People Section में आवेदन कर के दर्ज करना अनिवार्य है।', gu:'બધી રજા માટે રજા પર જતાં પહેલાં SSC ERP — People Section માં અરજી કરી નોંધવી ફરજિયાત છે.' },
      { en:'Your leave must show as Approved by your reporting manager in the ERP — a verbal, phone, or WhatsApp “ok” is not, by itself, a valid record.', hi:'आपकी छुट्टी ERP में आपके रिपोर्टिंग मैनेजर द्वारा "Approved" दिखनी चाहिए — मौखिक, फ़ोन या WhatsApp की "ok" अपने आप में मान्य रिकॉर्ड नहीं है।', gu:'તમારી રજા ERP માં તમારા રિપોર્ટિંગ મેનેજર દ્વારા "Approved" દેખાવી જોઈએ — મૌખિક, ફોન કે WhatsApp ની "ok" એકલી માન્ય રેકોર્ડ નથી.' },
      { en:'If you take leave without a corresponding approved ERP entry, it is treated as Loss of Pay (LOP) when your salary days are calculated for that month.', hi:'यदि आप संबंधित स्वीकृत ERP प्रविष्टि के बिना छुट्टी लेते हैं, तो उस महीने के वेतन दिनों की गणना में इसे Loss of Pay (LOP) माना जाता है।', gu:'જો તમે સંબંધિત મંજૂર ERP એન્ટ્રી વગર રજા લો, તો તે મહિનાના પગાર દિવસોની ગણતરીમાં તેને Loss of Pay (LOP) ગણવામાં આવે છે.' },
      { en:'Submit and get leave approved well before month-end, ahead of salary processing — entries logged after the payroll cut-off may not reflect in that month’s salary.', hi:'वेतन प्रसंस्करण से पहले, महीने के अंत से काफ़ी पहले छुट्टी जमा कर के मंज़ूर करवाएँ — पेरोल कट-ऑफ के बाद दर्ज प्रविष्टियाँ उस महीने के वेतन में नहीं दिख सकतीं।', gu:'પગાર પ્રક્રિયા પહેલાં, મહિનાના અંત પહેલાં સારી રીતે રજા સબમિટ કરી મંજૂર કરાવો — પેરોલ કટ-ઓફ પછી નોંધાયેલી એન્ટ્રી તે મહિનાના પગારમાં ન દેખાય.' },
    ]},
    { t:'h', text:{ en:'How General Leave works', hi:'जनरल लीव कैसे काम करती है', gu:'જનરલ લીવ કેવી રીતે કામ કરે છે' } },
    { t:'p', text:{ en:'General Leave covers everything — whether planned well ahead, or needed at short notice for an emergency. The notice you should give depends on the situation:', hi:'जनरल लीव सब कुछ कवर करती है — चाहे पहले से योजना बनाई हो, या आपात स्थिति में कम सूचना पर चाहिए हो। आपको कितनी सूचना देनी चाहिए यह स्थिति पर निर्भर करता है:', gu:'જનરલ લીવ બધું આવરી લે છે — ભલે અગાઉથી આયોજન કર્યું હોય, કે ઈમરજન્સીમાં ટૂંકી સૂચનાએ જોઈએ. તમારે કેટલી સૂચના આપવી જોઈએ તે પરિસ્થિતિ પર આધાર રાખે છે:' } },
    { t:'table', head:['Situation','Notice Required'], rows:[
      [{ en:'Leave of 3 or more consecutive days', hi:'3 या अधिक लगातार दिनों की छुट्टी', gu:'3 કે વધુ સળંગ દિવસોની રજા' },{ en:'At least 1 week in advance', hi:'कम से कम 1 सप्ताह पहले', gu:'ઓછામાં ઓછું 1 અઠવાડિયું અગાઉ' }],
      [{ en:'Short leave (up to 2 days)', hi:'छोटी छुट्टी (2 दिनों तक)', gu:'ટૂંકી રજા (2 દિવસ સુધી)' },{ en:'At least 1 day in advance', hi:'कम से कम 1 दिन पहले', gu:'ઓછામાં ઓછું 1 દિવસ અગાઉ' }],
      [{ en:'Genuine emergency', hi:'सच्ची आपात स्थिति', gu:'સાચી ઈમરજન્સી' },{ en:'Inform at least 1 hour before office timing, then apply the same day', hi:'कार्यालय समय से कम से कम 1 घंटे पहले सूचित करें, फिर उसी दिन आवेदन करें', gu:'ઓફિસ સમયના ઓછામાં ઓછા 1 કલાક પહેલાં જાણ કરો, પછી તે જ દિવસે અરજી કરો' }],
    ]},
    { t:'p', text:{ en:'Illness: if your leave is on account of illness and runs beyond 2 days, submit a medical certificate to your manager and the People & Culture Team.', hi:'बीमारी: यदि आपकी छुट्टी बीमारी के कारण है और 2 दिनों से अधिक चलती है, तो अपने मैनेजर और People & Culture Team को मेडिकल सर्टिफिकेट जमा करें।', gu:'બીમારી: જો તમારી રજા બીમારીના કારણે હોય અને 2 દિવસથી વધુ ચાલે, તો તમારા મેનેજર અને People & Culture Team ને મેડિકલ સર્ટિફિકેટ સબમિટ કરો.' } },
    { t:'h', text:{ en:'Sandwich Rule', hi:'सैंडविच नियम', gu:'સેન્ડવિચ નિયમ' } },
    { t:'p', text:{ en:'The “sandwich” rule applies when you take leave on the last working day before a weekly-off/holiday and on the first working day after it. In that case the weekly-off/holiday in between is not treated as a free day — it is also debited from your leave balance, since taking leave on both sides effectively extends it into a longer break.', hi:'"सैंडविच" नियम तब लागू होता है जब आप किसी साप्ताहिक-अवकाश/छुट्टी से पहले के अंतिम कार्यदिवस पर और उसके बाद के पहले कार्यदिवस पर छुट्टी लेते हैं। ऐसी स्थिति में बीच का साप्ताहिक-अवकाश/छुट्टी मुफ़्त दिन नहीं मानी जाती — वह भी आपके छुट्टी बैलेंस से काटी जाती है, क्योंकि दोनों ओर छुट्टी लेना उसे लंबे ब्रेक में बदल देता है।', gu:'"સેન્ડવિચ" નિયમ ત્યારે લાગુ પડે છે જ્યારે તમે સાપ્તાહિક-રજા/રજા પહેલાંના છેલ્લા કામકાજના દિવસે અને તેના પછીના પહેલા કામકાજના દિવસે રજા લો. તેવા કિસ્સામાં વચ્ચેની સાપ્તાહિક-રજા/રજા મફત દિવસ ગણાતી નથી — તે પણ તમારા રજા બેલેન્સમાંથી કપાય છે, કારણ કે બંને બાજુ રજા લેવાથી તે લાંબા બ્રેકમાં ફેરવાય છે.' } },
    { t:'table', head:['Day','What You Do','Leave Debited'], rows:[
      [{ en:'Saturday', hi:'शनिवार', gu:'શનિવાર' },{ en:'Work first half, on leave second half', hi:'पहला आधा काम, दूसरा आधा छुट्टी', gu:'પહેલો અડધો કામ, બીજો અડધો રજા' },{ en:'Half day', hi:'आधा दिन', gu:'અડધો દિવસ' }],
      [{ en:'Sunday (weekly-off)', hi:'रविवार (साप्ताहिक-अवकाश)', gu:'રવિવાર (સાપ્તાહિક-રજા)' },{ en:'Normally a holiday — but sandwiched between two leave days', hi:'सामान्यतः छुट्टी — पर दो छुट्टी के दिनों के बीच', gu:'સામાન્ય રીતે રજા — પણ બે રજાના દિવસો વચ્ચે' },{ en:'Full day (sandwiched)', hi:'पूरा दिन (सैंडविच)', gu:'પૂરો દિવસ (સેન્ડવિચ)' }],
      [{ en:'Monday', hi:'सोमवार', gu:'સોમવાર' },{ en:'On leave first half, work second half', hi:'पहला आधा छुट्टी, दूसरा आधा काम', gu:'પહેલો અડધો રજા, બીજો અડધો કામ' },{ en:'Half day', hi:'आधा दिन', gu:'અડધો દિવસ' }],
    ]},
    { t:'p', text:{ en:'Total leave debited in this example: 2 days (half + full + half). The same principle applies around any holiday, not just Sunday.', hi:'इस उदाहरण में कुल कटी छुट्टी: 2 दिन (आधा + पूरा + आधा)। यही सिद्धांत किसी भी छुट्टी के आसपास लागू होता है, केवल रविवार नहीं।', gu:'આ ઉદાહરણમાં કુલ કપાયેલી રજા: 2 દિવસ (અડધો + પૂરો + અડધો). આ જ સિદ્ધાંત કોઈપણ રજાની આસપાસ લાગુ પડે છે, ફક્ત રવિવાર નહીં.' } },
    { t:'h', text:{ en:'Club Leave', hi:'क्लब लीव', gu:'ક્લબ લીવ' } },
    { t:'p', text:{ en:'You may combine a leave day with an adjoining holiday to form a longer break. Example: if Friday is a holiday and Saturday is a working day, taking leave on Saturday effectively creates a 3-day break (Friday holiday + Saturday leave + Sunday weekly-off).', hi:'आप एक छुट्टी के दिन को किसी सटी हुई छुट्टी के साथ जोड़कर लंबा ब्रेक बना सकते हैं। उदाहरण: यदि शुक्रवार छुट्टी है और शनिवार कार्यदिवस है, तो शनिवार को छुट्टी लेने से 3-दिन का ब्रेक बनता है (शुक्रवार छुट्टी + शनिवार छुट्टी + रविवार साप्ताहिक-अवकाश)।', gu:'તમે એક રજાના દિવસને અડીને આવેલી રજા સાથે જોડીને લાંબો બ્રેક બનાવી શકો. ઉદાહરણ: જો શુક્રવાર રજા હોય અને શનિવાર કામકાજનો દિવસ હોય, તો શનિવારે રજા લેવાથી 3-દિવસનો બ્રેક બને છે (શુક્રવાર રજા + શનિવાર રજા + રવિવાર સાપ્તાહિક-રજા).' } },
    { t:'h', text:{ en:'General leave rules', hi:'सामान्य छुट्टी नियम', gu:'સામાન્ય રજા નિયમો' } },
    { t:'ul', items:[
      { en:'Employees on probation or serving their notice period are not permitted paid leave — any absence in these periods is LOP.', hi:'प्रोबेशन पर या नोटिस अवधि में कर्मचारियों को सवैतनिक छुट्टी की अनुमति नहीं है — इन अवधियों में कोई भी अनुपस्थिति LOP है।', gu:'પ્રોબેશન પર કે નોટિસ સમયગાળામાં કર્મચારીઓને પગારસહ રજાની મંજૂરી નથી — આ સમયગાળામાં કોઈપણ ગેરહાજરી LOP છે.' },
      { en:'Before planning leave, discuss it with your department. If a colleague on the same team is already approved for overlapping dates, your leave may not be approved, or may be treated as LOP, depending on business need.', hi:'छुट्टी की योजना बनाने से पहले अपने विभाग से चर्चा करें। यदि उसी टीम के किसी सहकर्मी की ओवरलैपिंग तारीखों के लिए पहले से मंज़ूरी है, तो व्यावसायिक ज़रूरत के अनुसार आपकी छुट्टी मंज़ूर न हो, या LOP मानी जा सकती है।', gu:'રજાનું આયોજન કરતાં પહેલાં તમારા વિભાગ સાથે ચર્ચા કરો. જો એ જ ટીમના સહકર્મીની ઓવરલેપિંગ તારીખો માટે અગાઉથી મંજૂરી હોય, તો વ્યવસાયિક જરૂરિયાત મુજબ તમારી રજા મંજૂર ન થાય, કે LOP ગણાય.' },
      { en:'A maximum of 5 leave days can be carried forward to the next financial year; any balance beyond 5 days lapses at year-end.', hi:'अधिकतम 5 छुट्टी के दिन अगले वित्तीय वर्ष में आगे ले जाए जा सकते हैं; 5 दिनों से अधिक कोई भी बैलेंस वर्ष के अंत में समाप्त हो जाता है।', gu:'મહત્તમ 5 રજાના દિવસો આગલા નાણાકીય વર્ષમાં કેરી ફોરવર્ડ કરી શકાય; 5 દિવસથી વધુ કોઈપણ બેલેન્સ વર્ષના અંતે લેપ્સ થાય છે.' },
      { en:'Alternatively, you may choose to encash (take a payout for) your remaining leave balance as on 31st March, in line with payroll rules.', hi:'वैकल्पिक रूप से, आप पेरोल नियमों के अनुसार 31 मार्च तक अपने शेष छुट्टी बैलेंस को एनकैश (भुगतान के रूप में) करना चुन सकते हैं।', gu:'વૈકલ્પિક રીતે, તમે પેરોલ નિયમો મુજબ 31 માર્ચ સુધીના તમારા બાકી રજા બેલેન્સને એન્કેશ (ચૂકવણી તરીકે) કરવાનું પસંદ કરી શકો.' },
      { en:'You are welcome to take a day of leave for a personal occasion such as your birthday, subject to the usual approval and notice. On your birthday, you may also leave early at 5:00 PM.', hi:'आप अपने जन्मदिन जैसे व्यक्तिगत अवसर के लिए एक दिन की छुट्टी ले सकते हैं, सामान्य मंज़ूरी और सूचना के अधीन। अपने जन्मदिन पर आप शाम 5:00 बजे जल्दी भी जा सकते हैं।', gu:'તમે તમારા જન્મદિવસ જેવા અંગત પ્રસંગ માટે એક દિવસની રજા લઈ શકો, સામાન્ય મંજૂરી અને સૂચનાને આધીન. તમારા જન્મદિવસે તમે સાંજે 5:00 વાગ્યે વહેલા પણ જઈ શકો.' },
      { en:'Please avoid planning holidays during the Company’s financial year-end (March).', hi:'कृपया कंपनी के वित्तीय वर्ष के अंत (मार्च) के दौरान छुट्टियों की योजना बनाने से बचें।', gu:'કૃપા કરીને કંપનીના નાણાકીય વર્ષના અંત (માર્ચ) દરમિયાન રજાઓનું આયોજન કરવાનું ટાળો.' },
    ]},
    { t:'h', text:{ en:'List of Holidays — FY 2026–27', hi:'छुट्टियों की सूची — वित्तीय वर्ष 2026–27', gu:'રજાઓની યાદી — નાણાકીય વર્ષ 2026–27' } },
    { t:'p', text:{ en:'The following are the Company-declared holidays for the financial year 2026–27. These are in addition to the 2nd and 4th Saturday and weekly-off holidays. The list may be revised by the People & Culture Team; any changes will be communicated in advance.', hi:'निम्नलिखित वित्तीय वर्ष 2026–27 के लिए कंपनी-घोषित छुट्टियाँ हैं। ये दूसरे और चौथे शनिवार तथा साप्ताहिक-अवकाश के अतिरिक्त हैं। सूची में People & Culture Team द्वारा संशोधन हो सकता है; किसी भी बदलाव की सूचना पहले से दी जाएगी।', gu:'નીચે નાણાકીય વર્ષ 2026–27 માટે કંપની-જાહેર કરેલી રજાઓ છે. આ બીજા અને ચોથા શનિવાર તથા સાપ્તાહિક-રજા ઉપરાંત છે. યાદીમાં People & Culture Team દ્વારા સુધારો થઈ શકે; કોઈપણ ફેરફારની જાણ અગાઉથી કરવામાં આવશે.' } },
    { t:'table', head:['Date','Day','Occasion'], rows:[
      ['23 Apr 2026','Thursday','Company Foundation Day'],
      ['15 Aug 2026','Saturday','Independence Day'],
      ['28 Aug 2026','Friday','Raksha Bandhan'],
      ['04 Sep 2026','Friday','Janmashtami'],
      ['02 Oct 2026','Friday','Gandhi Jayanti'],
      ['21 Oct 2026','Wednesday','Vijayadashmi'],
      ['08 Nov 2026','Sunday','Diwali'],
      ['09 Nov 2026','Monday','Diwali'],
      ['10 Nov 2026','Tuesday','Diwali'],
      ['11 Nov 2026','Wednesday','Diwali'],
      ['12 Nov 2026','Thursday','Diwali'],
    ]},
    { t:'callout', kind:'faq', items:[
      { q:{ en:'I told my manager verbally that I’m taking leave tomorrow — is that enough?' }, a:{ en:'No. It must be logged and approved in the SSC ERP — People Section. Verbal or chat approval alone will not prevent it from being marked LOP.' } },
      { q:{ en:'I forgot to apply for leave in the ERP before month-end — what happens to my salary?' }, a:{ en:'If there is no approved ERP record for those days by the payroll cut-off, they will be treated as Loss of Pay for that month.' } },
      { q:{ en:'Does unused leave carry forward to next year?' }, a:{ en:'Up to 5 days carry forward; any balance beyond that lapses. You may instead encash your remaining balance on 31st March.' } },
    ]},
  ])},

  { part:'B', n:7, title:{ en:'Maternity & Paternity Policy', hi:'मातृत्व और पितृत्व नीति', gu:'માતૃત્વ અને પિતૃત્વ નીતિ' }, body:S([
    { t:'h', text:{ en:'Paternity leave' } },
    { t:'ul', items:[
      { en:'7 days of paternity leave is provided around the due date of delivery.' },
      { en:'Applicable to all employees, whether on probation or confirmed/permanent.' },
    ]},
    { t:'h', text:{ en:'Maternity leave' } },
    { t:'ul', items:[
      { en:'Available to female employees, in line with the Maternity Benefit Act, 1961 (as amended in 2017).' },
      { en:'Before proceeding on maternity leave, the employee must inform the Company whether she intends to continue working with SSC after her leave.' },
    ]},
    { t:'h', text:{ en:'If planning to continue' } },
    { t:'ul', items:[
      { en:'26 weeks of maternity leave is granted, with basic salary paid for this period.' },
      { en:'For the 6 months immediately following the 26-week maternity leave, the employee will not be paid (leave without pay) — this is an additional window offered by SSC beyond the statutory minimum, not a legal requirement.' },
      { en:'If the employee voluntarily chooses to work during this additional 6-month window, she will be paid as per her last drawn monthly salary.' },
    ]},
    { t:'h', text:{ en:'If planning to re-join, but ultimately unable to' } },
    { t:'p', text:{ en:'If an employee had indicated she would continue but is subsequently unable to re-join, the salary paid during the 26-week maternity leave will be adjusted against her Full and Final Settlement.' } },
    { t:'h', text:{ en:'If she chooses not to continue' } },
    { t:'p', text:{ en:'If an employee decides, during her 8th or 9th month of pregnancy, that she does not wish to continue with SSC after her maternity leave, she may tender her resignation, with that month treated as her last working month, following the standard resignation process in Section 17. This is the employee’s own choice — SSC does not terminate an employee’s employment on account of pregnancy or maternity leave.' } },
    { t:'callout', kind:'faq', items:[
      { q:{ en:'Do I need to have completed probation to be eligible for maternity leave?' }, a:{ en:'Eligibility depends on having worked at least 80 days in the preceding 12 months, not on confirmation status. Speak with the People & Culture Team to confirm how this applies to your situation.' } },
      { q:{ en:'Can SSC ask me to leave because I am pregnant?' }, a:{ en:'No. Indian law prohibits dismissal during pregnancy or maternity leave. Any decision to not continue is entirely the employee’s own choice.' } },
    ]},
  ])},

  // ── PART C ──────────────────────────────────────────────
  { part:'C', n:8, title:{ en:'Travel & Reimbursement Policy', hi:'यात्रा और प्रतिपूर्ति नीति', gu:'મુસાફરી અને વળતર નીતિ' }, body:S([
    { t:'h', text:{ en:'Purpose & scope' } },
    { t:'p', text:{ en:'This policy governs company-related business travel — defined as a business trip to a city other than the one you are based in (except for the 40-km-radius rule below). It does not cover your daily commute to and from the office.' } },
    { t:'ul', items:[
      { en:'A trip within a 40-km radius of your base city is treated under local/day-travel rules, not outstation travel.' },
      { en:'Employees may need to travel to meet clients or partners, attend conferences/events representing SSC, or visit other company offices.' },
    ]},
    { t:'h', text:{ en:'General principle' } },
    { t:'p', text:{ en:'SSC reimburses employees for expenses that are necessary, reasonable, and actually incurred while on authorized company business. Please spend the Company’s money as carefully as you would your own, and always collect receipts.' } },
    { t:'h', text:{ en:'Transportation' } },
    { t:'ul', items:[
      { en:'Employees are entitled to company-paid Train/Bus tickets for outstation travel.' },
      { en:'Travel must be booked at least two weeks in advance, unless the trip is genuinely unforeseen.' },
      { en:'Written approval (or an approval email) from your reporting manager is required before booking.' },
      { en:'If you book transportation yourself (for instance, to collect personal loyalty/reward points), you must still get your manager’s approval on the fare, and it must not be more expensive than the standard option.' },
    ]},
    { t:'table', head:['Designation','Outstation Travel (₹/KM)','Local Conveyance (₹/KM)','Bus/Train Class (Outside Gujarat)'], rows:[
      ['Sales Engineer','2.5','5','Sleeper'],
      ['Sr. Sales Engineer','3','5','Sleeper'],
      ['Assistant Manager','3.5','5.5','3-Tier AC'],
      ['Manager','4','5.5','3-Tier AC'],
      ['Sr. Manager','4.5','6','3-Tier AC'],
    ]},
    { t:'callout', kind:'note', text:{ en:'Distance is calculated between the two cities as per Google Maps, not from the employee’s personal residence.' } },
    { t:'h', text:{ en:'Accommodation' } },
    { t:'ul', items:[
      { en:'Employees may stay at a hotel available in the area of travel; prior approval from the reporting manager is required.' },
      { en:'The Company may have negotiated corporate discount rates with specific hotels — check with Admin/the People & Culture Team before booking.' },
    ]},
    { t:'table', head:['Designation','Hotel — In Gujarat (per day)','Hotel — Outside Gujarat (per day)'], rows:[
      ['Sales Engineer','₹1,000 – 1,200','₹1,200 – 1,500'],
      ['Sr. Sales Engineer','₹1,000 – 1,200','₹1,200 – 1,500'],
      ['Assistant Manager','₹1,200 – 1,500','₹1,500 – 2,000'],
      ['Manager','₹1,200 – 1,500','₹1,500 – 2,000'],
      ['Sr. Manager','₹1,500 – 1,800','₹2,000 – 2,500'],
    ]},
    { t:'h', text:{ en:'Local transportation while travelling' } },
    { t:'p', text:{ en:'Public transport/auto-rickshaw fares are reimbursed (against receipts) for travel between the railway/bus station and your hotel, and between your hotel and any place you visit for company purposes. Fares for personal trips are not reimbursed.' } },
    { t:'h', text:{ en:'Food & daily allowance' } },
    { t:'table', head:['Meal','Amount (Self)'], rows:[ ['Lunch','₹300'], ['Dinner','₹500'] ]},
    { t:'ul', items:[
      { en:'Daily allowance applies only for trips involving a night stay, and covers food, non-alcoholic drinks, and other necessities.' },
      { en:'For a one-day trip (no night stay), a food allowance of ₹500 is provided; the Company will additionally arrange a single meal for day travelers.' },
      { en:'For client meals (e.g., a client dinner), the full bill is reimbursed. The most senior employee at the meeting should pay and claim reimbursement, with prior manager approval, and the bill should not exceed the applicable per-person limit.' },
    ]},
    { t:'h', text:{ en:'Claiming reimbursement — through the SSC ERP system' } },
    { t:'ul', items:[
      { en:'Every employee must log their expenses in the SSC ERP system — this is the only channel for reimbursement claims.' },
      { en:'Attach clear, legible copies of bills/receipts as proof for each expense entered; claims without a valid bill or receipt will not be reimbursed.' },
      { en:'Specify a clear reason/justification for each expense line in the ERP — vague or missing justifications will delay approval.' },
      { en:'Select the correct expense category in the ERP (transportation, accommodation, food, local conveyance, etc.) — do not club unrelated expenses under the wrong head.' },
      { en:'Double-check amounts before submitting. Incorrect entries slow down approval and may require you to resubmit.' },
      { en:'Do not wait to submit your reimbursement — submit within 15 days of returning from your trip, and in any case by the 30th of the month, so your claim can be picked up in that cycle.' },
      { en:'Sanctioning authority for both in-Gujarat and outside-Gujarat travel is your Reporting Manager and Department Head.' },
    ]},
    { t:'callout', kind:'faq', items:[
      { q:{ en:'Where do I submit my travel expenses?' }, a:{ en:'In the SSC ERP system only — log each expense with the correct category, a clear reason, and a copy of the bill.' } },
      { q:{ en:'What if I miss the 30th cut-off?' }, a:{ en:'Talk to your reporting manager as soon as possible. Late claims may still be processed at management’s discretion, but try not to make this a habit.' } },
      { q:{ en:'I entered the wrong amount in ERP — what now?' }, a:{ en:'Correct it immediately, or flag it to Finance/Admin. Incorrect entries can delay your reimbursement.' } },
      { q:{ en:'Will I be reimbursed without a bill?' }, a:{ en:'No. Reimbursement is strictly against valid receipts/bills uploaded in the ERP.' } },
    ]},
  ])},

  { part:'C', n:9, title:{ en:'Company SIM Card Policy', hi:'कंपनी सिम कार्ड नीति', gu:'કંપની સિમ કાર્ડ નીતિ' }, body:S([
    { t:'p', text:{ en:'Certain roles are issued a company SIM card to facilitate work-related communication.' } },
    { t:'ul', items:[
      { en:'The SIM card is company property and is meant strictly for business use — work-related calls, messages, and data.' },
      { en:'Personal usage should be kept to a minimum and must not result in additional charges to the Company.' },
      { en:'On receiving a SIM card, employees will be asked to confirm receipt in writing, noting the mobile number and effective date.' },
      { en:'The SIM card, along with any outstanding dues cleared, must be returned to Admin/the People & Culture Team upon separation from the Company.' },
    ]},
  ])},

  { part:'C', n:10, title:{ en:'Laptop / Desktop Usage Policy', hi:'लैपटॉप / डेस्कटॉप उपयोग नीति', gu:'લેપટોપ / ડેસ્કટોપ વપરાશ નીતિ' }, body:S([
    { t:'p', text:{ en:'Where a laptop or desktop is issued for your role, it remains the property of SSC at all times and is provided solely to help you perform your job.' } },
    { t:'h', text:{ en:'Responsible use' } },
    { t:'ul', items:[
      { en:'Use the device primarily for official work. Reasonable, incidental personal use (e.g., checking personal email) is fine, but the device must never be used for illegal activity, or to view, store, or share offensive, obscene, or unlicensed content.' },
      { en:'Do not install unlicensed or pirated software. If you need a tool or license for work, request it through IT/Admin.' },
      { en:'Do not share your company device with family members, friends, or anyone outside the Company.' },
    ]},
    { t:'h', text:{ en:'Security' } },
    { t:'ul', items:[
      { en:'Set a strong password/PIN on your device and lock it whenever you step away from your desk.' },
      { en:'Keep your operating system, antivirus, and security patches up to date; do not disable antivirus or firewall settings.' },
      { en:'Do not connect unknown or unauthorized external drives/USB devices to your company system.' },
      { en:'Report a lost, stolen, or damaged device to IT/Admin and the People & Culture Team immediately — delays can put company and client data at risk.' },
    ]},
    { t:'h', text:{ en:'Care & return' } },
    { t:'ul', items:[
      { en:'Handle the device with reasonable care. Cost of damage arising from negligence or misuse may be recovered from the employee, at the Company’s discretion.' },
      { en:'On resignation, termination, or long leave, the device (along with charger and accessories) must be returned to IT/Admin in good working condition, allowing for normal wear and tear.' },
    ]},
    { t:'dodont', do:[ 'Lock your screen every time you step away', 'Report a lost/damaged device the same day', 'Keep antivirus and OS updates on' ], dont:[ 'Don’t install pirated or unlicensed software', 'Don’t share your device outside the Company', 'Don’t copy confidential data to personal storage' ] },
    { t:'callout', kind:'faq', items:[
      { q:{ en:'My laptop stopped working — who do I contact?' }, a:{ en:'Reach out to IT/Admin right away, and copy the People & Culture Team if it’s likely to affect your work for more than a day.' } },
      { q:{ en:'Can I let a family member use my work laptop briefly?' }, a:{ en:'No — company devices should not be shared with anyone outside SSC, even briefly.' } },
    ]},
  ])},

  { part:'C', n:11, title:{ en:'Landline / Office Telephone Usage Policy', hi:'लैंडलाइन / कार्यालय टेलीफोन उपयोग नीति', gu:'લેન્ડલાઇન / ઓફિસ ટેલિફોન વપરાશ નીતિ' }, body:S([
    { t:'ul', items:[
      { en:'Office landlines are provided for official business communication — speaking with clients, vendors, and colleagues at other locations.' },
      { en:'STD/ISD calls should be kept work-related; where an extended personal STD/ISD call is unavoidable, please seek your manager’s approval in advance.' },
      { en:'Personal local calls should be brief and infrequent, and should not disrupt work or tie up lines needed for business calls.' },
      { en:'Please answer and represent the Company professionally on all calls, and take clear messages for colleagues who are unavailable.' },
      { en:'Report any fault, disconnection, or billing concern with the landline to Admin promptly.' },
    ]},
  ])},

  { part:'C', n:12, title:{ en:'Printer & Stationery Usage Policy', hi:'प्रिंटर और स्टेशनरी उपयोग नीति', gu:'પ્રિન્ટર અને સ્ટેશનરી વપરાશ નીતિ' }, body:S([
    { t:'ul', items:[
      { en:'Printers are provided for official documentation, client deliverables, and business needs — please avoid printing personal documents.' },
      { en:'Default to black-and-white and double-sided printing for internal drafts; use color printing only when necessary (e.g., client presentations, designs).' },
      { en:'Do not leave confidential or sensitive documents unattended at the printer/scanner — collect your prints promptly.' },
      { en:'Report paper jams, low toner, or other issues to Admin rather than attempting repairs yourself.' },
      { en:'Wherever possible, prefer digital sharing (email, shared drives) over printing, to reduce paper and cost.' },
    ]},
  ])},

  // ── PART D ──────────────────────────────────────────────
  { part:'D', n:13, title:{ en:'Office Cleanliness & Hygiene Policy', hi:'कार्यालय स्वच्छता और साफ-सफाई नीति', gu:'ઓફિસ સ્વચ્છતા અને હાઇજીન નીતિ' }, body:S([
    { t:'h', text:{ en:'Your workstation' } },
    { t:'ul', items:[
      { en:'Keep your desk, drawers, and immediate work area clean, organized, and free of clutter.' },
      { en:'Clear your desk of food wrappers, cups, and waste at the end of each day.' },
      { en:'Avoid eating strong-smelling food at your desk; use the pantry/designated dining area for meals.' },
    ]},
    { t:'h', text:{ en:'Shared & common areas' } },
    { t:'ul', items:[
      { en:'Leave meeting rooms, the pantry, and washrooms as you would want to find them — clean and tidy for the next person.' },
      { en:'Dispose of waste in the designated bins, and segregate waste (dry/wet, recyclable) where bins are provided for this purpose.' },
      { en:'Report any hygiene, pest, or maintenance issue to Admin/Housekeeping so it can be addressed quickly.' },
    ]},
    { t:'h', text:{ en:'Personal hygiene & housekeeping staff' } },
    { t:'p', text:{ en:'As a shared workplace, employees are expected to maintain reasonable personal hygiene and grooming, out of consideration for colleagues and clients. Please treat housekeeping and support staff with the same courtesy and respect as any other colleague.' } },
  ])},

  { part:'D', n:14, title:{ en:'Festival Celebration Policy', hi:'त्योहार उत्सव नीति', gu:'તહેવાર ઉજવણી નીતિ' }, body:S([
    { t:'p', text:{ en:'SSC values the diversity of its people and enjoys celebrating festivals together as one team.' } },
    { t:'ul', items:[
      { en:'The Company will mark major festivals (such as Diwali, Holi, Independence Day, and others relevant to the location/team) with small office celebrations, decorations, or get-togethers, as decided by the People & Culture Team/Admin each year.' },
      { en:'Participation in festival celebrations is voluntary and open to everyone, regardless of which festival(s) they personally observe — no one is required to contribute money or take part.' },
      { en:'Where the Company organizes a celebration, the People & Culture Team/Admin will communicate the date, any dress theme, and logistics in advance.' },
      { en:'Employees are welcome to suggest festivals or traditions they would like the office to recognize — write to the People & Culture Team with your suggestions.' },
      { en:'Festival celebrations should not interfere with client commitments or core working hours; timing will be planned sensitively.' },
    ]},
  ])},

  { part:'D', n:15, title:{ en:'Probation & Confirmation Policy', hi:'प्रोबेशन और पुष्टि नीति', gu:'પ્રોબેશન અને પુષ્ટિ નીતિ' }, body:S([
    { t:'ul', items:[
      { en:'All new employees join on probation, for the period specified in their offer/appointment letter.', hi:'सभी नए कर्मचारी प्रोबेशन पर शामिल होते हैं, जिसकी अवधि उनके ऑफर/नियुक्ति पत्र में निर्दिष्ट होती है।', gu:'બધા નવા કર્મચારીઓ પ્રોબેશન પર જોડાય છે, જેની અવધિ તેમના ઓફર/નિમણૂક પત્રમાં દર્શાવેલ હોય છે.' },
      { en:'Performance and conduct during probation are reviewed by the reporting manager and the People & Culture Team before confirmation.', hi:'प्रोबेशन के दौरान प्रदर्शन और आचरण की समीक्षा पुष्टि से पहले रिपोर्टिंग मैनेजर और People & Culture टीम द्वारा की जाती है।', gu:'પ્રોબેશન દરમિયાન કામગીરી અને વર્તનની સમીક્ષા પુષ્ટિ પહેલાં રિપોર્ટિંગ મેનેજર અને People & Culture ટીમ દ્વારા કરવામાં આવે છે.' },
      { en:'Employees on probation are not eligible for paid leave (see Section 6) and do not receive the SSC-branded T-shirt/uniform until confirmed (see Section 5).', hi:'प्रोबेशन पर कर्मचारी सवेतन छुट्टी के पात्र नहीं होते (धारा 6 देखें) और पुष्टि होने तक SSC-ब्रांडेड टी-शर्ट/वर्दी प्राप्त नहीं करते (धारा 5 देखें)।', gu:'પ્રોબેશન પરના કર્મચારીઓ પગારવાળી રજા માટે પાત્ર નથી (વિભાગ 6 જુઓ) અને પુષ્ટિ ન થાય ત્યાં સુધી SSC-બ્રાન્ડેડ ટી-શર્ટ/યુનિફોર્મ મેળવતા નથી (વિભાગ 5 જુઓ).' },
      { en:'On successful completion of probation, the People & Culture Team will issue a confirmation letter formalizing the employee’s status as a permanent employee of SSC.', hi:'प्रोबेशन के सफल समापन पर, People & Culture टीम एक पुष्टि पत्र जारी करेगी जो कर्मचारी की SSC के स्थायी कर्मचारी के रूप में स्थिति को औपचारिक बनाता है।', gu:'પ્રોબેશન સફળતાપૂર્વક પૂર્ણ થયે, People & Culture ટીમ એક પુષ્ટિ પત્ર જારી કરશે જે કર્મચારીની SSC ના કાયમી કર્મચારી તરીકેની સ્થિતિને ઔપચારિક બનાવે છે.' },
      { en:'The probation period may be extended in specific cases at management’s discretion, with the reasons communicated to the employee in writing.', hi:'विशिष्ट मामलों में प्रबंधन के विवेक पर प्रोबेशन अवधि बढ़ाई जा सकती है, जिसके कारण कर्मचारी को लिखित रूप में बताए जाते हैं।', gu:'ચોક્કસ કિસ્સાઓમાં મેનેજમેન્ટના વિવેકાધીન પ્રોબેશન અવધિ લંબાવી શકાય છે, જેના કારણો કર્મચારીને લેખિતમાં જણાવવામાં આવે છે.' },
    ]},
    { t:'callout', kind:'faq', items:[
      { q:{ en:'What happens if my probation is extended?', hi:'अगर मेरा प्रोबेशन बढ़ाया जाता है तो क्या होगा?', gu:'જો મારું પ્રોબેશન લંબાવવામાં આવે તો શું થાય?' }, a:{ en:'The People & Culture Team will inform you in writing of the reason and your revised confirmation date.', hi:'People & Culture टीम आपको कारण और आपकी संशोधित पुष्टि तिथि के बारे में लिखित रूप में सूचित करेगी।', gu:'People & Culture ટીમ તમને કારણ અને તમારી સુધારેલી પુષ્ટિ તારીખ વિશે લેખિતમાં જાણ કરશે.' } },
      { q:{ en:'Am I eligible for paid leave while on probation?', hi:'क्या प्रोबेशन के दौरान मैं सवेतन छुट्टी का पात्र हूँ?', gu:'શું પ્રોબેશન દરમિયાન હું પગારવાળી રજા માટે પાત્ર છું?' }, a:{ en:'No, except in genuine emergencies considered at management’s discretion.', hi:'नहीं, सिवाय वास्तविक आपात स्थितियों के जिन पर प्रबंधन के विवेक पर विचार किया जाता है।', gu:'ના, સાચી કટોકટીની પરિસ્થિતિઓ સિવાય જેને મેનેજમેન્ટના વિવેકાધીન ધ્યાનમાં લેવામાં આવે છે.' } },
    ]},
  ])},

  { part:'D', n:16, title:{ en:'Performance Appraisal (KRA & KPI)', hi:'प्रदर्शन मूल्यांकन (KRA और KPI)', gu:'કામગીરી મૂલ્યાંકન (KRA અને KPI)' }, body:S([
    { t:'p', text:{ en:'SSC follows a structured, performance-based appraisal process so that recognition, growth, and rewards are tied to actual contribution rather than tenure alone. Appraisals are anchored in each employee’s KRAs (Key Result Areas) and KPIs (Key Performance Indicators).' } },
    { t:'kv', rows:[
      ['KRA — Key Result Areas','The broad areas of responsibility you own in your role — the outcomes you are accountable for (e.g., sales targets, project delivery, client servicing, quality).'],
      ['KPI — Key Performance Indicators','The specific, measurable metrics that show how well each KRA is being met (e.g., revenue achieved vs. target, on-time delivery %, error rate, customer satisfaction score).'],
    ]},
    { t:'h', text:{ en:'How the appraisal works' } },
    { t:'ul', items:[
      { en:'At the start of each appraisal cycle, your reporting manager sets your KRAs and the KPIs (with targets) against which performance will be measured, aligned to your role and the Company’s goals.' },
      { en:'Performance is reviewed on a defined cycle (typically annually, with periodic check-ins), based on how you performed against your agreed KPIs.' },
      { en:'The review is a two-way discussion — you will have the opportunity for a self-assessment, followed by your manager’s evaluation and feedback on strengths, gaps, and development areas.' },
      { en:'Outcomes such as increments, promotions, incentives, and career development are based on this performance assessment, and remain at management’s discretion in line with business performance.' },
      { en:'Employees are encouraged to discuss their KRAs/KPIs and progress with their managers throughout the year — appraisal should never be a surprise at year-end.' },
    ]},
    { t:'callout', kind:'faq', items:[
      { q:{ en:'How is my increment or promotion decided?' }, a:{ en:'Primarily on your performance against your agreed KRAs and KPIs for the cycle, along with overall business performance, at management’s discretion.' } },
      { q:{ en:'Who sets my KRAs and KPIs?' }, a:{ en:'Your reporting manager, at the start of the appraisal cycle, aligned to your role and the Company’s goals. Discuss and clarify them early.' } },
    ]},
  ])},

  { part:'D', n:17, title:{ en:'Notice Period, Resignation & Exit Policy', hi:'नोटिस अवधि, इस्तीफा और निकास नीति', gu:'નોટિસ સમયગાળો, રાજીનામું અને એક્ઝિટ નીતિ' }, body:S([
    { t:'ul', items:[
      { en:'Employees wishing to resign must submit a written resignation to their reporting manager and the People & Culture Team, serving the notice period specified in their appointment letter.', hi:'इस्तीफा देने के इच्छुक कर्मचारियों को अपने रिपोर्टिंग मैनेजर और People & Culture टीम को लिखित इस्तीफा प्रस्तुत करना होगा, और अपने नियुक्ति पत्र में निर्दिष्ट नोटिस अवधि पूरी करनी होगी।', gu:'રાજીનામું આપવા ઇચ્છતા કર્મચારીઓએ પોતાના રિપોર્ટિંગ મેનેજર અને People & Culture ટીમને લેખિત રાજીનામું આપવું પડશે, અને પોતાના નિમણૂક પત્રમાં દર્શાવેલ નોટિસ સમયગાળો પૂરો કરવો પડશે.' },
      { en:'During the notice period, the employee is expected to complete handover of ongoing work/responsibilities and support a smooth transition.', hi:'नोटिस अवधि के दौरान, कर्मचारी से चल रहे काम/जिम्मेदारियों का हस्तांतरण पूरा करने और एक सुचारु परिवर्तन का समर्थन करने की अपेक्षा की जाती है।', gu:'નોટિસ સમયગાળા દરમિયાન, કર્મચારી પાસેથી ચાલુ કામ/જવાબદારીઓનું હસ્તાંતરણ પૂર્ણ કરવાની અને સરળ સંક્રમણને ટેકો આપવાની અપેક્ષા રાખવામાં આવે છે.' },
      { en:'Full and Final (F&F) settlement is processed after clearance from all departments (IT, Admin, Finance, the People & Culture Team, Reporting Manager) confirming return of company assets (laptop, SIM card, ID card, etc.) and no pending dues.', hi:'फुल एंड फाइनल (F&F) निपटान सभी विभागों (IT, Admin, Finance, People & Culture टीम, रिपोर्टिंग मैनेजर) से क्लीयरेंस के बाद संसाधित किया जाता है, जो कंपनी की संपत्ति (लैपटॉप, सिम कार्ड, आईडी कार्ड, आदि) की वापसी और कोई बकाया न होने की पुष्टि करते हैं।', gu:'ફુલ એન્ડ ફાઇનલ (F&F) સેટલમેન્ટ બધા વિભાગો (IT, Admin, Finance, People & Culture ટીમ, રિપોર્ટિંગ મેનેજર) પાસેથી ક્લિયરન્સ પછી પ્રક્રિયા કરવામાં આવે છે, જે કંપનીની સંપત્તિ (લેપટોપ, સિમ કાર્ડ, આઈડી કાર્ડ, વગેરે)ની પરત અને કોઈ બાકી લેણું ન હોવાની પુષ્ટિ કરે છે.' },
      { en:'The People & Culture Team may conduct an exit interview to gather feedback before an employee’s last working day.', hi:'People & Culture टीम कर्मचारी के अंतिम कार्य दिवस से पहले प्रतिक्रिया एकत्र करने के लिए एक एग्जिट इंटरव्यू आयोजित कर सकती है।', gu:'People & Culture ટીમ કર્મચારીના છેલ્લા કાર્યદિવસ પહેલાં પ્રતિસાદ એકત્રિત કરવા માટે એક એક્ઝિટ ઇન્ટરવ્યૂ યોજી શકે છે.' },
      { en:'SSC reserves the right to relieve an employee earlier than the notice period, or to accept payment in lieu of notice, at its discretion.', hi:'SSC अपने विवेक पर किसी कर्मचारी को नोटिस अवधि से पहले कार्यमुक्त करने, या नोटिस के बदले भुगतान स्वीकार करने का अधिकार सुरक्षित रखता है।', gu:'SSC પોતાના વિવેકાધીન કોઈ કર્મચારીને નોટિસ સમયગાળા પહેલાં કાર્યમુક્ત કરવાનો, અથવા નોટિસના બદલે ચુકવણી સ્વીકારવાનો અધિકાર અનામત રાખે છે.' },
    ]},
    { t:'callout', kind:'faq', items:[
      { q:{ en:'What do I need to return before my last day?', hi:'मुझे अपने अंतिम दिन से पहले क्या लौटाना होगा?', gu:'મારે મારા છેલ્લા દિવસ પહેલાં શું પરત કરવું પડશે?' }, a:{ en:'All company assets — laptop, SIM card, ID card, and any other issued equipment — through the standard asset return process coordinated by IT/Admin.', hi:'सभी कंपनी संपत्ति — लैपटॉप, सिम कार्ड, आईडी कार्ड, और कोई भी अन्य जारी उपकरण — IT/Admin द्वारा समन्वित मानक संपत्ति वापसी प्रक्रिया के माध्यम से।', gu:'બધી કંપની સંપત્તિ — લેપટોપ, સિમ કાર્ડ, આઈડી કાર્ડ, અને અન્ય કોઈપણ આપેલ સાધનો — IT/Admin દ્વારા સંકલિત પ્રમાણભૂત સંપત્તિ પરત પ્રક્રિયા દ્વારા.' } },
      { q:{ en:'When will I receive my Full & Final settlement?', hi:'मुझे मेरा फुल एंड फाइनल निपटान कब मिलेगा?', gu:'મને મારું ફુલ એન્ડ ફાઇનલ સેટલમેન્ટ ક્યારે મળશે?' }, a:{ en:'After all departments confirm clearance. The People & Culture Team will share the expected timeline with you at the time of your exit.', hi:'सभी विभागों द्वारा क्लीयरेंस की पुष्टि के बाद। People & Culture टीम आपके एग्जिट के समय अपेक्षित समय-सीमा आपके साथ साझा करेगी।', gu:'બધા વિભાગો ક્લિયરન્સની પુષ્ટિ કરે તે પછી. People & Culture ટીમ તમારા એક્ઝિટ સમયે અપેક્ષિત સમયમર્યાદા તમારી સાથે શેર કરશે.' } },
    ]},
  ])},

  { part:'D', n:18, title:{ en:'Confidentiality, Data Protection & Conflict of Interest', hi:'गोपनीयता, डेटा सुरक्षा और हितों का टकराव', gu:'ગોપનીયતા, ડેટા સુરક્ષા અને હિતોનો સંઘર્ષ' }, body:S([
    { t:'ul', items:[
      { en:'Employees must keep confidential all non-public company, client, and colleague information encountered during their employment, both during and after their time at SSC.', hi:'कर्मचारियों को अपने रोज़गार के दौरान सामने आई सभी गैर-सार्वजनिक कंपनी, ग्राहक और सहकर्मी जानकारी को SSC में अपने समय के दौरान और बाद में भी गोपनीय रखना चाहिए।', gu:'કર્મચારીઓએ પોતાના રોજગાર દરમિયાન સામે આવેલી બધી બિન-જાહેર કંપની, ગ્રાહક અને સહકર્મી માહિતી SSC માં પોતાના સમય દરમિયાન અને પછી પણ ગોપનીય રાખવી જોઈએ.' },
      { en:'Do not share business plans, pricing, designs, client lists, or proprietary technical information with anyone outside the Company without authorization.', hi:'व्यावसायिक योजनाओं, मूल्य निर्धारण, डिज़ाइन, ग्राहक सूचियों, या स्वामित्व वाली तकनीकी जानकारी को अधिकार के बिना कंपनी के बाहर किसी के साथ साझा न करें।', gu:'વ્યવસાયિક યોજનાઓ, કિંમત નિર્ધારણ, ડિઝાઇન, ગ્રાહક યાદીઓ, કે માલિકીની ટેકનિકલ માહિતી અધિકૃતતા વિના કંપનીની બહાર કોઈની સાથે શેર ન કરો.' },
      { en:'Avoid situations where your personal interests conflict with SSC’s interests — for example, engaging in a competing business, accepting gifts or favours from vendors that could influence business decisions, or hiring/awarding contracts to close relatives without disclosure.', hi:'ऐसी स्थितियों से बचें जहाँ आपके व्यक्तिगत हित SSC के हितों से टकराते हों — उदाहरण के लिए, प्रतिस्पर्धी व्यवसाय में शामिल होना, विक्रेताओं से ऐसे उपहार या एहसान स्वीकार करना जो व्यावसायिक निर्णयों को प्रभावित कर सकते हों, या बिना प्रकटीकरण के करीबी रिश्तेदारों को नियुक्त करना/अनुबंध देना।', gu:'એવી પરિસ્થિતિઓ ટાળો જ્યાં તમારા વ્યક્તિગત હિતો SSC ના હિતો સાથે ટકરાય — ઉદાહરણ તરીકે, સ્પર્ધાત્મક વ્યવસાયમાં સામેલ થવું, વિક્રેતાઓ પાસેથી એવી ભેટ કે તરફેણ સ્વીકારવી જે વ્યવસાયિક નિર્ણયોને પ્રભાવિત કરી શકે, અથવા જાહેરાત વિના નજીકના સંબંધીઓને નોકરી આપવી/કરાર આપવો.' },
      { en:'Disclose any potential conflict of interest to the People & Culture Team or management promptly, so it can be addressed transparently.', hi:'किसी भी संभावित हित के टकराव का खुलासा तुरंत People & Culture टीम या प्रबंधन को करें, ताकि इसे पारदर्शी रूप से संबोधित किया जा सके।', gu:'કોઈપણ સંભવિત હિતોના સંઘર્ષની જાણ તરત જ People & Culture ટીમ કે મેનેજમેન્ટને કરો, જેથી તેને પારદર્શક રીતે ઉકેલી શકાય.' },
    ]},
    { t:'callout', kind:'faq', items:[
      { q:{ en:'A vendor offered me a personal gift — what should I do?', hi:'एक विक्रेता ने मुझे एक व्यक्तिगत उपहार दिया — मुझे क्या करना चाहिए?', gu:'એક વિક્રેતાએ મને વ્યક્તિગત ભેટ આપી — મારે શું કરવું જોઈએ?' }, a:{ en:'Politely decline anything beyond a token/nominal gift, and inform your manager or the People & Culture Team if you’re unsure.', hi:'किसी भी सांकेतिक/मामूली उपहार से अधिक कुछ भी विनम्रतापूर्वक अस्वीकार करें, और यदि आप अनिश्चित हैं तो अपने मैनेजर या People & Culture टीम को सूचित करें।', gu:'કોઈપણ સાંકેતિક/નજીવી ભેટ કરતાં વધુ કંઈપણ નમ્રતાથી નકારો, અને જો તમે અનિશ્ચિત હો તો તમારા મેનેજર કે People & Culture ટીમને જાણ કરો.' } },
    ]},
  ])},

  { part:'D', n:19, title:{ en:'Workplace Health & Safety', hi:'कार्यस्थल स्वास्थ्य और सुरक्षा', gu:'કાર્યસ્થળ આરોગ્ય અને સલામતી' }, body:S([
    { t:'ul', items:[
      { en:'SSC is committed to providing a safe working environment for all employees.' },
      { en:'Report any unsafe condition, equipment fault, or workplace hazard to Admin immediately.' },
      { en:'Basic first-aid facilities are available at each office location — contact Admin for details.' },
      { en:'In case of a medical emergency, inform your manager/the People & Culture Team immediately and follow the office emergency guidance shared by Admin.' },
    ]},
  ])},

  // ── PART E ──────────────────────────────────────────────
  { part:'E', n:20, title:{ en:'Understanding Your Salary & Benefits — The Basics', hi:'अपने वेतन और लाभ को समझना — मूल बातें', gu:'તમારો પગાર અને લાભ સમજવા — મૂળભૂત બાબતો' }, body:S([
    { t:'p', text:{ en:'This section is meant to help you understand, in plain language, a few terms that often appear on your payslip or offer letter. It is a general explainer, not financial, tax, or legal advice — for anything specific to your own situation, please speak with the People & Culture Team or a qualified professional (such as a Chartered Accountant for tax matters).', hi:'यह अनुभाग आपको सरल भाषा में कुछ ऐसे शब्दों को समझने में मदद करने के लिए है जो अक्सर आपकी पेस्लिप या ऑफर लेटर पर दिखाई देते हैं। यह एक सामान्य व्याख्या है, कोई वित्तीय, कर, या कानूनी सलाह नहीं — अपनी स्थिति से संबंधित किसी भी विशिष्ट बात के लिए, कृपया People & Culture टीम या किसी योग्य पेशेवर (जैसे कर मामलों के लिए चार्टर्ड अकाउंटेंट) से बात करें।', gu:'આ વિભાગ તમને સરળ ભાષામાં કેટલાક એવા શબ્દો સમજવામાં મદદ કરવા માટે છે જે ઘણી વાર તમારી પેસ્લિપ કે ઓફર લેટર પર દેખાય છે. આ એક સામાન્ય સમજૂતી છે, કોઈ નાણાકીય, કર, કે કાનૂની સલાહ નથી — તમારી પરિસ્થિતિને લગતી કોઈપણ ચોક્કસ બાબત માટે, કૃપા કરીને People & Culture ટીમ કે કોઈ લાયક વ્યાવસાયિક (જેમ કે કર બાબતો માટે ચાર્ટર્ડ એકાઉન્ટન્ટ) સાથે વાત કરો.' } },
    { t:'h', text:{ en:'Provident Fund (PF)', hi:'भविष्य निधि (PF)', gu:'ભવિષ્ય નિધિ (PF)' } },
    { t:'ul', items:[
      { en:'The Employees’ Provident Fund (EPF) is a retirement savings scheme administered by the EPFO, applicable to eligible employees under the EPF & MP Act, 1952.', hi:'कर्मचारी भविष्य निधि (EPF) EPFO द्वारा संचालित एक सेवानिवृत्ति बचत योजना है, जो EPF & MP अधिनियम, 1952 के तहत पात्र कर्मचारियों पर लागू होती है।', gu:'કર્મચારી ભવિષ્ય નિધિ (EPF) EPFO દ્વારા સંચાલિત એક નિવૃત્તિ બચત યોજના છે, જે EPF & MP અધિનિયમ, 1952 હેઠળ પાત્ર કર્મચારીઓ પર લાગુ પડે છે.' },
      { en:'Broadly, a percentage of your basic salary is deducted each month as your PF contribution, and the Company contributes a matching amount on your behalf. These contributions accumulate with interest in your PF account.', hi:'मोटे तौर पर, आपके मूल वेतन का एक प्रतिशत हर महीने आपके PF अंशदान के रूप में काटा जाता है, और कंपनी आपकी ओर से एक समान राशि का योगदान करती है। ये अंशदान आपके PF खाते में ब्याज सहित जमा होते हैं।', gu:'સામાન્ય રીતે, તમારા મૂળ પગારનો એક ટકા દર મહિને તમારા PF યોગદાન તરીકે કાપવામાં આવે છે, અને કંપની તમારા વતી સમાન રકમનું યોગદાન આપે છે. આ યોગદાન તમારા PF ખાતામાં વ્યાજ સહિત જમા થાય છે.' },
      { en:'You can track your PF balance through the EPFO member portal or the UMANG app, using your UAN (Universal Account Number).', hi:'आप अपने UAN (यूनिवर्सल अकाउंट नंबर) का उपयोग करके EPFO सदस्य पोर्टल या UMANG ऐप के माध्यम से अपने PF बैलेंस को ट्रैक कर सकते हैं।', gu:'તમે તમારા UAN (યુનિવર્સલ એકાઉન્ટ નંબર)નો ઉપયોગ કરીને EPFO મેમ્બર પોર્ટલ કે UMANG એપ દ્વારા તમારું PF બેલેન્સ ટ્રૅક કરી શકો છો.' },
      { en:'PF is generally meant to be withdrawn/transferred at retirement or between jobs, though partial withdrawal is allowed for specific reasons (medical emergency, home purchase, marriage, etc.) as per EPFO rules.', hi:'PF आम तौर पर सेवानिवृत्ति पर या नौकरियों के बीच निकालने/स्थानांतरित करने के लिए होता है, हालाँकि EPFO नियमों के अनुसार विशिष्ट कारणों (चिकित्सा आपात स्थिति, घर खरीद, विवाह, आदि) के लिए आंशिक निकासी की अनुमति है।', gu:'PF સામાન્ય રીતે નિવૃત્તિ સમયે કે નોકરીઓ વચ્ચે ઉપાડવા/ટ્રાન્સફર કરવા માટે હોય છે, જોકે EPFO નિયમો અનુસાર ચોક્કસ કારણો (તબીબી કટોકટી, ઘર ખરીદી, લગ્ન, વગેરે) માટે આંશિક ઉપાડની મંજૂરી છે.' },
    ]},
    { t:'callout', kind:'note', text:{ en:'Exact contribution rates and eligibility (e.g., salary thresholds) are governed by EPFO regulations and may change; please confirm the current applicable rate with the People & Culture Team/Payroll for your specific case.', hi:'सटीक अंशदान दरें और पात्रता (जैसे, वेतन सीमाएँ) EPFO नियमों द्वारा शासित होती हैं और बदल सकती हैं; कृपया अपने विशिष्ट मामले के लिए People & Culture टीम/पेरोल के साथ वर्तमान लागू दर की पुष्टि करें।', gu:'ચોક્કસ યોગદાન દર અને પાત્રતા (જેમ કે, પગાર મર્યાદા) EPFO નિયમો દ્વારા સંચાલિત થાય છે અને બદલાઈ શકે છે; કૃપા કરીને તમારા ચોક્કસ કિસ્સા માટે People & Culture ટીમ/પેરોલ સાથે વર્તમાન લાગુ દરની પુષ્ટિ કરો.' } },
    { t:'h', text:{ en:'Gratuity', hi:'ग्रेच्युटी', gu:'ગ્રેચ્યુઇટી' } },
    { t:'ul', items:[
      { en:'Gratuity is a lump-sum benefit paid by the employer to an employee as a token of appreciation for continuous service, governed by the Payment of Gratuity Act, 1972.', hi:'ग्रेच्युटी नियोक्ता द्वारा कर्मचारी को निरंतर सेवा के लिए प्रशंसा के प्रतीक के रूप में दिया जाने वाला एकमुश्त लाभ है, जो ग्रेच्युटी भुगतान अधिनियम, 1972 द्वारा शासित होता है।', gu:'ગ્રેચ્યુઇટી એ નિયોક્તા દ્વારા કર્મચારીને સતત સેવા બદલ પ્રશંસાના પ્રતીક તરીકે આપવામાં આવતો એકસાથે લાભ છે, જે ગ્રેચ્યુઇટી ચુકવણી અધિનિયમ, 1972 દ્વારા સંચાલિત થાય છે.' },
      { en:'It generally becomes payable once an employee completes 5 years of continuous service with the Company, and is paid at the time of leaving (resignation, retirement, or termination), subject to conditions under the Act.', hi:'यह आम तौर पर तब देय होता है जब कोई कर्मचारी कंपनी के साथ 5 वर्ष की निरंतर सेवा पूरी करता है, और छोड़ने के समय (इस्तीफा, सेवानिवृत्ति, या समाप्ति) पर दिया जाता है, जो अधिनियम के तहत शर्तों के अधीन है।', gu:'તે સામાન્ય રીતે ત્યારે ચૂકવવાપાત્ર બને છે જ્યારે કોઈ કર્મચારી કંપની સાથે 5 વર્ષની સતત સેવા પૂર્ણ કરે છે, અને છોડવાના સમયે (રાજીનામું, નિવૃત્તિ, કે સમાપ્તિ) ચૂકવવામાં આવે છે, જે અધિનિયમ હેઠળની શરતોને આધીન છે.' },
      { en:'The typical formula used is: (Last drawn basic salary ÷ 26) × 15 × number of years of service — subject to the statutory ceiling in force at the time.', hi:'उपयोग किया जाने वाला सामान्य सूत्र है: (अंतिम आहरित मूल वेतन ÷ 26) × 15 × सेवा के वर्षों की संख्या — उस समय लागू वैधानिक सीमा के अधीन।', gu:'ઉપયોગમાં લેવાતું સામાન્ય સૂત્ર છે: (છેલ્લે લીધેલ મૂળ પગાર ÷ 26) × 15 × સેવાના વર્ષોની સંખ્યા — તે સમયે લાગુ વૈધાનિક મર્યાદાને આધીન.' },
    ]},
    { t:'callout', kind:'note', text:{ en:'Gratuity calculations depend on your exact tenure, last drawn basic salary, and the law in force at the time of separation. The People & Culture Team/Payroll will share your precise computation when applicable.', hi:'ग्रेच्युटी की गणना आपके सटीक कार्यकाल, अंतिम आहरित मूल वेतन, और अलग होने के समय लागू कानून पर निर्भर करती है। लागू होने पर People & Culture टीम/पेरोल आपकी सटीक गणना साझा करेगी।', gu:'ગ્રેચ્યુઇટીની ગણતરી તમારા ચોક્કસ કાર્યકાળ, છેલ્લે લીધેલ મૂળ પગાર, અને છૂટા થવાના સમયે લાગુ કાયદા પર આધાર રાખે છે. લાગુ પડે ત્યારે People & Culture ટીમ/પેરોલ તમારી ચોક્કસ ગણતરી શેર કરશે.' } },
    { t:'h', text:{ en:'Insurance', hi:'बीमा', gu:'વીમો' } },
    { t:'ul', items:[
      { en:'Where provided, group health/mediclaim insurance offers financial protection against hospitalization and certain medical expenses for you (and, in some plans, your dependents).', hi:'जहाँ प्रदान किया जाता है, समूह स्वास्थ्य/मेडिक्लेम बीमा आपके (और, कुछ योजनाओं में, आपके आश्रितों के) लिए अस्पताल में भर्ती और कुछ चिकित्सा खर्चों के खिलाफ वित्तीय सुरक्षा प्रदान करता है।', gu:'જ્યાં પ્રદાન કરવામાં આવે છે, ગ્રુપ હેલ્થ/મેડિક્લેમ વીમો તમારા (અને, કેટલીક યોજનાઓમાં, તમારા આશ્રિતો) માટે હોસ્પિટલમાં દાખલ થવા અને કેટલાક તબીબી ખર્ચ સામે નાણાકીય સુરક્ષા આપે છે.' },
      { en:'Coverage amount, inclusions, exclusions, and dependents covered vary by the specific policy the Company has taken — please check the actual policy document/communication from the People & Culture Team for your coverage details, claim process, and network hospitals.', hi:'कवरेज राशि, समावेशन, बहिष्करण, और कवर किए गए आश्रित कंपनी द्वारा ली गई विशिष्ट पॉलिसी के अनुसार भिन्न होते हैं — कृपया अपने कवरेज विवरण, दावा प्रक्रिया, और नेटवर्क अस्पतालों के लिए People & Culture टीम से वास्तविक पॉलिसी दस्तावेज़/संचार देखें।', gu:'કવરેજ રકમ, સમાવેશ, બાકાત, અને આવરી લેવાયેલ આશ્રિતો કંપનીએ લીધેલ ચોક્કસ પોલિસી અનુસાર બદલાય છે — કૃપા કરીને તમારી કવરેજ વિગતો, દાવા પ્રક્રિયા, અને નેટવર્ક હોસ્પિટલો માટે People & Culture ટીમ પાસેથી વાસ્તવિક પોલિસી દસ્તાવેજ/સંચાર તપાસો.' },
      { en:'Some Company benefits (like EPF) include an in-built insurance component (e.g., EDLI — Employees’ Deposit Linked Insurance) for eligible employees; ask the People & Culture Team if this applies to you.', hi:'कुछ कंपनी लाभ (जैसे EPF) में पात्र कर्मचारियों के लिए एक अंतर्निहित बीमा घटक (जैसे EDLI — कर्मचारी जमा लिंक्ड बीमा) शामिल होता है; यदि यह आप पर लागू होता है तो People & Culture टीम से पूछें।', gu:'કેટલાક કંપની લાભો (જેમ કે EPF)માં પાત્ર કર્મચારીઓ માટે એક બિલ્ટ-ઇન વીમા ઘટક (જેમ કે EDLI — કર્મચારી ડિપોઝિટ લિંક્ડ વીમો) સામેલ હોય છે; જો આ તમને લાગુ પડે તો People & Culture ટીમને પૂછો.' },
    ]},
    { t:'h', text:{ en:'Income Tax / TDS', hi:'आयकर / TDS', gu:'આવકવેરો / TDS' } },
    { t:'ul', items:[
      { en:'Your salary is subject to Income Tax as per the Income Tax Act, and the Company, as your employer, is required to deduct TDS (Tax Deducted at Source) from your monthly salary and deposit it with the government on your behalf.', hi:'आपका वेतन आयकर अधिनियम के अनुसार आयकर के अधीन है, और कंपनी, आपके नियोक्ता के रूप में, आपके मासिक वेतन से TDS (स्रोत पर कर कटौती) काटने और इसे आपकी ओर से सरकार के पास जमा करने के लिए आवश्यक है।', gu:'તમારો પગાર આવકવેરા અધિનિયમ અનુસાર આવકવેરાને આધીન છે, અને કંપની, તમારા નિયોક્તા તરીકે, તમારા માસિક પગારમાંથી TDS (સ્રોત પર કપાયેલ કર) કાપવા અને તેને તમારા વતી સરકાર પાસે જમા કરાવવા માટે જવાબદાર છે.' },
      { en:'You can typically choose between the Old Tax Regime (various deductions/exemptions, e.g., Section 80C, HRA) and the New Tax Regime (generally lower slab rates with fewer deductions) — Payroll will usually ask you to declare your preference at the start of the financial year.', hi:'आप आम तौर पर पुरानी कर व्यवस्था (विभिन्न कटौतियाँ/छूट, जैसे धारा 80C, HRA) और नई कर व्यवस्था (आम तौर पर कम कटौतियों के साथ कम स्लैब दरें) के बीच चुन सकते हैं — पेरोल आम तौर पर वित्तीय वर्ष की शुरुआत में आपसे आपकी पसंद घोषित करने के लिए कहेगा।', gu:'તમે સામાન્ય રીતે જૂની કર વ્યવસ્થા (વિવિધ કપાત/મુક્તિ, જેમ કે કલમ 80C, HRA) અને નવી કર વ્યવસ્થા (સામાન્ય રીતે ઓછી કપાત સાથે નીચા સ્લેબ દર) વચ્ચે પસંદ કરી શકો છો — પેરોલ સામાન્ય રીતે નાણાકીય વર્ષની શરૂઆતમાં તમને તમારી પસંદગી જાહેર કરવા કહેશે.' },
      { en:'If you wish to claim deductions (investments, insurance premiums, rent, home loan interest, etc.), you will typically need to submit proof of investment/declaration to Payroll within the timelines they specify.', hi:'यदि आप कटौतियों (निवेश, बीमा प्रीमियम, किराया, गृह ऋण ब्याज, आदि) का दावा करना चाहते हैं, तो आपको आम तौर पर पेरोल द्वारा निर्दिष्ट समय-सीमा के भीतर निवेश/घोषणा का प्रमाण प्रस्तुत करना होगा।', gu:'જો તમે કપાત (રોકાણ, વીમા પ્રીમિયમ, ભાડું, ગૃહ લોન વ્યાજ, વગેરે)નો દાવો કરવા ઇચ્છતા હો, તો તમારે સામાન્ય રીતે પેરોલ દ્વારા દર્શાવેલ સમયમર્યાદામાં રોકાણ/ઘોષણાનો પુરાવો રજૂ કરવો પડશે.' },
      { en:'At the end of the financial year, the Company will issue you a Form 16, summarizing your salary and the tax deducted, which you can use to file your Income Tax Return.', hi:'वित्तीय वर्ष के अंत में, कंपनी आपको एक फॉर्म 16 जारी करेगी, जो आपके वेतन और काटे गए कर का सारांश देता है, जिसका उपयोग आप अपना आयकर रिटर्न दाखिल करने के लिए कर सकते हैं।', gu:'નાણાકીય વર્ષના અંતે, કંપની તમને એક ફોર્મ 16 જારી કરશે, જે તમારા પગાર અને કપાયેલ કરનો સારાંશ આપે છે, જેનો ઉપયોગ તમે તમારું આવકવેરા રિટર્ન ફાઇલ કરવા માટે કરી શકો છો.' },
    ]},
    { t:'callout', kind:'note', text:{ en:'Tax laws, slabs, and regimes change from time to time. This section explains the general concept only — please consult the People & Culture Team/Payroll or your tax advisor for guidance specific to your income and declarations.', hi:'कर कानून, स्लैब, और व्यवस्थाएँ समय-समय पर बदलती रहती हैं। यह अनुभाग केवल सामान्य अवधारणा समझाता है — कृपया अपनी आय और घोषणाओं से संबंधित मार्गदर्शन के लिए People & Culture टीम/पेरोल या अपने कर सलाहकार से परामर्श करें।', gu:'કર કાયદા, સ્લેબ, અને વ્યવસ્થાઓ સમયાંતરે બદલાતી રહે છે. આ વિભાગ ફક્ત સામાન્ય ખ્યાલ સમજાવે છે — કૃપા કરીને તમારી આવક અને ઘોષણાઓને લગતા માર્ગદર્શન માટે People & Culture ટીમ/પેરોલ કે તમારા કર સલાહકારની સલાહ લો.' } },
    { t:'callout', kind:'faq', items:[
      { q:{ en:'I’m not sure how my PF, gratuity, or tax deduction is calculated on my payslip — who can explain it?', hi:'मुझे यकीन नहीं है कि मेरी पेस्लिप पर मेरे PF, ग्रेच्युटी, या कर कटौती की गणना कैसे की जाती है — इसे कौन समझा सकता है?', gu:'મને ખાતરી નથી કે મારી પેસ્લિપ પર મારા PF, ગ્રેચ્યુઇટી, કે કર કપાતની ગણતરી કેવી રીતે થાય છે — તેને કોણ સમજાવી શકે?' }, a:{ en:'Reach out to the People & Culture Team/Payroll — they can walk you through your specific payslip and deductions.', hi:'People & Culture टीम/पेरोल से संपर्क करें — वे आपकी विशिष्ट पेस्लिप और कटौतियों के बारे में आपको विस्तार से बता सकते हैं।', gu:'People & Culture ટીમ/પેરોલનો સંપર્ક કરો — તેઓ તમને તમારી ચોક્કસ પેસ્લિપ અને કપાત વિશે વિગતવાર સમજાવી શકે છે.' } },
    ]},
  ])},
]

export const HB_CONTACTS = [
  { name:'People & Culture Team', desc:'General HR queries, policies, leave (SSC ERP — People Section), onboarding, confirmations & exit.', detail:'people@ssccontrol.com' },
  { name:'Grievance Redressal', desc:'Mr. Ankit Dave — Head of Operations. Escalation for workplace concerns.', detail:'7486048264' },
  { name:'Internal Committee (POSH)', desc:'Sexual-harassment complaints under the POSH Act, 2013. Presiding contact: Mr. Ankit Dave. Full Committee details shared separately by the People & Culture Team.', detail:'' },
  { name:'IT / Admin Support', desc:'Laptop/desktop, company SIM, landline, printer & stationery, and asset return.', detail:'ankit.dave@ssccontrol.com' },
  { name:'Payroll & Finance', desc:'Salary, PF, gratuity, TDS/Form 16, and travel reimbursement (SSC ERP).', detail:'maunang.parikh@ssccontrol.com' },
  { name:'Health, Safety & Emergency', desc:'First-aid, workplace hazards & medical emergencies. Emergency contact: Mr. Ankit Dave.', detail:'' },
]
