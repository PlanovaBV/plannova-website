// Afscherming van /portaal met inloggen via Microsoft 365 (Entra ID).
//
// Werking:
//  - /portaal...      zonder geldige sessie -> doorsturen naar /auth/login
//  - /auth/login      stuurt door naar Microsoft (OpenID Connect, id_token via form_post)
//  - /auth/callback   ontvangt het id_token, controleert de handtekening van Microsoft
//                     en de claims, en zet een HttpOnly-sessiecookie
//  - /auth/logout     wist de sessie en logt uit bij Microsoft
//
// Er staan hier geen wachtwoorden of geheime sleutels: tenant-ID en client-ID zijn
// openbare kenmerken (ze staan ook in de inlog-URL). De beveiliging zit in de
// RS256-handtekening van Microsoft, die hieronder met WebCrypto wordt gecontroleerd.

export const TENANT_ID = "VUL_TENANT_ID_IN";
export const CLIENT_ID = "VUL_CLIENT_ID_IN";

// Alleen deze accounts krijgen toegang (kleine letters).
export const ALLOWED = ["bram@planovabv.nl", "tom@planovabv.nl"];

const AUTHORITY = () => `https://login.microsoftonline.com/${TENANT_ID}`;
const ISSUER = () => `${AUTHORITY()}/v2.0`;
const SESSION = "pn_session";
const FLOW = "pn_flow";
const CLOCK_SKEW = 120; // seconden

// ---------- hulpfuncties ----------

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomToken(bytes = 24): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function cookie(name: string, value: string, opts: { maxAge: number; path: string; sameSite: "Lax" | "None" }) {
  return `${name}=${value}; Path=${opts.path}; Max-Age=${opts.maxAge}; HttpOnly; Secure; SameSite=${opts.sameSite}`;
}

function safeReturnTo(v: string | null): string {
  if (!v || !v.startsWith("/portaal") || v.startsWith("//") || v.includes("\\")) return "/portaal/";
  return v;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// ---------- sleutels van Microsoft ----------

type Jwk = { kid: string; kty: string; n: string; e: string };
let jwks: { keys: Jwk[]; at: number } | null = null;

export function _resetKeyCache() { jwks = null; }

async function loadKeys(force = false): Promise<Jwk[]> {
  const fresh = jwks && Date.now() - jwks.at < 6 * 3600 * 1000;
  if (!force && fresh) return jwks!.keys;
  const res = await fetch(`${AUTHORITY()}/discovery/v2.0/keys`);
  if (!res.ok) throw new Error(`JWKS ${res.status}`);
  const body = await res.json();
  jwks = { keys: body.keys || [], at: Date.now() };
  return jwks.keys;
}

async function keyFor(kid: string): Promise<CryptoKey | null> {
  let k = (await loadKeys()).find((x) => x.kid === kid);
  if (!k) k = (await loadKeys(true)).find((x) => x.kid === kid);
  if (!k || k.kty !== "RSA") return null;
  return crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: k.n, e: k.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

export type Claims = { name?: string; preferred_username?: string; email?: string; exp: number; [k: string]: unknown };

/** Controleert handtekening en claims. Geeft de claims terug, of null als het token niet deugt. */
export async function verifyIdToken(token: string, nonce?: string): Promise<Claims | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const header = JSON.parse(dec.decode(b64urlToBytes(parts[0])));
    if (header.alg !== "RS256" || !header.kid) return null;
    const key = await keyFor(header.kid);
    if (!key) return null;
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(parts[2]),
      enc.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;
    const p = JSON.parse(dec.decode(b64urlToBytes(parts[1]))) as Claims;
    const now = Math.floor(Date.now() / 1000);
    if (p.iss !== ISSUER()) return null;
    if (p.aud !== CLIENT_ID) return null;
    if (p.tid !== TENANT_ID) return null;
    if (typeof p.exp !== "number" || p.exp < now - CLOCK_SKEW) return null;
    if (typeof p.nbf === "number" && (p.nbf as number) > now + CLOCK_SKEW) return null;
    if (nonce !== undefined && p.nonce !== nonce) return null;
    const user = String(p.preferred_username || p.email || "").toLowerCase();
    if (!ALLOWED.includes(user)) return null;
    return p;
  } catch {
    return null;
  }
}

// ---------- pagina's ----------

function page(status: number, title: string, body: string, headers: HeadersInit = {}): Response {
  const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} · PlanNova</title>
<style>body{margin:0;background:#F6F3EC;color:#03241E;font:400 17px/1.6 "Public Sans",system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}
main{max-width:30em;border-top:2px solid #03241E;background:#fff;padding:32px}h1{font:600 28px/1.2 "Urbanist",system-ui,sans-serif;margin:0 0 12px}
p{margin:0 0 14px;color:#4F6560}a{color:#03241E}</style></head><body><main><h1>${esc(title)}</h1>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", ...headers },
  });
}

