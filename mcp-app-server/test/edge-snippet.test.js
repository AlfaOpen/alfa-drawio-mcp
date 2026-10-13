import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import snippet from "../snippet/mcp_edge.js";

// The edge snippet (snippet/mcp_edge.js) answers the requests whose reply
// never depends on the server, and must answer them exactly like the Worker.
// The expected replies below were recorded from the Worker. With
// EDGE_COMPARE_URL set to a Worker's origin (e.g. the staging worker), every
// answered case is also sent there and compared live:
//
//   EDGE_COMPARE_URL=https://drawio-mcp-app-staging.jgraph.workers.dev npm test

const ORIGIN = "https://mcp.draw.io";
const SESSION = "ui-11111111-2222-3333-4444-555555555555";
const ACCEPT = "application/json, text/event-stream";
const CORS =
{
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "Content-Type, mcp-session-id, mcp-protocol-version",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};
const COMPARED_HEADERS = ["content-type", "allow", "mcp-session-id"].concat(Object.keys(CORS));

let passedThrough;
let realFetch;

before(function()
{
  realFetch = globalThis.fetch;
  globalThis.fetch = async function(request)
  {
    passedThrough.push(request);

    return new Response("from the worker", { status: 299 });
  };
});

after(function()
{
  globalThis.fetch = realFetch;
});

function post(body, headers)
{
  const text = typeof body === "string" ? body : JSON.stringify(body);

  return {
    method: "POST",
    path: "/mcp",
    headers: Object.assign(
    {
      "content-type": "application/json",
      "accept": ACCEPT,
      "content-length": String(new TextEncoder().encode(text).length),
      "mcp-session-id": SESSION,
    }, headers),
    body: text,
  };
}

function withoutSession(spec)
{
  delete spec.headers["mcp-session-id"];

  return spec;
}

function toRequest(spec, origin)
{
  return new Request(origin + spec.path,
  {
    method: spec.method,
    headers: spec.headers,
    body: spec.body,
  });
}

async function runSnippet(spec)
{
  passedThrough = [];
  const response = await snippet.fetch(toRequest(spec, ORIGIN));

  return { response: response, passed: passedThrough.length > 0 };
}

function pick(headers)
{
  const out = {};

  for (const name of COMPARED_HEADERS)
  {
    if (headers.get(name) !== null)
    {
      out[name] = headers.get(name);
    }
  }

  return out;
}

