import json
import logging
import math
import os
import re
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from hashlib import sha1
from pathlib import Path
from threading import Lock
from typing import Any

logger = logging.getLogger(__name__)

try:  # pragma: no cover - optional dependency
    import chromadb
except ImportError:  # pragma: no cover - optional dependency
    chromadb = None

try:  # pragma: no cover - optional dependency
    from langchain_text_splitters import RecursiveCharacterTextSplitter
except ImportError:  # pragma: no cover - lightweight local fallback
    class RecursiveCharacterTextSplitter:  # type: ignore[no-redef]
        def __init__(
            self,
            *,
            chunk_size: int = 500,
            chunk_overlap: int = 50,
            separators: list[str] | None = None,
        ) -> None:
            self.chunk_size = max(1, chunk_size)
            self.chunk_overlap = max(0, min(chunk_overlap, self.chunk_size - 1))
            self.separators = separators or ["\n\n", "\n", "。", "！", "？", ". ", " "]

        def split_text(self, text: str) -> list[str]:
            normalized = text.strip()
            if not normalized:
                return []
            if len(normalized) <= self.chunk_size:
                return [normalized]

            chunks: list[str] = []
            start = 0
            total_length = len(normalized)
            while start < total_length:
                end = min(total_length, start + self.chunk_size)
                window = normalized[start:end]
                if end < total_length:
                    split_at = -1
                    for separator in self.separators:
                        candidate = window.rfind(separator)
                        if candidate > split_at:
                            split_at = candidate + len(separator)
                    if split_at > self.chunk_size // 3:
                        end = start + split_at
                        window = normalized[start:end]
                chunks.append(window.strip())
                if end >= total_length:
                    break
                start = max(start + 1, end - self.chunk_overlap)
            return [chunk for chunk in chunks if chunk]


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_KNOWLEDGE_BASE_DIR = PROJECT_ROOT / ".omnimedia_knowledge_base"
FALLBACK_STORE_FILENAME = "knowledge_store.json"
GLOBAL_COLLECTION_NAME = "knowledge_documents"
SYSTEM_KNOWLEDGE_USER_ID = "__system__"
EMBEDDING_DIMENSIONS = 256
DEFAULT_CHUNK_SIZE = 500
DEFAULT_CHUNK_OVERLAP = 50

