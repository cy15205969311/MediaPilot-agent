import inspect
from pathlib import Path

import pytest

import app.services.knowledge_base as knowledge_base_module
from app.services.knowledge_base import (
    EMBEDDING_DIMENSIONS,
    KnowledgeBaseService,
    _HashingEmbeddingFunction,
)


def test_hashing_embedding_function_accepts_chroma_input_keyword():
    embedding_function = _HashingEmbeddingFunction()

    call_signature = inspect.signature(embedding_function.__call__)
    assert list(call_signature.parameters.keys()) == ["input"]

    vector = embedding_function.embed_query(input="hello chroma")

    assert isinstance(vector, list)
    assert len(vector) == EMBEDDING_DIMENSIONS


def test_knowledge_base_retrieve_context_supports_live_chroma_query(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    storage_dir = tmp_path / "knowledge-base"
    monkeypatch.setenv("OMNIMEDIA_KNOWLEDGE_BASE_DIR", str(storage_dir))
    knowledge_base_module._knowledge_base_service = None

    service = KnowledgeBaseService(storage_dir=storage_dir, prefer_chroma=True)
    if not getattr(service, "_using_chroma", False):
        pytest.skip("Chroma is not available in this environment.")

    inserted = service.add_text_document(
        "alice",
        "audio_playbook",
        "The winning script opens with a strong hook and then proves it with a real example.",
        source="playbook.md",
    )
    assert inserted >= 1

    context = service.retrieve_context(
        "alice",
        "audio_playbook",
        "strong hook example",
    )
    direct_documents = service._query_documents_from_chroma(  # noqa: SLF001
        "alice",
        "audio_playbook",
        query="strong hook example",
        top_k=3,
    )

    assert "strong hook" in context.lower()
    assert len(direct_documents) >= 1
