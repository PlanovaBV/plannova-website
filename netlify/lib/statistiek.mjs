// Bezoekersstatistieken zonder cookies.
//
// Privacy-opzet (AVG):
//  - Er worden geen cookies geplaatst en er wordt niets in de browser van de bezoeker
//    opgeslagen om hem te volgen.
//  - Het IP-adres wordt NIET opgeslagen. Voor het tellen van unieke bezoekers per dag
//    maken we een niet-terug te rekenen code (hash) van IP + browser + een geheime
//    dagwaarde die elke dag wordt vervangen. Daardoor is een bezoeker niet over dagen
//    heen te volgen en niet terug te herleiden.
//  - Alleen als de bezoeker zelf toestemming geeft, zoeken we eenmalig via de openbare
//    RIPE-database (Europees register van internetadressen) op bij welke organisatie het internetadres hoort. Alleen de
//    organisatienaam bewaren we, en alleen als het geen gewone internetprovider is.
//  - Losse bezoeken worden na 35 dagen verwijderd; daarna blijft alleen een dagtotaal over.

const BEWAAR_DAGEN = 35;
const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest|vkshare|whatsapp|telegram|discord|preview|headless|lighthouse|pagespeed|monitor|uptime|python|curl|wget|httpclient|java\/|go-http|axios|node-fetch/i;

// Gewone internetproviders en mobiele netwerken: die zeggen niets over het bedrijf.
const PROVIDER_RE = /\b(kpn|ziggo|vodafone|libertel|t-?mobile|odido|tele2|delta|zeelandnet|caiway|freedom|solcon|online\.nl|xs4all|telfort|youfone|simpel|lebara|budget|stipte|glasvezel|fiber|proximus|telenet|orange|base|scarlet|deutsche telekom|telekom|vodafone|o2|telefonica|1&1|versatel|unitymedia|liberty|upc|sky|bt |british telecom|virgin|comcast|verizon|at&t|charter|cox|google|cloudflare|amazon|aws|microsoft|azure|apple|akamai|fastly|ovh|hetzner|digitalocean|leaseweb|transip|ripe|apnic|arin|lacnic|afrinic|iana|starlink|mobile|wireless|broadband|residential|dsl|cable|ftth|isp)\b/i;

export const vandaag = (d = new Date()) => d.toISOString().slice(0, 10);

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(s) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** Geheime dagwaarde; wordt elke dag nieuw aangemaakt. */
async function dagZout(store, dag) {
  const key = `zout/${dag}`;
  let z = await store.get(key, { type: "text" });
  if (!z) {
    z = hex(crypto.getRandomValues(new Uint8Array(32)));
    await store.set(key, z);
  }
  return z;
}

export function apparaat(ua) {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return "Tablet";
  if (/mobi|iphone|android/i.test(ua)) return "Mobiel";
  return "Computer";
}

export function browser(ua) {
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/samsungbrowser/i.test(ua)) return "Samsung";
  if (/chrome|crios/i.test(ua)) return "Chrome";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/safari/i.test(ua)) return "Safari";
  return "Overig";
}

/** Herkomst als leesbare naam. */
export function herkomst(ref, eigenHost, utm) {
  if (utm) return utm.slice(0, 60);
  if (!ref) return "Direct";
  let host;
  try { host = new URL(ref).hostname.replace(/^www\./, ""); } catch { return "Direct"; }
  if (!host || host === eigenHost || /(^|\.)p?lan+ovabv\.nl$/.test(host)) return "Direct";
  if (/google\./.test(host)) return "Google";
  if (/bing\.com/.test(host)) return "Bing";
  if (/duckduckgo/.test(host)) return "DuckDuckGo";
  if (/linkedin|lnkd\.in/.test(host)) return "LinkedIn";
  if (/facebook|fb\.com|fb\.me/.test(host)) return "Facebook";
  if (/instagram/.test(host)) return "Instagram";
  if (/t\.co$|twitter|x\.com/.test(host)) return "X / Twitter";
  if (/wasmannbouw/.test(host)) return "Wasmann Bouw";
  return host.slice(0, 60);
}