MOCK_KNOWLEDGE_DOCUMENTS: dict[str, list[str]] = {
    "travel_local_guides": [
        "For Xiaohongshu local travel notes, the first sentence should surface price and regional contrast, such as a surprising budget in a premium district.",
        "A strong citywalk or short-trip note should clearly state route order, subway or parking access, total budget, and at least one avoid-pit reminder instead of only using vague praise.",
        "When writing Fujian or Fuzhou local content, add on-the-ground cues like walking distance, queue timing, weather fit, and whether the stop is better for friends, couples, or solo healing weekends.",
    ],
    "food_tourism_xhs": [
        "For Xiaohongshu food-and-travel notes, the opening line should mention price plus place contrast to create immediate curiosity.",
        "High-save local travel content performs better when it combines store taste notes with route efficiency, nearby photo spots, and realistic total spending.",
    ],
    "citywalk_scene_bank": [
        "Citywalk notes should prioritize emotional pacing: departure mood, route turning point, and final decompression payoff.",
        "Readers save citywalk content when it includes transport convenience, crowd timing, coffee or rest stops, and a practical half-day or one-day route structure.",
    ],
    "local_food_hotspots": [
        "Food exploration notes need one concrete sensory detail per stop, such as texture, aroma, or queue experience, rather than generic words like delicious or worth it.",
        "For local food recommendations, mention the best order strategy, peak queue window, and whether the spot is worth a dedicated detour.",
    ],
    "finance_recovery_playbook": [
        "Gentle finance content for women aged 28-35 should reduce shame, explain cashflow in plain language, and avoid extreme income promises.",
        "A recovery-style budgeting note should separate emergency spending, fixed monthly costs, and one realistic cash-recovery action the reader can start this week.",
        "High-trust finance notes perform better when they acknowledge anxiety first, then provide a step-by-step plan, then end with a calm risk reminder.",
    ],
    "monthly_budget_reset": [
        "Budget reset content should frame the problem as regaining control rather than blaming the reader for overspending.",
        "Readers respond to monthly reset structures that include a freeze list, a keep list, and one small reward that prevents rebound consumption.",
    ],
    "beauty_skin_repair_notes": [
        "Overnight-repair beauty notes should name one visible symptom in the first line, such as puffiness, dullness, or cakey base after late nights.",
        "Beauty rescue content needs a clear order of use, texture compatibility, and one avoid-layering warning to feel professional and trustworthy.",
        "High-empathy skincare writing pairs ingredient logic with emotional reassurance so readers feel understood rather than judged.",
    ],
    "beauty_dupe_lab": [
        "Beauty dupe notes should compare finish, wear time, skin-type fit, and the exact scenario where the cheaper option is enough.",
    ],
    "iot_embedded_lab": [
        "Embedded and IoT tutorials should explicitly state hardware board, MCU or sensor model, toolchain version, wiring assumptions, and expected output before showing code.",
        "High-quality STM32 notes call out pitfalls like clock config, serial baud mismatch, pin multiplexing, and power-supply noise rather than only posting successful code.",
        "Technical readers trust tutorials more when each section explains why a step exists, what failure looks like, and how to verify success on real hardware.",
    ],
    "embedded_lab_notebook": [
        "A reusable embedded engineering note should end with extension ideas, validation checkpoints, and known limitations for the current implementation.",
    ],
    "smart_home_reviews": [
        "Smart-home review notes should compare setup friction, ecosystem compatibility, automation depth, and hidden subscription or maintenance costs.",
    ],
    "ai_productivity_stack": [
        "AI productivity content converts better when it names the exact before-and-after workflow instead of praising the tool abstractly.",
        "For tool-stack notes, explain trigger conditions, handoff points, prompt structure, and what part still needs human judgment.",
    ],
    "secondhand_trade_playbook": [
        "High-conversion secondhand listings should describe condition honestly, including visible flaws, usage frequency, included accessories, and preferred transaction method.",
        "For Xianyu-style resale-recovery copy, the trust signal matters more than hype: explain why the item is being sold, what type of buyer it fits, and a realistic price anchor.",
        "Avoid exaggerated adjectives in resale copy. Concrete details like purchase channel, invoice availability, and battery or wear condition convert better.",
    ],
    "declutter_recovery_board": [
        "Declutter-to-recovery copy should focus on reclaiming space, lowering sunk-cost stress, and making the next owner feel safe about the purchase.",
    ],
    "secondhand_digital_guide": [
        "Secondhand digital-device copy should surface battery health, purchase channel, invoice status, repair history, and real usage intensity before trying to sell the highlight.",
        "For cameras, tablets, headphones, and gaming devices, clear accessory lists and condition grades convert better than emotional adjectives.",
    ],
    "private_domain_followup": [
        "Private-domain follow-up should lower pressure first, then clarify the next action, instead of jumping straight into repeated closing language.",
        "High-trust follow-up scripts mention the user's original concern, offer one precise answer, and end with a single low-friction CTA.",
    ],
    "education_score_boost": [
        "Education lead-generation titles convert better when they specify subject, score gap, and a believable improvement window instead of shouting miracle results.",
        "Parents trust education content more when it mentions common mistake patterns, suitable grade bands, and exactly what the material helps solve.",
        "High-school study notes should include execution cues like daily time cost, chapter scope, and wrong-question review method to avoid sounding empty.",
    ],
    "gaokao_sprint_plan": [
        "Gaokao sprint content should prioritize urgency with structure: current pain point, narrow rescue plan, and what can realistically improve before the exam.",
    ],
    "study_method_reviews": [
        "Study-method notes perform better when they contrast ineffective habits with one testable replacement method and a specific review cycle.",
    ],
    "medical_pop_science": [
        "Medical popular-science content should explain common misunderstandings in plain language while clearly stating what requires a real doctor visit.",
        "Health content gains trust when it separates symptoms, scenarios, and red-flag warnings instead of giving absolute advice.",
    ],
    "legal_common_qa": [
        "Legal explainers should define the scenario boundary first, then describe evidence, procedure, and practical next steps without pretending to replace a lawyer.",
        "High-trust labor or contract content performs better when it lists what documents to keep and what promises should not be believed verbally.",
    ],
    "housing_home_revival": [
        "Housing and renovation notes should always separate purchase cost, hidden cost, and long-term maintenance cost rather than only showing the aesthetic result.",
        "For rental or renovation topics, readers save content when it includes contract clauses, material tradeoffs, and what is worth spending on first.",
    ],
    "car_lifestyle_commuter": [
        "Automotive decision notes should compare commuting radius, charging or fueling convenience, parking constraints, and yearly ownership cost in one frame.",
        "Test-drive content performs better when it names the road condition, passenger mix, and one deal-breaking pain point rather than saying the car feels good.",
    ],
    "parenting_pet_care": [
        "Parenting and pet-care notes should reduce guilt and explain manageable routines, because anxious readers trust calm structure more than perfection language.",
        "Caregiving content is more reusable when it lists observation signals, frequency, timing, and what requires professional help.",
    ],
    "emotional_wellbeing_notes": [
        "Emotional-wellbeing content should validate the feeling first, then name a boundary or action the reader can try within 24 hours.",
        "Relationship or anxiety notes gain saves when they offer one concrete script, one reflection question, and one stop-doing reminder.",
    ],
}


@dataclass(frozen=True)
class KnowledgeDocument:
    document_id: str
    user_id: str
    scope: str
    source: str
    text: str
    created_at: str
    chunk_index: int = 0
    relevance_score: float = 0.0
    distance: float | None = None


