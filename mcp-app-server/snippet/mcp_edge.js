// Cloudflare Snippet in front of the drawio-mcp-app Worker on mcp.draw.io.
//
// Answers the MCP requests whose reply never depends on the server — a ping,
// a notification, a request without a session, GET/HEAD/DELETE/OPTIONS on
// /mcp, OAuth discovery probes — so they don't cost a Worker invocation.
// Copilot CLI pings every open session every 21 s, which made up ~70% of all
// Worker requests in October 2026. Everything else goes on to the Worker
// untouched, as does anything this code is unsure about: it only answers a
// request when the Worker's answer would be exactly the same (status, body,
// headers), which test/edge-snippet.test.js checks against a live Worker.
//
// Snippets run before Workers, have no bindings or logs, 5 ms of CPU and
// 32 KB of code, so this file is self-contained: no imports. Deployed as
// snippet `mcp_edge` on zone draw.io, with the rule in AGENTS.md
// ("Edge snippet").

/**
 * The protocol versions the server's MCP SDK accepts in mcp-protocol-version.
 * A request naming another one goes to the Worker, which answers it with the
 * SDK's 400. test/edge-snippet.test.js fails when the SDK's list changes.
 */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];

/** Larger bodies go to the Worker unread; a ping is under 100 bytes. */
const MAX_BODY_BYTES = 1024;

/** Same as the Worker's CORS_HEADERS (src/worker.js). */
const CORS_HEADERS =
{
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, mcp-protocol-version",
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
};

/** Marks a response as answered here, for checks from outside. */
const EDGE_HEADER = "x-drawio-mcp-edge";

/** OAuth/OIDC discovery paths clients probe; the Worker 404s them all. */
const DISCOVERY_PROBE = /^\/(mcp\/)?\.well-known\/(oauth-protected-resource|oauth-authorization-server|openid-configuration)(\/|$)/;

function respond(status, body, headers)
{
  return new Response(body,
  {
    status: status,
    headers: Object.assign({}, headers, CORS_HEADERS, { [EDGE_HEADER]: "snippet" }),
  });
}

/** A JSON-RPC error in the shape the SDK transport answers with. */
function jsonRpcError(status, message, headers)
{
  return respond(status, JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: message }, id: null }),
    Object.assign({ "Content-Type": "application/json" }, headers));
}

function isPlainObject(value)
{
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The SDK's zod `.int()` takes safe integers only. */
function isIdOrToken(value)
{
  return typeof value === "string" || Number.isSafeInteger(value);
}

/**
 * Whether the SDK takes this Content-Type as application/json. It compares the
 * parsed media type, never a substring (`text/plain; a=application/json` and
 * `application/json-rpc` get its 415), so this accepts a subset of what it
 * does: the part before the first ";", trimmed and lowercased, and no comma
 * anywhere (joined duplicate headers, which it can reject).
 */
function isJsonContentType(value)
{
  return value.split(";", 1)[0].trim().toLowerCase() === "application/json" && !value.includes(",");
}

/**
 * Whether the SDK accepts this as a JSON-RPC request (`hasId`) or
 * notification: its schemas are strict about the top-level keys, take a
 * string or safe integer id, and an object for params whose _meta, if any,
 * holds a string or safe integer progressToken. Stricter than the SDK where
 * that is simpler (the related-task _meta key) — anything unusual goes to the
 * Worker.
 */
function isValidMessage(message, hasId)
{
  for (const key of Object.keys(message))
  {
    if (key !== "jsonrpc" && key !== "method" && key !== "params" && !(hasId && key === "id"))
    {
      return false;
    }
  }

  if (message.jsonrpc !== "2.0" || typeof message.method !== "string" || (hasId && !isIdOrToken(message.id)))
  {
    return false;
  }

  if (message.params === undefined)
  {
    return true;
  }

  if (!isPlainObject(message.params))
  {
    return false;
  }

  const meta = message.params._meta;

  return meta === undefined || (isPlainObject(meta) &&
    (meta.progressToken === undefined || isIdOrToken(meta.progressToken)) &&
    !("io.modelcontextprotocol/related-task" in meta));
}

/**
 * The reply to a POST /mcp the Worker would give without doing anything, or
 * null to let the Worker answer it.
 */
async function answerPost(request, session)
{
  const length = Number(request.headers.get("content-length"));
  const contentType = request.headers.get("content-type") || "";
  const accept = request.headers.get("accept") || "";

  // An unknown length, a big body, a non-JSON one or an SSE-only client
  // (whose answer would be an event stream) all go to the Worker.
  if (!(length > 0 && length <= MAX_BODY_BYTES) || !isJsonContentType(contentType) ||
    (accept.includes("text/event-stream") && !accept.includes("application/json")))
  {
    return null;
  }

  let message;

  try
  {
    message = JSON.parse(await request.clone().text());
  }
  catch (e)
  {
    return null;
  }

  if (!isPlainObject(message) || message.method === "initialize")
  {
    return null;
  }

  const hasId = "id" in message;

  if (!isValidMessage(message, hasId))
  {
    return null;
  }

  // Without a session the transport rejects everything but an initialize.
  if (!session)
  {
    return jsonRpcError(400, "Bad Request: Server not initialized");
  }

  const version = request.headers.get("mcp-protocol-version");

  if (version !== null && !SUPPORTED_PROTOCOL_VERSIONS.includes(version))
  {
    return null;
  }

  if (hasId && message.method === "ping")
  {
    return respond(200, JSON.stringify({ result: {}, jsonrpc: "2.0", id: message.id }),
      { "Content-Type": "application/json", "mcp-session-id": session });
  }

  if (!hasId && message.method.startsWith("notifications/"))
  {
    return respond(202, null, {});
  }

  return null;
}

export default
{
  async fetch(request)
  {
    const path = new URL(request.url).pathname;

    if (path !== "/mcp")
    {
      if (!DISCOVERY_PROBE.test(path))
      {
        return fetch(request);
      }

      return request.method === "OPTIONS"
        ? respond(204, null, {})
        : new Response("Not Found", { status: 404, headers: { [EDGE_HEADER]: "snippet" } });
    }

    const session = request.headers.get("mcp-session-id");
    let answer = null;

    switch (request.method)
    {
      case "OPTIONS":
        answer = respond(204, null, {});
        break;

      case "GET":
        answer = jsonRpcError(405, "Method not allowed.", { Allow: "POST, DELETE" });
        break;

      case "HEAD":
        answer = respond(405, null, { "Content-Type": "application/json", Allow: "GET, POST, DELETE" });
        break;

      case "DELETE":
        answer = session ? respond(200, null, {}) : jsonRpcError(400, "Bad Request: Mcp-Session-Id header is required");
        break;

      case "POST":
        answer = await answerPost(request, session);
        break;
    }

    return answer || fetch(request);
  },
};
