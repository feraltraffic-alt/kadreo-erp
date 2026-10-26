/**
 * One self-contained HTML of the web build on in-memory demo data (no backend), for sharing:
 * the JS bundle, its lazy chunks and the Onest fonts are inlined as data URIs.
 *
 *   pnpm --filter @kadreo/mobile build:demo     → dist-demo/kadreo-mobile-demo.html
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = "dist-demo";
rmSync(out, { recursive: true, force: true });
const env = { ...process.env };
delete env.EXPO_PUBLIC_API_URL;
execSync(`npx expo export --platform web --output-dir ${out}`, { stdio: "inherit", env });

const html = readFileSync(join(out, "index.html"), "utf8");
const main = /<script src="([^"]+)" defer><\/script>/.exec(html)[1];
let js = readFileSync(join(out, main), "utf8");

const dataUri = (path, type) => `data:${type};base64,${readFileSync(join(out, path)).toString("base64")}`;
// Fonts and other assets are modules exporting their URL: point them at data URIs.
js = js.replace(/"(\/assets\/[^"]+\.(ttf|otf|png))"/g, (m, path, ext) => {
  const file = path.slice(1);
  if (!existsSync(join(out, file))) return m;
  return JSON.stringify(dataUri(file, ext === "png" ? "image/png" : "font/ttf"));
});
// Lazy chunks (camera barcode scanner) load by URL as well.
js = js.replace(/"(\/_expo\/static\/js\/web\/[^"]+\.js)"/g, (m, path) => JSON.stringify(dataUri(path.slice(1), "text/javascript")));

const page = html
  .replace(/<title>[^<]*<\/title>/, "<title>Kadreo — мобильное приложение и киоск (демо)</title>")
  .replace(/<link rel="icon"[^>]*\/>/, "")
  .replace(/<script src="[^"]+" defer><\/script>/, () => `<script>${js.replace(/<\/script/gi, "<\\/script")}</script>`);
writeFileSync(join(out, "kadreo-mobile-demo.html"), page);
console.log(`${out}/kadreo-mobile-demo.html: ${(page.length / 1e6).toFixed(1)} MB`);