@dataclass(frozen=True)
class KnowledgeScopeSummary:
    scope: str
    chunk_count: int
    source_count: int
    updated_at: str | None


@dataclass(frozen=True)
class KnowledgeScopeSourceSummary:
    filename: str
    chunk_count: int


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_knowledge_base_scope(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = re.sub(r"[^a-z0-9_]+", "_", value.strip().lower())
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    return normalized or None


def normalize_knowledge_source(value: str | None) -> str:
    normalized = (value or "uploaded_text").strip()
    return normalized[:255] or "uploaded_text"


def build_default_scope_from_filename(filename: str | None) -> str:
    raw_name = Path(filename or "knowledge_scope").stem
    normalized = normalize_knowledge_base_scope(raw_name)
    return normalized or "knowledge_scope"


def split_text_into_knowledge_chunks(
    text: str,
    *,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
) -> list[str]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", "。", "！", "？", ". ", " "],
    )
    return [chunk.strip() for chunk in splitter.split_text(text) if chunk.strip()]


def _tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    buffer: list[str] = []

    for raw_char in text.lower():
        if raw_char.isascii() and (raw_char.isalnum() or raw_char == "_"):
            buffer.append(raw_char)
            continue

        if buffer:
            tokens.append("".join(buffer))
            buffer = []

        if raw_char.strip():
            tokens.append(raw_char)

    if buffer:
        tokens.append("".join(buffer))

    return tokens


