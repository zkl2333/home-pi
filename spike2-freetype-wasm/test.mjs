// spike#2 验证（非生产）：加载自编 freetype-mono.wasm，跑 spike#1 全绿项
// + 之前 OOM 的 4.4MB wqy CJK。直接读 1-bit buffer（无 RGBA/无堆视图坑）。
//   node test.mjs            （需先 docker 构建出 ./out/freetype-mono.mjs+.wasm）
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOD = path.join(__dirname, "out", "freetype-mono.mjs");
const FONT_DIR = path.join(__dirname, "..", "projects", "eink-render", "fonts");
const t = () => performance.now();

function pngGray(width, height, gray) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const tb = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tb[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = tb[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (ty, d) => { const t4 = Buffer.from(ty); const L = Buffer.alloc(4); L.writeUInt32BE(d.length); const C = Buffer.alloc(4); C.writeUInt32BE(crc(Buffer.concat([t4, d]))); return Buffer.concat([L, t4, d, C]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width + 1)] = 0; for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = gray[y * width + x]; }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function main() {
  if (!fs.existsSync(MOD)) {
    console.error(`缺 ${MOD}\n先构建：docker build -t ft-mono-spike . && docker run --rm -v "$PWD/out:/out" ft-mono-spike`);
    process.exit(2);
  }
  const t0 = t();
  const Factory = (await import(pathToFileURL(MOD).href)).default;
  const m = await Factory();
  const init = m.cwrap("ft_init", "number", []);
  const loadFace = m.cwrap("ft_load_face", "number", ["number", "number"]);
  const setPx = m.cwrap("ft_set_px", "number", ["number"]);
  const render = m.cwrap("ft_render", "number", ["number"]);
  const g = (n) => m.cwrap(n, "number", [])();
  if (init() !== 0) throw new Error("ft_init 失败");
  console.log(`[1] 模块就绪 init=${(t() - t0).toFixed(1)}ms`);

  // wqy 在仓库里是 gitignored 的 .ttc（CI 会拉到 spike2 本目录）；
  // FreeType FT_New_Memory_Face(index 0) 直接吃 .ttc，无需抽 ttf。
  // 本机 dev 优先用 projects 下已有的 wqy-microhei.ttf。
  const wqyLocal = path.join(FONT_DIR, "wqy-microhei.ttf");
  const wqyTtc = path.join(__dirname, "wqy-microhei.ttc");
  const cases = [
    { name: "archivo", path: path.join(FONT_DIR, "archivo-black.ttf"), px: 64, text: "15:04" },
    { name: "phosphor", path: path.join(FONT_DIR, "Phosphor.ttf"), px: 24, text: "" },
    {
      name: "wqy",
      path: fs.existsSync(wqyLocal) ? wqyLocal : wqyTtc,
      px: 24,
      text: "晴22°C",
    }, // 之前 OOM 的关键用例
  ];

  for (const c of cases) {
    try {
      const fp = c.path;
      if (!fs.existsSync(fp)) { console.log(`[skip] ${path.basename(fp)} 不存在`); continue; }
      const bytes = fs.readFileSync(fp);
      const mb = (bytes.length / 1048576).toFixed(2);
      const ptr = m._malloc(bytes.length);
      m.HEAPU8.set(bytes, ptr);
      const tL = t();
      const e = loadFace(ptr, bytes.length);
      const tLd = (t() - tL).toFixed(1);
      if (e !== 0) { console.log(`--- ${c.name} (${mb}MB) ✗ ft_load_face err=${e}`); m._free(ptr); continue; }
      setPx(c.px);
      console.log(`--- ${c.name} (${path.basename(fp)}, ${mb}MB) load=${tLd}ms ${c.name === "wqy" ? "← 关键 CJK 用例" : ""}`);

      if (!c.text) { console.log(`    (无文本，仅验加载不 OOM) ✅`); m._free(ptr); continue; }

      const recs = [];
      let totalAdv = 0, gray = 0, pm = new Set();
      const tR = t();
      for (const ch of c.text) {
        if (render(ch.codePointAt(0)) !== 0) { console.log(`    [warn] 渲染失败 '${ch}'`); continue; }
        const w = g("ft_bm_width"), rows = g("ft_bm_rows"), pitch = g("ft_bm_pitch");
        const pmode = g("ft_bm_pixmode"), bp = g("ft_bm_buffer");
        const left = g("ft_bm_left"), top = g("ft_bm_top");
        const adv = g("ft_adv_x") >> 6; // 26.6 → px
        pm.add(pmode);
        // 直接解包 1-bit MSB-first（无 RGBA、无堆视图失效——立刻拷出）
        const mono = new Uint8Array(w * rows);
        for (let y = 0; y < rows; y++)
          for (let x = 0; x < w; x++) {
            const byte = m.HEAPU8[bp + y * pitch + (x >> 3)];
            mono[y * w + x] = (byte >> (7 - (x & 7))) & 1;
          }
        recs.push({ ch, w, rows, left, top, adv, mono });
        totalAdv += adv;
      }
      const tRd = (t() - tR).toFixed(1);

      const H = Math.ceil(c.px * 1.6), base = Math.ceil(H * 0.72);
      const W = Math.max(2, totalAdv + 4);
      const buf = new Uint8Array(W * H).fill(255);
      let pen = 2;
      for (const r of recs) {
        const ox = pen + r.left, oy = base - r.top;
        for (let y = 0; y < r.rows; y++) for (let x = 0; x < r.w; x++)
          if (r.mono[y * r.w + x]) { const X = ox + x, Y = oy + y; if (X >= 0 && X < W && Y >= 0 && Y < H) buf[Y * W + X] = 0; }
        pen += r.adv;
      }
      const out = path.join(__dirname, `spike2-out-${c.name}.png`);
      fs.writeFileSync(out, pngGray(W, H, buf));
      console.log(`    pixel_mode=${[...pm].join(",")} (期望 1=MONO) 渲染=${tRd}ms`);
      console.log(`    advance: ${recs.map((r) => `'${r.ch}'=${r.adv}`).join(" ")}  合计=${totalAdv}px`);
      console.log(`    → ${out}`);
      m._free(ptr);
    } catch (err) {
      console.log(`    ✗ ${c.name}: ${err && err.message ? err.message : err}`);
    }
  }
}
main().catch((e) => { console.error("SPIKE2 FAIL:", e); process.exit(1); });
