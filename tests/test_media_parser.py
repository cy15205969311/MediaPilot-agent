import asyncio
from pathlib import Path

import app.services.graph.provider as graph_provider_module
import app.services.media_parser as media_parser_module
from app.models.schemas import MediaChatRequest
from app.services.graph import LangGraphProvider
from app.services.media_parser import MediaParserError, TranscriptionRuntimeConfig
from app.services.providers import BaseLLMProvider


class RecordingProvider(BaseLLMProvider):
    def __init__(self) -> None:
        self.last_request_message = ""

    async def generate_stream(self, request, **kwargs):
        self.last_request_message = request.message
        yield {
            "event": "start",
            "thread_id": request.thread_id,
            "platform": request.platform.value,
            "task_type": request.task_type.value,
            "materials_count": len(request.materials),
        }
        yield {
            "event": "message",
            "delta": "A draft was generated from parsed materials.",
            "index": 0,
        }
        yield {
            "event": "artifact",
            "artifact": {
                "artifact_type": "content_draft",
                "title": "Parsed material draft",
                "title_candidates": ["Title A", "Title B", "Title C"],
                "body": "1. Material context was injected.\n2. Draft generation completed.",
                "platform_cta": "Feel free to iterate further.",
            },
        }
        yield {"event": "done", "thread_id": request.thread_id}


async def collect_events(provider: LangGraphProvider, request: MediaChatRequest):
    events: list[dict[str, object]] = []
    async for event in provider.generate_stream(request):
        events.append(event)
    return events


def test_parse_document_supports_local_upload_text_file(
    tmp_path: Path,
    monkeypatch,
):
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    document_path = uploads_dir / "alice" / "brief.txt"
    document_path.parent.mkdir(parents=True, exist_ok=True)
    document_path.write_text("first line\nsecond line", encoding="utf-8")
    monkeypatch.setattr(media_parser_module, "LOCAL_UPLOADS_DIR", uploads_dir)

    result = asyncio.run(media_parser_module.parse_document("/uploads/alice/brief.txt"))

    assert "first line" in result
    assert "second line" in result


def test_parse_document_supports_local_upload_docx_file(
    tmp_path: Path,
    monkeypatch,
):
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    document_path = uploads_dir / "alice" / "brief.docx"
    document_path.parent.mkdir(parents=True, exist_ok=True)
    document_path.write_bytes(b"fake-docx")
    monkeypatch.setattr(media_parser_module, "LOCAL_UPLOADS_DIR", uploads_dir)

    class FakeParagraph:
        def __init__(self, text: str) -> None:
            self.text = text

    class FakeCell:
        def __init__(self, text: str) -> None:
            self.text = text

    class FakeRow:
        def __init__(self, cells: list[str]) -> None:
            self.cells = [FakeCell(text) for text in cells]

    class FakeTable:
        def __init__(self, rows: list[list[str]]) -> None:
            self.rows = [FakeRow(row) for row in rows]

    class FakeDocument:
        paragraphs = [
            FakeParagraph("执行摘要"),
            FakeParagraph("面向 2026 Q2 的咖啡新品传播计划"),
        ]
        tables = [
            FakeTable(
                [
                    ["渠道", "主话题"],
                    ["小红书", "咖啡液测评"],
                    ["抖音", "门店开箱"],
                ]
            )
        ]

    monkeypatch.setattr(media_parser_module, "Document", lambda _: FakeDocument())

    result = asyncio.run(media_parser_module.parse_document("/uploads/alice/brief.docx"))

    assert "执行摘要" in result
    assert "面向 2026 Q2 的咖啡新品传播计划" in result
    assert "渠道 | 主话题" in result
    assert "小红书 | 咖啡液测评" in result


