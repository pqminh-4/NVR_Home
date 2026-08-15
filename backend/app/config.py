"""Cấu hình toàn cục của NVR_Home."""
from __future__ import annotations

import logging
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]

logger = logging.getLogger("nvr.config")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", case_sensitive=False)

    # Đường dẫn
    storage_dir: Path = REPO_ROOT / "storage"
    config_dir: Path = REPO_ROOT / "config"
    frontend_dist: Path = REPO_ROOT / "frontend" / "dist"

    # go2rtc
    go2rtc_url: str = "http://localhost:1984"
    go2rtc_rtsp: str = "rtsp://localhost:8554"

    # Bảo mật
    jwt_secret: str = Field(
        default="", validation_alias=AliasChoices("NVR_JWT_SECRET", "JWT_SECRET")
    )
    admin_password: str = Field(
        default="changeme",
        validation_alias=AliasChoices("NVR_ADMIN_PASSWORD", "ADMIN_PASSWORD"),
    )

    # AI
    detector_backend: str = "yolo"  # yolo | motion
    yolo_model_path: str = ""       # mặc định: storage/models/yolov8n.onnx
    yolo_model_url: str = (
        "https://huggingface.co/onnx-community/yolov8n-ONNX/resolve/main/onnx/model.onnx"
    )

    # Thông báo
    tz: str = "Asia/Ho_Chi_Minh"

    def model_post_init(self, _ctx) -> None:
        self.storage_dir = Path(self.storage_dir)
        self.config_dir = Path(self.config_dir)
        self.frontend_dist = Path(self.frontend_dist)
        for sub in ("db", "recordings", "snapshots", "faces", "models"):
            (self.storage_dir / sub).mkdir(parents=True, exist_ok=True)

    @property
    def db_path(self) -> Path:
        return self.storage_dir / "db" / "nvr.db"

    @property
    def local_tz(self) -> ZoneInfo:
        try:
            return ZoneInfo(self.tz)
        except ZoneInfoNotFoundError:
            return ZoneInfo("Asia/Ho_Chi_Minh")


def local_now() -> datetime:
    return datetime.now(settings.local_tz)


def slugify(name: str) -> str:
    """Tạo slug an toàn cho tên file/thư mục từ tiếng Việt."""
    s = name.strip().lower()
    s = re.sub(r"[àáạảãâầấậẩẫăằắặẳẵ]", "a", s)
    s = re.sub(r"[èéẹẻẽêềếệểễ]", "e", s)
    s = re.sub(r"[ìíịỉĩ]", "i", s)
    s = re.sub(r"[òóọỏõôồốộổỗơờớợởỡ]", "o", s)
    s = re.sub(r"[ùúụủũưừứựửữ]", "u", s)
    s = re.sub(r"[ỳýỵỷỹ]", "y", s)
    s = re.sub(r"đ", "d", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "cam"


settings = Settings()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
