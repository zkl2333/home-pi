/**
 * JSX vnode → Yoga 布局 → ops JSON。
 *
 * ops JSON 喂给 python/render_ops.py（PIL mode='1' + FreeType MONO）→ 真 1-bit PNG。
 *
 * 输入形状：React.createElement / JSX 输出的标准 vnode：
 *   { type: 'div', props: { style, children, ... }, key, ref, $$typeof }
 *
 * 支持的 style 子集（camelCase）：
 *   display:flex（默认）；flexDirection / justifyContent / alignItems / flex / flexGrow / flexShrink / flexBasis
 *   width / height / minWidth / minHeight（数字 / 'Npx' / '%'）
 *   padding[Top/Right/Bottom/Left]（含 shorthand "T R B L"）
 *   margin[Top/Right/Bottom/Left]
 *   gap / rowGap / columnGap
 *   fontSize / fontWeight / fontFamily / color（继承）
 *   textAlign:center（文字在自身盒内水平居中；默认左对齐）
 *   background / backgroundColor（黑/白 二值；灰色当黑处理，因为 e-ink 无灰）
 *   borderColor + borderWidth（四边）
 *
 * Yoga 配置走 useWebDefaults，flexDirection 默认 row（对齐浏览器 CSS）。
 */
import Yoga from "yoga-layout";

export const WIDTH = 250;
export const HEIGHT = 122;

// ─── 文字测量（近似，无需 canvas/PIL 实测） ────────────
// wqy-microhei CJK 字符宽 ≈ fontSize；ASCII ≈ fontSize * 0.55。
// 这是粗估：居中文字不依赖它（见 textAlign:center → PIL anchor='mm'
// 在盒心绘，盒心由 Yoga 居中保证 == 容器中心，与估宽误差无关）。
export function measureText(text, fontSize) {
  let w = 0;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code >= 0x2e80) w += fontSize;
    else w += fontSize * 0.55;
  }
  return { width: Math.ceil(w), height: Math.ceil(fontSize * 1.2) };
}

// ─── CSS 值解析 ─────────────────────────────────────
function parseLen(v) {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (s.endsWith("%")) return s;
  const n = parseFloat(s);
  return isNaN(n) ? undefined : n;
}

function parseShorthand(v) {
  if (v == null) return null;
  const parts = String(v).trim().split(/\s+/).map(parseLen);
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
  return [parts[0], parts[1], parts[2], parts[3]];
}

function isBlack(c) {
  if (c == null) return false;
  const s = String(c).toLowerCase().trim();
  return s === "black" || s === "#000" || s === "#000000";
}
function isWhite(c) {
  if (c == null) return false;
  const s = String(c).toLowerCase().trim();
  return s === "white" || s === "#fff" || s === "#ffffff";
}
function colorToBW(c, fallback = null) {
  if (c == null) return fallback;
  if (isBlack(c)) return "black";
  if (isWhite(c)) return "white";
  const s = String(c).toLowerCase().trim();
  // e-ink 无灰：所有"非白"色都当黑（含 #555 等灰色）
  if (s.startsWith("#") || s.startsWith("rgb")) return "black";
  return fallback;
}

// ─── Yoga 样式 ─────────────────────────────────────
const Y_JUSTIFY = {
  "flex-start": Yoga.JUSTIFY_FLEX_START,
  "flex-end": Yoga.JUSTIFY_FLEX_END,
  center: Yoga.JUSTIFY_CENTER,
  "space-between": Yoga.JUSTIFY_SPACE_BETWEEN,
  "space-around": Yoga.JUSTIFY_SPACE_AROUND,
  "space-evenly": Yoga.JUSTIFY_SPACE_EVENLY,
};
const Y_ALIGN = {
  "flex-start": Yoga.ALIGN_FLEX_START,
  "flex-end": Yoga.ALIGN_FLEX_END,
  center: Yoga.ALIGN_CENTER,
  stretch: Yoga.ALIGN_STRETCH,
  baseline: Yoga.ALIGN_BASELINE,
};
const Y_FLEX_DIR = {
  row: Yoga.FLEX_DIRECTION_ROW,
  column: Yoga.FLEX_DIRECTION_COLUMN,
  "row-reverse": Yoga.FLEX_DIRECTION_ROW_REVERSE,
  "column-reverse": Yoga.FLEX_DIRECTION_COLUMN_REVERSE,
};

