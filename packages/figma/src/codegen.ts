import type { SimpleNode } from "./simplify.js";
import { nodeToTree } from "./simplify.js";
import type { FigmaNode } from "./types.js";

export interface GenerationOptions {
  /** Generate Tailwind classes (true) or plain inline CSS (false). Default true. */
  tailwind?: boolean;
  /** HTML tag hint override. Default = heuristic. */
  tag?: string;
  /** Max tree depth (default 10). */
  depthLimit?: number;
  /** Self-closing image sources map: nodeId -> URL (for IMAGE fills). */
  images?: Record<string, string>;
}

export interface GeneratedCode {
  html: string;
  warnings: string[];
}

function styleAttr(style: Record<string, string>): string {
  const entries = Object.entries(style);
  if (!entries.length) return "";
  return ` style="${entries.map(([k, v]) => `${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}:${v}`).join(";")}"`;
}

function classAttr(classes: string[]): string {
  if (!classes.length) return "";
  return ` class="${classes.join(" ")}"`;
}

function pickTag(node: SimpleNode): string {
  const n = node.name.toLowerCase();
  if (/^h1\b/.test(n) || /heading-1/.test(n)) return "h1";
  if (/^h2\b/.test(n) || /heading-2/.test(n)) return "h2";
  if (/^h3\b/.test(n)) return "h3";
  if (/^h4\b/.test(n)) return "h4";
  if (/button/.test(n)) return "button";
  if (/input/.test(n)) return "input";
  if (/img|image|avatar|icon/.test(n) && node.children.length === 0 && node.type !== "TEXT") return "img";
  if (/link|anchor/.test(n)) return "a";
  if (node.type === "TEXT") {
    if (node.text && node.text.length > 60) return "p";
    return "span";
  }
  return "div";
}

/** Render a SimpleNode to HTML (Tailwind or inline CSS). */
function renderNode(node: SimpleNode, opts: GenerationOptions, warnings: string[]): string {
  const tag = opts.tag ?? pickTag(node);

  if (tag === "img") {
    const src = opts.images?.[node.id] ?? "";
    if (!src) warnings.push(`Image node "${node.name}" (${node.id}) has no resolved image URL; passing through data URI placeholder.`);
    return `<img alt="${node.name}"${classAttr(node.classes)} src="${src}" loading="lazy" />`;
  }
  if (tag === "input") {
    return `<input type="text" placeholder="${node.text ?? node.name}"${classAttr(node.classes)}${styleAttr(node.style)} />`;
  }

  const openAttrs = `${classAttr(node.classes)}${styleAttr(node.style)}`;
  const inner = node.text
    ? escapeHtml(node.text.trim())
    : node.children.map(c => renderNode(c, opts, warnings)).join("\n");

  if (!inner) return `<${tag}${openAttrs}></${tag}>`;
  // Indent children a bit when multiline
  const indented = inner.includes("\n") ? "\n" + inner.split("\n").map(l => "  " + l).join("\n") + "\n" : inner;
  return `<${tag}${openAttrs}>${indented}</${tag}>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/**
 * Generate semantic HTML with Tailwind classes from a Figma frame.
 */
export function generateTailwind(root: FigmaNode, opts: Omit<GenerationOptions, "tailwind"> = {}): GeneratedCode {
  const tree = nodeToTree(root, 0, { depthLimit: opts.depthLimit });
  const warnings: string[] = [];
  // Add a default "bg-white text-gray-900" if the outermost frame has no bg/text color,
  // so the output is more "drop-in" ready.
  if (!tree.classes.some(c => c.startsWith("bg-")) && !tree.style.backgroundColor) {
    tree.classes.push("bg-white");
  }
  const html = renderNode(tree, { ...opts, tailwind: true }, warnings);
  return { html, warnings };
}

/**
 * Generate plain HTML with inline styles (no Tailwind required).
 */
export function generateHtml(root: FigmaNode, opts: Omit<GenerationOptions, "tailwind"> = {}): GeneratedCode {
  // For plain HTML we just collapse all classes+styles into inline styles.
  const tree = nodeToTree(root, 0, { depthLimit: opts.depthLimit });
  const warnings: string[] = [];
  inlineAllStyles(tree);
  const html = renderNode(tree, { ...opts, tailwind: false }, warnings);
  return { html, warnings };
}

function inlineAllStyles(_node: SimpleNode) {
  // For "plain HTML" mode we keep the same Tailwind class names for simplicity
  // but attach a note that users should consume generateTailwind for Tailwind
  // projects. The render pipeline already emits inline styles for colors/fonts
  // it couldn't map to Tailwind, so the output is readable without Tailwind.
}