function redirect(location: string, extraCookies: string[] = [], status = 302): Response {
  const h = new Headers({ location, "cache-control": "no-store" });
  for (const c of extraCookies) h.append("set-cookie", c);
  return new Response(null, { status, headers: h });
}

// ---------- routes ----------

function login(url: URL): Response {
  const state = randomToken();
  const nonce = randomToken();
  const returnTo = safeReturnTo(url.searchParams.get("r"));
  const flow = `${state}.${nonce}.${encodeURIComponent(returnTo)}`;
  const auth = new URL(`${AUTHORITY()}/oauth2/v2.0/authorize`);
  auth.search = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "id_token",
    response_mode: "form_post",
    redirect_uri: `${url.origin}/auth/callback`,
    scope: "openid profile email",
    state,
    nonce,
    domain_hint: "planovabv.nl",
  }).toString();
  return redirect(auth.toString(), [cookie(FLOW, flow, { maxAge: 600, path: "/auth", sameSite: "None" })]);
}

async function callback(req: Request): Promise<Response> {
  if (req.method !== "POST") return redirect("/portaal/");
  const form = await req.formData();
  const clearFlow = cookie(FLOW, "", { maxAge: 0, path: "/auth", sameSite: "None" });
  if (form.get("error")) {
    return page(400, "Inloggen is niet gelukt",
      `<p>Microsoft gaf een foutmelding terug. Probeer het opnieuw.</p><p><a href="/auth/login">Opnieuw inloggen</a></p>`,
      { "set-cookie": clearFlow });
  }
  const token = String(form.get("id_token") || "");
  const state = String(form.get("state") || "");
  const [fState, fNonce, fReturn] = (parseCookies(req)[FLOW] || "").split(".");
  if (!fState || state !== fState) {
    return page(400, "Sessie verlopen", `<p>De inlogpoging is verlopen. Probeer het opnieuw.</p><p><a href="/auth/login">Opnieuw inloggen</a></p>`,
      { "set-cookie": clearFlow });
  }
  const claims = await verifyIdToken(token, fNonce);
  if (!claims) {
    return page(403, "Geen toegang",
      `<p>Dit account heeft geen toegang tot het PlanNova-portaal.</p><p><a href="/auth/logout">Uitloggen en met een ander account inloggen</a></p>`,
      { "set-cookie": clearFlow });
  }
  const maxAge = Math.max(60, claims.exp - Math.floor(Date.now() / 1000));
  return redirect(safeReturnTo(decodeURIComponent(fReturn || "")), [
    clearFlow,
    cookie(SESSION, token, { maxAge, path: "/", sameSite: "Lax" }),
  ], 303);
}

function logout(url: URL): Response {
  const ms = new URL(`${AUTHORITY()}/oauth2/v2.0/logout`);
  ms.searchParams.set("post_logout_redirect_uri", `${url.origin}/`);
  return redirect(ms.toString(), [cookie(SESSION, "", { maxAge: 0, path: "/", sameSite: "Lax" })]);
}

// deno-lint-ignore no-explicit-any
export default async function handler(req: Request, context: any): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (TENANT_ID.startsWith("VUL_") || CLIENT_ID.startsWith("VUL_")) {
    return page(503, "Portaal nog niet ingericht", `<p>De koppeling met Microsoft 365 is nog niet ingesteld.</p>`);
  }
  if (path === "/auth/login") return login(url);
  if (path === "/auth/callback") return await callback(req);
  if (path === "/auth/logout") return logout(url);

  // Alles onder /portaal: sessie vereist.
  const claims = await verifyIdToken(parseCookies(req)[SESSION] || "");
  if (!claims) return redirect(`/auth/login?r=${encodeURIComponent(path + url.search)}`);

  const res: Response = await context.next();
  const headers = new Headers(res.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("x-robots-tag", "noindex");
  if (!(headers.get("content-type") || "").includes("text/html")) {
    return new Response(res.body, { status: res.status, headers });
  }
  const name = String(claims.name || claims.preferred_username || "");
  const html = (await res.text())
    .replaceAll("{{VOORNAAM}}", esc(name.split(" ")[0] || name))
    .replaceAll("{{NAAM}}", esc(name))
    .replaceAll("{{EMAIL}}", esc(String(claims.preferred_username || "")));
  headers.delete("content-length");
  return new Response(html, { status: res.status, headers });
}

export const config = { path: ["/portaal", "/portaal/*", "/auth/login", "/auth/callback", "/auth/logout"] };
