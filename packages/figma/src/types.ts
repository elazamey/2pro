/**
 * Subset of Figma REST API types we actually use. Figma's API responses are
 * rich; we model only the fields we need for token extraction and code gen.
 */

export type LayoutMode = "NONE" | "HORIZONTAL" | "VERTICAL";
export type PrimaryAxisAlignItems = "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
export type CounterAxisAlignItems = "MIN" | "CENTER" | "MAX" | "BASELINE";
export type BlendMode = string;

export interface Paint {
  type: "SOLID" | "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "IMAGE" | "EMOJI";
  color?: { r: number; g: number; b: number; a?: number };
  opacity?: number;
  visible?: boolean;
  gradientStops?: Array<{ color: { r: number; g: number; b: number; a?: number }; position: number }>;
  imageRef?: string;
  scaleMode?: "FILL" | "FIT" | "CROP" | "TILE";
}

export interface TypeStyle {
  fontFamily?: string;
  fontPostScriptName?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  lineHeightPercent?: number;
  letterSpacing?: number;
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";
  textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  italic?: boolean;
}

export interface ExportSetting {
  suffix: string;
  format: "PNG" | "JPG" | "SVG" | "PDF";
}

export interface Style {
  key: string;
  name: string;
  description: string;
  styleType: "FILL" | "TEXT" | "EFFECT" | "GRID";
}

export interface BaseNode {
  id: string;
  name: string;
  visible?: boolean;
  // Absolute bounding box in canvas coords
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  // Relative to its parent (not always present)
  relativeTransform?: number[][];
  fills?: Paint[];
  strokes?: Paint[];
  strokeWeight?: number;
  strokeAlign?: "INSIDE" | "OUTSIDE" | "CENTER";
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  opacity?: number;
  effects?: Array<{ type: string; radius?: number; color?: { r: number; g: number; b: number; a?: number }; offset?: { x: number; y: number }; visible?: boolean }>;
  styles?: Record<string, string>; // fill -> styleKey, text -> styleKey, etc.
  children?: FigmaNode[];
  layoutMode?: LayoutMode;
  primaryAxisAlignItems?: PrimaryAxisAlignItems;
  counterAxisAlignItems?: CounterAxisAlignItems;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  counterAxisSpacing?: number;
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
  clipsContent?: boolean;
}

export interface TextNode extends BaseNode {
  type: "TEXT";
  characters?: string;
  style?: TypeStyle;
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<string, TypeStyle>;
}

export interface FrameNode extends BaseNode {
  type: "FRAME";
}

export interface ComponentNode extends BaseNode {
  type: "COMPONENT" | "COMPONENT_SET";
  componentId?: string;
  key?: string;
}

export interface InstanceNode extends BaseNode {
  type: "INSTANCE";
  componentId?: string;
}

export interface RectangleNode extends BaseNode {
  type: "RECTANGLE";
}

export interface GroupNode extends BaseNode {
  type: "GROUP";
}

export interface VectorNode extends BaseNode {
  type: "VECTOR" | "LINE" | "ELLIPSE" | "POLYGON" | "STAR" | "BOOLEAN_OPERATION";
}

export type FigmaNode =
  | TextNode
  | FrameNode
  | ComponentNode
  | InstanceNode
  | RectangleNode
  | GroupNode
  | VectorNode
  | BaseNode & { type: string };

export interface FigmaFile {
  name: string;
  lastModified: string;
  version: string;
  role: string;
  editorType: string;
  document: FigmaNode;
  components?: Record<string, { key: string; name: string; description: string; componentSetId?: string }>;
  componentSets?: Record<string, { key: string; name: string; description: string }>;
  styles?: Record<string, Style>;
}
