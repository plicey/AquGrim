#!/bin/sh
# Rebuild the game bridge SWF from AquaBridge.as on Linux, with no root.
#
# The AS3 compiler is Apache Flex's mxmlc, which needs a JDK (it ships none) and a
# playerglobal.swc. Both are plain tarballs; nothing here installs anything system-wide.
#
# The two traps, in the order you hit them:
#
#   JAVA_HOME is NOT enough. bin/mxmlc calls a bare `java` from PATH, ignoring JAVA_HOME
#   entirely, so the JDK's bin directory has to be on PATH or it fails with "java: not found".
#
#   PLAYERGLOBAL_HOME is required and the SDK does not derive it. flex-config.xml refers to
#   {playerglobalHome} and nothing sets it, so compilation fails with
#   "unable to open '{playerglobalHome}/32.0'" until you export it. This is the variable the
#   SDK documentation leaves to you, and the one worth knowing before you start.
#
# Fetch the toolchain (no root needed, ~600 MB):
#
#   mkdir -p work/flash-sdk && cd work/flash-sdk
#   curl -LO https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse
#   tar xzf <jdk>.tar.gz
#   curl -LO https://archive.apache.org/dist/flex/4.16.1/binaries/apache-flex-sdk-4.16.1-bin.tar.gz
#   tar xzf apache-flex-sdk-4.16.1-bin.tar.gz
#   curl -Lo playerglobal32_0.swc https://fpdownload.macromedia.com/get/flashplayer/updaters/32/playerglobal32_0.swc
#   mkdir -p apache-flex-sdk-4.16.1-bin/frameworks/libs/player/32.0
#   cp playerglobal32_0.swc apache-flex-sdk-4.16.1-bin/frameworks/libs/player/32.0/playerglobal.swc
#
# Then:
#
#   FLEX_HOME=<sdk> JDK_HOME=<jdk> sh plugins/grimlite-parity/bridge/build.sh
#
# The output is deliberately not committed: plugins/*/assets/*.swf is the repo's precedent
# for SWF assets, and the bridge is reproducible from this source plus the recipe above.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
out="$here/../assets/aqua-bridge.swf"

FLEX_HOME=${FLEX_HOME:-}
if [ -z "$FLEX_HOME" ] || [ ! -x "$FLEX_HOME/bin/mxmlc" ]; then
    echo "FLEX_HOME must point at an Apache Flex SDK with bin/mxmlc (got: ${FLEX_HOME:-unset})" >&2
    exit 1
fi

# mxmlc needs a JRE on PATH; JAVA_HOME alone is not consulted by the wrapper.
if ! command -v java >/dev/null 2>&1; then
    if [ -n "${JDK_HOME:-}" ] && [ -x "$JDK_HOME/bin/java" ]; then
        PATH="$JDK_HOME/bin:$PATH"
        export PATH
    else
        echo "no java on PATH, and JDK_HOME is unset or has no bin/java" >&2
        exit 1
    fi
fi

# The SDK never derives this one, and flex-config.xml fails without it.
PLAYERGLOBAL_HOME=${PLAYERGLOBAL_HOME:-$FLEX_HOME/frameworks/libs/player}
export PLAYERGLOBAL_HOME

mkdir -p "$(dirname "$out")"

# Same flags plugins/example-companion/flash/build.bat documents for plugin SWFs.
exec "$FLEX_HOME/bin/mxmlc" \
    -target-player=32.0 \
    -swf-version=32 \
    -default-size 960 530 \
    -default-background-color=0x000000 \
    -default-frame-rate=24 \
    -static-link-runtime-shared-libraries=true \
    -output "$out" \
    "$here/AquaBridge.as"
