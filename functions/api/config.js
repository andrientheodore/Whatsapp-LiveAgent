import { publicConfig } from "../_lib/config.js";

export function onRequest({ request, env }) {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405, headers });
  }
  try {
    return Response.json(publicConfig(env), { headers });
  } catch {
    return Response.json({ error: "Live chat is not configured. Please contact the site owner." }, { status: 503, headers });
  }
}