/** Organisatienaam bij een IP-adres via RIPE/RDAP. Geeft null bij providers of fouten. */
export async function organisatie(ip, fetchImpl = fetch) {
  if (!ip || /^(127\.|10\.|192\.168\.|::1|fc|fd)/i.test(ip)) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetchImpl(`https://rdap.db.ripe.net/ip/${encodeURIComponent(ip)}`, { signal: ctrl.signal, redirect: "manual", headers: { accept: "application/rdap+json" } });
    clearTimeout(t);
    if (!r.ok) return null;
    const d = await r.json();
    const namen = [];
    for (const e of d.entities || []) {
      const roles = e.roles || [];
      if (!roles.includes("registrant")) continue;
      const fn = ((e.vcardArray || [])[1] || []).find((x) => x[0] === "fn");
      const naam = fn && String(fn[3] || "").trim();
      if (naam && !/-MNT$/i.test(naam) && !/^RIPE|NCC/i.test(naam)) namen.push(naam);
    }
    // Bij een blok dat een provider aan een organisatie heeft toegewezen staat de naam
    // vaak in de omschrijving (descr) of in de netwerknaam.
    const omschrijving = ((d.remarks || []).find((r) => Array.isArray(r.description))?.description || [])
      .map((x) => String(x).trim()).find((x) => x && !/^[-=*#\s]+$/.test(x) && !/https?:|@|see |report|abuse|\d/i.test(x)) || "";
    const netnaam = String(d.name || "");
    const kandidaten = [namen[0] || "", omschrijving].filter(Boolean);
    if (PROVIDER_RE.test(netnaam) || /^NL-|^[A-Z]{2}-[A-Z]+-[A-Z]+-\d+/.test(netnaam)) return null;
    const naam = kandidaten.find((n) => !PROVIDER_RE.test(n)) || "";
    if (!naam) return null;
    return naam.slice(0, 100);
  } catch {
    return null;
  }
}

/** Verwerkt één paginabezoek. */
export async function registreer(req, ctx, store, opties = {}) {
  const ua = req.headers.get("user-agent") || "";
  if (!ua || BOT_RE.test(ua)) return { genegeerd: "bot" };
  // Bezoeken van Bram en Tom (ingelogd in het portaal) tellen niet mee.
  if (/(^|;\s*)pn_session=/.test(req.headers.get("cookie") || "")) return { genegeerd: "eigen" };
  let body;
  try { body = await req.json(); } catch { return { genegeerd: "invoer" }; }
  const pad = String(body.pad || "/").split("?")[0].split("#")[0].slice(0, 120) || "/";
  if (/^\/(portaal|auth|api|\.netlify)/.test(pad)) return { genegeerd: "intern" };
  const nu = new Date();
  const dag = vandaag(nu);
  const ip = ctx?.ip || "";
  const zout = await dagZout(store, dag);
  const bezoeker = (await sha256(`${zout}|${ip}|${ua}`)).slice(0, 16);
  const geo = ctx?.geo || {};
  const host = new URL(req.url).hostname.replace(/^www\./, "");
  const ev = {
    t: nu.toISOString(),
    b: bezoeker,
    pad,
    bron: herkomst(String(body.ref || ""), host, String(body.utm || "")),
    land: geo.country?.name || geo.country?.code || "",
    regio: geo.subdivision?.name || "",
    stad: geo.city || "",
    apparaat: apparaat(ua),
    browser: browser(ua),
  };
  // "extra" = alleen de bedrijfsnaam aanvullen nadat de bezoeker later alsnog akkoord gaf;
  // telt niet als extra paginaweergave.
  if (body.extra === true) ev.x = 1;
  if (body.toestemming === true && body.eerste === true) {
    const org = await (opties.organisatie || organisatie)(ip);
    if (org) ev.bedrijf = org;
  }
  const id = `${nu.getTime().toString(36)}-${hex(crypto.getRandomValues(new Uint8Array(4)))}`;
  await store.setJSON(`e/${dag}/${id}`, ev);
  return { ok: true };
}

// ---------- overzicht voor het dashboard ----------

function telOp(map, k, n = 1) { if (k) map[k] = (map[k] || 0) + n; }

/** Maakt een dagoverzicht uit losse bezoeken. */
function vatSamen(dag, evs) {
  const s = { dag, weergaven: evs.length, bezoekers: 0, paginas: {}, bronnen: {}, steden: {}, landen: {}, apparaten: {}, browsers: {}, bedrijven: [] };
  const perBezoeker = new Map();
  s.weergaven = 0;
  for (const e of evs) {
    if (!perBezoeker.has(e.b)) perBezoeker.set(e.b, []);
    perBezoeker.get(e.b).push(e);
    if (!e.x) { s.weergaven++; telOp(s.paginas, e.pad); }
  }
  s.bezoekers = perBezoeker.size;
  for (const lijst of perBezoeker.values()) {
    lijst.sort((a, b) => (a.t < b.t ? -1 : 1));
    const eerste = lijst[0];
    telOp(s.bronnen, eerste.bron);
    telOp(s.steden, [eerste.stad, eerste.land === "Netherlands" ? "" : eerste.land].filter(Boolean).join(", "));
    telOp(s.landen, eerste.land);
    telOp(s.apparaten, eerste.apparaat);
    telOp(s.browsers, eerste.browser);
    const bedrijf = lijst.find((e) => e.bedrijf)?.bedrijf;
    if (bedrijf) {
      s.bedrijven.push({
        naam: bedrijf,
        plaats: eerste.stad || "",
        land: eerste.land || "",
        tijd: eerste.t,
        bron: eerste.bron,
        paginas: [...new Set(lijst.map((e) => e.pad))],
      });
    }
  }
  return s;
}

async function evsVanDag(store, dag) {
  const { blobs } = await store.list({ prefix: `e/${dag}/` });
  const out = [];
  for (let i = 0; i < blobs.length; i += 25) {
    const deel = await Promise.all(blobs.slice(i, i + 25).map((b) => store.get(b.key, { type: "json" })));
    out.push(...deel.filter(Boolean));
  }
  return out;
}

export async function overzicht(store, dagen = 30, nu = new Date()) {
  dagen = Math.min(400, Math.max(1, dagen | 0));
  const vandaagStr = vandaag(nu);
  const lijst = [];
  for (let i = dagen - 1; i >= 0; i--) {
    const d = new Date(nu.getTime() - i * 86400000);
    lijst.push(vandaag(d));
  }
  const res = await Promise.all(lijst.map(async (dag) => {
    if (dag === vandaagStr) return vatSamen(dag, await evsVanDag(store, dag));
    const opgeslagen = await store.get(`s/${dag}`, { type: "json" });
    if (opgeslagen) return opgeslagen;
    const s = vatSamen(dag, await evsVanDag(store, dag));
    await store.setJSON(`s/${dag}`, s);
    return s;
  }));
  // Opruimen: losse bezoeken ouder dan de bewaartermijn verwijderen (dagtotaal blijft).
  opruimen(store, nu).catch(() => {});
  const tot = { weergaven: 0, bezoekers: 0, paginas: {}, bronnen: {}, steden: {}, landen: {}, apparaten: {}, browsers: {} };
  const bedrijven = [];
  for (const s of res) {
    tot.weergaven += s.weergaven;
    tot.bezoekers += s.bezoekers;
    for (const k of ["paginas", "bronnen", "steden", "landen", "apparaten", "browsers"]) {
      for (const [n, v] of Object.entries(s[k] || {})) telOp(tot[k], n, v);
    }
    bedrijven.push(...(s.bedrijven || []));
  }
  bedrijven.sort((a, b) => (a.tijd < b.tijd ? 1 : -1));
  return {
    dagen: res.map((s) => ({ dag: s.dag, bezoekers: s.bezoekers, weergaven: s.weergaven })),
    totaal: tot,
    bedrijven,
  };
}

async function opruimen(store, nu) {
  const grens = vandaag(new Date(nu.getTime() - BEWAAR_DAGEN * 86400000));
  const { blobs } = await store.list({ prefix: "e/" });
  const oud = blobs.filter((b) => b.key.slice(2, 12) < grens);
  for (const b of oud.slice(0, 500)) await store.delete(b.key);
  // Dagtotalen (met eventuele bedrijfsnamen) maximaal 13 maanden bewaren.
  const grensTotaal = vandaag(new Date(nu.getTime() - 400 * 86400000));
  for (const b of (await store.list({ prefix: "s/" })).blobs) if (b.key.slice(2) < grensTotaal) await store.delete(b.key);
  const zouten = (await store.list({ prefix: "zout/" })).blobs.filter((b) => b.key.slice(5) < vandaag(nu));
  for (const b of zouten) await store.delete(b.key);
}
