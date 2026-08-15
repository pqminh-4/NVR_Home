#!/usr/bin/env bash
# NVR_Home — cài đặt 1 dòng từ GitHub (Ubuntu/Debian)
#
# Cách dùng:
#   curl -fsSL https://raw.githubusercontent.com/pqminh-4/NVR_Home/main/scripts/remote-install.sh | bash
#
# Trỏ ghi hình vào ổ lớn (tham số cuối):
#   curl -fsSL .../remote-install.sh | bash -s -- /mnt/data/nvr
#
# Máy chưa có curl? Dùng wget:
#   wget -qO- https://raw.githubusercontent.com/pqminh-4/NVR_Home/main/scripts/remote-install.sh | bash
#
# Không có cả curl/wget? Cài curl trước bằng apt:
#   sudo apt-get update && sudo apt-get install -y curl && curl -fsSL ... | bash
set -euo pipefail

REPO="pqminh-4/NVR_Home"
BRANCH="main"
DEST="${NVR_DIR:-$HOME/NVR_Home}"
STORAGE="${1:-}"

# sudo nếu không phải root (Ubuntu luôn có sẵn sudo)
if [ "$(id -u)" = "0" ]; then SUDO=""; else SUDO="sudo"; fi

echo "==> NVR_Home installer (repo: $REPO)"

# ---- phần bổ trợ: git + curl + ca-certificates (apt có sẵn trên mọi Ubuntu) ----
PKGS=""
command -v git  >/dev/null 2>&1 || PKGS="$PKGS git"
command -v curl >/dev/null 2>&1 || PKGS="$PKGS curl"
if [ -n "$PKGS" ]; then
  echo "==> Cài phần bổ trợ:$PKGS ..."
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq $PKGS ca-certificates
fi

# ---- clone lần đầu hoặc cập nhật nếu đã có ----
if [ -d "$DEST/.git" ]; then
  echo "==> Đã có $DEST — kéo bản mới..."
  git -C "$DEST" pull --ff-only || echo "(không pull được, dùng bản hiện có)"
else
  echo "==> Tải mã nguồn về $DEST ..."
  git clone --depth 1 -b "$BRANCH" "https://github.com/$REPO.git" "$DEST"
fi

# ---- chạy bộ cài chính (Docker, .env, ổ lưu trữ, build & khởi động) ----
cd "$DEST"
if [ -n "$STORAGE" ]; then
  exec bash scripts/install-ubuntu.sh "$STORAGE"
else
  exec bash scripts/install-ubuntu.sh
fi
