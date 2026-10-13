import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pako from "pako";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/shared.js";

// The links to the draw.io editor. The link create_diagram hands a client that
// doesn't render the app opens XML as a raw #R link and Mermaid as #create,
// which draw.io converts. The viewer's "Open in draw.io" button opens its XML
// as #create with the "pop" effect, which animates the diagram in.

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

test("the viewer's Open in draw.io button gets a #create link with the pop effect", function()
{
  // The button's code runs in the app's HTML, so it is taken from the source
  // of the template and run with the same pako.
  const source = readFileSync(new URL("../src/shared.js", import.meta.url), "utf-8");
  const fn = source.match(/\nfunction generateDrawioEditUrl\(xml\)\n\{\n[\s\S]*?\n\}\n/);

  assert.ok(fn, "generateDrawioEditUrl not found in src/shared.js");

  const generateDrawioEditUrl = new Function("pako", fn[0] + "\nreturn generateDrawioEditUrl;")(pako);
  const url = new URL(generateDrawioEditUrl(xml));

  assert.equal(url.searchParams.get("pv"), "0");
  assert.equal(url.searchParams.get("grid"), "0");
  assert.ok(url.hash.startsWith("#create="), url.hash.substring(0, 20));

  const createObj = JSON.parse(decodeURIComponent(url.hash.substring("#create=".length)));

  assert.equal(createObj.type, "xml");
  assert.equal(createObj.compressed, true);
  assert.equal(createObj.effect, "pop");
  assert.equal(decompress(createObj.data), xml);
});
