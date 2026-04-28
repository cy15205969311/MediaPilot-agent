"""add template library persistence

Revision ID: 20260428_01
Revises: 20260427_01
Create Date: 2026-04-28 14:30:00
"""

from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260428_01"
down_revision: Union[str, Sequence[str], None] = "20260427_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PRESET_TEMPLATES: tuple[dict[str, str | bool | None], ...] = (
    {
        "id": "template-preset-travel-hotflow",
        "user_id": None,
        "title": "文旅探店爆款流",
        "description": "突出情绪价值与在地体验，适合周末短途游与城市周边探店内容。",
        "platform": "小红书",
        "category": "美食文旅",
        "system_prompt": (
            "你是一名擅长小红书文旅探店内容策划的生活方式编辑。"
            "目标读者是 28-35 岁、重视松弛感和周末补偿式出游体验的都市女性。"
            "请围绕真实路线、氛围细节、出片机位、预算感知、踩坑提醒和自然互动 CTA 组织内容，"
            "让读者觉得这是一篇被认真走过、愿意立刻收藏的在地攻略。"
        ),
        "is_preset": True,
    },
    {
        "id": "template-preset-finance-recovery",
        "user_id": None,
        "title": "精致穷回血理财方案",
        "description": "聚焦 28-35 岁女性的预算管理与温和理财表达，语气温柔且专业。",
        "platform": "小红书",
        "category": "职场金融",
        "system_prompt": (
            "你是一名擅长女性理财内容的品牌顾问，面对的是 28-35 岁、处于精致穷阶段、"
            "一边追求生活品质一边承受同龄人焦虑的职场女性。"
            "请用温柔、可信、不过度制造焦虑的表达方式，给出可执行的回血思路、预算建议、风险提醒与情绪安抚，"
            "帮助读者建立“我也可以慢慢好起来”的信心。"
        ),
        "is_preset": True,
    },
    {
        "id": "template-preset-beauty-overnight-repair",
        "user_id": None,
        "title": "熬夜党护肤急救方案",
        "description": "面向高压熬夜人群的护肤文案模板，强调情绪价值与即时改善感。",
        "platform": "小红书",
        "category": "美妆护肤",
        "system_prompt": (
            "你是一名懂成分也懂情绪价值的小红书护肤主编。"
            "受众是经常熬夜、状态不稳定、又想快速恢复体面感的年轻女性。"
            "请输出既有专业可信度、又带安慰感的护肤内容，突出熬夜后暗沉、浮肿、卡粉等真实痛点，"
            "并给出清晰步骤、使用场景、避雷提示和适度鼓励。"
        ),
        "is_preset": True,
    },
    {
        "id": "template-preset-tech-iot-markdown",
        "user_id": None,
        "title": "硬核技术教程（IoT / STM32）",
        "description": "结构严谨的技术教程模板，适合 STM32、嵌入式与物联网工程实践分享。",
        "platform": "技术博客",
        "category": "数码科技",
        "system_prompt": (
            "你是一名擅长输出硬核技术教程的工程作者。"
            "请使用严格、清晰的 Markdown 结构，围绕问题背景、硬件环境、依赖版本、核心原理、代码实现、调试步骤、"
            "常见坑点和扩展方向组织内容。"
            "当主题涉及 STM32、IoT、串口、传感器、跨平台联调时，请优先强调可复现性、接口边界和工程取舍。"
        ),
        "is_preset": True,
    },
    {
        "id": "template-preset-xianyu-secondhand-sku",
        "user_id": None,
        "title": "高转化二手闲置 SKU",
        "description": "主打断舍离回血与同龄人焦虑语境下的真诚转化文案，适合闲鱼二手发布。",
        "platform": "闲鱼",
        "category": "电商/闲鱼",
        "system_prompt": (
            "你是一名擅长闲鱼高转化文案的二手运营助手。"
            "目标用户是预算敏感、又对同龄人焦虑和消费后悔高度共鸣的人群。"
            "请站在断舍离回血、减少闲置成本、真实说明成色与使用场景的角度写文案，"
            "重点突出商品亮点、成交信任、价格合理性和不夸大的真实表达。"
        ),
        "is_preset": True,
    },
    {
        "id": "template-preset-education-score-boost",
        "user_id": None,
        "title": "初高中教辅引流标题",
        "description": "强调提分、逆袭与方法感，适合教辅资料、电商详情和家长沟通场景。",
        "platform": "抖音",
        "category": "教育/干货",
        "system_prompt": (
            "你是一名擅长教育内容增长的选题编辑。"
            "请围绕初高中提分、逆袭、时间紧、基础薄弱、家长焦虑等真实场景，"
            "生成高点击但不过度夸张的标题与引流文案。"
            "输出要兼顾学生与家长视角，突出适用人群、见效预期、学习门槛和行动指令。"
        ),
        "is_preset": True,
    },
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "templates" not in existing_tables:
        op.create_table(
            "templates",
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.String(length=32), nullable=True),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("platform", sa.String(length=64), nullable=False),
            sa.Column("category", sa.String(length=64), nullable=False),
            sa.Column("system_prompt", sa.Text(), nullable=False),
            sa.Column("is_preset", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    template_indexes = {index["name"] for index in inspector.get_indexes("templates")}
    if "ix_templates_user_id" not in template_indexes:
        op.create_index("ix_templates_user_id", "templates", ["user_id"], unique=False)

    now = datetime.now(timezone.utc)
    for item in PRESET_TEMPLATES:
        exists = bind.execute(
            sa.text("SELECT 1 FROM templates WHERE id = :id"),
            {"id": item["id"]},
        ).scalar()
        if exists is not None:
            continue

        bind.execute(
            sa.text(
                """
                INSERT INTO templates (
                    id, user_id, title, description, platform, category,
                    system_prompt, is_preset, created_at
                ) VALUES (
                    :id, :user_id, :title, :description, :platform, :category,
                    :system_prompt, :is_preset, :created_at
                )
                """
            ),
            {
                **item,
                "created_at": now,
            },
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "templates" not in existing_tables:
        return

    template_indexes = {index["name"] for index in inspector.get_indexes("templates")}
    if "ix_templates_user_id" in template_indexes:
        op.drop_index("ix_templates_user_id", table_name="templates")
    op.drop_table("templates")
