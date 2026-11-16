import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = (await readFile(new URL("../full-view/session.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "");
const details = { firstName: "Test", lastName: "Visitor", phoneNumber: "12025550100", email: "test@example.com" };

async function session({ contact = true, lookupFails = false, contactDetails = details } = {}) {
  const messages = [];
  const timers = new Map();
  const observers = new Map();
  let clock = 0;
  let nextTimer = 0;
  let contactVisible = true;
  let composerVisible = false;
  let intermediateInput = false;
  let submissions = 0;
  class Input extends EventTarget {
    required = true;
    get value() { return this.text || ""; }
    set value(text) { this.text = text; }
  }
  const name = new Input();
  const phone = new Input();
  const email = new Input();
  const submit = { disabled: false };
  const app = { id: "sleekflow-widget-app" };
  const wrapper = { parentElement: app, setAttribute() {} };
  const form = {
    parentElement: { parentElement: wrapper, setAttribute() {} },
    isConnected: true,
    querySelector(selector) {
      if (selector.includes('type="submit"')) return submit;
      if (selector.includes('name="name"')) return name;
      if (selector.includes('type="tel"')) return phone;
      if (selector.includes('type="email"')) return email;
      return null;
    },
    setAttribute() {}, checkValidity: () => true,
    requestSubmit() { submissions++; submit.disabled = true; },
  };
  const root = {
    querySelector(selector) {
      if (selector === "form") return contactVisible ? form : null;
      if (selector.includes('type="email"')) return contactVisible ? email : null;
      if (selector === "input, textarea, [contenteditable='true']") return contactVisible ? name : composerVisible || intermediateInput ? {} : null;
      if (selector.includes("textarea")) return composerVisible ? {} : null;
      return null;
    },
    querySelectorAll: () => [], getElementById: () => app,
    appendChild() {}, addEventListener() {},
  };
  const host = { shadowRoot: root, dataset: {}, style: {} };
  const notice = { hidden: true, textContent: "" };
  const body = { dataset: {}, appendChild() {} };
  const document = {
    body,
    getElementById: (id) => ({ "sleekflow-widget-container": host, "contact-notice": notice, "chat-client": { appendChild() {} }, "welcome-title": {}, "welcome-subtitle": {}, "welcome-note-text": {} })[id],
    createElement: () => ({}), querySelector: () => null,
  };
  class Observer {
    constructor(callback) { this.callback = callback; }
    observe(target, options) { observers.set(target, { callback: this.callback, options }); }
  }
  const storage = {};
  const window = {
    location: new URL(`https://widget.example/full-view/session.html${contact ? "?contact_id=11111111-1111-4111-8111-111111111111" : ""}`),
    history: { replaceState() {} }, localStorage: storage,
    parent: { postMessage: (message) => messages.push(message.type) },
  };
  vm.runInNewContext(source, {
    window, document, HTMLInputElement: Input, Event, URL, URLSearchParams, AbortSignal,
    Storage: class {}, MutationObserver: Observer, watchConversationNote() {},
    loadWidgetConfig: async () => ({}), createWidgetScript: () => ({}),
    getComputedStyle: () => ({ overflowY: "auto" }),
    fetch: async () => ({ ok: !lookupFails, json: async () => contactDetails }),
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, time: clock + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  // Complete lookup and the zero-delay native form submission.
  await new Promise((resolve) => setImmediate(resolve));
  function advance(ms) {
    clock += ms;
    for (const [id, timer] of timers) {
      if (timer.time <= clock) { timers.delete(id); timer.callback(); }
    }
  }
  function sync() { observers.get(root).callback(); }
  advance(0);
  return {
    messages, notice, submit, rootOptions: observers.get(root).options,
    advance, sync, get submissions() { return submissions; },
    transition() { contactVisible = false; form.isConnected = false; intermediateInput = true; sync(); },
    conversation() { contactVisible = false; form.isConnected = false; composerVisible = true; sync(); },
  };
}

test("keeps loading through a slow native auto-submit and intermediate renders", async () => {
  const env = await session();
  assert.equal(env.submissions, 1);
  env.advance(9000);
  assert.deepEqual(env.messages, [], "A pending native submission must stay behind the loading screen");
  env.transition();
  assert.deepEqual(env.messages, [], "An intermediate input is not a ready conversation");
  env.conversation();
  assert.deepEqual(env.messages, ["full-view-ready"]);
  env.advance(8000); env.sync();
  assert.equal(env.submissions, 1);
  assert.deepEqual(env.messages, ["full-view-ready"]);
});

test("reveals an editable form when a slow submission is rejected", async () => {
  const env = await session();
  env.advance(9000);
  assert.deepEqual(env.messages, []);
  assert.equal(env.rootOptions.attributes, true);
  assert.ok(env.rootOptions.attributeFilter.includes("disabled"));
  env.submit.disabled = false; env.sync();
  assert.deepEqual(env.messages, ["full-view-ready"]);
  assert.match(env.notice.textContent, /check your details/);
});

test("reveals the conversation as soon as the composer appears", async () => {
  const env = await session();
  env.conversation();
  assert.deepEqual(env.messages, ["full-view-ready"]);
  env.advance(9000);
  assert.equal(env.notice.hidden, true);
});

test("preserves manual entry for anonymous, failed and incomplete contact lookups", async () => {
  for (const options of [{ contact: false }, { lookupFails: true }, { contactDetails: { ...details, phoneNumber: "" } }]) {
    const env = await session(options);
    assert.deepEqual(env.messages, ["full-view-ready"]);
    assert.equal(env.submissions, 0);
  }
});
