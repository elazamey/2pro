# @2pro/figma

A TypeScript client and toolkit for Figma:

1. **REST API client** (`FigmaClient`) — fetch files, nodes, and image render URLs.
2. **Design token extractor** (`extractDesignTokens`) — walk a file (or a single node) and extract colors, typography, spacing, and corner-radii tokens, including named styles from Figma's style system.
3. **Code generator** (`generateTailwind`, `generateHtml`) — turn a Figma frame into semantic HTML with Tailwind CSS classes (or inline CSS). Built-in mappings for font sizes, font weights, radii, flex layout, padding, and gaps. Arbitrary values fall back to Tailwind's bracket syntax (`w-[123px]`, `pt-[13px]`, `text-[#2e73f7]`).

## Usage

```ts
import { FigmaClient, extractDesignTokens, tokensToCss, tokensToTailwindTheme, generateTailwind } from "@2pro/figma";

const figma = new FigmaClient({ token: process.env.FIGMA_ACCESS_TOKEN });
const { file, node } = await figma.resolve("https://www.figma.com/design/abc123/My-Design?node-id=1-2");

// Extract tokens from the target node (or the whole file)
const tokens = extractDesignTokens({ ...file, document: node ?? file.document });
console.log(tokens.colors, tokens.typography, tokens.spacing, tokens.radii);
console.log(tokensToCss(tokens));                 // CSS custom properties
console.log(tokensToTailwindTheme(tokens));       // tailwind.config.js snippet

// Generate Tailwind HTML from a frame
const { html, warnings } = generateTailwind(node);
```

## CLI

`2pro figma tokens <url-or-key> [--format pretty|css|tailwind|json]`
`2pro figma code <url-or-key> [--node <id>] [--out file.html]`

## URL parsing

`parseFigmaUrl()` accepts:

- Plain file keys: `abc123DEF456`
- `/file/` URLs: `https://www.figma.com/file/abc123DEF456/Name?node-id=123%3A456`
- `/design/` URLs: `https://www.figma.com/design/abc123DEF456/Name`
- Node IDs are decoded automatically (the `%3A` → `:` conversion).