def test_request_audio_transcription_uses_dashscope_chat_path_when_only_llm_gateway_is_configured(
    tmp_path: Path,
    monkeypatch,
):
    audio_path = tmp_path / "sample.mp3"
    audio_path.write_bytes(b"fake-audio")

    runtime_config = TranscriptionRuntimeConfig(
        api_key="llm-key",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        model="qwen3-asr-flash",
        mode="dashscope_chat_completions",
    )

    async def fake_dashscope_transcription(*args, **kwargs):
        assert args[0] == audio_path
        assert kwargs["runtime_config"] == runtime_config
        return "dashscope transcript"

    async def fail_openai_transcription(*args, **kwargs):
        raise AssertionError("OpenAI audio.transcriptions path should not be used here.")

    monkeypatch.setattr(
        media_parser_module,
        "_request_dashscope_compatible_transcription",
        fake_dashscope_transcription,
    )
    monkeypatch.setattr(
        media_parser_module,
        "_request_openai_audio_transcription",
        fail_openai_transcription,
    )

    result = asyncio.run(
        media_parser_module._request_audio_transcription(
            audio_path,
            runtime_config=runtime_config,
        )
    )

    assert result == "dashscope transcript"


def test_langgraph_provider_injects_document_and_video_context(monkeypatch):
    inner_provider = RecordingProvider()

    async def fake_parse_document(url: str) -> str:
        assert url.endswith(".pdf")
        return "brand handbook text"

    async def fake_transcribe_video(url: str) -> str:
        assert url.endswith(".mp4")
        return "video voice-over transcript"

    monkeypatch.setattr(graph_provider_module, "parse_document", fake_parse_document)
    monkeypatch.setattr(graph_provider_module, "transcribe_video", fake_transcribe_video)

    provider = LangGraphProvider(inner_provider=inner_provider)
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-materials-rich-context",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "Please turn the attached assets into one social draft.",
            "materials": [
                {
                    "type": "text_link",
                    "url": "/uploads/alice/brief.pdf",
                    "text": "brief.pdf",
                },
                {
                    "type": "video_url",
                    "url": "/uploads/alice/demo.mp4",
                    "text": "demo.mp4",
                },
            ],
        }
    )

    events = asyncio.run(collect_events(provider, request))

    assert '<document_context source="brief.pdf">' in inner_provider.last_request_message
    assert "brand handbook text" in inner_provider.last_request_message
    assert '<video_transcript source="demo.mp4">' in inner_provider.last_request_message
    assert "video voice-over transcript" in inner_provider.last_request_message
    assert any(
        event["event"] == "tool_call"
        and event.get("name") == "parse_document"
        and "brief.pdf" in str(event.get("message", ""))
        for event in events
    )
    assert any(
        event["event"] == "tool_call"
        and event.get("name") == "video_transcription"
        and event.get("status") == "completed"
        for event in events
    )
    assert not any(event["event"] == "error" for event in events)


def test_langgraph_provider_degrades_gracefully_when_document_parse_fails(monkeypatch):
    inner_provider = RecordingProvider()

    async def failing_parse_document(_: str) -> str:
        raise MediaParserError("Encrypted PDF files are not supported right now.")

    monkeypatch.setattr(graph_provider_module, "parse_document", failing_parse_document)

    provider = LangGraphProvider(inner_provider=inner_provider)
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-materials-parse-fallback",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "Please create a proposal from the attachment.",
            "materials": [
                {
                    "type": "text_link",
                    "url": "/uploads/alice/secret.pdf",
                    "text": "secret.pdf",
                }
            ],
        }
    )

    events = asyncio.run(collect_events(provider, request))

    assert "secret.pdf" in inner_provider.last_request_message
    assert "Encrypted PDF files are not supported right now." in inner_provider.last_request_message
    assert any(
        event["event"] == "tool_call"
        and event.get("name") == "parse_document"
        and event.get("status") == "failed"
        for event in events
    )
    assert any(event["event"] == "artifact" for event in events)
    assert not any(event["event"] == "error" for event in events)
