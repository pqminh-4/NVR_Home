#!/usr/bin/env bash
# NVR_Home — script cài đặt tự động trên Ubuntu
# Cách chạy:  bash scripts/install-ubuntu.sh [thư-mục-ổ-lớn]
# VD:         bash scripts/install-ubuntu.sh /mnt/data/nvr-storage
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
say()  { echo -e "${GREEN}[NVR]${NC} $1"; }
warn() { echo -e "${YELLOW}[NVR]${NC} $1"; }
err()  { echo -e "${RED}[NVR LỖI]${NC} $1"; exit 1; }

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"
STORAGE_DIR="${1:-$PROJECT_DIR/storage}"

say "Cài NVR_Home từ $PROJECT_DIR (ghi hình vào: $STORAGE_DIR)"

# ---- 1. Docker ----
if ! command -v docker >/dev/null 2>&1; then
  say "Đang cài Docker..."
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
  warn "Đã thêm user '$USER' vào nhóm docker — nếu lệnh docker sau đó báo quyền, chạy 'newgrp docker' rồi chạy lại script."
fi
command -v docker >/dev/null 2>&1 || err "Docker chưa cài xong — mở terminal mới chạy lại script."
docker compose version >/dev/null 2>&1 || err "Thiếu docker compose plugin — cài: sudo apt install docker-compose-plugin"
if ! docker info >/dev/null 2>&1; then
  sg docker -c "true" 2>/dev/null || true
  docker info >/dev/null 2>&1 || err "Không gọi được Docker daemon. Thử: newgrp docker && bash $0"
fi

# ---- 2. Ổ lưu trữ ----
if [[ "$STORAGE_DIR" != "$PROJECT_DIR/storage" ]]; then
  mkdir -p "$STORAGE_DIR"
  if [[ -d "$PROJECT_DIR/storage" && ! -L "$PROJECT_DIR/storage" ]]; then
    warn "Đã có thư mục storage cũ — chuyển nội dung sang $STORAGE_DIR"
    cp -rn "$PROJECT_DIR/storage/." "$STORAGE_DIR/" 2>/dev/null || true
    mv "$PROJECT_DIR/storage" "${PROJECT_DIR}/storage_backup_$(date +%s)"
  fi
  ln -sfn "$STORAGE_DIR" "$PROJECT_DIR/storage"
  say "storage -> $STORAGE_DIR"
fi
mkdir -p storage

# ---- 3. .env ----
if [[ ! -f .env ]]; then
  cp .env.example .env
  PASS="$(head -c 12 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 12)"
  sed -i "s/^NVR_ADMIN_PASSWORD=.*/NVR_ADMIN_PASSWORD=$PASS/" .env
  say "Đã tạo .env với mật khẩu admin: ${PASS}"
  warn "LƯU mật khẩu này lại (hoặc tự đổi trong file .env / trong app)."
else
  say "Đã có .env — giữ nguyên."
fi

# ---- 4. Build & chạy ----
say "Build và khởi động (lần đầu ~2-3 phút)..."
docker compose up -d --build
sleep 8

if curl -fsS http://localhost:8080/api/system/health >/dev/null 2>&1; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  say "=== CÀI XONG ==="
  echo -e "  Mở app:      ${GREEN}http://${IP:-<IP-máy-này>}:8080${NC}"
  echo -e "  go2rtc:      http://${IP:-<IP-máy-này>}:1984"
  echo -e "  Xem logs:    docker logs -f nvr-home"
  warn  "Máy chủ firewall: nếu máy khác không mở được, chạy:"
  echo  "  sudo ufw allow 8080/tcp 1984/tcp 8555/tcp"
else
  warn "Chưa nhận được /health — xem logs: docker logs nvr-home"
fi
