import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The viewer's Download button asks the host (ui/download-file) to save the
// diagram as a .drawio file. Its code runs in the app's HTML, so it is taken
// from the source of the template.

const source = readFileSync(new URL("../src/shared.js", import.meta.url), "utf-8");
const fn = source.match(/\nfunction drawioFileRequest\(xml\)\n\{\n[\s\S]*?\n\}\n/);

assert.ok(fn, "drawioFileRequest not found in src/shared.js");

const drawioFileRequest = new Function(fn[0] + "\nreturn drawioFileRequest;")();

const model = '<mxGraphModel adaptiveColors="auto"><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="a" value="R&amp;D" style="rounded=1;html=1;" vertex="1" parent="1">' +
  '<mxGeometry x="40" y="40" width="140" height="60" as="geometry"/></mxCell></root></mxGraphModel>';

function fileOf(request)
{
  assert.equal(request.contents.length, 1);

  const item = request.contents[0];

  assert.equal(item.type, "resource");
  assert.equal(item.resource.uri, "file:///diagram.drawio");
  assert.equal(item.resource.mimeType, "application/vnd.jgraph.mxfile");

  return item.resource.text;
}

test("a diagram downloads as a .drawio file with one page", function()
{
  assert.equal(fileOf(drawioFileRequest(model)),
    '<mxfile><diagram name="Page-1" id="page-1">' + model + "</diagram></mxfile>");
});

test("an mxfile downloads as it is", function()
{
  const mxfile = '\n<mxfile host="app.diagrams.net"><diagram name="A" id="a">' + model +
    '</diagram><diagram name="B" id="b">' + model + "</diagram></mxfile>";

  assert.equal(fileOf(drawioFileRequest(mxfile)), mxfile);
});
