import fs from "node:fs";
import { render, PAGES } from "./lib/renderer.jsx";

const args = process.argv.slice(2);
const pageId = args[0] || "overview";

if (!PAGES.some((p) => p.id === pageId)) {
  console.error(`unknown page: ${pageId}\nvalid: ${PAGES.map((p) => p.id).join(", ")}`);
  process.exit(1);
}

const out = await render(undefined, pageId);

const outPath = `output-${pageId}.png`;
fs.writeFileSync(outPath, out.png);

console.log(`✓ ${outPath}`);
console.log(`page: ${out.pageId} (${out.pageName})`);
console.log("timings:", out.timings);
