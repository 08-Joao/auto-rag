#!/usr/bin/env python3
"""Recupera chunks do índice FAISS gerado pelo notebook de chunking."""

from __future__ import annotations

import argparse
import contextlib
import json
import re
import sys
from pathlib import Path
from typing import Any

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Busca chunks automotivos no FAISS.")
    parser.add_argument("--query", required=True, help="Pergunta do usuário.")
    parser.add_argument("--output-dir", required=True, help="Diretório com manual_chunks.faiss e chunks_metadata.json.")
    parser.add_argument("--model", required=True, help="Modelo de embeddings usado no chunking.")
    parser.add_argument("--top-k", type=int, default=5, help="Quantidade de chunks retornados.")
    parser.add_argument(
        "--lexical-supplements",
        type=int,
        default=0,
        help="Quantidade de chunks complementares encontrados por regras lexicais.",
    )
    return parser.parse_args()


def compact_chunk(item: dict[str, Any], score: float) -> dict[str, Any]:
    metadata = item.get("metadata", {})
    return {
        "score": score,
        "chunk_id": item.get("chunk_id"),
        "document_name": item.get("document_name"),
        "pdf_path": item.get("pdf_path"),
        "page_start": item.get("page_start"),
        "page_end": item.get("page_end"),
        "section_title": item.get("section_title"),
        "text": item.get("text", ""),
        "image_paths": item.get("image_paths", []),
        "metadata": {
            "brand": metadata.get("brand"),
            "faiss_vector_id": metadata.get("faiss_vector_id"),
            "image_count": metadata.get("image_count"),
            "split_reason": metadata.get("split_reason"),
        },
    }


def is_wheel_size_query(query: str) -> bool:
    normalized = query.lower()
    return any(
        term in normalized
        for term in [
            "aro",
            "rim size",
            "rim diameter",
            "wheel size",
            "tamanho da roda",
            "tamanho do aro",
            "diametro do aro",
            "diâmetro do aro",
        ]
    )


def is_oil_query(query: str) -> bool:
    normalized = query.lower()
    return any(
        term in normalized
        for term in [
            "oleo",
            "óleo",
            "engine oil",
            "oil standard",
            "viscosidade",
            "viscosity",
        ]
    )


def is_visual_location_query(query: str) -> bool:
    normalized = query.lower()
    return any(
        term in normalized
        for term in [
            "onde fica",
            "onde esta",
            "onde está",
            "localizado",
            "localizada",
            "localizacao",
            "localização",
            "reservatorio",
            "reservatório",
            "tampa",
            "mostrar",
            "mostre",
            "imagem",
            "imagens",
            "diagrama",
            "figura",
            "oil filler cap location",
            "typical layout",
        ]
    )


def query_years(query: str) -> set[str]:
    return set(re.findall(r"\b(?:19|20)\d{2}\b", query))


def wheel_lexical_score(item: dict[str, Any], query: str) -> float:
    text = item.get("text", "").lower()
    document_name = item.get("document_name", "").lower()
    years = query_years(query)

    score = 0.0
    has_wheel_evidence = False
    if "rim size" in text and ("tyre size" in text or "tire size" in text):
        score += 0.35
        has_wheel_evidence = True
    if "rim offset" in text:
        score += 0.15
        has_wheel_evidence = True
    if "rim diameter code" in text:
        score += 0.15
        has_wheel_evidence = True
    if re.search(r"\b\d{1,2}j\s*x\s*\d{2}\b", text):
        score += 0.2
        has_wheel_evidence = True
    if not has_wheel_evidence:
        return 0.0

    if years and any(year in document_name for year in years):
        score += 0.25
    if re.search(r"\b\d{3}\s*/\s*\d{2}\b", text):
        score += 0.1

    return score


