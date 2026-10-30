// Ontvangt paginabezoeken van de website (zonder cookies). Zie ../lib/statistiek.mjs.
import { getStore } from "@netlify/blobs";
import { registreer } from "../lib/statistiek.mjs";

export default async (req: Request, context: any) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  try {
    const store = getStore({ name: "statistiek", consistency: "strong" });
    await registreer(req, context, store);
  } catch {
    // Statistiek mag de website nooit hinderen.
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
};

export const config = { path: "/api/bezoek" };
