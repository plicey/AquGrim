#!/bin/bash
# Drive one local-origin boot. Scratch artifact; see README.md.
#
#   bash docs/research/local-origin/run.sh [--on-display=:0] [harness flags...]
#
# Runs on a headless Xvfb display by default; pass --on-display=:0 to watch it, and
# --wait=<ms> to hold the window open long enough for a human to log in (see the report's
# "steps only a human can do" section).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
OUT=/var/tmp/aq-origin/run
DISPLAY_ARG="$DISPLAY"
[ -z "$DISPLAY_ARG" ] && DISPLAY_ARG=":99"
EXTRA=""
for a in "$@"; do
  case "$a" in
    --on-display=*) DISPLAY_ARG="$(echo "$a" | cut -d= -f2-)" ;;
    --out=*)        OUT="$(echo "$a" | cut -d= -f2-)" ;;
    *)              EXTRA="$EXTRA $a" ;;
  esac
done
mkdir -p "$OUT/logs"
if ! xdpyinfo -display "$DISPLAY_ARG" >/dev/null 2>&1; then
  echo "[run] starting Xvfb on $DISPLAY_ARG"
  Xvfb "$DISPLAY_ARG" -screen 0 1280x800x24 >"$OUT/logs/xvfb.log" 2>&1 &
  sleep 2
fi
echo "[run] DISPLAY=$DISPLAY_ARG output=$OUT"
DISPLAY="$DISPLAY_ARG" "$REPO/node_modules/electron/dist/electron" \
  "$REPO/docs/research/local-origin/harness.js" --out="$OUT" $EXTRA 2>&1 | tee "$OUT/harness.log"
