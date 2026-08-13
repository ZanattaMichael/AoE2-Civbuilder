#!/usr/bin/env bash
#
# Builds create-data-mod, the native binary that rewrites the game's .dat file.
#
# Runnable from anywhere: paths are derived from the script's own location
# rather than the caller's working directory.
#
# Requires: build-essential cmake libjsoncpp-dev zlib1g-dev liblz4-dev
#           libboost-iostreams-dev
#
# Usage:
#   ./modding/scripts/build.sh            # build
#   ./modding/scripts/build.sh --clean    # discard the build directory first

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
MODDING_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$MODDING_DIR")"
BUILD_DIR="$MODDING_DIR/build"

if [[ "${1:-}" == "--clean" ]]; then
	echo "Removing $BUILD_DIR"
	rm -rf "$BUILD_DIR"
fi

# genieutils is a submodule and is compiled as part of this build. pcrio sits
# beside it because genieutils' CMakeLists compiles ../pcrio/pcrio.c.
if [[ ! -f "$MODDING_DIR/genieutils/CMakeLists.txt" ]]; then
	echo "genieutils is missing. Initialising submodules..."
	git -C "$REPO_ROOT" submodule update --init --recursive modding/genieutils
fi

if [[ ! -f "$MODDING_DIR/pcrio/pcrio.c" ]]; then
	echo "error: modding/pcrio/pcrio.c is missing; genieutils cannot be built without it" >&2
	exit 1
fi

echo "Configuring..."
cmake -S "$MODDING_DIR" -B "$BUILD_DIR" -DSTATIC_COMPILE=TRUE

echo "Building..."
cmake --build "$BUILD_DIR" -j "$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)"

BINARY="$BUILD_DIR/create-data-mod"
if [[ ! -x "$BINARY" ]]; then
	echo "error: build finished but $BINARY is missing" >&2
	exit 1
fi

echo
echo "Built $BINARY"
"$BINARY" --help 2>/dev/null | head -5 || true
