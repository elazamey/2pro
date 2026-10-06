/**
 * @2pro/figma — Figma REST client, design token extractor, and HTML/Tailwind
 * code generator.
 *
 * Uses Figma's official REST API (no MCP server required at runtime — you can
 * use this library from code/CLI/dashboard directly with a Personal Access
 * Token, or put the @modelcontextprotocol/server-figma in front of it for AI
 * agents).
 */

export { FigmaClient, parseFigmaUrl } from "./client.js";
export type { FigmaClientConfig } from "./client.js";

export type {
  FigmaFile,
  FigmaNode,
  FrameNode,
  ComponentNode,
  TextNode,
  RectangleNode,
  InstanceNode,
  Style,
  Paint,
  TypeStyle,
  LayoutMode,
  PrimaryAxisAlignItems,
  CounterAxisAlignItems,
} from "./types.js";

export { extractDesignTokens, tokensToCss, tokensToTailwindTheme, type DesignTokens, type ColorToken, type TypographyToken, type SpacingToken, type RadiusToken } from "./tokens.js";
export { generateHtml, generateTailwind, type GenerationOptions, type GeneratedCode } from "./codegen.js";
export { nodeToTree, type SimpleNode } from "./simplify.js";