def _embed_text(text: str) -> list[float]:
    vector = [0.0] * EMBEDDING_DIMENSIONS
    tokens = _tokenize(text)
    if not tokens:
        return vector

    for token in tokens:
        digest = sha1(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % EMBEDDING_DIMENSIONS
        vector[index] += 1.0

    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [value / norm for value in vector]


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    return sum(left[index] * right[index] for index in range(min(len(left), len(right))))


def _clamp_relevance_score(score: float) -> float:
    if math.isnan(score) or math.isinf(score):
        return 0.0
    return round(max(0.0, min(1.0, score)), 4)


def _distance_to_relevance_score(distance: float | None) -> float:
    if distance is None:
        return 0.0
    return _clamp_relevance_score(1.0 - distance)


class _HashingEmbeddingFunction:
    def __init__(self) -> None:
        self._config = {"name": "omnimedia_hashing_embedding", "dimensions": EMBEDDING_DIMENSIONS}

    def __call__(self, input: Any) -> list[list[float]]:
        return self.embed_documents(input=input)

    def embed_documents(
        self,
        texts: list[str] | None = None,
        *,
        input: Any = None,
        **kwargs: Any,
    ) -> list[list[float]]:
        raw_value = input if input is not None else texts
        if raw_value is None:
            raw_value = kwargs.get("texts", kwargs.get("documents", []))
        return [_embed_text(text) for text in self._coerce_texts(raw_value)]

    def embed_query(
        self,
        text: str | None = None,
        *,
        input: str | None = None,
        **kwargs: Any,
    ) -> list[float]:
        raw_text = input if input is not None else text
        if raw_text is None:
            raw_text = kwargs.get("query", kwargs.get("text", ""))
        return _embed_text(str(raw_text))

    @staticmethod
    def _coerce_texts(input: Any) -> list[str]:
        if isinstance(input, str):
            return [input]
        return [str(item) for item in input]

    @staticmethod
    def name() -> str:
        return "omnimedia_hashing_embedding"

    @staticmethod
    def build_from_config(config: dict[str, Any]) -> "_HashingEmbeddingFunction":
        _ = config
        return _HashingEmbeddingFunction()

    def get_config(self) -> dict[str, Any]:
        return dict(self._config)

    def is_legacy(self) -> bool:
        return False

    def default_space(self) -> str:
        return "cosine"

    def supported_spaces(self) -> list[str]:
        return ["cosine", "l2", "ip"]


class KnowledgeBaseService:
    def __init__(
        self,
        *,
        storage_dir: Path | None = None,
        prefer_chroma: bool = True,
    ) -> None:
        env_storage_dir = os.getenv("OMNIMEDIA_KNOWLEDGE_BASE_DIR", "").strip()
        resolved_storage_dir = (
            Path(env_storage_dir).expanduser()
            if env_storage_dir
            else storage_dir or DEFAULT_KNOWLEDGE_BASE_DIR
        )
        self.storage_dir = resolved_storage_dir
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self._fallback_store_path = self.storage_dir / FALLBACK_STORE_FILENAME
        self._lock = Lock()
        self._embedding_function = _HashingEmbeddingFunction()
        self._client = None
        self._using_chroma = False

        if prefer_chroma and chromadb is not None:
            try:  # pragma: no cover - exercised only when chromadb is installed
                self._client = chromadb.PersistentClient(path=str(self.storage_dir / "chroma"))
                self._using_chroma = True
            except Exception as exc:  # pragma: no cover - defensive fallback
                logger.warning("Knowledge base fell back to local JSON store: %s", exc)

        self.seed_mock_knowledge()

    def add_text_document(
        self,
        user_id: str,
        scope: str,
        text: str,
        *,
        source: str,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
    ) -> int:
        chunks = split_text_into_knowledge_chunks(
            text,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
        return self.add_documents(user_id, scope, chunks, source=source)

    def add_documents(
        self,
        user_id: str,
        scope: str,
        texts: list[str],
        *,
        source: str = "uploaded_text",
    ) -> int:
        normalized_user_id = (user_id or "").strip()
        normalized_scope = normalize_knowledge_base_scope(scope)
        normalized_source = normalize_knowledge_source(source)
        if not normalized_user_id or normalized_scope is None:
            return 0

        cleaned_texts = [text.strip() for text in texts if text and text.strip()]
        if not cleaned_texts:
            return 0

        deduped_documents: dict[str, KnowledgeDocument] = {}
        created_at = utcnow_iso()
        for chunk_index, text in enumerate(cleaned_texts):
            document_id = self._build_document_id(
                normalized_user_id,
                normalized_scope,
                normalized_source,
                text,
                chunk_index,
            )
            deduped_documents[document_id] = KnowledgeDocument(
                document_id=document_id,
                user_id=normalized_user_id,
                scope=normalized_scope,
                source=normalized_source,
                text=text,
                created_at=created_at,
                chunk_index=chunk_index,
            )

        if not deduped_documents:
            return 0

        self._upsert_local_store(deduped_documents)

        if self._using_chroma:
            try:  # pragma: no cover - exercised only when chromadb is installed
                collection = self._get_collection()
                collection.upsert(
                    ids=list(deduped_documents.keys()),
                    documents=[item.text for item in deduped_documents.values()],
                    metadatas=[
                        {
                            "user_id": item.user_id,
                            "scope": item.scope,
                            "source": item.source,
                            "created_at": item.created_at,
                            "chunk_index": item.chunk_index,
                        }
                        for item in deduped_documents.values()
                    ],
                )
            except Exception as exc:  # pragma: no cover - defensive fallback
                logger.warning(
                    "Knowledge base Chroma upsert failed user_id=%s scope=%s source=%s: %s",
                    normalized_user_id,
                    normalized_scope,
                    normalized_source,
                    exc,
                )

        return len(deduped_documents)

    def list_scopes(self, user_id: str) -> list[KnowledgeScopeSummary]:
        normalized_user_id = (user_id or "").strip()
        if not normalized_user_id:
            return []

        scope_buckets: dict[str, dict[str, Any]] = {}
        for document in self._iter_documents():
            if document.user_id != normalized_user_id:
                continue
            bucket = scope_buckets.setdefault(
                document.scope,
                {
                    "chunk_count": 0,
                    "sources": set(),
                    "updated_at": document.created_at,
                },
            )
            bucket["chunk_count"] += 1
            bucket["sources"].add(document.source)
            if document.created_at > bucket["updated_at"]:
                bucket["updated_at"] = document.created_at

        summaries = [
            KnowledgeScopeSummary(
                scope=scope,
                chunk_count=int(bucket["chunk_count"]),
                source_count=len(bucket["sources"]),
                updated_at=str(bucket["updated_at"]) if bucket["updated_at"] else None,
            )
            for scope, bucket in scope_buckets.items()
        ]
        return sorted(
            summaries,
            key=lambda item: item.updated_at or "",
            reverse=True,
        )

    def rename_scope(self, user_id: str, old_scope: str, new_scope: str) -> int:
        normalized_user_id = (user_id or "").strip()
        normalized_old_scope = normalize_knowledge_base_scope(old_scope)
        normalized_new_scope = normalize_knowledge_base_scope(new_scope)
        if (
            not normalized_user_id
            or normalized_old_scope is None
            or normalized_new_scope is None
        ):
            return 0

        if normalized_old_scope == normalized_new_scope:
            return self._count_documents(normalized_user_id, normalized_old_scope)

        renamed_documents = self._rename_scope_in_local_store(
            user_id=normalized_user_id,
            old_scope=normalized_old_scope,
            new_scope=normalized_new_scope,
        )
        if not renamed_documents:
            return 0

        if self._using_chroma:
            try:  # pragma: no cover - exercised only when chromadb is installed
                collection = self._get_collection()
                collection.delete(
                    where={
                        "$and": [
                            {"user_id": normalized_user_id},
                            {"scope": normalized_old_scope},
                        ]
                    },
                )

                collection.upsert(
                    ids=[document.document_id for document in renamed_documents],
                    documents=[document.text for document in renamed_documents],
                    metadatas=[
                        {
                            "user_id": document.user_id,
                            "scope": document.scope,
                            "source": document.source,
                            "created_at": document.created_at,
                            "chunk_index": document.chunk_index,
                        }
                        for document in renamed_documents
                    ],
                )
            except Exception as exc:  # pragma: no cover - defensive fallback
                logger.warning(
                    "Knowledge base Chroma rename failed user_id=%s old_scope=%s new_scope=%s: %s",
                    normalized_user_id,
                    normalized_old_scope,
                    normalized_new_scope,
                    exc,
                )

        return len(renamed_documents)

    def list_scope_sources(
        self,
        user_id: str,
        scope: str,
    ) -> list[KnowledgeScopeSourceSummary]:
        normalized_user_id = (user_id or "").strip()
        normalized_scope = normalize_knowledge_base_scope(scope)
        if not normalized_user_id or normalized_scope is None:
            return []

        buckets: dict[str, int] = {}
        for document in self._iter_documents():
            if document.user_id != normalized_user_id or document.scope != normalized_scope:
                continue
            buckets[document.source] = buckets.get(document.source, 0) + 1

        items = [
            KnowledgeScopeSourceSummary(
                filename=filename,
                chunk_count=chunk_count,
            )
            for filename, chunk_count in buckets.items()
        ]
        return sorted(items, key=lambda item: (-item.chunk_count, item.filename.lower()))

    def list_source_documents(
        self,
        user_id: str,
        scope: str,
        source: str,
    ) -> list[KnowledgeDocument]:
        normalized_user_id = (user_id or "").strip()
        normalized_scope = normalize_knowledge_base_scope(scope)
        normalized_source = normalize_knowledge_source(source)
        if not normalized_user_id or normalized_scope is None:
            return []

        if self._using_chroma:
            chroma_documents = self._get_source_documents_from_chroma(
                normalized_user_id,
                normalized_scope,
                normalized_source,
            )
            if chroma_documents:
                return chroma_documents

        documents = [
            document
            for document in self._iter_documents()
            if (
                document.user_id == normalized_user_id
                and document.scope == normalized_scope
                and document.source == normalized_source
            )
        ]
        return self._sort_source_documents(documents)

    def delete_scope(self, user_id: str, scope: str) -> int:
        normalized_user_id = (user_id or "").strip()
        normalized_scope = normalize_knowledge_base_scope(scope)
        if not normalized_user_id or normalized_scope is None:
            return 0

        deleted_ids = self._delete_from_local_store(
            user_id=normalized_user_id,
            scope=normalized_scope,
        )

        if self._using_chroma:
            try:  # pragma: no cover - exercised only when chromadb is installed
                collection = self._get_collection()
                collection.delete(
                    where={
                        "$and": [
                            {"user_id": normalized_user_id},
                            {"scope": normalized_scope},
                        ]
                    },
                )
            except Exception as exc:  # pragma: no cover - defensive fallback
                logger.warning(
                    "Knowledge base Chroma delete failed user_id=%s scope=%s: %s",
                    normalized_user_id,
                    normalized_scope,
                    exc,
                )

        return len(deleted_ids)

    def delete_source(self, user_id: str, scope: str, source: str) -> int:
        normalized_user_id = (user_id or "").strip()
        normalized_scope = normalize_knowledge_base_scope(scope)
        normalized_source = normalize_knowledge_source(source)
        if not normalized_user_id or normalized_scope is None:
            return 0

        deleted_ids = self._delete_source_from_local_store(
            user_id=normalized_user_id,
            scope=normalized_scope,
            source=normalized_source,
        )

        if self._using_chroma:
            try:  # pragma: no cover - exercised only when chromadb is installed
                collection = self._get_collection()
                collection.delete(
                    where={
                        "$and": [
                            {"user_id": normalized_user_id},
                            {"scope": normalized_scope},
                            {"source": normalized_source},
                        ]
                    },
                )
            except Exception as exc:  # pragma: no cover - defensive fallback
                logger.warning(
                    "Knowledge base Chroma source delete failed user_id=%s scope=%s source=%s: %s",
                    normalized_user_id,
                    normalized_scope,
                    normalized_source,
                    exc,
                )

        return len(deleted_ids)

    def retrieve_chunks(
        self,
        user_id: str,
        scope: str,
        query: str,
        top_k: int = 3,
    ) -> list[KnowledgeDocument]:
        normalized_user_id = (user_id or "").strip()
        normalized_scope = normalize_knowledge_base_scope(scope)
        if normalized_scope is None:
            return []

        self._ensure_scope_seeded(normalized_scope)

        documents = self._query_documents(
            normalized_user_id,
            normalized_scope,
            query=query,
            top_k=max(1, top_k),
        )
        if documents:
            return documents

        if not normalized_user_id:
            return []

        return self._query_documents(
            SYSTEM_KNOWLEDGE_USER_ID,
            normalized_scope,
            query=query,
            top_k=max(1, top_k),
        )

    def retrieve_context(
        self,
        user_id: str,
        scope: str,
        query: str,
        top_k: int = 3,
    ) -> str:
        documents = self.retrieve_chunks(user_id, scope, query, top_k=top_k)
        if not documents:
            return ""

        sections = [
            f"[{index}] ({document.source}) {round(document.relevance_score * 100)}% 相关度。{document.text}"
            for index, document in enumerate(documents, start=1)
        ]
        return "\n\n".join(sections)

    def seed_mock_knowledge(self) -> None:
        for scope, texts in MOCK_KNOWLEDGE_DOCUMENTS.items():
            self._ensure_scope_seeded(scope, texts=texts)

    def _ensure_scope_seeded(self, scope: str, *, texts: list[str] | None = None) -> None:
        normalized_scope = normalize_knowledge_base_scope(scope)
        if normalized_scope is None:
            return

        scoped_texts = texts or MOCK_KNOWLEDGE_DOCUMENTS.get(normalized_scope, [])
        if not scoped_texts:
            return

        if self._count_documents(SYSTEM_KNOWLEDGE_USER_ID, normalized_scope) > 0:
            return

        self.add_documents(
            SYSTEM_KNOWLEDGE_USER_ID,
            normalized_scope,
            scoped_texts,
            source="preset_seed",
        )

    def _count_documents(self, user_id: str, scope: str) -> int:
        normalized_user_id = (user_id or "").strip()
        normalized_scope = normalize_knowledge_base_scope(scope)
        if not normalized_user_id or normalized_scope is None:
            return 0
        return sum(
            1
            for document in self._iter_documents()
            if document.user_id == normalized_user_id and document.scope == normalized_scope
        )

    def _iter_documents(self) -> list[KnowledgeDocument]:
        return list(self._load_local_store().values())

    def _load_local_store(self) -> dict[str, KnowledgeDocument]:
        with self._lock:
            if not self._fallback_store_path.exists():
                return {}
            try:
                payload = json.loads(self._fallback_store_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                logger.warning("Knowledge base local store is corrupt. Rebuilding from scratch.")
                return {}
        return self._deserialize_local_store(payload)

    def _deserialize_local_store(self, payload: object) -> dict[str, KnowledgeDocument]:
        if not isinstance(payload, dict):
            return {}

        documents_payload = payload.get("documents")
        if isinstance(documents_payload, dict):
            normalized_documents: dict[str, KnowledgeDocument] = {}
            for document_id, raw_document in documents_payload.items():
                if not isinstance(document_id, str) or not isinstance(raw_document, dict):
                    continue
                user_id = str(raw_document.get("user_id", "")).strip()
                scope = normalize_knowledge_base_scope(str(raw_document.get("scope", "")))
                text = str(raw_document.get("text", "")).strip()
                if not user_id or not scope or not text:
                    continue
                source = normalize_knowledge_source(str(raw_document.get("source", "uploaded_text")))
                created_at = str(raw_document.get("created_at", "")).strip() or utcnow_iso()
                normalized_documents[document_id] = KnowledgeDocument(
                    document_id=document_id,
                    user_id=user_id,
                    scope=scope,
                    source=source,
                    text=text,
                    created_at=created_at,
                    chunk_index=int(raw_document.get("chunk_index", 0) or 0),
                    relevance_score=float(raw_document.get("relevance_score", 0.0) or 0.0),
                    distance=raw_document.get("distance"),
                )
            return normalized_documents

        legacy_documents: dict[str, KnowledgeDocument] = {}
        for scope, items in payload.items():
            normalized_scope = normalize_knowledge_base_scope(scope if isinstance(scope, str) else None)
            if normalized_scope is None or not isinstance(items, dict):
                continue
            for document_id, text in items.items():
                if not isinstance(document_id, str) or not isinstance(text, str):
                    continue
                legacy_documents[document_id] = KnowledgeDocument(
                    document_id=document_id,
                    user_id=SYSTEM_KNOWLEDGE_USER_ID,
                    scope=normalized_scope,
                    source="legacy_seed",
                    text=text,
                    created_at=utcnow_iso(),
                    chunk_index=0,
                )
        return legacy_documents

    def _write_local_store(self, documents: dict[str, KnowledgeDocument]) -> None:
        payload = {
            "version": 2,
            "documents": {
                document_id: asdict(document)
                for document_id, document in documents.items()
            },
        }
        self._fallback_store_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _upsert_local_store(self, documents: dict[str, KnowledgeDocument]) -> None:
        with self._lock:
            existing_documents = self._deserialize_local_store(
                json.loads(self._fallback_store_path.read_text(encoding="utf-8"))
                if self._fallback_store_path.exists()
                else {}
            )
            existing_documents.update(documents)
            self._write_local_store(existing_documents)

    def _delete_from_local_store(self, *, user_id: str, scope: str) -> list[str]:
        with self._lock:
            existing_documents = self._deserialize_local_store(
                json.loads(self._fallback_store_path.read_text(encoding="utf-8"))
                if self._fallback_store_path.exists()
                else {}
            )
            deleted_ids = [
                document_id
                for document_id, document in existing_documents.items()
                if document.user_id == user_id and document.scope == scope
            ]
            if not deleted_ids:
                return []
            for document_id in deleted_ids:
                existing_documents.pop(document_id, None)
            self._write_local_store(existing_documents)
            return deleted_ids

    def _delete_source_from_local_store(
        self,
        *,
        user_id: str,
        scope: str,
        source: str,
    ) -> list[str]:
        with self._lock:
            existing_documents = self._deserialize_local_store(
                json.loads(self._fallback_store_path.read_text(encoding="utf-8"))
                if self._fallback_store_path.exists()
                else {}
            )
            deleted_ids = [
                document_id
                for document_id, document in existing_documents.items()
                if (
                    document.user_id == user_id
                    and document.scope == scope
                    and document.source == source
                )
            ]
            if not deleted_ids:
                return []
            for document_id in deleted_ids:
                existing_documents.pop(document_id, None)
            self._write_local_store(existing_documents)
            return deleted_ids

    def _rename_scope_in_local_store(
        self,
        *,
        user_id: str,
        old_scope: str,
        new_scope: str,
    ) -> list[KnowledgeDocument]:
        with self._lock:
            existing_documents = self._deserialize_local_store(
                json.loads(self._fallback_store_path.read_text(encoding="utf-8"))
                if self._fallback_store_path.exists()
                else {}
            )
            target_documents = [
                document
                for document in existing_documents.values()
                if document.user_id == user_id and document.scope == old_scope
            ]
            if not target_documents:
                return []

            renamed_documents: dict[str, KnowledgeDocument] = {}
            removed_ids = {document.document_id for document in target_documents}
            for document in target_documents:
                renamed_document_id = self._build_document_id(
                    user_id,
                    new_scope,
                    document.source,
                    document.text,
                    document.chunk_index,
                )
                renamed_documents[renamed_document_id] = KnowledgeDocument(
                    document_id=renamed_document_id,
                    user_id=document.user_id,
                    scope=new_scope,
                    source=document.source,
                    text=document.text,
                    created_at=document.created_at,
                    chunk_index=document.chunk_index,
                )

            for document_id in removed_ids:
                existing_documents.pop(document_id, None)
            existing_documents.update(renamed_documents)
            self._write_local_store(existing_documents)
            return list(renamed_documents.values())

    def _query_documents(
        self,
        user_id: str,
        scope: str,
        *,
        query: str,
        top_k: int,
    ) -> list[KnowledgeDocument]:
        normalized_user_id = (user_id or "").strip()
        if not normalized_user_id:
            return []

        if self._using_chroma:
            documents = self._query_documents_from_chroma(
                normalized_user_id,
                scope,
                query=query,
                top_k=top_k,
            )
            if documents:
                return documents

        scoped_documents = [
            document
            for document in self._iter_documents()
            if document.user_id == normalized_user_id and document.scope == scope
        ]
        if not scoped_documents:
            return []

        query_vector = _embed_text(query)
        query_tokens = set(_tokenize(query))
        scored_documents: list[tuple[float, KnowledgeDocument]] = []
        for document in scoped_documents:
            document_vector = _embed_text(document.text)
            score = _cosine_similarity(query_vector, document_vector)
            if query_tokens and any(token in document.text.lower() for token in query_tokens):
                score += 0.15
            scored_documents.append((score, document))

        scored_documents.sort(key=lambda item: item[0], reverse=True)
        return [
            replace(document, relevance_score=_clamp_relevance_score(score), distance=None)
            for score, document in scored_documents[:top_k]
        ]

    def _query_documents_from_chroma(
        self,
        user_id: str,
        scope: str,
        *,
        query: str,
        top_k: int,
    ) -> list[KnowledgeDocument]:
        try:  # pragma: no cover - exercised only when chromadb is installed
            collection = self._get_collection()
            results = collection.query(
                query_embeddings=[self._embedding_function.embed_query(input=query)],
                n_results=top_k,
                where={
                    "$and": [
                        {"user_id": user_id},
                        {"scope": scope},
                    ]
                },
                include=["documents", "metadatas", "distances"],
            )
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.warning(
                "Knowledge base Chroma query failed user_id=%s scope=%s: %s",
                user_id,
                scope,
                exc,
            )
            return []

        raw_ids = results.get("ids") or []
        raw_documents = results.get("documents") or []
        raw_metadatas = results.get("metadatas") or []
        raw_distances = results.get("distances") or []
        ids = raw_ids[0] if raw_ids and isinstance(raw_ids[0], list) else raw_ids
        documents = (
            raw_documents[0]
            if raw_documents and isinstance(raw_documents[0], list)
            else raw_documents
        )
        metadatas = (
            raw_metadatas[0]
            if raw_metadatas and isinstance(raw_metadatas[0], list)
            else raw_metadatas
        )
        distances = (
            raw_distances[0]
            if raw_distances and isinstance(raw_distances[0], list)
            else raw_distances
        )

        hydrated_documents: list[KnowledgeDocument] = []
        for index, raw_document in enumerate(documents):
            metadata = metadatas[index] if index < len(metadatas) and isinstance(metadatas[index], dict) else {}
            document_id = str(ids[index]) if index < len(ids) else self._build_document_id(
                user_id,
                scope,
                normalize_knowledge_source(metadata.get("source") if isinstance(metadata, dict) else None),
                str(raw_document),
                int(metadata.get("chunk_index", index) or index),
            )
            text = str(raw_document).strip()
            if not text:
                continue
            raw_distance = distances[index] if index < len(distances) else None
            try:
                distance = float(raw_distance) if raw_distance is not None else None
            except (TypeError, ValueError):
                distance = None
            hydrated_documents.append(
                KnowledgeDocument(
                    document_id=document_id,
                    user_id=str(metadata.get("user_id", user_id)),
                    scope=normalize_knowledge_base_scope(str(metadata.get("scope", scope))) or scope,
                    source=normalize_knowledge_source(
                        str(metadata.get("source", "uploaded_text")),
                    ),
                    text=text,
                    created_at=str(metadata.get("created_at", "")).strip() or utcnow_iso(),
                    chunk_index=int(metadata.get("chunk_index", index) or index),
                    relevance_score=_distance_to_relevance_score(distance),
                    distance=distance,
                )
            )
        return hydrated_documents

    def _get_source_documents_from_chroma(
        self,
        user_id: str,
        scope: str,
        source: str,
    ) -> list[KnowledgeDocument]:
        try:  # pragma: no cover - exercised only when chromadb is installed
            collection = self._get_collection()
            results = collection.get(
                where={
                    "$and": [
                        {"user_id": user_id},
                        {"scope": scope},
                        {"source": source},
                    ]
                },
                include=["documents", "metadatas"],
            )
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.warning(
                "Knowledge base Chroma source preview failed user_id=%s scope=%s source=%s: %s",
                user_id,
                scope,
                source,
                exc,
            )
            return []

        raw_ids = results.get("ids") or []
        raw_documents = results.get("documents") or []
        raw_metadatas = results.get("metadatas") or []
        hydrated_documents: list[KnowledgeDocument] = []
        for index, raw_document in enumerate(raw_documents):
            metadata = (
                raw_metadatas[index]
                if index < len(raw_metadatas) and isinstance(raw_metadatas[index], dict)
                else {}
            )
            text = str(raw_document).strip()
            if not text:
                continue
            chunk_index = int(metadata.get("chunk_index", index) or index)
            document_id = str(raw_ids[index]) if index < len(raw_ids) else self._build_document_id(
                user_id,
                scope,
                source,
                text,
                chunk_index,
            )
            hydrated_documents.append(
                KnowledgeDocument(
                    document_id=document_id,
                    user_id=str(metadata.get("user_id", user_id)),
                    scope=normalize_knowledge_base_scope(str(metadata.get("scope", scope))) or scope,
                    source=normalize_knowledge_source(str(metadata.get("source", source))),
                    text=text,
                    created_at=str(metadata.get("created_at", "")).strip() or utcnow_iso(),
                    chunk_index=chunk_index,
                )
            )
        return self._sort_source_documents(hydrated_documents)

    @staticmethod
    def _sort_source_documents(documents: list[KnowledgeDocument]) -> list[KnowledgeDocument]:
        return sorted(
            documents,
            key=lambda document: (
                document.chunk_index,
                document.created_at,
                document.document_id,
            ),
        )

    def _get_collection(self):
        if self._client is None:  # pragma: no cover - defensive guard
            raise RuntimeError("Chroma client is not available.")
        return self._client.get_or_create_collection(
            name=GLOBAL_COLLECTION_NAME,
            embedding_function=self._embedding_function,
            metadata={"kind": "multi_tenant_knowledge"},
        )

    @staticmethod
    def _build_document_id(
        user_id: str,
        scope: str,
        source: str,
        text: str,
        chunk_index: int = 0,
    ) -> str:
        digest = sha1(
            f"{user_id}:{scope}:{source}:{chunk_index}:{text}".encode("utf-8"),
        ).hexdigest()
        return f"{scope}-{digest[:20]}"


_knowledge_base_service: KnowledgeBaseService | None = None


def get_knowledge_base_service() -> KnowledgeBaseService:
    global _knowledge_base_service
    if _knowledge_base_service is None:
        _knowledge_base_service = KnowledgeBaseService()
    return _knowledge_base_service


def init_mock_knowledge() -> None:
    get_knowledge_base_service().seed_mock_knowledge()
