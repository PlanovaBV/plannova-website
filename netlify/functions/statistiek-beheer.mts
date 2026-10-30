// Dashboardgegevens voor het portaal (alleen Bram en Tom, na inloggen).
import { getStore } from "@netlify/blobs";
import { verifyIdToken } from "../edge-functions/portaal-auth.ts";
import { overzicht } from "../lib/statistiek.mjs";

function sessie(req: Request): string {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)pn_session=([^;]+)/);
  return m ? m[1] : "";
}

export default async (req: Request) => {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (!(await verifyIdToken(sessie(req)))) {
    return new Response(JSON.stringify({ fout: "Je sessie is verlopen. Log opnieuw in." }), { status: 401, headers });
  }
  const dagen = parseInt(new URL(req.url).searchParams.get("dagen") || "30", 10) || 30;
  const store = getStore({ name: "statistiek", consistency: "strong" });
  return new Response(JSON.stringify(await overzicht(store, dagen)), { headers });
};

export const config = { path: "/portaal/api/statistieken" };
