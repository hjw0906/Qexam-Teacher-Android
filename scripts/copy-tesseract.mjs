/**
 * Copies the Tesseract worker/core plus Korean+English language data into
 * public/ so image OCR works fully offline inside the packaged app.
 * Missing sources are reported as warnings, never as build errors.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeModules = resolve(root, "node_modules");
const outWorker = resolve(root, "public/tesseract");
const outData = resolve(root, "public/tessdata");

function warn(msg) {
  console.warn(`[assets] ${msg}`);
}

mkdirSync(outWorker, { recursive: true });
mkdirSync(outData, { recursive: true });

/* worker script */
const workerCandidates = [
  resolve(nodeModules, "tesseract.js/dist/worker.min.js"),
  resolve(nodeModules, "tesseract.js/dist/worker.js"),
];
let workerCopied = false;
for (const candidate of workerCandidates) {
  if (existsSync(candidate)) {
    copyFileSync(candidate, join(outWorker, "worker.min.js"));
    workerCopied = true;
    break;
  }
}
if (!workerCopied) warn("tesseract worker script not found (run npm install first)");

/* core wasm/js */
const coreDir = resolve(nodeModules, "tesseract.js-core");
if (existsSync(coreDir)) {
  for (const file of readdirSync(coreDir)) {
    if (/^tesseract-core.*\.(js|wasm)$/.test(file)) {
      copyFileSync(join(coreDir, file), join(outWorker, file));
    }
  }
} else {
  warn("tesseract.js-core not installed");
}

/* language data (npm packages keep the .traineddata.gz files) */
const languages = ["eng", "kor"];
for (const lang of languages) {
  const pkg = resolve(nodeModules, `@tesseract.js-data/${lang}/4.0.0_best_int`, `${lang}.traineddata.gz`);
  const flat = resolve(nodeModules, `@tesseract.js-data/${lang}`, `${lang}.traineddata.gz`);
  const source = existsSync(pkg) ? pkg : existsSync(flat) ? flat : null;
  if (source) {
    copyFileSync(source, join(outData, `${lang}.traineddata.gz`));
  } else {
    warn(`language data for "${lang}" not found - install @tesseract.js-data/${lang}`);
  }
}

const size = (dir) =>
  readdirSync(dir).reduce((total, file) => total + statSync(join(dir, file)).size, 0);
console.log(
  `[assets] tesseract worker ${(size(outWorker) / 1048576).toFixed(1)} MB, data ${(
    size(outData) / 1048576
  ).toFixed(1)} MB`,
);
