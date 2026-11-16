const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Observe the native widget without changing its requests, responses or state.
export function watchConversationNote({ contactId, conversationId, widgetId, widgetApiBaseUrl }, browser = window) {
  if (![contactId, conversationId, widgetId].every((id) => typeof id === "string" && UUID.test(id))) return;
  let widgetApi;
  try {
    widgetApi = new URL(widgetApiBaseUrl);
    if (widgetApi.protocol !== "https:") return;
  } catch { return; }
  const senderPath = `${widgetApi.pathname.replace(/\/+$/, "")}/LiveChatV2/Public/Senders/`;
  const fetch = browser.fetch.bind(browser);
  const attempted = new Set();
  const warn = () => browser.console.warn("Unable to add the internal conversation note. Chat is still available.");
  const read = (key) => { try { return browser.localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => {
    try {
      if (value === null) browser.localStorage.removeItem(key);
      else browser.localStorage.setItem(key, value);
    } catch { /* In-memory deduplication still applies when storage is blocked. */ }
  };

  async function addNote(senderId, sessionSignature) {
    if (!UUID.test(senderId) || !sessionSignature || attempted.has(senderId)) return;
    attempted.add(senderId);
    const key = `full-view-note:${conversationId}:${senderId}`;
    const send = async () => {
      if (read(key)) return;
      // Retain uncertain outcomes across reloads instead of risking duplicate notes.
      write(key, "pending");
      try {
        const response = await fetch("/api/conversation-note", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId, conversationId, senderId, sessionSignature }),
          signal: AbortSignal.timeout(20000),
        });
        const result = await response.json();
        if (!response.ok || result.ok !== true) {
          write(key, result.mayHaveSent === false ? null : "unknown");
          warn();
          return;
        }
        write(key, "sent");
      } catch {
        write(key, "unknown");
        warn();
      }
    };
    try {
      if (browser.navigator.locks) await browser.navigator.locks.request(key, send);
      else await send();
    } catch { warn(); }
  }

  function inspect({ method, url, signature, contactForm }, response) {
    try {
      const parsed = new URL(url, browser.location.href);
      if (parsed.origin !== widgetApi.origin || !parsed.pathname.startsWith(senderPath)) return;
      const path = parsed.pathname.slice(senderPath.length);
      const sender = path.match(/^([^/]+)$/);
      const submission = path.match(/^([^/]+)\/Channels\/([^/]+)\/Messages$/);
      if (method === "POST" && contactForm && submission?.[2] === widgetId && UUID.test(response?.conversationId)) {
        void addNote(submission[1], signature);
      } else if (method === "GET" && sender && response?.sender?.channelIdentityId === widgetId
        && response.sender.metadata?.contact_form && UUID.test(response.sender.conversationId)
        && UUID.test(response.sender.userProfileId)) {
        // A returning visitor may already have a submitted form in this sender.
        void addNote(sender[1], signature);
      }
    } catch { /* Ignore responses outside the widget's expected JSON contract. */ }
  }

  const prototype = browser.XMLHttpRequest.prototype;
  const open = prototype.open;
  const setRequestHeader = prototype.setRequestHeader;
  const send = prototype.send;
  const requests = new WeakMap();
  prototype.open = function (method, url, ...args) {
    requests.set(this, { method: String(method).toUpperCase(), url: String(url), signature: "" });
    return open.call(this, method, url, ...args);
  };
  prototype.setRequestHeader = function (name, value) {
    const request = requests.get(this);
    if (request && name.toLowerCase() === "x-sleekflow-livechat-signature") request.signature = value;
    return setRequestHeader.call(this, name, value);
  };
  prototype.send = function (body) {
    const request = requests.get(this);
    if (request) {
      try {
        const payload = body instanceof browser.FormData ? JSON.parse(body.get("extendedMessagePayload")) : null;
        request.contactForm = payload?.extendedMessageType === 501
          && payload.extendedMessagePayloadDetail?.liveChatV2MessageObject?.contact_form?.type === "livechatv2_contact_form";
      } catch { request.contactForm = false; }
      this.addEventListener("load", () => {
        if (this.status < 200 || this.status >= 300) return;
        try {
          inspect(request, this.responseType === "json" ? this.response : JSON.parse(this.responseText));
        } catch { /* Non-JSON widget responses are unrelated to contact submission. */ }
      }, { once: true });
    }
    return send.call(this, body);
  };
}
