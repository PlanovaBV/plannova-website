// Portfolio: opslag en regels voor projecten en foto's.
// Wordt gebruikt door de Netlify Functions in netlify/functions/.
// `store` is een Netlify Blobs-store (of een nep-store bij lokaal testen).

export const STATUSSEN = {
  "in-voorbereiding": "In voorbereiding",
  "in-aanbouw": "In aanbouw",
  "opgeleverd": "Opgeleverd",
};

const MAX_FOTO_BYTES = 6 * 1024 * 1024;
const MAX_FOTOS = 24;
const FOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const ID_RE = /^[a-z0-9-]{8,64}$/;
const FOTO_RE = /^[a-z0-9-]{8,64}\.(jpg|png|webp)$/;
// Opleverdatum: jaar ("2027") of jaar en maand ("2027-06").
const MAAND_RE = /^(19|20)\d\d(-(0[1-9]|1[0-2]))?$/;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

const fout = (status, melding) => json({ fout: melding }, status, { "cache-control": "no-store" });

function nieuwId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

function tekst(v, max) {
  return String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

/** Controleert en schoont invoer op. Geeft { project } of { fout }. */
export function valideer(input, bestaand) {
  if (!input || typeof input !== "object") return { fout: "Ongeldige invoer." };
  const titel = tekst(input.titel, 120);
  if (!titel) return { fout: "Vul een titel in." };
  const status = STATUSSEN[input.status] ? input.status : "in-voorbereiding";
  let woningen = null;
  if (input.woningen !== null && input.woningen !== undefined && String(input.woningen).trim() !== "") {
    const n = Number(input.woningen);
    if (!Number.isInteger(n) || n < 0 || n > 100000) return { fout: "Aantal woningen moet een heel getal zijn." };
    woningen = n;
  }
  const oplevering = MAAND_RE.test(String(input.oplevering || "")) ? String(input.oplevering) : "";
  const fotos = Array.isArray(input.fotos) ? input.fotos.filter((f) => typeof f === "string" && FOTO_RE.test(f)) : [];
  if (fotos.length > MAX_FOTOS) return { fout: `Maximaal ${MAX_FOTOS} foto's per project.` };
  const nu = new Date().toISOString();
  return {
    project: {
      id: bestaand?.id || nieuwId(),
      titel,
      plaats: tekst(input.plaats, 80),
      status,
      woningen,
      oplevering,
      beschrijving: tekst(input.beschrijving, 6000),
      fotos: [...new Set(fotos)],
      gepubliceerd: input.gepubliceerd === true,
      aangemaakt: bestaand?.aangemaakt || nu,
      gewijzigd: nu,
    },
  };
}

async function alleProjecten(store) {
  const { blobs } = await store.list({ prefix: "project/" });
  const lijst = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  // Volgorde: opleverdatum, nieuwste bovenaan. Zonder datum bovenaan; daarbinnen nieuwst toegevoegd eerst.
  return lijst.filter(Boolean).sort((a, b) => {
    const da = a.oplevering || "9999-99", db = b.oplevering || "9999-99";
    if (da !== db) return da < db ? 1 : -1;
    return a.aangemaakt < b.aangemaakt ? 1 : -1;
  });
}

function publiek(p) {
  return {
    id: p.id,
    titel: p.titel,
    plaats: p.plaats,
    status: p.status,
    statusLabel: STATUSSEN[p.status],
    woningen: p.woningen,
    oplevering: p.oplevering || "",
    beschrijving: p.beschrijving,
    fotos: p.fotos.map((f) => `/api/foto/${f}`),
    aangemaakt: p.aangemaakt,
  };
}

// ---------- beheer (alleen na inloggen) ----------

export async function beheer(req, store, gebruiker) {
  const url = new URL(req.url);
  const pad = url.pathname.replace(/\/+$/, "");

  if (req.method !== "GET") {
    // Alleen verzoeken vanaf de eigen website accepteren.
    const origin = req.headers.get("origin");
    if (!origin || new URL(origin).host !== url.host) return fout(403, "Verzoek geweigerd.");
  }

  if (pad === "/portaal/api/projecten") {
    if (req.method === "GET") {
      return json({ projecten: await alleProjecten(store), gebruiker }, 200, { "cache-control": "no-store" });
    }
    if (req.method === "POST") {
      let input;
      try { input = await req.json(); } catch { return fout(400, "Ongeldige invoer."); }
      let bestaand = null;
      if (input?.id) {
        if (!ID_RE.test(input.id)) return fout(400, "Onbekend project.");
        bestaand = await store.get(`project/${input.id}`, { type: "json" });
        if (!bestaand) return fout(404, "Dit project bestaat niet meer.");
      }
      const { project, fout: f } = valideer(input, bestaand);
      if (f) return fout(400, f);
      project.gewijzigdDoor = gebruiker;
      await store.setJSON(`project/${project.id}`, project);
      // Foto's die uit het project zijn gehaald, opruimen.
      if (bestaand) {
        for (const oud of bestaand.fotos || []) {
          if (!project.fotos.includes(oud)) await store.delete(`foto/${oud}`);
        }
      }
      return json({ project }, 200, { "cache-control": "no-store" });
    }
    if (req.method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      if (!ID_RE.test(id)) return fout(400, "Onbekend project.");
      const bestaand = await store.get(`project/${id}`, { type: "json" });
      if (bestaand) {
        for (const f of bestaand.fotos || []) await store.delete(`foto/${f}`);
        await store.delete(`project/${id}`);
      }
      return json({ ok: true }, 200, { "cache-control": "no-store" });
    }
    return fout(405, "Niet toegestaan.");
  }

  if (pad === "/portaal/api/foto") {
    if (req.method !== "POST") return fout(405, "Niet toegestaan.");
    let type = (req.headers.get("content-type") || "").split(";")[0].trim();
    let data;
    if (type === "application/json") {
      // Foto overnemen vanaf een link (https), bijvoorbeeld van een bestaande website.
      let bron;
      try { bron = new URL(String((await req.json()).url || "")); } catch { return fout(400, "Ongeldige link."); }
      if (bron.protocol !== "https:" || /^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(bron.hostname) || !bron.hostname.includes(".")) {
        return fout(400, "Alleen https-links naar een website.");
      }
      const r = await fetch(bron, { redirect: "follow" }).catch(() => null);
      if (!r || !r.ok) return fout(400, "De foto kon niet worden opgehaald.");
      type = (r.headers.get("content-type") || "").split(";")[0].trim();
      if (!FOTO_TYPES[type]) return fout(415, "Deze link is geen JPG, PNG of WebP.");
      data = await r.arrayBuffer();
    } else {
      data = await req.arrayBuffer();
    }
    const ext = FOTO_TYPES[type];
    if (!ext) return fout(415, "Alleen JPG, PNG of WebP.");
    if (!data.byteLength) return fout(400, "Lege foto.");
    if (data.byteLength > MAX_FOTO_BYTES) return fout(413, "Deze foto is te groot.");
    const key = `${nieuwId()}.${ext}`;
    await store.set(`foto/${key}`, data, { metadata: { type, door: gebruiker } });
    return json({ foto: key, url: `/api/foto/${key}` }, 200, { "cache-control": "no-store" });
  }

  return fout(404, "Niet gevonden.");
}

// ---------- openbaar ----------

export async function openbaar(req, store) {
  const url = new URL(req.url);
  if (req.method !== "GET" && req.method !== "HEAD") return fout(405, "Niet toegestaan.");

  if (url.pathname.replace(/\/+$/, "") === "/api/projecten") {
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "100", 10) || 100));
    const lijst = (await alleProjecten(store)).filter((p) => p.gepubliceerd).slice(0, limit).map(publiek);
    return json({ projecten: lijst }, 200, { "cache-control": "public, max-age=0, must-revalidate", "netlify-cdn-cache-control": "public, max-age=30" });
  }

  const m = url.pathname.match(/^\/api\/foto\/([a-z0-9-]{8,64}\.(?:jpg|png|webp))$/);
  if (m) {
    const res = await store.getWithMetadata(`foto/${m[1]}`, { type: "arrayBuffer" });
    if (!res) return new Response("Niet gevonden", { status: 404 });
    return new Response(res.data, {
      headers: {
        "content-type": res.metadata?.type || "image/jpeg",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }
  return fout(404, "Niet gevonden.");
}
