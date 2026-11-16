import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { onRequest } from "../functions/api/contact.js";

const id = "11111111-1111-4111-8111-111111111111";
const context = (query = `contact_id=${id}`, env = { SLEEKFLOW_API_KEY: "test-secret", SLEEKFLOW_API_BASE_URL: "https://api.example" }, method = "GET") => ({
  request: new Request(`https://widget.example/api/contact?${query}`, { method }), env,
});
afterEach(() => mock.restoreAll());

test("fetches the requested contact server-side and exposes only widget fields", async () => {
  const fetch = mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, `https://api.example/api/contact/${id}`);
    assert.equal(options.headers["X-Sleekflow-Api-Key"], "test-secret");
    assert.equal(options.headers.Accept, "application/json");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({
      FirstName: " Test ", LastName: "Demo", PhoneNumber: "12025550100", Email: "visitor@example.com",
      ContactOwnerEmail: "private@example.com", NRIC: "private", id,
    });
  });
  const response = await onRequest(context());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    firstName: "Test", lastName: "Demo", phoneNumber: "12025550100", email: "visitor@example.com",
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test("rejects absent, malformed and path-injection contact IDs before calling the platform", async () => {
  const fetch = mock.method(globalThis, "fetch", () => { throw new Error("Unexpected fetch"); });
  for (const query of ["", "contact_id=", "contact_id=abc", "contact_id=../../contacts"]) {
    assert.equal((await onRequest(context(query))).status, 400);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("fails gracefully when the server key is not configured", async () => {
  assert.equal((await onRequest(context(`contact_id=${id}`, {}))).status, 503);
});

test("does not proxy other HTTP methods", async () => {
  assert.equal((await onRequest(context(`contact_id=${id}`, undefined, "POST"))).status, 405);
});

test("maps upstream failures without leaking upstream bodies or credentials", async () => {
  for (const [upstreamStatus, expectedStatus] of [[404, 404], [401, 502], [429, 502], [500, 502]]) {
    mock.method(globalThis, "fetch", async () => new Response("private upstream error", { status: upstreamStatus }));
    const response = await onRequest(context());
    assert.equal(response.status, expectedStatus);
    assert.deepEqual(await response.json(), { error: "Unable to load contact." });
    mock.restoreAll();
  }
});

test("handles network errors, timeouts, invalid JSON and invalid response shapes", async () => {
  for (const fetch of [
    async () => { throw new TypeError("Network failure"); },
    async () => { throw new DOMException("Timeout", "TimeoutError"); },
    async () => new Response("<html>Bad gateway</html>"),
    async () => Response.json(null),
    async () => Response.json([]),
  ]) {
    mock.method(globalThis, "fetch", fetch);
    assert.equal((await onRequest(context())).status, 502);
    mock.restoreAll();
  }
});

test("normalizes missing and null fields so the visitor can finish the form", async () => {
  mock.method(globalThis, "fetch", async () => Response.json({ FirstName: "Test", LastName: null, Email: 123 }));
  const response = await onRequest(context());
  assert.deepEqual(await response.json(), { firstName: "Test", lastName: "", phoneNumber: "", email: "" });
});

test("uses the configured API base path and rejects invalid configuration before fetching", async () => {
  const fetch = mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, `https://custom-api.example/gateway/api/contact/${id}`);
    return Response.json({ FirstName: "Test" });
  });
  assert.equal((await onRequest(context(`contact_id=${id}`, {
    SLEEKFLOW_API_KEY: "test-secret", SLEEKFLOW_API_BASE_URL: "https://custom-api.example/gateway/",
  }))).status, 200);
  assert.equal(fetch.mock.callCount(), 1);
  for (const base of [undefined, "http://api.example", "https://secret@api.example"]) {
    assert.equal((await onRequest(context(`contact_id=${id}`, {
      SLEEKFLOW_API_KEY: "test-secret", SLEEKFLOW_API_BASE_URL: base,
    }))).status, 503);
  }
  assert.equal(fetch.mock.callCount(), 1);
});
