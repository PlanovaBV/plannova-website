// Openbare lijst van gepubliceerde projecten en de bijbehorende foto's.
import { getStore } from "@netlify/blobs";
import { openbaar } from "../lib/portfolio.mjs";

export default async (req: Request) => {
  const store = getStore({ name: "portfolio", consistency: "strong" });
  return openbaar(req, store);
};

export const config = { path: ["/api/projecten", "/api/foto/*"] };
