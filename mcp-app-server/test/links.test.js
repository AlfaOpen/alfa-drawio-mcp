import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pako from "pako";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/shared.js";

// The link create_diagram hands a client that doesn't render the app. XML
// opens as #R, like the viewer's "Open in draw.io": after a #create, draw.io
// rewrites the hash and, when the rewrite differs from the link (a host that
// re-encodes it, like VS Code), asks "All changes will be lost!"; it never
// rewrites a #R hash. Mermaid stays #create, which draw.io converts.

const xml = '<mxGraphModel adaptiveColors="auto"><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="a" value="R&amp;D: 100% (x+y)" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">' +
  '<mxGeometry x="40" y="40" width="140" height="60" as="geometry"/></mxCell></root></mxGraphModel>';

let client;

before(async function()
{
  const server = createServer("", { iconServiceUrl: null });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  // No io.modelcontextprotocol/ui capability: the server adds the link.
  client = new Client({ name: "links-test", version: "0.0.0" });
  await client.connect(clientTransport);
});

after(async function()
{
  await client.close();
});

async function linkFor(args)
{
  const result = await client.callTool({ name: "create_diagram", arguments: args });
  const block = result.content.find(function(item)
  {
    return item.type === "text" && item.text.includes("https://app.diagrams.net/");
  });

  assert.ok(block, JSON.stringify(result.content));

  return new URL(block.text.match(/https:\/\/\S+/)[0]);
}

function decompress(base64)
{
  return decodeURIComponent(pako.inflateRaw(Buffer.from(base64, "base64"), { to: "string" }));
}

test("an XML diagram gets a #R link", async function()
{
  const url = await linkFor({ xml: xml });

  assert.equal(url.searchParams.get("pv"), "0");
  assert.equal(url.searchParams.get("grid"), "0");
  assert.ok(url.hash.startsWith("#R"), url.hash.substring(0, 20));
  assert.equal(decompress(decodeURIComponent(url.hash.substring(2))), xml);
});

test("a Mermaid diagram gets a #create link", async function()
{
  const mermaid = "flowchart TD\n  A[Start] --> B[End]";
  const url = await linkFor({ mermaid: mermaid });

  assert.ok(url.hash.startsWith("#create="), url.hash.substring(0, 20));

  const createObj = JSON.parse(decodeURIComponent(url.hash.substring("#create=".length)));

  assert.equal(createObj.type, "mermaid");
  assert.equal(decompress(createObj.data), mermaid);
});
