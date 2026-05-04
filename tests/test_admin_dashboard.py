from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.db.models import TokenTransaction, User
from app.services.admin_dashboard import _build_model_usage_ratio


def test_build_model_usage_ratio_aggregates_dynamic_model_token_totals():
    engine = create_engine("sqlite:///:memory:")
    TestingSessionLocal = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)

    now = datetime.now(timezone.utc)
    start_datetime = now - timedelta(days=30)

    with TestingSessionLocal() as db:
        user = User(username="dashboard-user", hashed_password="hashed")
        db.add(user)
        db.flush()
        db.add_all(
            [
                TokenTransaction(
                    user_id=user.id,
                    amount=-120,
                    transaction_type="consume",
                    model_name="gpt-5.4",
                    created_at=now,
                ),
                TokenTransaction(
                    user_id=user.id,
                    amount=-30,
                    transaction_type="consume",
                    model_name="gpt-5.4",
                    created_at=now,
                ),
                TokenTransaction(
                    user_id=user.id,
                    amount=-80,
                    transaction_type="consume",
                    model_name="deepseek-chat",
                    created_at=now,
                ),
                TokenTransaction(
                    user_id=user.id,
                    amount=999,
                    transaction_type="grant",
                    model_name="mimo-v2.5",
                    created_at=now,
                ),
            ]
        )
        db.commit()

        result = _build_model_usage_ratio(db, start_datetime=start_datetime)

    assert [(item.model_name, item.count) for item in result] == [
        ("gpt-5.4", 150),
        ("deepseek-chat", 80),
    ]
