import { watchConversationNote } from "/full-view/conversation-note.js";
import { loadWidgetConfig, createWidgetScript } from "/full-view/widget-config.js";

(() => {
  "use strict";

  let root;
  let opened = false;
  let started = false;
  let ready = false;
  let config;
  const contactId = new URLSearchParams(window.location.search).get("contact_id")?.trim().toLowerCase();
  const conversationId = new URLSearchParams(window.location.search).get("conversation_id")?.trim().toLowerCase();
  let contactPending = !!contactId;
  let contactDetails = null;
  let userEdited = false;
  let autoSubmitPending = false;
  let autoSubmitAttempted = false;
  let autoSubmitFallbackReady = false;
  let autoSubmitTimer;
  const populatedForms = new WeakSet();

  // Scope the vendor's persisted sender, messages and tracking session to this
  // contact in this iframe. Anonymous sessions and the homepage keep their keys.
  if (contactId) {
    try {
      const storage = window.localStorage;
      for (const method of ["getItem", "setItem", "removeItem"]) {
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (key, ...args) {
          const scopedKey = this === storage && /^sf-live-chat-(sender|messages|session)(-|$)/.test(key)
            ? `full-view-contact:${contactId}:${key}` : key;
          return original.call(this, scopedKey, ...args);
        };
      }
    } catch {
      // The widget handles browsers where persistent storage is unavailable.
    }
  }
  if (contactId || conversationId) {
    // Keep the CRM identifiers out of vendor page tracking and referrer URLs.
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("contact_id");
    cleanUrl.searchParams.delete("conversation_id");
    window.history.replaceState(null, "", cleanUrl);
  }

  const notify = (type) => window.parent.postMessage({ type }, window.location.origin);

  function showContactNotice(text) {
    const notice = document.getElementById("contact-notice");
    notice.textContent = text;
    notice.hidden = false;
  }

  function setInputValue(input, value) {
    if (!input || !value) return;
    // React tracks the instance's value setter; use the native setter so the
    // widget receives a real change and updates its own validation/state.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  function populateContact(form) {
    if (!contactDetails || userEdited || populatedForms.has(form)) return;
    const name = form.querySelector('input[name="name"], input[id="name"], input[autocomplete="name"]');
    const firstName = form.querySelector('input[name="firstName"], input[autocomplete="given-name"]');
    const lastName = form.querySelector('input[name="lastName"], input[autocomplete="family-name"]');
    const phone = form.querySelector('input[type="tel"]');
    const email = form.querySelector('input[type="email"]');
    if (!(name || firstName) || !phone || !email) return;
    populatedForms.add(form);
    setInputValue(name, [contactDetails.firstName, contactDetails.lastName].filter(Boolean).join(" "));
    setInputValue(firstName, contactDetails.firstName);
    setInputValue(lastName, contactDetails.lastName);
    const phoneNumber = contactDetails.phoneNumber;
    setInputValue(phone, phoneNumber && !phoneNumber.startsWith("+") ? `+${phoneNumber}` : phoneNumber);
    setInputValue(email, contactDetails.email);

    if (autoSubmitAttempted) return;
    autoSubmitPending = true;
    // Give the widget a render to enable its native submit after state updates.
    setTimeout(() => {
      const submit = form.querySelector('button[type="submit"]');
      autoSubmitAttempted = true;
      const hasRequiredDetails = [contactDetails.firstName, contactDetails.lastName].some((value) => value.trim())
        && (!phone.required || phoneNumber.trim())
        && (!email.required || contactDetails.email.trim());
      if (!userEdited && hasRequiredDetails && form.isConnected && submit && !submit.disabled && form.checkValidity()) {
        form.requestSubmit(submit);
        // Allow a rejected/invalid form to become editable, but keep loading
        // while the widget's disabled submit indicates an in-flight request.
        autoSubmitTimer = setTimeout(() => {
          autoSubmitFallbackReady = true;
          sync();
        }, 8000);
      } else {
        autoSubmitPending = false;
        showContactNotice("Please complete your details to start the chat.");
        sync();
      }
    }, 0);
  }

  async function loadContact() {
    if (!contactId) return;
    try {
      const url = new URL("/api/contact", window.location.origin);
      url.searchParams.set("contact_id", contactId);
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("Contact lookup failed");
      const data = await response.json();
      if (!data || !["firstName", "lastName", "phoneNumber", "email"].every((key) => typeof data[key] === "string")) {
        throw new Error("Invalid contact details");
      }
      contactDetails = data;
    } catch {
      showContactNotice("We couldn’t load your contact details. Please fill out the form to start the chat.");
    } finally {
      contactPending = false;
      sync();
    }
  }

  function sync() {
    const host = document.getElementById("sleekflow-widget-container");
    if (!host?.shadowRoot) return;
    if (!root) {
      root = host.shadowRoot;
      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = "/full-view/widget-layout.css";
      root.appendChild(stylesheet);
      root.addEventListener("input", (event) => { if (event.isTrusted) userEdited = true; });
      root.addEventListener("submit", (event) => { if (event.isTrusted) autoSubmitAttempted = true; });
      new MutationObserver(sync).observe(root, {
        childList: true, characterData: true, subtree: true,
        attributes: true, attributeFilter: ["disabled"],
      });
      new MutationObserver(() => {
        if (host.style.display === "none") window.SleekFlowWidget?.open();
      }).observe(host, { attributes: true, attributeFilter: ["style"] });
      document.getElementById("chat-client").appendChild(host);
    }

    const toggle = root.querySelector('[data-testid="chat-widget-button"]');
    if (toggle && !opened && !toggle.disabled) {
      opened = true;
      toggle.click();
    }
    // Navigate the native landing screen; contact links also populate and
    // submit the pre-chat form below. Message-send controls are never clicked.
    if (opened && !started && !root.querySelector("input, textarea, [contenteditable='true']")) {
      const start = Array.from(root.querySelectorAll("button")).find((button) =>
        /^(start chat|start chatting|back to conversation|continue chatting)$/i.test(button.textContent.trim()) && !button.closest("form")
      );
      if (start && !start.disabled) { started = true; start.click(); }
    }

    const form = root.querySelector("form");
    const contact = !!root.querySelector('input[type="email"], input[type="tel"], input[name="name"]');
    document.body.dataset.view = contact ? "contact" : "conversation";
    host.dataset.fullView = contact ? "contact" : "conversation";
    if (form && contact) {
      if (!contactPending) populateContact(form);
      form.setAttribute("data-contact-form", "");
      form.parentElement.setAttribute("data-contact-card", "");
      // Let the provider's real form fill the reading column. Retain every
      // field, its validation, and the configured consent disclaimer.
      let element = form.parentElement.parentElement;
      while (element && element.id !== "sleekflow-widget-app") {
        const overflow = getComputedStyle(element).overflowY;
        if (overflow === "auto" || overflow === "scroll") {
          element.setAttribute("data-contact-scroll", "");
          break;
        }
        element.setAttribute("data-contact-path", "");
        element = element.parentElement;
      }
    }
    const heading = root.querySelector("h1, h2");
    const header = heading?.closest('div[class~="sf:min-h-18"]');
    if (header) {
      if (config && heading.textContent !== config.chatTitle) {
        heading.textContent = config.chatTitle;
      }
      header.setAttribute("data-full-view-header", "");
      header.parentElement.setAttribute("data-widget-window", "");
      header.querySelector(":scope > div:last-child button")?.setAttribute("data-full-view-minimize", "");
      header.querySelector(":scope > button:first-child")?.setAttribute("data-full-view-back", "");
    }
    // Hide sender labels independently of the account's configured agent names.
    for (const label of root.querySelectorAll('p > span[class~="sf:text-xs"][class~="sf:text-gray-600"]')) {
      label.parentElement.toggleAttribute("data-hidden-agent-name", config?.hideAgentNames ?? true);
    }
    const app = root.getElementById("sleekflow-widget-app");
    const viewport = app?.firstElementChild;
    if (viewport && viewport.tagName === "DIV") viewport.setAttribute("data-widget-viewport", "");

    const composer = !contact && root.querySelector("textarea, [contenteditable='true']");
    if (composer) {
      autoSubmitPending = false;
      clearTimeout(autoSubmitTimer);
    } else if (autoSubmitPending && autoSubmitFallbackReady && contact && form) {
      const submit = form.querySelector('button[type="submit"]');
      if (submit && !submit.disabled) {
        autoSubmitPending = false;
        showContactNotice("Please check your details and start the chat.");
      }
    }
    if (!ready && !contactPending && !autoSubmitPending && ((contact && form) || composer)) {
      ready = true;
      notify("full-view-ready");
    }
  }

  new MutationObserver(sync).observe(document.body, { childList: true, subtree: true });
  async function startWidget() {
    try {
      config = await loadWidgetConfig();
      document.getElementById("welcome-title").textContent = config.welcomeTitle;
      document.getElementById("welcome-subtitle").textContent = config.welcomeSubtitle;
      document.getElementById("welcome-note-text").textContent = config.welcomeNote;
      watchConversationNote({ contactId, conversationId, widgetId: config.widgetId, widgetApiBaseUrl: config.widgetApiBaseUrl });
      document.body.appendChild(createWidgetScript(config, () => notify("full-view-error")));
      sync();
    } catch {
      notify("full-view-error");
    }
  }
  startWidget();
  loadContact();
  sync();
})();
