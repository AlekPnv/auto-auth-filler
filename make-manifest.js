// Writes a target-specific manifest into the dist folder.
//
// The source manifest.json carries both background keys so that loading the
// folder unpacked works in either browser during development. Shipping both is
// not acceptable though: Chrome warns "'background.scripts' requires manifest
// version of 2 or lower", and addons.mozilla.org warns that
// background.service_worker is ignored. Each package therefore gets only the
// key its engine actually uses.
//
// Usage: node make-manifest.js <chrome|firefox> <output-path>

const fs = require("fs");
const path = require("path");

const target = process.argv[2];
const outPath = process.argv[3];

if (!["chrome", "firefox"].includes(target) || !outPath) {
  console.error("usage: node make-manifest.js <chrome|firefox> <output-path>");
  process.exit(1);
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"),
);

if (target === "chrome") {
  delete manifest.background.scripts;
  // gecko-only, meaningless to Chromium
  delete manifest.browser_specific_settings;
} else {
  delete manifest.background.service_worker;
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");

const kept = Object.keys(manifest.background).join(", ");
console.log(`  manifest for ${target}: background keys = ${kept}`);
