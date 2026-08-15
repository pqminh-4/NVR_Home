"""Nhận diện người quen — InsightFace buffalo_l (cài riêng, optional).

    pip install -r requirements-faces.txt

Nếu chưa cài, service tự báo không khả dụng và app vẫn chạy bình thường.
"""
from __future__ import annotations

import logging
from pathlib import Path

import cv2
import numpy as np
from sqlmodel import Session

from ..config import settings
from ..db import engine
from ..models import FacePhoto, KnownFace

logger = logging.getLogger("nvr.faces")


class FaceService:
    def __init__(self) -> None:
        self._app = None
        self._failed = False
        self._index: list[tuple[np.ndarray, str, int]] = []

    # ---------- khả dụng ----------

    def available(self) -> bool:
        try:
            import insightface  # noqa: F401

            return True
        except ImportError:
            return False

    def _ensure(self):
        if self._app is not None:
            return self._app
        if self._failed:
            raise RuntimeError("InsightFace không khả dụng")
        try:
            from insightface.app import FaceAnalysis

            app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
            app.prepare(ctx_id=-1, det_size=(640, 640))
            self._app = app
            logger.info("InsightFace sẵn sàng")
            return app
        except Exception:
            self._failed = True
            raise

    # ---------- trích xuất / so khớp ----------

    def extract(self, frame_bgr: np.ndarray) -> np.ndarray | None:
        """Embedding khuôn mặt lớn nhất trong ảnh (hoặc None)."""
        app = self._ensure()
        faces = app.get(frame_bgr)
        if not faces:
            return None
        faces.sort(key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]), reverse=True)
        return faces[0].normed_embedding.astype(np.float32)

    def identify(self, crop_bgr: np.ndarray, threshold: float) -> tuple[str | None, float]:
        """Trả về (tên người quen | None, độ tương đồng)."""
        if not self._index:
            return None, 0.0
        emb = self.extract(crop_bgr)
        if emb is None:
            return None, 0.0
        best_name, best_sim = None, 0.0
        for ref, name, _fid in self._index:
            sim = float(np.dot(ref, emb))
            if sim > best_sim:
                best_sim, best_name = sim, name
        if best_sim >= threshold:
            return best_name, best_sim
        return None, best_sim

    # ---------- enroll ----------

    def enroll(self, name: str, note: str, images: list[np.ndarray]) -> int:
        """Thêm người quen từ danh sách ảnh; trả về KnownFace.id."""
        embeddings: list[np.ndarray] = []
        for img in images:
            emb = self.extract(img)
            if emb is not None:
                embeddings.append(emb)
        if not embeddings:
            raise ValueError(
                "Không tìm thấy khuôn mặt trong ảnh nào. Dùng ảnh chụp rõ mặt, ánh sáng tốt."
            )
        with Session(engine) as session:
            face = KnownFace(name=name, note=note)
            session.add(face)
            session.commit()
            session.refresh(face)
            for i, (img, emb) in enumerate(zip(images, embeddings)):
                # ảnh thumb đã enrollment dùng ảnh gốc (resize nhẹ)
                thumb_dir = settings.storage_dir / "faces" / str(face.id)
                thumb_dir.mkdir(parents=True, exist_ok=True)
                rel = f"faces/{face.id}/{i}.jpg"
                thumb = cv2.resize(img, (256, 256)) if img.shape[:2] != (256, 256) else img
                cv2.imwrite(str(settings.storage_dir / rel), thumb, [cv2.IMWRITE_JPEG_QUALITY, 90])
                session.add(FacePhoto(
                    face_id=face.id, path=rel,
                    embedding=emb.astype(np.float32).tobytes(),
                ))
            session.commit()
        self.rebuild_index()
        return face.id

    def delete(self, face_id: int) -> None:
        import shutil

        with Session(engine) as session:
            photos = session.query(FacePhoto).where(FacePhoto.face_id == face_id).all()
            for p in photos:
                session.delete(p)
            face = session.get(KnownFace, face_id)
            if face:
                session.delete(face)
            session.commit()
        d = settings.storage_dir / "faces" / str(face_id)
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
        self.rebuild_index()

    # ---------- index ----------

    def rebuild_index(self) -> None:
        index: list[tuple[np.ndarray, str, int]] = []
        with Session(engine) as session:
            photos = session.query(FacePhoto).all()
            names = {f.id: f.name for f in session.query(KnownFace).all()}
        for p in photos:
            if p.embedding and p.face_id in names:
                emb = np.frombuffer(p.embedding, dtype=np.float32)
                index.append((emb, names[p.face_id], p.face_id))
        self._index = index
        logger.info("Face index: %d ảnh / %d người", len(index), len(names))

    def stats(self) -> dict:
        return {"available": self.available(), "photos": len(self._index)}


face_service = FaceService()
