#!/usr/bin/env bash
# Installs emRequest into every supported editor found on this Mac / Linux machine.
# Usage:  ./install.sh path/to/emrequest-x.y.z.vsix
set -u
VSIX="${1:-$(ls -t "$(dirname "$0")"/../*.vsix 2>/dev/null | head -1)}"
if [ -z "$VSIX" ] || [ ! -f "$VSIX" ]; then echo "Give the path to the .vsix file: ./install.sh emrequest.vsix"; exit 1; fi

# Editor name | command-line tool | extra places the tool lives on macOS
EDITORS=(
  "VS Code|code|/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
  "Cursor|cursor|/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
  "Antigravity|antigravity|/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity"
  "Windsurf|windsurf|/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf"
)
found=0
for row in "${EDITORS[@]}"; do
  IFS='|' read -r name cli macpath <<<"$row"
  bin="$(command -v "$cli" 2>/dev/null || true)"
  [ -z "$bin" ] && [ -x "$macpath" ] && bin="$macpath"
  if [ -n "$bin" ]; then
    found=1
    echo "→ Installing into $name…"
    if "$bin" --install-extension "$VSIX" --force >/dev/null 2>&1; then echo "  ✓ done"; else echo "  ✗ failed (open $name → Extensions → … → Install from VSIX)"; fi
  fi
done
[ $found -eq 0 ] && echo "No supported editor found. Install manually: Extensions → … → Install from VSIX."
echo "Restart the editor(s) to see emRequest in the sidebar."
