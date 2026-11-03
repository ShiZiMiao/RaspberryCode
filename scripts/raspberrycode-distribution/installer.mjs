const packageDirName = "raspberrycode";

export function installScriptSource(baseUrl) {
  return `#!/usr/bin/env sh
set -eu

BASE_URL="\${RASPBERRYCODE_DIST_BASE_URL:-${baseUrl}}"
INSTALL_DIR="\${RASPBERRYCODE_DIST_HOME:-$HOME/.raspberrycode/runtime}"
BIN_DIR="\${RASPBERRYCODE_DIST_BIN_DIR:-$HOME/.local/bin}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "raspberrycode install requires $1" >&2
    exit 1
  fi
}

need_cmd node
need_cmd curl
need_cmd tar

LATEST_JSON="$(curl -fsSL "\${BASE_URL%/}/latest.json")"
VERSION="$(printf '%s' "$LATEST_JSON" | node -e "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(data).version))")"
TARBALL="$(printf '%s' "$LATEST_JSON" | node -e "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(data).tarball))")"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ARCHIVE="$TMP_DIR/$TARBALL"
curl -fL "\${BASE_URL%/}/releases/$VERSION/$TARBALL" -o "$ARCHIVE"

mkdir -p "$INSTALL_DIR/releases" "$BIN_DIR"
TARGET="$INSTALL_DIR/releases/$VERSION"
rm -rf "$TARGET.new"
mkdir -p "$TARGET.new"
tar -xzf "$ARCHIVE" -C "$TARGET.new"
rm -rf "$TARGET"
mv "$TARGET.new/${packageDirName}" "$TARGET"
rm -rf "$TARGET.new"
# 修复原因：链接目标用相对链接自身位置的路径，INSTALL_DIR 为相对目录时链接不会断，
# 整体移动安装目录后链接也仍然有效；语义与原先的绝对 TARGET 等价。
ln -sfn "releases/$VERSION" "$INSTALL_DIR/current"

cat > "$BIN_DIR/raspberrycode" <<SH
#!/usr/bin/env sh
exec node "$INSTALL_DIR/current/bin/raspberrycode.mjs" "\\$@"
SH
chmod +x "$BIN_DIR/raspberrycode"

echo "RaspberryCode $VERSION installed."
echo "Run: raspberrycode"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Note: $BIN_DIR is not in PATH." ;;
esac
`;
}