const answered =
[
  {
    name: "ping in Copilot CLI's shape",
    spec: post({ method: "ping", params: { _meta: { progressToken: 1234 } }, jsonrpc: "2.0", id: 1234 },
      { "mcp-protocol-version": "2025-06-18" }),
    status: 200,
    body: "{\"result\":{},\"jsonrpc\":\"2.0\",\"id\":1234}",
    headers: Object.assign({ "content-type": "application/json", "mcp-session-id": SESSION }, CORS),
  },
  {
    name: "ping with a string id, JSON-only Accept, no protocol header",
    spec: post({ jsonrpc: "2.0", id: "abc", method: "ping" }, { "accept": "application/json" }),
    status: 200,
    body: "{\"result\":{},\"jsonrpc\":\"2.0\",\"id\":\"abc\"}",
    headers: Object.assign({ "content-type": "application/json", "mcp-session-id": SESSION }, CORS),
  },
  {
    name: "notifications/initialized",
    spec: post({ jsonrpc: "2.0", method: "notifications/initialized" }),
    status: 202,
    body: "",
    headers: CORS,
  },
  {
    name: "notifications/cancelled with params",
    spec: post({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 7, reason: "user" } }),
    status: 202,
    body: "",
    headers: CORS,
  },
  {
    name: "ping without a session",
    spec: withoutSession(post({ jsonrpc: "2.0", id: 1, method: "ping" })),
    status: 400,
    body: "{\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32000,\"message\":\"Bad Request: Server not initialized\"},\"id\":null}",
    headers: Object.assign({ "content-type": "application/json" }, CORS),
  },
  {
    name: "a 2026-07-28 client's server/discover probe without a session",
    spec: withoutSession(post({ jsonrpc: "2.0", id: 1, method: "server/discover" }, { "mcp-protocol-version": "2026-07-28" })),
    status: 400,
    body: "{\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32000,\"message\":\"Bad Request: Server not initialized\"},\"id\":null}",
    headers: Object.assign({ "content-type": "application/json" }, CORS),
  },
  {
    name: "GET /mcp",
    spec: { method: "GET", path: "/mcp", headers: { "accept": "text/event-stream", "mcp-session-id": SESSION } },
    status: 405,
    body: "{\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32000,\"message\":\"Method not allowed.\"},\"id\":null}",
    headers: Object.assign({ "content-type": "application/json", "allow": "POST, DELETE" }, CORS),
  },
  {
    name: "HEAD /mcp",
    spec: { method: "HEAD", path: "/mcp", headers: {} },
    status: 405,
    body: "",
    headers: Object.assign({ "content-type": "application/json", "allow": "GET, POST, DELETE" }, CORS),
  },
  {
    name: "DELETE with a session",
    spec: { method: "DELETE", path: "/mcp", headers: { "mcp-session-id": SESSION } },
    status: 200,
    body: "",
    headers: CORS,
  },
  {
    name: "DELETE without a session",
    spec: { method: "DELETE", path: "/mcp", headers: {} },
    status: 400,
    body: "{\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32000,\"message\":\"Bad Request: Mcp-Session-Id header is required\"},\"id\":null}",
    headers: Object.assign({ "content-type": "application/json" }, CORS),
  },
  {
    name: "OPTIONS /mcp",
    spec: { method: "OPTIONS", path: "/mcp", headers: { "origin": "https://example.com", "access-control-request-method": "POST" } },
    status: 204,
    body: "",
    headers: CORS,
  },
].concat(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server", "/.well-known/openid-configuration",
  "/mcp/.well-known/openid-configuration"].map(function(path)
{
  return {
    name: "discovery probe " + path,
    spec: { method: "GET", path: path, headers: {} },
    status: 404,
    body: "Not Found",
    headers: { "content-type": "text/plain;charset=UTF-8" },
  };
}));

const forwarded =
[
  { name: "initialize", spec: post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) },
  { name: "tools/list", spec: post({ jsonrpc: "2.0", id: 2, method: "tools/list" }) },
  { name: "a ping naming an unsupported protocol version", spec: post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "mcp-protocol-version": "1999-01-01" }) },
  { name: "a ping from an SSE-only client", spec: post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "accept": "text/event-stream" }) },
  { name: "a batch", spec: post([{ jsonrpc: "2.0", id: 1, method: "ping" }]) },
  { name: "invalid JSON", spec: post("{\"jsonrpc\":\"2.0\",") },
  { name: "a non-JSON content type", spec: post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "content-type": "text/plain" }) },
  { name: "a body without a length", spec: post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "content-length": "" }) },
  { name: "a body over the size limit", spec: post({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(2000) } }) },
  { name: "a fractional id", spec: post({ jsonrpc: "2.0", id: 1.5, method: "ping" }) },
  { name: "a null id", spec: post({ jsonrpc: "2.0", id: null, method: "ping" }) },
  { name: "an extra top-level key", spec: post({ jsonrpc: "2.0", id: 1, method: "ping", extra: true }) },
  { name: "params that are not an object", spec: post({ jsonrpc: "2.0", id: 1, method: "ping", params: [] }) },
  { name: "a boolean progressToken", spec: post({ jsonrpc: "2.0", id: 1, method: "ping", params: { _meta: { progressToken: true } } }) },
  { name: "a wrong jsonrpc version", spec: post({ jsonrpc: "1.0", id: 1, method: "ping" }) },
  { name: "a JSON-RPC response", spec: post({ jsonrpc: "2.0", id: 1, result: {} }) },
  { name: "a notification outside notifications/", spec: post({ jsonrpc: "2.0", method: "custom/thing" }) },
  { name: "a sessionless initialize", spec: withoutSession(post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } })) },
  { name: "PUT /mcp", spec: { method: "PUT", path: "/mcp", headers: {} } },
  { name: "the OpenAI domain verification", spec: { method: "GET", path: "/.well-known/openai-apps-challenge", headers: {} } },
  { name: "the health check", spec: { method: "GET", path: "/health", headers: {} } },
  { name: "the favicon", spec: { method: "GET", path: "/favicon.ico", headers: {} } },
];

