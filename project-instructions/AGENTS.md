# Project Instructions

Alternative approach that works without installing the MCP server. Users add instructions to a Claude Project that teach Claude to generate draw.io URLs using Python code execution.

## Key Files

| File | Purpose |
|------|---------|
| `claude-project-instructions.txt` | Instructions to paste into Claude Project settings |

## How It Works

1. Claude generates diagram code (Mermaid, XML, or CSV)
2. Executes Python code that repairs common XML slips, checks that the XML is well-formed, and compresses and encodes the diagram
3. The script outputs a complete HTML page with the URL embedded as a clickable button
4. Claude presents the HTML as an artifact — the user clicks the button to open draw.io

## XML Reference

Users copy `shared/xml-essentials.md` (the condensed XML rules, ~1.3k characters) into their Claude Project alongside `claude-project-instructions.txt`, and the full `shared/xml-reference.md` only when they need layers, tags, metadata, tables or dark-mode colors. Both live in `shared/` at the repo root — the single source of truth for all prompts. In LLM tests the condensed rules produced diagrams as good as the full reference (see `mcp-tool-server/AGENTS.md`).

The Python script repairs the common XML slips before compressing — text around the diagram, `<` or a stray `&` in an attribute value, the default layer written as its own parent; the same repairs as `shared/repair-xml.js` on the MCP servers — then parses the XML, so a diagram that is still broken stops the script with an error instead of producing a link that opens a blank diagram.

## Coding Conventions

- **Allman brace style**: Opening braces go on their own line for all control structures, functions, objects, and callbacks.
- Prefer `function()` expressions over arrow functions for callbacks.
- See the root `AGENTS.md` for examples.

## Why HTML Output?

The generated URL contains compressed base64 data. LLMs silently corrupt base64 strings when reproducing them token by token. By having the Python script output a complete HTML page with the link embedded, the URL never passes through Claude's text generation — ensuring the link is always correct.
