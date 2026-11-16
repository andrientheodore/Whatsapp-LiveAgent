import { httpsUrl, required, widgetId } from "../_lib/config.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
const failure = (error, status, mayHaveSent = false) => json({ error, mayHaveSent }, status);

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return failure("Origin not allowed.", 403);
  let input;
  try { input = await request.json(); } catch { return failure("Invalid JSON.", 400); }
  const { contactId, conversationId, senderId, sessionSignature } = input || {};
  if (![contactId, conversationId, senderId].every((id) => typeof id === "string" && UUID.test(id))
    || typeof sessionSignature !== "string" || !sessionSignature || sessionSignature.length > 4096
    || /[\r\n]/.test(sessionSignature)) return failure("Invalid conversation details.", 400);
  let apiKey, apiBaseUrl, widgetApiBaseUrl, appBaseUrl, configuredWidgetId, region;
  try {
    apiKey = required(env, "SLEEKFLOW_API_KEY");
    apiBaseUrl = httpsUrl(env, "SLEEKFLOW_API_BASE_URL");
    widgetApiBaseUrl = httpsUrl(env, "SLEEKFLOW_WIDGET_API_BASE_URL");
    appBaseUrl = httpsUrl(env, "SLEEKFLOW_APP_BASE_URL");
    configuredWidgetId = widgetId(env, "SLEEKFLOW_WIDGET_ID");
    region = required(env, "SLEEKFLOW_REGION");
  } catch { return failure("Conversation notes are unavailable.", 503); }

  // Resolve the created IDs from SleekFlow using the signed widget session;
  // never accept client-provided destination links or a note message.
  let sender;
  try {
    const signal = AbortSignal.timeout(8000);
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(`${widgetApiBaseUrl}/LiveChatV2/Public/Senders/${senderId}`, {
        headers: {
          Accept: "application/json",
          "X-Sleekflow-Location": region,
          "X-Sleekflow-LiveChat-Signature": sessionSignature,
        }, signal,
      });
      if (!response.ok) return failure("Unable to verify the widget session.", 502);
      sender = (await response.json())?.sender;
      if (sender?.id !== senderId || sender?.channelIdentityId?.toLowerCase() !== configuredWidgetId) {
        return failure("Widget session does not match.", 403);
      }
      if (UUID.test(sender.conversationId) && UUID.test(sender.userProfileId) && sender.metadata?.contact_form) break;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  } catch { return failure("Unable to verify the widget session.", 502); }
  if (!UUID.test(sender?.conversationId) || !UUID.test(sender?.userProfileId) || !sender?.metadata?.contact_form) {
    return failure("The contact form has not finished creating the conversation.", 409);
  }

  const label = env.CONVERSATION_NOTE_LABEL?.trim() || "User initiated a live chat conversation";
  const messageContent = `${label} - ${appBaseUrl}/inbox?conversationId=${sender.conversationId}`
    + ` - Contact Created - ${appBaseUrl}/contacts/${sender.userProfileId}`;
  try {
    const response = await fetch(`${apiBaseUrl}/api/message/send/note`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Sleekflow-Api-Key": apiKey },
      body: JSON.stringify({ conversationId, messageContent }),
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return failure("Unable to create the internal note.", 502, response.status >= 500);
    return json({ ok: true, createdConversationId: sender.conversationId, createdContactId: sender.userProfileId });
  } catch {
    // The write may have reached SleekFlow even if its response was lost.
    return failure("The internal note result could not be confirmed.", 502, true);
  }
}