def oil_lexical_score(item: dict[str, Any], query: str) -> float:
    text = item.get("text", "").lower()
    document_name = item.get("document_name", "").lower()
    years = query_years(query)

    score = 0.0
    has_oil_evidence = False

    if "vw 502 00" in text or "audi oil standard" in text:
        score += 0.35
        has_oil_evidence = True
    if "viscosity" in text or "viscosidade" in text:
        score += 0.25
        has_oil_evidence = True
    if re.search(r"\b(?:sae\s*)?[05sow]{1,2}w[-\s]?\d{2}\b", text):
        score += 0.25
        has_oil_evidence = True
    if "engine oil specifications" in text or "oil specifications" in text:
        score += 0.2
        has_oil_evidence = True

    if not has_oil_evidence:
        return 0.0

    if years and any(year in document_name for year in years):
        score += 0.25
    if "index" in text[:120].lower() or "alphabetical index" in text[:240].lower():
        score -= 0.2

    return score


def visual_location_lexical_score(item: dict[str, Any], query: str) -> float:
    text = item.get("text", "").lower()
    document_name = item.get("document_name", "").lower()
    years = query_years(query)
    image_count = len(item.get("image_paths", []))

    score = 0.0
    has_location_evidence = False

    if "oil filler cap location" in text:
        score += 0.45
        has_location_evidence = True
    if "typical layout" in text and ("engine oil filler cap" in text or "oil filler cap" in text):
        score += 0.35
        has_location_evidence = True
    if "engine compartment" in text and ("oil filler cap" in text or "oil filler neck" in text):
        score += 0.3
        has_location_evidence = True
    if "typical locations of fluid containers" in text:
        score += 0.25
        has_location_evidence = True
    if not has_location_evidence:
        return 0.0

    if image_count > 0:
        score += 0.8
    if years and any(year in document_name for year in years):
        score += 0.25
    if "vw 502 00" in text or "viscosity" in text:
        score -= 0.2
    if "oil level indicator" in text and "oil filler cap location" not in text:
        score -= 0.12

    return score


def lexical_supplements(
    metadata: list[dict[str, Any]],
    query: str,
    existing_vector_ids: set[int],
    limit: int,
) -> list[dict[str, Any]]:
    if limit <= 0:
        return []

    candidates = []
    for vector_id, item in enumerate(metadata):
        if vector_id in existing_vector_ids:
            continue

        score = 0.0
        if is_wheel_size_query(query):
            score = max(score, wheel_lexical_score(item, query))
        if is_visual_location_query(query):
            score = max(score, visual_location_lexical_score(item, query))
        if is_oil_query(query) and not is_visual_location_query(query):
            score = max(score, oil_lexical_score(item, query))

        if score <= 0:
            continue

        candidates.append((score, vector_id, item))

    candidates.sort(key=lambda candidate: candidate[0], reverse=True)

    return [
        compact_chunk(item, float(0.65 + min(score, 0.35)))
        for score, _, item in candidates[:limit]
    ]


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir)
    index_path = output_dir / "manual_chunks.faiss"
    metadata_path = output_dir / "chunks_metadata.json"

    if not index_path.exists():
        raise FileNotFoundError(f"Índice FAISS não encontrado: {index_path}")
    if not metadata_path.exists():
        raise FileNotFoundError(f"Metadados dos chunks não encontrados: {metadata_path}")

    index = faiss.read_index(str(index_path))
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))

    with contextlib.redirect_stdout(sys.stderr):
        model = SentenceTransformer(args.model)
        query_embedding = model.encode(
            [args.query],
            convert_to_numpy=True,
            normalize_embeddings=True,
        ).astype("float32")

    top_k = max(1, min(args.top_k, len(metadata)))
    scores, vector_ids = index.search(query_embedding, top_k)

    results = []
    existing_vector_ids = set()
    for score, vector_id in zip(scores[0], vector_ids[0]):
        if vector_id < 0:
            continue
        existing_vector_ids.add(int(vector_id))
        results.append(compact_chunk(metadata[int(vector_id)], float(score)))

    results.extend(
        lexical_supplements(
            metadata,
            args.query,
            existing_vector_ids,
            args.lexical_supplements,
        ),
    )

    print(json.dumps({"query": args.query, "results": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
