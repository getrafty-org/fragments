#!/bin/bash
set -e

NAME="fgmpackd"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="/usr/local/bin"

case "$OSTYPE" in
    linux*) PLATFORM="linux" ;;
    darwin*) PLATFORM="macos" ;;
    msys*|cygwin*|win*) PLATFORM="win" ;;
    *) echo "Unsupported platform: $OSTYPE"; exit 1 ;;
esac

if [[ "$PLATFORM" == "win" ]]; then
    BINARY_NAME="${NAME}-win-x64.exe"
else
    BINARY_NAME="${NAME}-${PLATFORM}-x64"
fi

SERVER_BINARY="$PROJECT_ROOT/language-server/dist/bin/$BINARY_NAME"

if [[ "$1" == "--uninstall" ]]; then
    rm -f /usr/local/bin/${NAME} ~/.local/bin/${NAME} /usr/local/bin/${NAME}.exe ~/.local/bin/${NAME}.exe 2>/dev/null || true
    echo "Uninstalled ${NAME}"
    exit 0
fi

[[ ! -f "$SERVER_BINARY" ]] && { echo "Error: Binary not built. Run 'npm run build:language-server:binary'"; exit 1; }


cp "$SERVER_BINARY" "$INSTALL_DIR/$BINARY_NAME"
chmod +x "$INSTALL_DIR/$BINARY_NAME"
echo "Installed $BINARY_NAME to $INSTALL_DIR"