function applyStyle(yn, style = {}) {
  if (style.width !== undefined) yn.setWidth(parseLen(style.width));
  if (style.height !== undefined) yn.setHeight(parseLen(style.height));
  if (style.minWidth !== undefined) yn.setMinWidth(parseLen(style.minWidth));
  if (style.minHeight !== undefined) yn.setMinHeight(parseLen(style.minHeight));
  if (style.maxWidth !== undefined) yn.setMaxWidth(parseLen(style.maxWidth));
  if (style.maxHeight !== undefined) yn.setMaxHeight(parseLen(style.maxHeight));
  if (style.flexDirection) yn.setFlexDirection(Y_FLEX_DIR[style.flexDirection]);
  if (style.justifyContent) yn.setJustifyContent(Y_JUSTIFY[style.justifyContent]);
  if (style.alignItems) yn.setAlignItems(Y_ALIGN[style.alignItems]);
  if (style.alignSelf) yn.setAlignSelf(Y_ALIGN[style.alignSelf]);
  if (style.flex !== undefined) yn.setFlex(parseLen(style.flex));
  if (style.flexGrow !== undefined) yn.setFlexGrow(parseLen(style.flexGrow));
  if (style.flexShrink !== undefined) yn.setFlexShrink(parseLen(style.flexShrink));
  if (style.flexBasis !== undefined) yn.setFlexBasis(parseLen(style.flexBasis));
  if (style.gap !== undefined) yn.setGap(Yoga.GUTTER_ALL, parseLen(style.gap));
  if (style.rowGap !== undefined) yn.setGap(Yoga.GUTTER_ROW, parseLen(style.rowGap));
  if (style.columnGap !== undefined) yn.setGap(Yoga.GUTTER_COLUMN, parseLen(style.columnGap));

  if (style.padding !== undefined) {
    const v = parseLen(style.padding);
    if (v !== undefined) yn.setPadding(Yoga.EDGE_ALL, v);
    else {
      const arr = parseShorthand(style.padding);
      if (arr) {
        yn.setPadding(Yoga.EDGE_TOP, arr[0]);
        yn.setPadding(Yoga.EDGE_RIGHT, arr[1]);
        yn.setPadding(Yoga.EDGE_BOTTOM, arr[2]);
        yn.setPadding(Yoga.EDGE_LEFT, arr[3]);
      }
    }
  }
  if (style.paddingTop !== undefined) yn.setPadding(Yoga.EDGE_TOP, parseLen(style.paddingTop));
  if (style.paddingRight !== undefined) yn.setPadding(Yoga.EDGE_RIGHT, parseLen(style.paddingRight));
  if (style.paddingBottom !== undefined) yn.setPadding(Yoga.EDGE_BOTTOM, parseLen(style.paddingBottom));
  if (style.paddingLeft !== undefined) yn.setPadding(Yoga.EDGE_LEFT, parseLen(style.paddingLeft));

  if (style.margin !== undefined) yn.setMargin(Yoga.EDGE_ALL, parseLen(style.margin));
  if (style.marginTop !== undefined) yn.setMargin(Yoga.EDGE_TOP, parseLen(style.marginTop));
  if (style.marginRight !== undefined) yn.setMargin(Yoga.EDGE_RIGHT, parseLen(style.marginRight));
  if (style.marginBottom !== undefined) yn.setMargin(Yoga.EDGE_BOTTOM, parseLen(style.marginBottom));
  if (style.marginLeft !== undefined) yn.setMargin(Yoga.EDGE_LEFT, parseLen(style.marginLeft));
}

// ─── 样式继承 ──────────────────────────────────────
function inheritStyle(parent, own = {}) {
  return {
    fontSize: own.fontSize ?? parent.fontSize ?? 11,
    fontWeight: own.fontWeight ?? parent.fontWeight ?? 400,
    fontFamily: own.fontFamily ?? parent.fontFamily ?? "regular",
    color: own.color ?? parent.color ?? "black",
  };
}
function fontPx(v) {
  if (v == null) return 11;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v));
  return isNaN(n) ? 11 : n;
}

