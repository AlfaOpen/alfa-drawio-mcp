import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/shared.js";

// Runs createServer with the files src/index.js and src/build-html.js read and
// checks what a client sees in tools/list and get_drawio_reference.

// Clients index tool descriptions: VS Code Copilot embeds them in batches for
// its tool search, and one description over the embedding limit fails the
// whole batch, other servers' tools included (jgraph/drawio-mcp#76). The
// references used to be appended to the create_diagram description (~55k
// characters); they are served by get_drawio_reference now, and this keeps
// them out.
const MAX_DESCRIPTION_LENGTH = 2048;

function readShared(name)
{
  return readFileSync(new URL("../../shared/" + name, import.meta.url), "utf-8");
}

const shapeIndexUrl = new URL("../../shape-search/search-index.json", import.meta.url);

let client;

before(async function()
{
  const server = createServer("",
  {
    xmlReference: readShared("xml-reference.md"),
    mermaidReference: readShared("mermaid-reference.md"),
    shapeIndex: existsSync(shapeIndexUrl) ? JSON.parse(readFileSync(shapeIndexUrl, "utf-8")) : null,
    iconServiceUrl: null,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  client = new Client({ name: "tools-test", version: "0.0.0" });
  await client.connect(clientTransport);
});

after(async function()
{
  await client.close();
});

test("every tool description stays short", async function()
{
  const { tools } = await client.listTools();

  assert.ok(tools.length > 0);

  for (const tool of tools)
  {
    assert.ok(tool.description.length <= MAX_DESCRIPTION_LENGTH,
      tool.name + " description is " + tool.description.length +
      " characters (max " + MAX_DESCRIPTION_LENGTH + ")");
  }
});

test("create_diagram points at get_drawio_reference", async function()
{
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map(function(tool) { return [tool.name, tool]; }));
  const reference = byName.get_drawio_reference;

  assert.deepEqual(reference.inputSchema.properties.format.enum, ["xml", "mermaid"]);
  assert.deepEqual(reference.annotations,
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.match(byName.create_diagram.description, /Call `get_drawio_reference` before your first diagram/);
});

test("get_drawio_reference returns the shared references", async function()
{
  const xml = await client.callTool({ name: "get_drawio_reference", arguments: { format: "xml" } });
  const mermaid = await client.callTool({ name: "get_drawio_reference", arguments: { format: "mermaid" } });

  assert.equal(xml.isError, undefined);
  assert.deepEqual(xml.content, [{ type: "text", text: readShared("xml-reference.md") }]);
  assert.equal(mermaid.isError, undefined);
  assert.deepEqual(mermaid.content, [{ type: "text", text: readShared("mermaid-reference.md") }]);
});

test("get_drawio_reference rejects an unknown format", async function()
{
  for (const args of [{ format: "csv" }, { format: "toString" }, {}])
  {
    const result = await client.callTool({ name: "get_drawio_reference", arguments: args });

    assert.equal(result.isError, true, JSON.stringify(args));
  }
});
