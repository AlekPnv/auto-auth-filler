#!/usr/bin/env bash
# Auto Auth Filler: Linux / macOS packaging script
# Produces two ZIPs ready for store submission:
#   auto-auth-filler-chrome.zip   -> Chrome Web Store / Edge Add-ons
#   auto-auth-filler-firefox.zip  -> Firefox AMO (addons.mozilla.org)
#
# Requirements: bash, zip (install via: apt install zip  or  brew install zip)
# Usage:  chmod +x package.sh && ./package.sh

set -euo pipefail

DIST="dist"
CHROME_ZIP="auto-auth-filler-chrome.zip"
FIREFOX_ZIP="auto-auth-filler-firefox.zip"

# Files to include (no .git, no node_modules)
# config.js carries your own Client ID and must be present, or the packaged
# extension cannot authenticate.
FILES=(
  manifest.json
  config.js
  background.js
  content.js
  options.html
  options.js
  popup.html
  popup.js
  styles.css
)

# 1. Clean and create dist/
echo "[1/4] Cleaning dist folder..."
rm -rf "$DIST"
mkdir -p "$DIST"

# 2. Copy files
echo "[2/4] Copying extension files..."
for f in "${FILES[@]}"; do
  if [[ -f "$f" ]]; then
    cp "$f" "$DIST/$f"
    echo "  Copied $f"
  else
    echo "  WARNING: $f not found, skipping"
  fi
done

# Copy icons directory
if [[ -d "icons" ]]; then
  cp -r icons "$DIST/icons"
  echo "  Copied icons/"
else
  echo "  WARNING: icons/ directory not found"
fi

# 3. Chrome ZIP - manifest without background.scripts, which Chrome warns about
echo "[3/4] Creating Chrome ZIP..."
node make-manifest.js chrome "$DIST/manifest.json"
rm -f "$CHROME_ZIP"
(cd "$DIST" && zip -r "../$CHROME_ZIP" . --exclude "*.DS_Store" --exclude "__MACOSX/*")
echo "  Created $CHROME_ZIP"

# 4. Firefox ZIP - manifest without background.service_worker, which AMO flags
echo "[4/4] Creating Firefox ZIP..."
node make-manifest.js firefox "$DIST/manifest.json"
rm -f "$FIREFOX_ZIP"
(cd "$DIST" && zip -r "../$FIREFOX_ZIP" . --exclude "*.DS_Store" --exclude "__MACOSX/*")
echo "  Created $FIREFOX_ZIP"

# Leave dist/ holding the Firefox manifest, which is the one web-ext lints.

# Done
echo ""
echo "Done!"
echo "  Chrome Web Store  →  $CHROME_ZIP"
echo "  Firefox AMO       →  $FIREFOX_ZIP"
echo ""
echo "REMINDER: Before publishing, ensure config.js contains YOUR OWN"
echo "          Google OAuth Client ID (see config.template.js for instructions)."
