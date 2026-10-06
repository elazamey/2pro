import type { FigmaFile, FigmaNode, Paint, TypeStyle, Style } from "./types.js";

export interface ColorToken {
  name: string;
  /** #rrggbb or #rrggbbaa */
  hex: string;
  r: number; g: number; b: number; a: number;
}

export interface TypographyToken {
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight?: number;
  letterSpacing?: number;
  italic?: boolean;
}

export interface SpacingToken {
  name: string;
  value: number;
}

export interface RadiusToken {
  name: string;
  value: number;
}

export interface DesignTokens {
  colors: ColorToken[];
  typography: TypographyToken[];
  spacing: SpacingToken[];
  radii: RadiusToken[];
}

function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }
function toHexByte(v: number) { return Math.round(clamp01(v) * 255).toString(16).padStart(2, "0"); }

export function rgbToHex(paint: Paint): string | null {
  if (paint.type !== "SOLID" || !paint.color) return null;
  const { r, g, b } = paint.color;
  const a = clamp01(paint.opacity ?? paint.color.a ?? 1);
  const rgb = `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
  return a < 1 ? `${rgb}${toHexByte(a)}` : rgb;
}

function isVisible(p: Paint): boolean {
  return p.visible !== false;
}

export function firstSolidFill(fills?: Paint[]): Paint | null {
  if (!fills) return null;
  for (const f of fills) if (f.type === "SOLID" && isVisible(f)) return f;
  return null;
}

function walk(node: FigmaNode, visit: (n: FigmaNode) => void) {
  visit(node);
  if (node.children) for (const c of node.children) walk(c, visit);
}

function cssName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Extract design tokens from a Figma file.
 *
 * Named styles (from file.styles) take priority and get clean names; we also
 * sample direct fills/typography from the tree as fallback anonymous tokens.
 */
export function extractDesignTokens(file: FigmaFile): DesignTokens {
  const colors: ColorToken[] = [];
  const typography: TypographyToken[] = [];
  const spacingSet = new Map<number, SpacingToken>();
  const radiusSet = new Map<number, RadiusToken>();
  const seenColors = new Set<string>();
  const seenType = new Set<string>();

  const addColor = (name: string, p: Paint) => {
    const hex = rgbToHex(p);
    if (!hex) return;
    const key = `${name}|${hex}`;
    if (seenColors.has(key)) return;
    seenColors.add(key);
    const c = p.color!;
    colors.push({
      name,
      hex,
      r: c.r, g: c.g, b: c.b,
      a: clamp01(p.opacity ?? c.a ?? 1),
    });
  };

  const addType = (name: string, s: TypeStyle) => {
    if (!s.fontFamily || !s.fontSize || !s.fontWeight) return;
    const key = `${name}|${s.fontFamily}|${s.fontSize}|${s.fontWeight}`;
    if (seenType.has(key)) return;
    seenType.add(key);
    typography.push({
      name,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeightPx,
      letterSpacing: s.letterSpacing,
      italic: s.italic,
    });
  };

  // 1) Named styles from file.styles — we need to walk the document to find
  //    nodes pointing at each style key to read their actual color/typography.
  const styleKeyToNodeFill = new Map<string, Paint>();
  const styleKeyToType = new Map<string, TypeStyle>();
  const styleKeyToSampleNode = new Map<string, FigmaNode>();

  walk(file.document, (n) => {
    if (n.styles) {
      for (const [styleType, styleKey] of Object.entries(n.styles)) {
        if (styleType === "fill" || styleType === "fills") {
          const fill = firstSolidFill(n.fills);
          if (fill && !styleKeyToNodeFill.has(styleKey)) {
            styleKeyToNodeFill.set(styleKey, fill);
            styleKeyToSampleNode.set(styleKey, n);
          }
        }
        if (styleType === "text" && (n as any).style) {
          const t = (n as any).style as TypeStyle;
          if (!styleKeyToType.has(styleKey)) {
            styleKeyToType.set(styleKey, t);
            styleKeyToSampleNode.set(styleKey, n);
          }
        }
      }
    }
    // Collect spacing/radius samples from Auto Layout frames
    if (n.layoutMode && n.layoutMode !== "NONE") {
      for (const v of [n.paddingLeft, n.paddingRight, n.paddingTop, n.paddingBottom, n.itemSpacing]) {
        if (typeof v === "number" && v > 0) spacingSet.set(v, { name: `spacing-${v}`, value: v });
      }
    }
    if (typeof n.cornerRadius === "number" && n.cornerRadius > 0) {
      radiusSet.set(n.cornerRadius, { name: `radius-${n.cornerRadius}`, value: n.cornerRadius });
    }
  });

  if (file.styles) {
    for (const [key, style] of Object.entries(file.styles) as [string, Style][]) {
      const name = cssName(style.name);
      if (style.styleType === "FILL") {
        const fill = styleKeyToNodeFill.get(key);
        if (fill) addColor(name, fill);
      } else if (style.styleType === "TEXT") {
        const t = styleKeyToType.get(key);
        if (t) addType(name, t);
      }
    }
  }

  // 2) Fallback: sample colors from fills and text from TEXT nodes directly.
  walk(file.document, (n) => {
    if ((n.type === "RECTANGLE" || n.type === "FRAME" || n.type === "COMPONENT" || n.type === "INSTANCE") && n.fills) {
      const fill = firstSolidFill(n.fills);
      if (fill) addColor(`color-${colors.length + 1}`, fill);
    }
    if (n.type === "TEXT" && (n as any).style) {
      addType(`text-${typography.length + 1}`, (n as any).style);
    }
  });

  // Sort spacing/radius by size
  const spacing = [...spacingSet.values()].sort((a, b) => a.value - b.value)
    .map((s, i) => ({ ...s, name: `spacing-${s.value === 4 * (i + 1) ? s.value : s.value}` }));
  const radii = [...radiusSet.values()].sort((a, b) => a.value - b.value);

  return { colors, typography, spacing, radii };
}

/** Render tokens as CSS custom properties for easy copy/paste. */
export function tokensToCss(tokens: DesignTokens): string {
  const lines: string[] = [":root {"];
  for (const c of tokens.colors) lines.push(`  --color-${cssName(c.name)}: ${c.hex};`);
  for (const t of tokens.typography) {
    lines.push(`  --font-${cssName(t.name)}: ${t.fontWeight} ${t.fontSize}px${t.lineHeight ? "/" + t.lineHeight + "px" : ""} ${t.fontFamily};`);
  }
  for (const s of tokens.spacing) lines.push(`  --${cssName(s.name)}: ${s.value}px;`);
  for (const r of tokens.radii) lines.push(`  --radius-${r.value}: ${r.value}px;`);
  lines.push("}");
  return lines.join("\n");
}

/** Render tokens as a Tailwind theme extension snippet. */
export function tokensToTailwindTheme(tokens: DesignTokens): string {
  const colors: Record<string, string> = {};
  for (const c of tokens.colors) colors[cssName(c.name)] = c.hex;
  const fontFamily: Record<string, string[]> = {};
  const fontSize: Record<string, [string, { lineHeight?: string }]> = {};
  for (const t of tokens.typography) {
    fontFamily[cssName(t.name)] = [t.fontFamily];
    fontSize[cssName(t.name)] = [`${t.fontSize}px`, t.lineHeight ? { lineHeight: `${t.lineHeight}px` } : {} as any];
  }
  const spacing: Record<string, string> = {};
  for (const s of tokens.spacing) spacing[String(s.value)] = `${s.value}px`;
  const borderRadius: Record<string, string> = {};
  for (const r of tokens.radii) borderRadius[String(r.value)] = `${r.value}px`;

  return `/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: ${JSON.stringify(colors, null, 2).replace(/\n/g, "\n      ")},
      fontFamily: ${JSON.stringify(fontFamily, null, 2).replace(/\n/g, "\n      ")},
      fontSize: ${JSON.stringify(fontSize, null, 2).replace(/\n/g, "\n      ")},
      spacing: ${JSON.stringify(spacing, null, 2).replace(/\n/g, "\n      ")},
      borderRadius: ${JSON.stringify(borderRadius, null, 2).replace(/\n/g, "\n      ")},
    },
  },
};
`;
}
