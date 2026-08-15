"""YOLO ONNX: phát hiện người/xe/mèo/chó (COCO subset).

Hỗ trợ 2 định dạng model:
- YOLOv10 (NMS-free): output (1, 300, 6) = [x1,y1,x2,y2,score,class]
- YOLOv8 export onnx: output (1, 84, 8400) = [cx,cy,w,h + 80 scores]
"""
from __future__ import annotations

import logging
import urllib.request
from pathlib import Path

import numpy as np

from ..config import settings

logger = logging.getLogger("nvr.yolo")

COCO_SUBSET = {
    0: "person", 1: "bicycle", 2: "car", 3: "motorcycle",
    5: "bus", 7: "truck", 15: "cat", 16: "dog",
}

INPUT_SIZE = 640

# Thứ tự ưu tiên: nguồn nào tải được dùng nguồn đó
MODEL_SOURCES = [
    ("yolov10n.onnx", "https://github.com/THU-MIG/yolov10/releases/download/v1.1/yolov10n.onnx"),
    ("yolov8n.onnx", "https://huggingface.co/onnx-community/yolov8n-ONNX/resolve/main/onnx/model.onnx"),
]


def _download_model(dest_dir: Path) -> Path | None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    for name, url in MODEL_SOURCES:
        dest = dest_dir / name
        try:
            logger.info("Tải model AI: %s ...", url)
            tmp = dest.with_suffix(".tmp")
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=90) as r, open(tmp, "wb") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
            if tmp.stat().st_size < 1_000_000:
                raise RuntimeError("file quá nhỏ, không phải model")
            tmp.rename(dest)
            return dest
        except Exception as exc:
            logger.warning("Không tải được %s (%s)", url, exc)
            tmp = dest.with_suffix(".tmp")
            tmp.unlink(missing_ok=True)
    return None


class YoloDetector:
    _instance: "YoloDetector | None" = None
    _load_failed = False

    def __init__(self) -> None:
        import onnxruntime as ort  # lazy: nặng

        custom = Path(settings.yolo_model_path) if settings.yolo_model_path else None
        models_dir = settings.storage_dir / "models"
        if custom and custom.exists():
            path = custom
        else:
            existing = [models_dir / n for n, _ in MODEL_SOURCES if (models_dir / n).exists()]
            if existing:
                path = existing[0]
            else:
                got = _download_model(models_dir)
                if got is None:
                    raise RuntimeError(
                        "Không tải được model AI. Đặt file yolov8n.onnx/yolov10n.onnx "
                        f"vào {models_dir} rồi restart."
                    )
                path = got
        self.session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        out_shape = self.session.get_outputs()[0].shape
        # v10: (1,300,6); v8: (1,84,8400)
        self.is_v10 = len(out_shape) == 3 and out_shape[-1] == 6
        logger.info("YOLO sẵn sàng: %s (%s)", path.name, "v10" if self.is_v10 else "v8")

    @classmethod
    def get(cls) -> "YoloDetector | None":
        if cls._load_failed:
            return None
        if cls._instance is None:
            try:
                cls._instance = YoloDetector()
            except Exception as exc:
                logger.warning("YOLO không khả dụng, fallback motion: %s", exc)
                cls._load_failed = True
        return cls._instance

    # ---------- inference ----------

    def predict(
        self, frame_bgr: np.ndarray, wanted: set[str], conf: float
    ) -> list[tuple[str, float, float, float, float, float]]:
        """[(class, score, x1, y1, x2, y2)] toạ độ pixel gốc của frame."""
        h, w = frame_bgr.shape[:2]
        scale = INPUT_SIZE / max(h, w)
        nw, nh = int(w * scale), int(h * scale)
        import cv2

        resized = cv2.resize(frame_bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
        canvas = np.full((INPUT_SIZE, INPUT_SIZE, 3), 114, dtype=np.uint8)
        canvas[:nh, :nw] = resized
        blob = canvas[:, :, ::-1].transpose(2, 0, 1).astype(np.float32) / 255.0
        blob = blob[np.newaxis]

        out = np.squeeze(self.session.run(None, {self.input_name: blob})[0], 0)

        results: list[tuple[str, float, list[float]]] = []
        if out.ndim == 2 and out.shape[1] == 6:
            # YOLOv10: NMS-free, mỗi dòng [x1,y1,x2,y2,score,class]
            for row in out:
                score, cid = float(row[4]), int(row[5])
                if score < conf or cid not in COCO_SUBSET:
                    continue
                name = COCO_SUBSET[cid]
                if name not in wanted:
                    continue
                results.append((name, score, [float(v) for v in row[:4]]))
        else:
            # YOLOv8: (84, 8400) -> (8400, 84)
            preds = out.T if out.shape[0] < out.shape[1] and out.shape[0] in (84, 85) else out
            for row in preds:
                cid = int(np.argmax(row[4:84]))
                score = float(row[4 + cid])
                if score < conf or cid not in COCO_SUBSET:
                    continue
                name = COCO_SUBSET[cid]
                if name not in wanted:
                    continue
                results.append((name, score, [float(v) for v in row[:4]]))
            # NMS cho v8
            results = _nms_v8(results)

        final = []
        for name, score, box in results:
            x1, y1, x2, y2 = box
            if len(box) == 4 and out.shape[-1] == 6:
                # v10 đã là xyxy
                pass
            else:
                cx, cy, bw, bh = box
                x1, y1 = cx - bw / 2, cy - bh / 2
                x2, y2 = cx + bw / 2, cy + bh / 2
            final.append((
                name, score,
                max(0.0, x1 / scale), max(0.0, y1 / scale),
                min(float(w), x2 / scale), min(float(h), y2 / scale),
            ))
        return final


def _nms_v8(results: list, iou_thr: float = 0.45) -> list:
    if not results:
        return []
    order = sorted(range(len(results)), key=lambda i: results[i][1], reverse=True)
    keep: list = []
    while order:
        i = order.pop(0)
        keep.append(results[i])
        order = [
            j for j in order
            if _iou(results[i][2], results[j][2]) < iou_thr
        ]
    return keep


def _iou(a, b) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / union if union > 0 else 0
