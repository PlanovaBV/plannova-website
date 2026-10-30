/* PlanNova: bezoekersstatistiek + cookiemelding (Accepteren = ook bedrijfsherkenning).
   Er worden geen cookies geplaatst. In de browser bewaren we alleen uw keuze
   ("plannova-toestemming") zodat we het niet opnieuw vragen. Zie /privacy/. */
(function(){
  var KEY='plannova-toestemming', SES='plannova-bezoek-gestart';
  function lees(){try{return localStorage.getItem(KEY)}catch(_){return null}}
  function zet(v){try{localStorage.setItem(KEY,v)}catch(_){}}
  var gpc=navigator.globalPrivacyControl===true;
  var keuze=lees()||(gpc?'nee':null);
  var eerste=true;
  try{eerste=!sessionStorage.getItem(SES);sessionStorage.setItem(SES,'1')}catch(_){}
  var utm='';
  try{var q=new URLSearchParams(location.search);utm=[q.get('utm_source'),q.get('utm_campaign')].filter(Boolean).join(' / ')}catch(_){}
  function stuur(extra){
    try{
      var body=JSON.stringify({pad:location.pathname,ref:document.referrer||'',utm:utm,toestemming:keuze==='ja',eerste:extra?true:eerste,extra:!!extra});
      if(window.fetch) fetch('/api/bezoek',{method:'POST',headers:{'content-type':'application/json'},body:body,keepalive:true,credentials:'same-origin'}).catch(function(){});
    }catch(_){}
  }
  stuur(false);

  // ---------- melding ----------
  var css='.pn-tm{position:fixed;left:16px;right:16px;bottom:16px;z-index:60;max-width:560px;margin-left:auto;background:#03241E;color:#EDE6D6;border-radius:3px;box-shadow:0 12px 40px rgba(3,36,30,.28);padding:20px 22px;font:400 15px/1.55 "Public Sans","Segoe UI",system-ui,sans-serif}'+
    '.pn-tm b{display:block;font:600 18px/1.25 "Urbanist","Segoe UI",system-ui,sans-serif;margin-bottom:6px;color:#fff}'+
    '.pn-tm p{margin:0;color:#C9D3CC}.pn-tm a{color:#EDE6D6;text-underline-offset:3px}'+
    '.pn-tm .r{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}'+
    '.pn-tm button{font:600 14.5px/1 "Public Sans","Segoe UI",system-ui,sans-serif;padding:13px 18px;border-radius:2px;cursor:pointer;border:1px solid #C5A45F}'+
    '.pn-tm .ja{background:#C5A45F;color:#03241E}.pn-tm .ja:hover{background:#d4b676}'+
    '.pn-tm .nee{background:transparent;color:#EDE6D6;border-color:#3a5c53}.pn-tm .nee:hover{border-color:#EDE6D6}'+
    '.pn-tm button:focus-visible{outline:2px solid #fff;outline-offset:2px}'+
    '@media (max-width:520px){.pn-tm{left:10px;right:10px;bottom:10px;padding:18px}.pn-tm .r button{flex:1}}';
  function toon(){
    if(document.getElementById('pn-tm')) return;
    var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
    var d=document.createElement('div');d.className='pn-tm';d.id='pn-tm';d.setAttribute('role','dialog');d.setAttribute('aria-live','polite');d.setAttribute('aria-label','Cookiemelding');
    d.innerHTML='<b>Deze website gebruikt cookies</b><p>We gebruiken cookies en vergelijkbare technieken om de website goed te laten werken, het gebruik te analyseren en de website te verbeteren. Lees meer in onze <a href="/privacy/">privacyverklaring</a>.</p>'+
      '<div class="r"><button type="button" class="ja">Accepteren</button><button type="button" class="nee">Weigeren</button></div>';
    document.body.appendChild(d);
    d.querySelector('.ja').onclick=function(){keuze='ja';zet('ja');d.remove();stuur(true)};
    d.querySelector('.nee').onclick=function(){keuze='nee';zet('nee');d.remove()};
  }
  window.plannovaPrivacy=function(e){if(e)e.preventDefault();var o=document.getElementById('pn-tm');if(o)o.remove();toon()};
  function klaar(){
    document.querySelectorAll('[data-privacy-instellingen]').forEach(function(a){a.addEventListener('click',window.plannovaPrivacy)});
    if(!keuze) toon();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',klaar); else klaar();
})();
