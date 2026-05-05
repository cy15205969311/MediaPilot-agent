from app.core.text_normalization import looks_like_mojibake, repair_possible_mojibake
from app.models.schemas import ImageGenerationArtifactPayload


def _garble_utf8_as_gb18030(text: str) -> str:
    return text.encode("utf-8").decode("gb18030", errors="ignore")


def test_repair_possible_mojibake_decodes_garbled_image_title() -> None:
    garbled = _garble_utf8_as_gb18030("图片生成结果")

    assert looks_like_mojibake(garbled) is True
    assert repair_possible_mojibake(garbled) == "图片生成结果"


def test_repair_possible_mojibake_decodes_garbled_platform_cta() -> None:
    source = "如果你愿意，我可以继续为这组图片补写发布文案，或调整整体视觉风格。"
    garbled = _garble_utf8_as_gb18030(source)

    assert looks_like_mojibake(garbled) is True
    assert repair_possible_mojibake(garbled).startswith(
        "如果你愿意，我可以继续为这组图片补写发布文案",
    )


def test_repair_possible_mojibake_leaves_normal_chinese_unchanged() -> None:
    assert repair_possible_mojibake("图片生成结果") == "图片生成结果"


def test_image_generation_artifact_payload_normalizes_garbled_fields() -> None:
    title = "图片生成结果"
    prompt = "生成一张明亮、干净、适合社交媒体发布的品牌主视觉海报，保留高级留白和清晰的主体聚焦。"
    original_prompt = "帮我出一张适合小红书发布的品牌海报。"
    revised_prompt = "生成一张明亮、干净、适合社交媒体发布的品牌主视觉海报，保留高级留白和清晰的主体聚焦。"
    platform_cta = "如果你愿意，我可以继续为这组图片补写发布文案，或调整整体视觉风格。"

    artifact = ImageGenerationArtifactPayload.model_validate(
        {
            "artifact_type": "image_result",
            "title": _garble_utf8_as_gb18030(title),
            "prompt": _garble_utf8_as_gb18030(prompt),
            "generated_images": ["https://example.com/image.png"],
            "original_prompt": _garble_utf8_as_gb18030(original_prompt),
            "revised_prompt": _garble_utf8_as_gb18030(revised_prompt),
            "platform_cta": _garble_utf8_as_gb18030(platform_cta),
        }
    )

    assert artifact.title == title
    assert (artifact.original_prompt or "").startswith("帮我出一张")
    assert "小红书发布" in (artifact.original_prompt or "")
    assert "社交媒体发布" in (artifact.revised_prompt or "")
    assert "品牌主视觉海报" in (artifact.revised_prompt or "")
    assert "社交媒体发布" in artifact.prompt
    assert "品牌主视觉海报" in artifact.prompt
    assert (artifact.platform_cta or "").startswith(
        "如果你愿意，我可以继续为这组图片补写发布文案",
    )