// ─── 规范化 ─────────────────────────────────────
// JSX 输出有三种非 host 节点：
//   - 函数组件：vnode.type 是函数 → 调用拿到子 vnode
//   - Fragment：vnode.type 是 Symbol(react.fragment) → 把 children 摊到父级
//   - 数组 / 嵌套数组 / false / null / 空字符串：需要清理
// 规范化把整棵树压成 { type: string, props: { style, children: array } }
// 一次性产物，下游 walker（buildYogaTree / emitOps）就稳定可靠了。
function isTextContent(c) {
  return typeof c === "string" || typeof c === "number";
}
function isVNode(v) {
  return v != null && typeof v === "object" && "type" in v && "props" in v;
}
function isFragment(v) {
  // Fragment 节点的 type 是 Symbol(react.fragment)，无 string 名字
  return isVNode(v) && (typeof v.type === "symbol" || v.type == null);
}

// 把一个 child slot 摊平成 host vnode 或文本 的扁平数组
function flattenChild(c, out) {
  if (c == null || c === false || c === true) return;
  if (Array.isArray(c)) {
    for (const x of c) flattenChild(x, out);
    return;
  }
  if (isTextContent(c)) {
    if (typeof c === "string" && c.trim() === "") return;
    out.push(c);
    return;
  }
  if (!isVNode(c)) return;
  // 展开函数组件
  let v = c;
  while (isVNode(v) && typeof v.type === "function") {
    v = v.type(v.props);
  }
  if (v == null || v === false || v === true) return;
  if (isTextContent(v)) {
    out.push(v);
    return;
  }
  if (!isVNode(v)) return;
  // Fragment：摊到父级
  if (isFragment(v)) {
    flattenChild(v.props?.children, out);
    return;
  }
  // host element：递归规范化它自己的 children，挂在新 vnode 上
  const normChildren = [];
  flattenChild(v.props?.children, normChildren);
  out.push({
    type: v.type,
    props: { ...v.props, children: normChildren },
  });
}

function normalizeTree(vnode) {
  const out = [];
  flattenChild(vnode, out);
  // 根必须是单个 host element
  if (out.length !== 1 || isTextContent(out[0])) {
    throw new Error("vdomToOps: 根节点必须是单个非文本 host element");
  }
  return out[0];
}

// ─── VDOM → Yoga ────────────────────────────────────
let webConfig = null;
function getWebConfig() {
  if (!webConfig) {
    webConfig = Yoga.Config.create();
    webConfig.setUseWebDefaults(true); // flexDirection=row 浏览器默认
  }
  return webConfig;
}

function buildYogaTree(vnode, parentInherited) {
  if (isTextContent(vnode)) return null;
  const yn = Yoga.Node.createWithConfig(getWebConfig());
  const style = vnode.props?.style ?? {};
  applyStyle(yn, style);

  const inherited = inheritStyle(parentInherited, style);
  vnode.__inherited = inherited;

  const children = vnode.props?.children ?? [];
  const allText = children.length > 0 && children.every(isTextContent);
  if (allText) {
    const text = children.map(String).join("");
    const fs = fontPx(inherited.fontSize);
    // 宽：优先注入的精确测量器（ft-mono FreeType advance，与光栅同源）；
    // 缺省回退 0.55 估算。高：仍用 1.2×fs 行盒（竖直居中由 raster
    // 的 anchor 'lm'/'mm' 按字体真实 ascent/descent 处理，与此盒高解耦）。
    const w = _measure
      ? _measure(text, fs, inherited.fontFamily)
      : measureText(text, fs).width;
    if (style.width === undefined) yn.setWidth(w);
    if (style.height === undefined) yn.setHeight(Math.ceil(fs * 1.2));
    vnode.__text = text;
    return yn;
  }

  let idx = 0;
  for (const child of children) {
    if (isTextContent(child)) continue;
    const childYn = buildYogaTree(child, inherited);
    if (childYn) yn.insertChild(childYn, idx++);
  }
  return yn;
}

