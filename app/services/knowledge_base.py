import json
import logging
import math
import os
from hashlib import sha1
from pathlib import Path
from threading import Lock
from typing import Any

logger = logging.getLogger(__name__)

try:  # pragma: no cover - optional dependency
    import chromadb
except ImportError:  # pragma: no cover - optional dependency
    chromadb = None


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_KNOWLEDGE_BASE_DIR = PROJECT_ROOT / ".omnimedia_knowledge_base"
FALLBACK_STORE_FILENAME = "knowledge_store.json"
EMBEDDING_DIMENSIONS = 256

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
    "secondhand_trade_playbook": [
        "High-conversion secondhand listings should describe condition honestly, including visible flaws, usage frequency, included accessories, and preferred transaction method.",
        "For Xianyu-style resale-recovery copy, the trust signal matters more than hype: explain why the item is being sold, what type of buyer it fits, and a realistic price anchor.",
        "Avoid exaggerated adjectives in resale copy. Concrete details like purchase channel, invoice availability, and battery or wear condition convert better.",
    ],
    "declutter_recovery_board": [
        "Declutter-to-recovery copy should focus on reclaiming space, lowering sunk-cost stress, and making the next owner feel safe about the purchase.",
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
}


def normalize_knowledge_base_scope(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    return normalized or None


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


class _HashingEmbeddingFunction:
    def __call__(self, input: Any) -> list[list[float]]:
        if isinstance(input, str):
            texts = [input]
        else:
            texts = [str(item) for item in input]
        return [_embed_text(text) for text in texts]


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

    def add_documents(self, scope: str, texts: list[str]) -> int:
        normalized_scope = normalize_knowledge_base_scope(scope)
        if normalized_scope is None:
            return 0

        cleaned_texts = [text.strip() for text in texts if text and text.strip()]
        if not cleaned_texts:
            return 0

        deduped_pairs: list[tuple[str, str]] = []
        seen_ids: set[str] = set()
        for text in cleaned_texts:
            document_id = self._build_document_id(normalized_scope, text)
            if document_id in seen_ids:
                continue
            seen_ids.add(document_id)
            deduped_pairs.append((document_id, text))

        if not deduped_pairs:
            return 0

        self._upsert_local_store(
            normalized_scope,
            {document_id: text for document_id, text in deduped_pairs},
        )

        if self._using_chroma:
            try:  # pragma: no cover - exercised only when chromadb is installed
                collection = self._get_collection(normalized_scope)
                collection.upsert(
                    ids=[document_id for document_id, _ in deduped_pairs],
                    documents=[text for _, text in deduped_pairs],
                    metadatas=[
                        {"scope": normalized_scope, "source": "local_seed_or_ingest"}
                        for _ in deduped_pairs
                    ],
                )
            except Exception as exc:  # pragma: no cover - defensive fallback
                logger.warning(
                    "Knowledge base Chroma upsert failed for scope=%s: %s",
                    normalized_scope,
                    exc,
                )

        return len(deduped_pairs)

    def retrieve_context(
        self,
        scope: str,
        query: str,
        top_k: int = 3,
    ) -> str:
        normalized_scope = normalize_knowledge_base_scope(scope)
        if normalized_scope is None:
            return ""

        self._ensure_scope_seeded(normalized_scope)

        documents = self._query_documents(
            normalized_scope,
            query=query,
            top_k=max(1, top_k),
        )
        if not documents:
            return ""

        sections = [f"[{index}] {document}" for index, document in enumerate(documents, start=1)]
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

        if self._count_documents(normalized_scope) > 0:
            return

        self.add_documents(normalized_scope, scoped_texts)

    def _count_documents(self, scope: str) -> int:
        store = self._load_local_store()
        return len(store.get(scope, {}))

    def _load_local_store(self) -> dict[str, dict[str, str]]:
        with self._lock:
            if not self._fallback_store_path.exists():
                return {}
            try:
                payload = json.loads(self._fallback_store_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                logger.warning("Knowledge base local store is corrupt. Rebuilding from scratch.")
                return {}
        if not isinstance(payload, dict):
            return {}
        normalized_payload: dict[str, dict[str, str]] = {}
        for scope, items in payload.items():
            if not isinstance(scope, str) or not isinstance(items, dict):
                continue
            normalized_payload[scope] = {
                str(document_id): str(text)
                for document_id, text in items.items()
                if isinstance(text, str)
            }
        return normalized_payload

    def _upsert_local_store(self, scope: str, documents: dict[str, str]) -> None:
        with self._lock:
            store = {}
            if self._fallback_store_path.exists():
                try:
                    store = json.loads(self._fallback_store_path.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    logger.warning("Knowledge base local store was corrupt and will be replaced.")
                    store = {}

            scoped_store = store.get(scope)
            if not isinstance(scoped_store, dict):
                scoped_store = {}
            for document_id, text in documents.items():
                scoped_store[document_id] = text
            store[scope] = scoped_store
            self._fallback_store_path.write_text(
                json.dumps(store, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

    def _query_documents(self, scope: str, *, query: str, top_k: int) -> list[str]:
        if self._using_chroma:
            documents = self._query_documents_from_chroma(scope, query=query, top_k=top_k)
            if documents:
                return documents

        store = self._load_local_store()
        scoped_documents = list(store.get(scope, {}).values())
        if not scoped_documents:
            return []

        query_vector = _embed_text(query)
        scored_documents: list[tuple[float, str]] = []
        query_tokens = set(_tokenize(query))

        for document in scoped_documents:
            document_vector = _embed_text(document)
            score = _cosine_similarity(query_vector, document_vector)
            if query_tokens and any(token in document.lower() for token in query_tokens):
                score += 0.15
            scored_documents.append((score, document))

        scored_documents.sort(key=lambda item: item[0], reverse=True)
        return [document for _, document in scored_documents[:top_k]]

    def _query_documents_from_chroma(
        self,
        scope: str,
        *,
        query: str,
        top_k: int,
    ) -> list[str]:
        try:  # pragma: no cover - exercised only when chromadb is installed
            collection = self._get_collection(scope)
            results = collection.query(
                query_texts=[query],
                n_results=top_k,
                include=["documents"],
            )
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.warning("Knowledge base Chroma query failed for scope=%s: %s", scope, exc)
            return []

        documents = results.get("documents") or []
        if not documents:
            return []
        first_group = documents[0] if isinstance(documents[0], list) else documents
        return [str(item).strip() for item in first_group if str(item).strip()]

    def _get_collection(self, scope: str):
        if self._client is None:  # pragma: no cover - defensive guard
            raise RuntimeError("Chroma client is not available.")
        return self._client.get_or_create_collection(
            name=self._scope_to_collection_name(scope),
            embedding_function=self._embedding_function,
            metadata={"scope": scope},
        )

    @staticmethod
    def _scope_to_collection_name(scope: str) -> str:
        normalized_scope = normalize_knowledge_base_scope(scope) or "default_scope"
        return normalized_scope.replace("/", "_").replace("-", "_")

    @staticmethod
    def _build_document_id(scope: str, text: str) -> str:
        digest = sha1(f"{scope}:{text}".encode("utf-8")).hexdigest()
        return f"{scope}-{digest[:20]}"


_knowledge_base_service: KnowledgeBaseService | None = None


def get_knowledge_base_service() -> KnowledgeBaseService:
    global _knowledge_base_service
    if _knowledge_base_service is None:
        _knowledge_base_service = KnowledgeBaseService()
    return _knowledge_base_service


def init_mock_knowledge() -> None:
    get_knowledge_base_service().seed_mock_knowledge()
