import type { FigmaNode, Paint, TypeStyle } from "./types.js";
import { firstSolidFill } from "./tokens.js";

export interface SimpleNode {
  id: string;
  type: string;
  name: string;
  /** tailwind-friendly class string */
  classes: string[];
  /** inline style attrs Tailwind can't express (gradients, exact fonts not in the project, etc.) */
  style: Record<string, string>;
  text?: string;
  children: SimpleNode[];
}

function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }
function hexByte(v: number) { return Math.round(clamp01(v) * 255).toString(16).padStart(2, "0"); }
function fillColor(p: Paint): { hex: string; opacity: number } | null {
  if (p.type !== "SOLID" || !p.color) return null;
  const { r, g, b } = p.color;
  const a = clamp01(p.opacity ?? p.color.a ?? 1);
  return { hex: `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`, opacity: a };
}

function nearestTailwindGray(hex: string): string | null {
  // Map solid blacks/whites/grays to tailwind tokens (very rough)
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  if (Math.abs(r - g) > 8 || Math.abs(g - b) > 8) return null;
  const avg = (r + g + b) / 3;
  if (avg > 245) return "white";
  if (avg > 225) return "gray-100";
  if (avg > 200) return "gray-200";
  if (avg > 160) return "gray-300";
  if (avg > 120) return "gray-500";
  if (avg > 80) return "gray-700";
  if (avg > 30) return "gray-900";
  return "black";
}

function fontWeightClass(w?: number): string {
  if (!w) return "";
  if (w <= 300) return "font-light";
  if (w <= 450) return "font-normal";
  if (w <= 550) return "font-medium";
  if (w <= 650) return "font-semibold";
  if (w <= 750) return "font-bold";
  return "font-extrabold";
}

function alignmentClass(h?: string): string {
  if (h === "CENTER") return "text-center";
  if (h === "RIGHT") return "text-right";
  return "text-left";
}

function flexJustify(v?: string): string {
  switch (v) {
    case "CENTER": return "justify-center";
    case "MAX": return "justify-end";
    case "SPACE_BETWEEN": return "justify-between";
    default: return "justify-start";
  }
}

function flexItems(v?: string): string {
  switch (v) {
    case "CENTER": return "items-center";
    case "MAX": return "items-end";
    case "BASELINE": return "items-baseline";
    default: return "items-start";
  }
}

function sizeClass(value: number | undefined, dim: "w" | "h"): string {
  if (value === undefined) return "";
  // Map exact pixels to Tailwind spacing scale (roughly 4px grid); fall back to inline `w-[npx]`.
  if (value === Math.round(value / 4) * 4 && value > 0 && value <= 96) {
    return `${dim}-${value / 4}`; // w-1 = 0.25rem = 4px with default tailwind config
  }
  return `${dim}-[${value}px]`;
}