// ─── 走树 emit ops ─────────────────────────────────
function emitOps(ctx, vnode, yn, parentX, parentY) {
  if (isTextContent(vnode)) return;
  const x = Math.round(parentX + yn.getComputedLeft());
  const y = Math.round(parentY + yn.getComputedTop());
  const w = Math.round(yn.getComputedWidth());
  const h = Math.round(yn.getComputedHeight());
  const style = vnode.props?.style ?? {};
  const inh = vnode.__inherited;

  // 背景
  const bg = style.background ?? style.backgroundColor;
  if (bg) {
    const c = colorToBW(bg);
    if (c) ctx.ops.push({ op: "rect", x, y, w, h, fill: c });
  }

  // 边框（box-sizing:border-box）
  const bColor = colorToBW(style.borderColor);
  const bWidth = parseLen(style.borderWidth);
  if (bColor && bWidth) {
    ctx.ops.push({ op: "rect", x, y, w, h: bWidth, fill: bColor });
    ctx.ops.push({ op: "rect", x, y: y + h - bWidth, w, h: bWidth, fill: bColor });
    ctx.ops.push({ op: "rect", x, y, w: bWidth, h, fill: bColor });
    ctx.ops.push({ op: "rect", x: x + w - bWidth, y, w: bWidth, h, fill: bColor });
  }
  // border-radius:50% 当圆点处理（4-6px 圆点用 ellipse）
  const br = style.borderRadius;
  if (br && (br === "50%" || br === "999px") && w <= 16 && h <= 16) {
    if (bg) {
      // 圆点：先擦背景画，再加 ellipse
      ctx.ops.push({ op: "rect", x, y, w, h, fill: "white" }); // 抠掉前面背景方块
      ctx.ops.push({ op: "ellipse", x, y, w, h, fill: colorToBW(bg, "black") });
    } else if (bColor) {
      ctx.ops.push({ op: "ellipse", x, y, w, h, stroke: bColor });
    }
  }

  // 文字
  if (vnode.__text) {
    ctx.ops.push({
      op: "text",
      x,
      y,
      w,
      h,
      text: vnode.__text,
      font: inh.fontFamily ?? "regular",
      size: fontPx(inh.fontSize),
      fill: colorToBW(inh.color, "black"),
      // textAlign:center → Python 用 anchor='mm' 在盒心绘（盒心由 flex 居中
      // 保证 == 容器中心，与估宽误差无关）。默认左对齐 + 盒内竖直居中。
      align: style.textAlign === "center" ? "center" : undefined,
    });
    return;
  }

  // 递归
  const children = vnode.props?.children ?? [];
  let idx = 0;
  for (const child of children) {
    if (isTextContent(child)) continue;
    const childYn = yn.getChild(idx++);
    emitOps(ctx, child, childYn, x, y);
  }
}

// 注入的精确测量器（renderer 在 ft-mono 就绪后传入）。buildYogaTree 递归
// 内部用，故走模块级；vdomToOps 单次调用串行（ft-mono 单 g_face 本就串行）。
let _measure = null;

// ─── 主入口 ────────────────────────────────────────
// opts.measure?: (text, fontPx, fontFamily) => widthPx —— 缺省回退 0.55 估算
export function vdomToOps(vnode, { width = WIDTH, height = HEIGHT, fonts, measure } = {}) {
  _measure = measure || null;
  try {
    // 把整棵 JSX 树展开成 host-only 规范树（type 全字符串、children 全扁平）
    const root = normalizeTree(vnode);
    const yRoot = buildYogaTree(root, {});
    yRoot.setWidth(width);
    yRoot.setHeight(height);
    yRoot.calculateLayout(width, height);

    const ctx = { ops: [] };
    emitOps(ctx, root, yRoot, 0, 0);
    yRoot.freeRecursive();

    return {
      size: [width, height],
      fonts: fonts ?? { regular: "fonts/wqy-microhei.ttf" },
      ops: ctx.ops,
    };
  } finally {
    _measure = null;
  }
}
