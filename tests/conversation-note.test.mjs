import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { onRequest } from "../functions/api/conversation-note.js";

const contactId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const senderId = "33333333-3333-4333-8333-333333333333";
const createdConversationId = "44444444-4444-4444-8444-444444444444";
const createdContactId = "55555555-5555-4555-8555-555555555555";
const input = { contactId, conversationId, senderId, sessionSignature: "widget-signature" };
const sender = { id: senderId, conversationId: createdConversationId, userProfileId: createdContactId,
  channelIdentityId: "66666666-6666-4666-8666-666666666666", metadata: { contact_form: { type: "livechatv2_contact_form" } } };
const context = (body = input, env = { SLEEKFLOW_API_KEY: "server-secret", SLEEKFLOW_API_BASE_URL: "https://api.example",
  SLEEKFLOW_WIDGET_API_BASE_URL: "https://widget-api.example", SLEEKFLOW_APP_BASE_URL: "https://app.example/en",
  SLEEKFLOW_WIDGET_ID: sender.channelIdentityId, SLEEKFLOW_REGION: "test-region" }, options = {}) => ({
  request: new Request("https://widget.example/api/conversation-note", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...options,
  }), env,
});
afterEach(() => mock.restoreAll());

test("verifies the signed sender, then writes exact note text to the supplied source conversation", async () => {
  const fetch = mock.method(globalThis, "fetch", async (url, options) => {
    if (url.includes("/Public/Senders/")) {
      assert.equal(url, `https://widget-api.example/LiveChatV2/Public/Senders/${senderId}`);
      assert.equal(options.headers["X-Sleekflow-LiveChat-Signature"], "widget-signature");
      assert.equal(options.headers["X-Sleekflow-Api-Key"], undefined);
      return Response.json({ sender });
    }
    assert.equal(url, "https://api.example/api/message/send/note");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["X-Sleekflow-Api-Key"], "server-secret");
    assert.deepEqual(JSON.parse(options.body), {
      conversationId,
      messageContent: `User initiated a live chat conversation - https://app.example/en/inbox?conversationId=${createdConversationId} - Contact Created - https://app.example/en/contacts/${createdContactId}`,
    });
    return Response.json({ id: "internal-note" });
  });
  const response = await onRequest(context({ ...input, createdConversationId: contactId, messageContent: "untrusted" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, createdConversationId, createdContactId });
  assert.equal(fetch.mock.callCount(), 2);
});

test("requires both supplied IDs and a valid sender credential without making upstream calls", async () => {
  const fetch = mock.method(globalThis, "fetch", () => { throw new Error("Unexpected fetch"); });
  for (const change of [{ contactId: undefined }, { conversationId: undefined }, { senderId: "../other" },
    { sessionSignature: "" }, { sessionSignature: "invalid\r\nheader" }, { sessionSignature: "x".repeat(4097) }]) {
    assert.equal((await onRequest(context({ ...input, ...change }))).status, 400);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("rejects invalid JSON, other methods, and cross-origin writes", async () => {
  assert.equal((await onRequest(context(input, undefined, { body: "{" }))).status, 400);
  assert.equal((await onRequest(context(input, undefined, { method: "GET", body: undefined }))).status, 405);
  assert.equal((await onRequest(context(input, undefined, { headers: { Origin: "https://other.example" } }))).status, 403);
  assert.equal((await onRequest(context(input, {}))).status, 503);
});

test("rejects a different widget or a mismatched sender before writing a note", async () => {
  for (const change of [{ channelIdentityId: contactId }, { id: contactId }]) {
    const fetch = mock.method(globalThis, "fetch", async () => Response.json({ sender: { ...sender, ...change } }));
    assert.equal((await onRequest(context())).status, 403);
    assert.equal(fetch.mock.callCount(), 1);
    mock.restoreAll();
  }
});

test("waits for newly assigned IDs and never writes before a submitted contact form exists", async () => {
  let reads = 0;
  mock.method(globalThis, "fetch", async (url) => {
    if (!url.includes("/Public/Senders/")) return Response.json({ id: "note" });
    return Response.json({ sender: ++reads === 1 ? { ...sender, userProfileId: undefined } : sender });
  });
  assert.equal((await onRequest(context())).status, 200);
  assert.equal(reads, 2);
  mock.restoreAll();
  const fetch = mock.method(globalThis, "fetch", async () => Response.json({ sender: { ...sender, metadata: {} } }));
  const response = await onRequest(context());
  assert.equal(response.status, 409);
  assert.equal((await response.json()).mayHaveSent, false);
  assert.equal(fetch.mock.callCount(), 3);
});

test("verification failures never submit a note or expose upstream errors", async () => {
  for (const answer of [async () => new Response("private", { status: 401 }), async () => new Response("<html>error</html>"),
    async () => { throw new TypeError("private network error"); }]) {
    const fetch = mock.method(globalThis, "fetch", answer);
    const response = await onRequest(context());
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "Unable to verify the widget session.", mayHaveSent: false });
    assert.equal(fetch.mock.callCount(), 1);
    mock.restoreAll();
  }
});

test("does not retry note writes and distinguishes rejected writes from uncertain results", async () => {
  for (const [answer, mayHaveSent] of [
    [async () => new Response("private", { status: 400 }), false],
    [async () => new Response("private", { status: 503 }), true],
    [async () => { throw new DOMException("Timeout", "TimeoutError"); }, true],
  ]) {
    const fetch = mock.method(globalThis, "fetch", async (url) => url.includes("/Public/Senders/") ? Response.json({ sender }) : answer());
    const response = await onRequest(context());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).mayHaveSent, mayHaveSent);
    assert.equal(fetch.mock.callCount(), 2);
    mock.restoreAll();
  }
});

test("uses configured service base paths, region, widget ID and note label", async () => {
  const env = { SLEEKFLOW_API_KEY: "custom-key", SLEEKFLOW_API_BASE_URL: "https://custom-api.example/platform/",
    SLEEKFLOW_WIDGET_API_BASE_URL: "https://custom-widget.example/backend/",
    SLEEKFLOW_APP_BASE_URL: "https://custom-app.example/id/", SLEEKFLOW_WIDGET_ID: contactId,
    SLEEKFLOW_REGION: "custom-region", CONVERSATION_NOTE_LABEL: "Chat started" };
  const fetch = mock.method(globalThis, "fetch", async (url, options) => {
    if (url.includes("/Public/Senders/")) {
      assert.equal(url, `https://custom-widget.example/backend/LiveChatV2/Public/Senders/${senderId}`);
      assert.equal(options.headers["X-Sleekflow-Location"], "custom-region");
      return Response.json({ sender: { ...sender, channelIdentityId: contactId } });
    }
    assert.equal(url, "https://custom-api.example/platform/api/message/send/note");
    assert.equal(options.headers["X-Sleekflow-Api-Key"], "custom-key");
    assert.equal(JSON.parse(options.body).messageContent,
      `Chat started - https://custom-app.example/id/inbox?conversationId=${createdConversationId} - Contact Created - https://custom-app.example/id/contacts/${createdContactId}`);
    return Response.json({ ok: true });
  });
  assert.equal((await onRequest(context(input, env))).status, 200);
  assert.equal(fetch.mock.callCount(), 2);
});
