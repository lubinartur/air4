"""Embedding generation abstraction (MVP: deterministic local vectors, L2-normalized)."""

from __future__ import annotations

import hashlib
import struct

# Fixed dimension for MVP; keep stable when swapping storage backends (Chroma/pgvector).
_EMBEDDING_DIM = 384


def _l2_normalize(vec: list[float]) -> list[float]:
    norm = sum(x * x for x in vec) ** 0.5 or 1.0
    return [x / norm for x in vec]


def _deterministic_embedding(text: str, dim: int = _EMBEDDING_DIM) -> list[float]:
    """Reproducible dense vector from text for local dev when no external provider is configured."""
    vec: list[float] = []
    block = hashlib.sha256(text.encode("utf-8")).digest()
    counter = 0
    while len(vec) < dim:
        block = hashlib.sha256(block + str(counter).encode()).digest()
        counter += 1
        for j in range(0, len(block) - 3, 4):
            u = struct.unpack(">I", block[j : j + 4])[0]
            vec.append((u / 4294967295.0) * 2.0 - 1.0)
            if len(vec) >= dim:
                break
    return _l2_normalize(vec)


def generate_embedding(text: str) -> list[float]:
    """
    Produce an L2-normalized embedding for ``text``.

    Today this delegates to the deterministic local implementation. Future
    providers can branch here while keeping the same return contract.
    """
    return _deterministic_embedding(text)


# -----------------------------------------------------------------------------
# TODO: OpenAI embeddings
# -----------------------------------------------------------------------------
# Wire OPENAI_API_KEY + model id; call OpenAI HTTP API; map dimension to
# storage policy; return _l2_normalize(vectors).


# -----------------------------------------------------------------------------
# TODO: Ollama embeddings
# -----------------------------------------------------------------------------
# Call local Ollama /api/embeddings (or equivalent); ensure output dim matches
# DB / index expectations; return _l2_normalize(vectors).


# -----------------------------------------------------------------------------
# TODO: Chroma / pgvector integration
# -----------------------------------------------------------------------------
# Keep generate_embedding for query-time vectors; add a thin repository that
# upserts vectors into Chroma or Postgres+pgvector while events stay
# authoritative in SQLite (or migrate storage behind this module).
