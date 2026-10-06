import { test } from "node:test";
import assert from "node:assert/strict";
import { rgbToHex, extractDesignTokens, tokensToCss } from "./tokens.js";
import type { FigmaFile, Paint, TextNode } from "./types.js";

test("rgbToHex converts opaque colors correctly", () => {
  const p: Paint = { type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } };
  assert.equal(rgbToHex(p), "#ff0000");
});

test("rgbToHex appends alpha hex for translucent colors", () => {
  const p: Paint = { type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 0.5 };
  assert.equal(rgbToHex(p), "#00000080");
});

test("extractDesignTokens picks up fills and text", () => {
  const file: FigmaFile = {
    name: "test",
    lastModified: "", version: "", role: "", editorType: "",
    document: {
      id: "0:0", name: "Page", type: "FRAME",
      children: [
        {
          id: "1:1", name: "Rect", type: "RECTANGLE",
          fills: [{ type: "SOLID", color: { r: 0.1, g: 0.2, b: 0.3 } }],
        },
        {
          id: "1:2", name: "Label", type: "TEXT", characters: "Hello",
          style: { fontFamily: "Inter", fontSize: 14, fontWeight: 600 } as any,
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
        } as TextNode,
      ],
    },
  };
  const t = extractDesignTokens(file);
  assert.ok(t.colors.length >= 1, "expected at least one color");
  assert.ok(t.typography.length >= 1, "expected at least one typography token");
  assert.ok(t.typography.some(x => x.fontFamily === "Inter"));
  const css = tokensToCss(t);
  assert.match(css, /--color-/);
  assert.match(css, /--font-/);
});
