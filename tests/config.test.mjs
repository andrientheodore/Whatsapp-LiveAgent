import assert from "node:assert/strict";
import { test } from "node:test";
import { onRequest } from "../functions/api/config.js";
import { httpsUrl } from "../functions/_lib/config.js";

const env = {
  SLEEKFLOW_WIDGET_SCRIPT_URL: "https://cdn.example/widget.js",
  SLEEKFLOW_COMPANY_ID: "77777777-7777-4777-8777-777777777777",
  SLEEKFLOW_WIDGET_ID: "66666666-6666-4666-8666-666666666666",
  SLEEKFLOW_REGION: "custom-region",
  SLEEKFLOW_WIDGET_API_BASE_URL: "https://widget-api.example/custom///",
  SLEEKFLOW_API_KEY: "server-only-secret",
  SLEEKFLOW_API_BASE_URL: "https://private-api.example",
  SLEEKFLOW_APP_BASE_URL: "https://private-app.example",
  UNRELATED_SECRET: "another-secret",
};
const request = new Request("https://widget.example/api/config");

test("publishes only allowed public settings, even when other secrets are bound", async () => {
  const response = onRequest({ request, env });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    scriptUrl: env.SLEEKFLOW_WIDGET_SCRIPT_URL,
    companyId: env.SLEEKFLOW_COMPANY_ID,
    widgetId: env.SLEEKFLOW_WIDGET_ID,
    region: "custom-region",
    widgetApiBaseUrl: "https://widget-api.example/custom",
    chatTitle: "Live support", welcomeTitle: "Hello! Welcome", welcomeSubtitle: "Live support",
    welcomeNote: "Chat directly with our team", hideAgentNames: true,
  });
});

test("reads presentation overrides without interpreting them as markup", async () => {
  const response = onRequest({ request, env: { ...env, CHAT_TITLE: "  Support team  ",
    WELCOME_TITLE: "<b>Welcome</b>", WELCOME_SUBTITLE: "Ask a question", WELCOME_NOTE: "Here to help",
    HIDE_AGENT_NAMES: "false" } });
  const config = await response.json();
  assert.equal(config.chatTitle, "Support team");
  assert.equal(config.welcomeTitle, "<b>Welcome</b>");
  assert.equal(config.welcomeSubtitle, "Ask a question");
  assert.equal(config.welcomeNote, "Here to help");
  assert.equal(config.hideAgentNames, false);
});

test("missing and malformed widget settings fail without exposing environment contents", async () => {
  for (const change of [{ SLEEKFLOW_WIDGET_ID: "" }, { SLEEKFLOW_COMPANY_ID: "not-a-uuid" },
    { SLEEKFLOW_WIDGET_SCRIPT_URL: "javascript:alert(1)" }, { SLEEKFLOW_REGION: "" },
    { SLEEKFLOW_WIDGET_API_BASE_URL: "https://user:password@private.example" }]) {
    const response = onRequest({ request, env: { ...env, ...change } });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Live chat is not configured. Please contact the site owner." });
  }
  assert.equal(onRequest({ request: new Request(request, { method: "POST" }), env }).status, 405);
});

test("base URLs preserve custom paths and reject credentials, queries, fragments and insecure schemes", () => {
  assert.equal(httpsUrl({ URL: " https://api.example/v2/// " }, "URL"), "https://api.example/v2");
  for (const URL of ["", "invalid", "http://api.example", "https://secret@api.example", "https://api.example?key=secret", "https://api.example#part"]) {
    assert.throws(() => httpsUrl({ URL }, "URL"));
  }
});
