import { httpsUrl, required } from "../_lib/config.js";

const CONTACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed." }, 405);
  }
  const contactId = new URL(request.url).searchParams.get("contact_id")?.trim();
  if (!contactId || !CONTACT_ID.test(contactId)) {
    return json({ error: "A valid contact_id is required." }, 400);
  }
  let apiKey, apiBaseUrl;
  try {
    apiKey = required(env, "SLEEKFLOW_API_KEY");
    apiBaseUrl = httpsUrl(env, "SLEEKFLOW_API_BASE_URL");
  } catch {
    return json({ error: "Contact lookup is unavailable." }, 503);
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/contact/${contactId}`, {
      headers: {
        Accept: "application/json",
        "X-Sleekflow-Api-Key": apiKey,
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) {
      return json({ error: "Unable to load contact." }, response.status === 404 ? 404 : 502);
    }
    const contact = await response.json();
    if (!contact || typeof contact !== "object" || Array.isArray(contact)) {
      return json({ error: "Unable to load contact." }, 502);
    }
    const value = (field) => typeof contact[field] === "string" ? contact[field].trim() : "";
    // Return only the fields needed by the widget, never the full CRM record.
    return json({
      firstName: value("FirstName"),
      lastName: value("LastName"),
      phoneNumber: value("PhoneNumber"),
      email: value("Email"),
    });
  } catch {
    return json({ error: "Unable to load contact." }, 502);
  }
}
