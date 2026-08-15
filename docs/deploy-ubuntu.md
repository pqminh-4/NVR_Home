# Deploy NVR_Home lên Ubuntu Homelab

Hướng dẫn từng bước cài app lên máy Ubuntu tại nhà. Thời gian ~10–15 phút.

## 0. Bạn cần gì

- Máy Ubuntu (20.04 trở lên) — PC mini, máy cũ hay VM đều được
- 1 ổ dữ liệu lớn đủ cho ghi hình (khuyến nghị ≥ 500GB cho 2–4 camera ghi 24/7)
- Camera IP có URL RTSP trong mạng LAN

> **CPU:** Intel N100 / Core i3 cũ trở lên là đủ cho 4–6 camera
> (AI quét 1–2 fps + ghi hình codec-copy rất nhẹ CPU).

---

## 1. Cài Docker (nếu chưa có)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker   # hoặc đăng xuất rồi vào lại
docker --version && docker compose version   # kiểm tra
```

## 2. Chuyển dự án từ máy Windows sang Ubuntu

Chọn **một** cách:

**Cách A — scp (có SSH tới homelab):** mở Git Bash trên Windows:
```bash
cd /d/
scp -r NVR_Home user@IP-HOMELAB:~/NVR_Home
```

**Cách B — USB:** nén `NVR_Home` (bỏ `node_modules`, `.venv`, `storage`) rồi copy:
```bash
# trên Windows (Git Bash)
cd /d && tar --exclude node_modules --exclude .venv --exclude storage -czf NVR_Home.tar.gz NVR_Home
# giải nén trên Ubuntu
tar xzf NVR_Home.tar.gz
```

**Cách C — qua git:** push dự án lên Git riêng của bạn rồi `git clone` trên Ubuntu.

## 3. Cấu hình và khởi động

**Cách nhanh nhất — 1 dòng (tự cài Docker + tải mã nguồn + build + chạy):**

```bash
curl -fsSL https://raw.githubusercontent.com/pqminh-4/NVR_Home/main/scripts/remote-install.sh | bash
# hoặc trỏ ổ lớn:
curl -fsSL https://raw.githubusercontent.com/pqminh-4/NVR_Home/main/scripts/remote-install.sh | bash -s -- /mnt/data/nvr
```

Mật khẩu admin được sinh ngẫu nhiên và in ra cuối lệnh (đổi sau trong app).

**Cách thủ công (đã copy mã nguồn sang máy):**

```bash
cd ~/NVR_Home
cp .env.example .env
nano .env          # đổi NVR_ADMIN_PASSWORD!
docker compose up -d --build
```

Chờ ~2–3 phút build lần đầu. Kiểm tra:

```bash
docker compose ps          # 2 container "Up"
docker logs -f nvr-home    # thấy "NVR_Home 0.1.0 đã khởi động" là OK (Ctrl+C để thoát)
```

Mở trình duyệt trên bất kỳ máy nào trong nhà: **http://IP-HOMELAB:8080**
→ đăng nhập `admin` + mật khẩu trong `.env`.

> **Tự khởi động cùng máy:** đã có sẵn `restart: unless-stopped` trong
> docker-compose.yml — chỉ cần Docker service bật khi mở máy (mặc định là vậy).

## 4. Trỏ ghi hình vào ổ lớn

Cách 1 — chỉ định đường dẫn ổ trong `docker-compose.yml`:
```yaml
    volumes:
      - /mnt/data/nvr-storage:/data    # thay ./storage
