"""Phát hiện chuyển động bằng so khung hình — fallback khi không chạy được YOLO."""
from __future__ import annotations

import cv2
import numpy as np

_W = 320  # width xử lý


class MotionDetector:
    def __init__(self, min_area_ratio: float = 0.015):
        self.min_area = min_area_ratio * _W * (_W * 9 / 16)
        self.prev: np.ndarray | None = None

    def detect(self, frame_bgr: np.ndarray) -> list[tuple[str, float, float, float, float, float]]:
        """Trả về [('motion', score, x1, y1, x2, y2)] toạ độ pixel gốc."""
        h, w = frame_bgr.shape[:2]
        small = cv2.resize(frame_bgr, (_W, int(h * _W / w)))
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (21, 21), 0)
        if self.prev is None:
            self.prev = gray
            return []
        diff = cv2.absdiff(gray, self.prev)
        self.prev = gray
        _, thresh = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
        thresh = cv2.dilate(thresh, None, iterations=2)
        contours, _ = cv2.findContours(
            thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        out = []
        for c in contours:
            if cv2.contourArea(c) < self.min_area:
                continue
            x, y, cw, ch = cv2.boundingRect(c)
            sx, sy = w / _W, h / small.shape[0]
            out.append((
                "motion",
                min(1.0, cv2.contourArea(c) / (_W * small.shape[0])),
                x * sx, y * sy, (x + cw) * sx, (y + ch) * sy,
            ))
        return out[:5]
