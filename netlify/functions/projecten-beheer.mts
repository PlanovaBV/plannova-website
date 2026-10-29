// Beheer van het portfolio (alleen voor Bram en Tom, na inloggen met Microsoft 365).
// De edge function portaal-auth controleert de sessie al voor alles onder /portaal;
// deze functie controleert de sessie voor de zekerheid nog een keer zelf.
import { getStore } from "@netlify/blobs";
import { verifyIdToken } from "../edge-functions/portaal-auth.ts";
import { beheer } from "../lib/portfolio.mjs";

function sessie(req: Request): string {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === "pn_session") return part.slice(i + 1).trim();
  }
  return "";
}

export default async (req: Request) => {
  const claims = await verifyIdToken(sessie(req));
  if (!claims) {
    return new Response(JSON.stringify({ fout: "Je sessie is verlopen. Log opnieuw in." }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const gebruiker = String(claims.preferred_username || "").toLowerCase();
  const store = getStore({ name: "portfolio", consistency: "strong" });
  return beheer(req, store, gebruiker);
};

export const config = { path: ["/portaal/api/projecten", "/portaal/api/foto"] };