export function nodeToTree(node: FigmaNode, depth = 0, opts: { depthLimit?: number } = {}): SimpleNode {
  const limit = opts.depthLimit ?? 8;
  const classes: string[] = [];
  const style: Record<string, string> = {};
  const children: SimpleNode[] = [];

  const isAutoLayout = node.layoutMode && node.layoutMode !== "NONE";

  // Layout container
  if (isAutoLayout) {
    classes.push("flex");
    if (node.layoutMode === "VERTICAL") classes.push("flex-col");
    classes.push(flexJustify(node.primaryAxisAlignItems));
    classes.push(flexItems(node.counterAxisAlignItems));
    if (node.paddingTop) classes.push(`pt-[${node.paddingTop}px]`);
    if (node.paddingBottom) classes.push(`pb-[${node.paddingBottom}px]`);
    if (node.paddingLeft) classes.push(`pl-[${node.paddingLeft}px]`);
    if (node.paddingRight) classes.push(`pr-[${node.paddingRight}px]`);
    if (node.itemSpacing) classes.push(`gap-[${node.itemSpacing}px]`);
  }

  // Sizing
  const bb = node.absoluteBoundingBox;
  if (bb && !isAutoLayout) {
    if (bb.width > 0 && depth === 0) classes.push(sizeClass(bb.width, "w"));
    if (bb.height > 0 && depth === 0) classes.push(sizeClass(bb.height, "h"));
  }
  if (isAutoLayout) {
    // HUG/FILL behavior
    if (node.layoutSizingHorizontal === "FILL") classes.push("w-full");
    if (node.layoutSizingVertical === "FILL") classes.push("h-full");
  }

  // Fill (background color) — for TEXT nodes, fills paint the glyphs, not the background.
  if (node.type !== "TEXT") {
    const fill = firstSolidFill(node.fills);
    if (fill) {
      const c = fillColor(fill);
      if (c) {
        const mapped = nearestTailwindGray(c.hex);
        if (mapped && c.opacity === 1) classes.push(`bg-${mapped}`);
        else if (c.opacity < 1) style.backgroundColor = c.hex + Math.round(c.opacity * 255).toString(16).padStart(2, "0");
        else style.backgroundColor = c.hex;
      }
    }
  }

  // Stroke
  if (node.strokes?.length && node.strokeWeight) {
    const stroke = firstSolidFill(node.strokes);
    if (stroke) {
      const c = fillColor(stroke);
      if (c) {
        const mapped = nearestTailwindGray(c.hex);
        classes.push(`border-[${node.strokeWeight}px]`);
        if (mapped) classes.push(`border-${mapped}`);
        else style.borderColor = c.hex;
      }
    }
  }

  // Corner radius
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    const r = node.cornerRadius;
    if (r === 4) classes.push("rounded");
    else if (r === 6) classes.push("rounded-md");
    else if (r === 8) classes.push("rounded-lg");
    else if (r === 12) classes.push("rounded-xl");
    else if (r >= 16 && r < 24) classes.push("rounded-2xl");
    else if (r >= 999) classes.push("rounded-full");
    else classes.push(`rounded-[${r}px]`);
  }

  // Opacity
  if (typeof node.opacity === "number" && node.opacity < 1) style.opacity = String(node.opacity);

  // Shadow
  const drop = node.effects?.find(e => e.type === "DROP_SHADOW" && e.visible !== false);
  if (drop && drop.radius != null) {
    // Crude mapping to tailwind shadows
    if (drop.radius <= 4) classes.push("shadow-sm");
    else if (drop.radius <= 10) classes.push("shadow");
    else if (drop.radius <= 20) classes.push("shadow-lg");
    else if (drop.radius <= 40) classes.push("shadow-2xl");
    else classes.push("shadow-2xl");
  }

  // Text
  let text: string | undefined;
  if (node.type === "TEXT") {
    const t = (node as any).style as TypeStyle | undefined;
    text = (node as any).characters ?? "";
    classes.push(alignmentClass(t?.textAlignHorizontal));
    classes.push(fontWeightClass(t?.fontWeight));
    if (t?.italic) classes.push("italic");
    if (t?.fontSize) {
      const fs = t.fontSize;
      if (fs === 12) classes.push("text-xs");
      else if (fs === 14) classes.push("text-sm");
      else if (fs === 16) classes.push("text-base");
      else if (fs === 18) classes.push("text-lg");
      else if (fs === 20) classes.push("text-xl");
      else if (fs === 24) classes.push("text-2xl");
      else if (fs === 30) classes.push("text-3xl");
      else if (fs === 36) classes.push("text-4xl");
      else if (fs >= 48) classes.push("text-5xl");
      else classes.push(`text-[${fs}px]`);
    }
    if (t?.lineHeightPx) classes.push(`leading-[${Math.round(t.lineHeightPx)}px]`);
    // Text color
    const tf = firstSolidFill(node.fills);
    if (tf) {
      const tc = fillColor(tf);
      if (tc) {
        const mapped = nearestTailwindGray(tc.hex);
        if (mapped) {
          classes.push(mapped === "white" ? "text-white" :
            mapped === "black" ? "text-black" :
            `text-${mapped}`);
        } else {
          style.color = tc.hex;
        }
      }
    }
  }

  // Children
  if (depth < limit && node.children) {
    for (const c of node.children) {
      if (c.visible === false) continue;
      children.push(nodeToTree(c, depth + 1, opts));
    }
  }

  return {
    id: node.id,
    type: node.type,
    name: node.name,
    classes: classes.filter(Boolean),
    style,
    text,
    children,
  };
}
