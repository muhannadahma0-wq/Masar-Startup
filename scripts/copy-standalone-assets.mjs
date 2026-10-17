import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const staticAssets = path.join(root, ".next", "static");
try {
  await access(standalone);
  await access(staticAssets);
} catch {
  throw new Error("Next.js standalone output is missing. Run `next build` before copying assets.");
}
await mkdir(path.join(standalone, ".next"), { recursive: true });
await cp(staticAssets, path.join(standalone, ".next", "static"), { recursive: true, force: true });
try {
  await access(path.join(root, "public"));
  await cp(path.join(root, "public"), path.join(standalone, "public"), { recursive: true, force: true });
} catch {
  // A project without public assets is valid.
}
console.log("Standalone Next.js assets copied.");