```

Cách 2 — giữ nguyên `./storage` nhưng symlink:
```bash
mkdir -p /mnt/data/nvr-storage
mv storage /mnt/data/nvr-storage/data_old 2>/dev/null
ln -s /mnt/data/nvr-storage storage
```

> Ổ gắn vĩnh viễn qua `/etc/fstab` (UUID xem bằng `lsblk -f`):
> ```
> UUID=xxxx-xxxx  /mnt/data  ext4  defaults  0  2
> ```

## 5. Truy cập từ ngoài nhà — Tailscale (khuyến nghị, không mở port router)

```bash
# trên Ubuntu
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# đăng nhập tài khoản Tailscale (miễn phí)
```

Cài app Tailscale trên điện thoại → mở `http://<tên-homelab>:8080` từ bất kỳ đâu.
Vào **Cài đặt → Hệ thống** đặt `go2rtc_public_url` thành
`http://<tên-homelab>.<tailnet>.ts.net:1984` nếu muốn live view mượt khi ở ngoài
(cần bật HTTPS trong Tailscale admin và thêm script sau vào máy chủ:
`sudo tailscale serve --bg --https=443 http://localhost:8080`).

## 6. Bật nhận diện người quen (tùy chọn)

```bash
docker exec nvr-home pip install -r backend/requirements-faces.txt
docker compose restart nvr
```

## 7. Vận hành hằng ngày

| Việc | Lệnh |
|---|---|
| Xem logs | `docker logs -f nvr-home` |
| Khởi động lại | `docker compose restart` |
| Nâng cấp (sau khi `git pull` / copy code mới) | `docker compose up -d --build` |
| Xem dung lượng ổ | `du -sh storage/recordings` |
| Backup cấu hình (camera + cài đặt) | `cp storage/db/nvr.db /mnt/backup/` |

- Ghi hình + snapshots nằm trong `storage/` — nâng cấp app **không mất dữ liệu**.
- Chính sách xoá file cũ đặt trong app: **Cài đặt → Lưu trữ & AI**.

## 8. Camera ở VLAN / dải mạng khác

App **không lọc IP** theo dải mạng — camera ở VLAN khác hoạt động bình thường miễn là:

- Router/switch tầng 3 **định tuyến giữa các VLAN** và **cho phép TCP 554** (RTSP) + port HTTP của camera,
- Kiểm tra nhanh từ máy chủ: `ping <IP-camera>` và `curl -v telnet://<IP-camera>:554` (Ctrl+C thoát khi thấy "Connected").

Nếu ping thông mà nút **Kiểm tra** trong app vẫn báo `timeout` → firewall chặn phía VLAN camera;
báo `401 Unauthorized` → sai mật khẩu RTSP; **kết nối được nhưng không có track video** → sai đường dẫn stream (xem bảng dưới).

## 9. Sự cố thường gặp trên Ubuntu

| Triệu chứng | Xử lý |
|---|---|
| Không mở được :8080 từ máy khác | `sudo ufw allow 8080/tcp && sudo ufw allow 1984/tcp && sudo ufw allow 8555/tcp` (nếu bật UFW) |
| Live view không chạy khi ở ngoài Tailscale | kiểm tra `go2rtc_public_url` (mục 5) |
| ffmpeg ghi liên tục chết/khởi động lại | xem lỗi trong Cài đặt → camera (thường sai URL/pass RTSP) |
| Camera Hikvision báo 401 | tạo user riêng cho RTSP trong camera, phân quyền "remote: monitor" |
| Kết nối được nhưng stream không có track video | sai đường dẫn RTSP cho model camera: Hikvision `/Streaming/Channels/101`, Dahua `/cam/realmonitor?channel=1&subtype=0`, Ezviz `/ch1/main` hoặc `/h264_stream1` |
| Camera Ezviz không kết nối được | bật RTSP trong app Ezviz (LAN Live View → Local Service Settings), mật khẩu RTSP = **mã verification code in hoa trên nhãn camera**, user `admin` |
| Camera khác VLAN không kết nối được | xem mục 8 ở trên — gần như luôn là đường dẫn/mật khẩu RTSP, không phải định tuyến |
| Live view lỗi mà ghi hình vẫn chạy | nhiều camera (vd Ezviz) **giới hạn 2 phiên RTSP đồng thời** — app thiết kế recorder dùng 1 phiên, mọi dịch vụ khác (detector, live, snapshot) dùng chung phiên go2rtc; đừng mở thêm trình xem RTSP ngoài app vào cùng camera |
| Quên mật khẩu admin | `rm storage/db/nvr.db && docker compose restart` (mất cấu hình camera, đặt lại từ .env) |
