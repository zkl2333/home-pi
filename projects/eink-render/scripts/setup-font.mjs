// 一键准备 wqy-microhei.ttf：从 GitHub 镜像下载 .ttc 再抽出 subfont 0 为 .ttf
// Satori 0.26 不支持 ttcf 签名（TTC），所以必须拆成独立 .ttf 才能喂给它。
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const FONTS_DIR = path.resolve("fonts");
const TTC_PATH = path.join(FONTS_DIR, "wqy-microhei.ttc");
const TTF_PATH = path.join(FONTS_DIR, "wqy-microhei.ttf");
// 顺序：本机 cache → 系统 apt 字体（Pi 上 fonts-wqy-microhei 包提供）→ 网络下载
// Pi 上 github.com:443 被屏蔽，走 jsdelivr 代理（Cloudflare 可达）。
const SYSTEM_TTC = "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc";
const URL_PRIMARY = "https://cdn.jsdelivr.net/gh/anthonyfok/fonts-wqy-microhei@master/wqy-microhei.ttc";
const URL_FALLBACK = "https://github.com/anthonyfok/fonts-wqy-microhei/raw/master/wqy-microhei.ttc";

function extractTTC(inputPath, outputPath, fontIndex = 0) {
  const buf = fs.readFileSync(inputPath);
  if (buf.toString("ascii", 0, 4) !== "ttcf") throw new Error("Not a TTC file");
  const numFonts = buf.readUInt32BE(8);
  if (fontIndex >= numFonts) throw new Error(`fontIndex ${fontIndex} >= numFonts ${numFonts}`);

  const subfontOffset = buf.readUInt32BE(12 + fontIndex * 4);
  const sfntVersion = buf.readUInt32BE(subfontOffset);
  const numTables = buf.readUInt16BE(subfontOffset + 4);

  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const rec = subfontOffset + 12 + i * 16;
    tables.push({
      tag: buf.toString("ascii", rec, rec + 4),
      checksum: buf.readUInt32BE(rec + 4),
      offset: buf.readUInt32BE(rec + 8),
      length: buf.readUInt32BE(rec + 12),
    });
  }

  const headerSize = 12 + numTables * 16;
  let cursor = headerSize;
  const remapped = tables.map((t) => {
    const newOffset = cursor;
    cursor += (t.length + 3) & ~3; // 4-byte 对齐
    return { ...t, newOffset };
  });

  const out = Buffer.alloc(cursor);
  out.writeUInt32BE(sfntVersion, 0);
  out.writeUInt16BE(numTables, 4);
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = (1 << entrySelector) * 16;
  out.writeUInt16BE(searchRange, 6);
  out.writeUInt16BE(entrySelector, 8);
  out.writeUInt16BE(numTables * 16 - searchRange, 10);

  remapped.forEach((t, i) => {
    const rec = 12 + i * 16;
    out.write(t.tag, rec, 4, "ascii");
    out.writeUInt32BE(t.checksum, rec + 4);
    out.writeUInt32BE(t.newOffset, rec + 8);
    out.writeUInt32BE(t.length, rec + 12);
    buf.copy(out, t.newOffset, t.offset, t.offset + t.length);
  });

  fs.writeFileSync(outputPath, out);
  return { numFonts, fontIndex, numTables, size: cursor };
}

async function downloadTo(url, dest) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await pipeline(res.body, fs.createWriteStream(dest));
}

fs.mkdirSync(FONTS_DIR, { recursive: true });

if (!fs.existsSync(TTC_PATH)) {
  if (fs.existsSync(SYSTEM_TTC)) {
    // Pi / Debian 系装了 fonts-wqy-microhei，直接复用，秒过
    console.log(`= 复用系统字体 ${SYSTEM_TTC}`);
    fs.copyFileSync(SYSTEM_TTC, TTC_PATH);
    console.log(`✓ ${TTC_PATH} (${fs.statSync(TTC_PATH).size} bytes)`);
  } else {
    // jsdelivr 优先（Cloudflare 可达），github 兜底
    const urls = [URL_PRIMARY, URL_FALLBACK];
    let lastErr;
    for (const url of urls) {
      try {
        console.log(`↓ ${url}`);
        await downloadTo(url, TTC_PATH);
        console.log(`✓ ${TTC_PATH} (${fs.statSync(TTC_PATH).size} bytes)`);
        lastErr = null;
        break;
      } catch (e) {
        console.log(`  失败: ${e.message}`);
        lastErr = e;
        try { fs.unlinkSync(TTC_PATH); } catch {}
      }
    }
    if (lastErr) throw new Error(`所有源都失败: ${lastErr.message}`);
  }
} else {
  console.log(`= ${TTC_PATH} (already exists)`);
}

if (!fs.existsSync(TTF_PATH)) {
  const r = extractTTC(TTC_PATH, TTF_PATH, 0);
  console.log(`✓ ${TTF_PATH} (font ${r.fontIndex}/${r.numFonts}, ${r.numTables} tables, ${r.size} bytes)`);
} else {
  console.log(`= ${TTF_PATH} (already exists)`);
}

console.log("\n字体就位，可以 npm run dev 了。");
