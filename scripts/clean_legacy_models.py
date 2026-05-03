from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import func, or_, select, update

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.db.database import SessionLocal
from app.db.models import TokenTransaction

# If your historical default model was not qwen-turbo, change it here before running.
HISTORICAL_MODEL_NAME = "qwen-turbo"
LEGACY_MODEL_NAME = "legacy"
SUCCESS_MESSAGE_PREFIX = "\u2705 \u5386\u53f2\u6570\u636e\u6e05\u6d17\u5b8c\u6210\uff1a\u5171\u5c06 "
SUCCESS_MESSAGE_SUFFIX = " \u6761\u9057\u7559\u8bb0\u5f55\u51c6\u786e\u5f52\u56e0\u4e3a "
SUCCESS_MESSAGE_END = " \u6a21\u578b\u3002"


def clean_legacy_models() -> int:
    session = SessionLocal()
    try:
        legacy_filter = or_(
            TokenTransaction.model_name == LEGACY_MODEL_NAME,
            TokenTransaction.model_name.is_(None),
        )

        affected_count = int(
            session.scalar(
                select(func.count()).select_from(TokenTransaction).where(legacy_filter)
            )
            or 0
        )

        if affected_count == 0:
            session.rollback()
            print(
                f"{SUCCESS_MESSAGE_PREFIX}0{SUCCESS_MESSAGE_SUFFIX}"
                f"{HISTORICAL_MODEL_NAME}{SUCCESS_MESSAGE_END}"
            )
            return 0

        session.execute(
            update(TokenTransaction)
            .where(legacy_filter)
            .values(model_name=HISTORICAL_MODEL_NAME)
        )
        session.commit()

        print(
            f"{SUCCESS_MESSAGE_PREFIX}{affected_count}{SUCCESS_MESSAGE_SUFFIX}"
            f"{HISTORICAL_MODEL_NAME}{SUCCESS_MESSAGE_END}"
        )
        return affected_count
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


if __name__ == "__main__":
    clean_legacy_models()
