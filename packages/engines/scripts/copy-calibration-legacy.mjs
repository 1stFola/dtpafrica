import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src/calibration/legacy");
const dest = path.join(root, "dist/calibration/legacy");
fs.mkdirSync(dest, { recursive: true });
for (const file of ["calibration-data.js", "calibration-engine.js"]) {
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
}
console.log("Copied calibration legacy scripts to dist/calibration/legacy");
