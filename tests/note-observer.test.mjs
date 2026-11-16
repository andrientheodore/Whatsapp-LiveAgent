import assert from "node:assert/strict";
import { test } from "node:test";
import { watchConversationNote } from "../full-view/conversation-note.js";

const contactId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const senderId = "33333333-3333-4333-8333-333333333333";
const widgetId = "66666666-6666-4666-8666-666666666666";
const base = "https://widget-api.example/LiveChatV2/Public/Senders/";
const options = { contactId, conversationId, widgetId, widgetApiBaseUrl: "https://widget-api.example" };
const flush = () => new Promise((resolve) => setImmediate(resolve));

function environment(storage = new Map(), answer = async () => Response.json({ ok: true })) {
  const requests = [];
  const warnings = [];
  class XHR extends EventTarget {
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader() {}
    send(body) { this.body = body; }
    respond(status, body) { this.status = status; this.responseText = JSON.stringify(body); this.dispatchEvent(new Event("load")); }
  }
  const browser = {
    XMLHttpRequest: XHR, FormData, location: { href: "https://widget.example/full-view/session" },
    console: { warn: (message) => warnings.push(message) }, navigator: { locks: { request: async (_, action) => action() } },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    fetch: async (url, init) => { requests.push({ url, init }); return answer(); },
  };
  return { browser, requests, warnings, storage };
}
function submit(browser, { status = 200, contactForm = true, origin = base } = {}) {
  const xhr = new browser.XMLHttpRequest();
  xhr.open("POST", `${origin}${senderId}/Channels/${widgetId}/Messages`);
  xhr.setRequestHeader("X-Sleekflow-LiveChat-Signature", "signed-widget-session");
  const form = new FormData();
  form.set("extendedMessagePayload", JSON.stringify(contactForm ? { extendedMessageType: 501,
    extendedMessagePayloadDetail: { liveChatV2MessageObject: { contact_form: { type: "livechatv2_contact_form" } } } } : {}));
  xhr.send(form);
  xhr.respond(status, { conversationId });
  return xhr;
}

test("records a successful native form submission with both supplied IDs and preserves the vendor request", async () => {
  const env = environment(); watchConversationNote(options, env.browser);
  const xhr = submit(env.browser); await flush();
  assert.equal(xhr.method, "POST"); assert.ok(xhr.body instanceof FormData);
  assert.equal(env.requests.length, 1);
  assert.equal(env.requests[0].url, "/api/conversation-note");
  assert.deepEqual(JSON.parse(env.requests[0].init.body), { contactId, conversationId, senderId, sessionSignature: "signed-widget-session" });
  assert.equal([...env.storage.values()][0], "sent");
  submit(env.browser); await flush();
  assert.equal(env.requests.length, 1);
  const reloaded = environment(env.storage); watchConversationNote(options, reloaded.browser);
  submit(reloaded.browser); await flush();
  assert.equal(reloaded.requests.length, 0);
});

test("does not install observers without both valid URL parameters", async () => {
  for (const change of [{ contactId: undefined }, { conversationId: undefined }, { conversationId: "invalid" }]) {
    const env = environment(); const open = env.browser.XMLHttpRequest.prototype.open;
    watchConversationNote({ ...options, ...change }, env.browser);
    assert.equal(env.browser.XMLHttpRequest.prototype.open, open);
    submit(env.browser); await flush(); assert.equal(env.requests.length, 0);
  }
});

test("ignores failed forms, chat messages and untrusted origins", async () => {
  const env = environment(); watchConversationNote(options, env.browser);
  submit(env.browser, { status: 500 }); submit(env.browser, { contactForm: false });
  submit(env.browser, { origin: "https://other.example/LiveChatV2/Public/Senders/" });
  await flush(); assert.equal(env.requests.length, 0);
});

test("handles an already-submitted sender without re-submitting the contact form", async () => {
  const env = environment(); watchConversationNote(options, env.browser);
  const xhr = new env.browser.XMLHttpRequest();
  xhr.open("GET", base + senderId); xhr.setRequestHeader("x-sleekflow-livechat-signature", "signed-widget-session"); xhr.send();
  xhr.respond(200, { sender: { channelIdentityId: widgetId, conversationId, userProfileId: contactId, metadata: { contact_form: {} } } });
  await flush(); assert.equal(env.requests.length, 1);
});

test("keeps ambiguous writes from automatically repeating after reload", async () => {
  const env = environment(new Map(), async () => { throw new TypeError("Connection lost"); });
  watchConversationNote(options, env.browser); submit(env.browser); await flush();
  assert.equal([...env.storage.values()][0], "unknown"); assert.equal(env.warnings.length, 1);
  const reloaded = environment(env.storage); watchConversationNote(options, reloaded.browser);
  submit(reloaded.browser); await flush(); assert.equal(reloaded.requests.length, 0);
});

test("a definite rejection can be retried on reload without a loop in the current page", async () => {
  const env = environment(new Map(), async () => Response.json({ mayHaveSent: false }, { status: 503 }));
  watchConversationNote(options, env.browser); submit(env.browser); await flush();
  assert.equal(env.storage.size, 0);
  submit(env.browser); await flush(); assert.equal(env.requests.length, 1);
  const reloaded = environment(env.storage); watchConversationNote(options, reloaded.browser);
  submit(reloaded.browser); await flush(); assert.equal(reloaded.requests.length, 1);
});

test("observes only the configured backend origin and base path", async () => {
  const env = environment();
  watchConversationNote({ ...options, widgetApiBaseUrl: "https://custom-widget.example/backend/" }, env.browser);
  submit(env.browser);
  submit(env.browser, { origin: "https://custom-widget.example/LiveChatV2/Public/Senders/" });
  await flush();
  assert.equal(env.requests.length, 0);
  submit(env.browser, { origin: "https://custom-widget.example/backend/LiveChatV2/Public/Senders/" });
  await flush();
  assert.equal(env.requests.length, 1);
});
