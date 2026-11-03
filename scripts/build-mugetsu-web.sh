#!/usr/bin/env bash
# Prerequisites: Rust 1.99.0 + wasm32 target, Node 24, Java 17, wasm-bindgen 0.2.127, wasm-opt.
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
for tool in wasm-bindgen wasm-opt; do command -v "$tool" >/dev/null; done
[[ "$(wasm-bindgen --version)" == "wasm-bindgen 0.2.127" ]]
wasm-opt --version >/dev/null
work="${MUGETSU_WEB_WORK:-$root/work/mugetsu-web}"
mkdir -p "$work"
if [[ ! -d "$work/mugetsu/.git" ]]; then
    git init -q "$work/mugetsu"
    git -C "$work/mugetsu" fetch --depth 1 https://github.com/mugetsu-aqw/mugetsu.git 49eeabc9bd8743b90827ae988b0c9e0ad9f3ba06
    git -C "$work/mugetsu" checkout --detach FETCH_HEAD
fi
[[ "$(git -C "$work/mugetsu" rev-parse HEAD)" == 49eeabc9bd8743b90827ae988b0c9e0ad9f3ba06 ]]
bash "$work/mugetsu/source/build-linux.sh" --prepare-only
source_dir="$work/mugetsu/source/build/ruffle"
git -C "$source_dir" apply "$root/scripts/mugetsu/web-port.patch"
export RUSTUP_TOOLCHAIN=1.99.0
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"
export BINARYEN_CORES="${BINARYEN_CORES:-1}"
cd "$source_dir/web"
npm ci --ignore-scripts --no-audit --no-fund
npm run build --workspace=ruffle-core
npm run build --workspace=ruffle-selfhosted
node "$root/scripts/install-mugetsu-web.js" "$source_dir/web/packages/selfhosted/dist" "$work/mugetsu"