for (const c of answered)
{
  test("answers " + c.name + " like the Worker", async function()
  {
    const { response, passed } = await runSnippet(c.spec);

    assert.equal(passed, false, "passed through to the Worker");
    assert.equal(response.status, c.status);
    assert.equal(await response.text(), c.body);
    assert.deepEqual(pick(response.headers), c.headers);
    assert.equal(response.headers.get("x-drawio-mcp-edge"), "snippet");
  });
}

for (const c of forwarded)
{
  test("forwards " + c.name + " to the Worker", async function()
  {
    const { response, passed } = await runSnippet(c.spec);

    assert.equal(passed, true, "answered at the edge");
    assert.equal(response.status, 299);
  });
}

test("forwards the request with its body intact", async function()
{
  const spec = post({ jsonrpc: "2.0", id: 2, method: "tools/list" });

  await runSnippet(spec);

  assert.equal(await passedThrough[0].text(), spec.body);
});

test("knows the protocol versions the SDK accepts", function()
{
  // The snippet keeps a copy of the SDK's list: it can't import, and a
  // snippet module exports only its handler, so the copy is read from the
  // source. When this fails after an SDK update, update
  // SUPPORTED_PROTOCOL_VERSIONS in snippet/mcp_edge.js and redeploy it.
  const source = readFileSync(new URL("../snippet/mcp_edge.js", import.meta.url), "utf-8");
  const match = source.match(/const SUPPORTED_PROTOCOL_VERSIONS = (\[[^\]]*\]);/);

  assert.ok(match, "SUPPORTED_PROTOCOL_VERSIONS not found in the snippet");
  assert.deepEqual(JSON.parse(match[1]), SUPPORTED_PROTOCOL_VERSIONS);
});

test("fits the snippet size limit", function()
{
  const size = readFileSync(new URL("../snippet/mcp_edge.js", import.meta.url)).length;

  assert.ok(size <= 32 * 1024, "snippet is " + size + " bytes (max 32 KB)");
});

// With EDGE_VIA_SNIPPET=1 the live requests carry the header the staged
// rollout's rule requires, so on mcp.draw.io they go through the deployed
// snippet; without it every answer must come from the Worker itself (so a
// comparison against mcp.draw.io after the full rollout fails instead of
// comparing the snippet with itself — compare against staging then).
const VIA_SNIPPET = process.env.EDGE_VIA_SNIPPET === "1";
const LIVE_SKIP = { skip: !process.env.EDGE_COMPARE_URL && "EDGE_COMPARE_URL not set" };

function liveRequest(spec)
{
  const origin = process.env.EDGE_COMPARE_URL.replace(/\/$/, "");
  const headers = VIA_SNIPPET ? Object.assign({ "x-drawio-mcp-edge-test": "1" }, spec.headers) : spec.headers;

  return realFetch(toRequest(Object.assign({}, spec, { headers: headers }), origin));
}

test("matches a live Worker", LIVE_SKIP, async function()
{
  for (const c of answered)
  {
    const live = await liveRequest(c.spec);

    assert.equal(live.status, c.status, c.name + ": status");
    assert.equal(await live.text(), c.body, c.name + ": body");
    assert.deepEqual(pick(live.headers), c.headers, c.name + ": headers");
    assert.equal(live.headers.get("x-drawio-mcp-edge"), VIA_SNIPPET ? "snippet" : null, c.name + ": answered by");
  }
});

test("passes initialize and tools/list on to a live Worker", LIVE_SKIP, async function()
{
  const init = await liveRequest(withoutSession(post({ jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "edge-snippet-test", version: "1" } } })));
  const session = init.headers.get("mcp-session-id");

  assert.equal(init.status, 200);
  assert.equal(init.headers.get("x-drawio-mcp-edge"), null);
  assert.equal((await init.json()).result.serverInfo.name, "drawio-mcp-app");
  assert.match(session, /^noui-/);

  const list = await liveRequest(post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-session-id": session }));

  assert.equal(list.status, 200);
  assert.equal(list.headers.get("x-drawio-mcp-edge"), null);
  assert.ok((await list.json()).result.tools.some(function(tool) { return tool.name === "create_diagram"; }));
});
