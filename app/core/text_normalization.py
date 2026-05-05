from __future__ import annotations

from difflib import SequenceMatcher
import re
from typing import Any

_PRIVATE_USE_RE = re.compile(r"[\uE000-\uF8FF]")
_MOJIBAKE_MARKERS = (
    "锛",
    "銆",
    "鈥",
    "€",
    "�",
    "鍥",
    "鐢",
    "缁",
    "鍙",
    "璇",
    "鎴",
    "浣",
    "娆",
    "瑙",
    "嗛",
    "鑽",
    "缂",
    "闈",
    "鏍",
    "鐗",
    "閫",
    "鍑",
    "鍓",
    "鏂",
    "寮",
    "甯",
    "鏉",
    "绗",
)
_ROUNDTRIP_REPAIR_SIMILARITY_THRESHOLD = 0.85


def mojibake_score(text: str) -> int:
    if not text:
        return 0

    score = sum(text.count(marker) for marker in _MOJIBAKE_MARKERS)
    score += len(_PRIVATE_USE_RE.findall(text)) * 2
    return score


def _attempt_utf8_gb18030_repair(text: str) -> str:
    return text.encode("gb18030", errors="ignore").decode(
        "utf-8",
        errors="ignore",
    )


def _garble_utf8_as_gb18030(text: str) -> str:
    return text.encode("utf-8", errors="ignore").decode(
        "gb18030",
        errors="ignore",
    )


def _roundtrip_repair_similarity(original: str, repaired: str) -> float:
    if not original or not repaired:
        return 0.0

    regarbled = _garble_utf8_as_gb18030(repaired)
    if not regarbled:
        return 0.0

    return SequenceMatcher(None, original, regarbled).ratio()


def _should_accept_repair(original: str, repaired: str) -> bool:
    if not repaired or repaired == original:
        return False

    if _roundtrip_repair_similarity(original, repaired) >= _ROUNDTRIP_REPAIR_SIMILARITY_THRESHOLD:
        return True

    return mojibake_score(repaired) < mojibake_score(original)


def looks_like_mojibake(text: str) -> bool:
    if not text:
        return False

    if _PRIVATE_USE_RE.search(text):
        return True

    if mojibake_score(text) >= 2:
        return True

    try:
        repaired = _attempt_utf8_gb18030_repair(text)
    except Exception:
        return False

    return _should_accept_repair(text, repaired)


def repair_possible_mojibake(value: Any) -> Any:
    if not isinstance(value, str):
        return value

    try:
        repaired = _attempt_utf8_gb18030_repair(value)
    except Exception:
        return value

    if not _should_accept_repair(value, repaired):
        return value

    return repaired
