#!/usr/bin/env python3
"""Recupera chunks do índice FAISS gerado pelo notebook de chunking."""

from __future__ import annotations

import argparse
import contextlib
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import faiss
import numpy as np
from sentence_transformers import CrossEncoder, SentenceTransformer


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
    parser.add_argument("--bm25-top-k", type=int, default=40, help="Quantidade de candidatos BM25.")
    parser.add_argument("--reranker-model", default="", help="Cross-encoder local opcional para reranking.")
    parser.add_argument("--reranker-top-k", type=int, default=40, help="Quantidade maxima de candidatos para reranker.")
    return parser.parse_args()


def infer_vehicle(document_name: str, metadata: dict[str, Any]) -> dict[str, Any]:
    normalized = document_name.lower().replace("_", "-")
    parts = [part for part in re.split(r"[-\s]+", normalized) if part]
    year = next((int(part) for part in parts if re.fullmatch(r"(?:19|20)\d{2}", part)), None)
    brand = metadata.get("brand")

    if not brand and year and str(year) in parts:
        year_index = parts.index(str(year))
        if year_index + 1 < len(parts):
            brand = parts[year_index + 1]

    model = None
    if year and brand and str(year) in parts and brand in parts:
        brand_index = parts.index(brand)
        model_parts = []
        for part in parts[brand_index + 1 :]:
            if part in {str(year), "manual", "owner", "owners", "proprietario"}:
                continue
            if re.fullmatch(r"[a-f0-9]{10,}", part):
                break
            model_parts.append(part)
            if len(model_parts) >= 3:
                break
        if model_parts:
            midpoint = len(model_parts) // 2
            if len(model_parts) % 2 == 0 and model_parts[:midpoint] == model_parts[midpoint:]:
                model_parts = model_parts[:midpoint]
            model = " ".join(model_parts)

    return {
        "vehicle_make": brand,
        "vehicle_model": model,
        "vehicle_year": year,
        "document_type": metadata.get("document_type") or "owner_manual",
    }


def extract_entities(text: str) -> list[str]:
    entities: set[str] = set()
    normalized = text.replace("\n", " ")
    for match in re.finditer(r"\bVW\s*50[234]\s*00\b", normalized, flags=re.I):
        entities.add(re.sub(r"\s+", " ", match.group(0)).upper())
    for match in re.finditer(r"\b(?:SAE\s*)?[05SO]W[-\s]?\d{2}\b", normalized, flags=re.I):
        value = match.group(0).upper().replace("SAE", "").strip()
        value = value.replace("O", "0").replace("S", "5").replace(" ", "").replace("-", "")
        if re.fullmatch(r"[05]W\d{2}", value):
            entities.add(f"{value[:2]}-{value[2:]}")
    for term in [
        "oil filler cap",
        "engine compartment",
        "rim size",
        "tyre size",
        "tire size",
        "fuse box",
        "fluid containers",
    ]:
        if term in normalized.lower():
            entities.add(term)
    return sorted(entities)


def compact_chunk(item: dict[str, Any], score: float, retrieval_scores: dict[str, float] | None = None) -> dict[str, Any]:
    metadata = item.get("metadata", {})
    vehicle = infer_vehicle(item.get("document_name") or "", metadata)
    text = item.get("text", "")
    scores = retrieval_scores or {}
    scores["final"] = score
    return {
        "score": score,
        "chunk_id": item.get("chunk_id"),
        "document_name": item.get("document_name"),
        "pdf_path": item.get("pdf_path"),
        "page_start": item.get("page_start"),
        "page_end": item.get("page_end"),
        "section_title": item.get("section_title"),
        "text": text,
        "image_paths": item.get("image_paths", []),
        "metadata": {
            "brand": metadata.get("brand"),
            **vehicle,
            "content_type": infer_content_type(text, item.get("image_paths", [])),
            "entities": extract_entities(text),
            "faiss_vector_id": metadata.get("faiss_vector_id"),
            "image_count": metadata.get("image_count"),
            "split_reason": metadata.get("split_reason"),
        },
        "retrieval_scores": scores,
    }


def infer_content_type(text: str, image_paths: list[str]) -> str:
    lower = text.lower()
    if re.search(r"\b(?:vw\s*50[234]\s*00|sae\s*[05so]w[-\s]?\d{2}|rim size|tyre size|tire size)\b", lower):
        return "specification"
    if image_paths and any(term in lower for term in ["fig.", "figure", "typical layout", "location", "engine compartment"]):
        return "visual_location"
    if any(term in lower for term in ["warning", "caution", "danger", "atencao", "atenção"]):
        return "warning"
    if any(term in lower for term in ["procedure", "step", "press", "turn", "remove", "install"]):
        return "procedure"
    return "manual_text"


def tokenize(text: str) -> list[str]:
    return re.findall(r"[\wÀ-ÿ]+", text.lower())


def bm25_scores(metadata: list[dict[str, Any]], query: str, limit: int) -> list[tuple[float, int]]:
    if limit <= 0:
        return []

    query_terms = tokenize(query)
    if not query_terms:
        return []

    doc_terms = [tokenize(item.get("text", "")) for item in metadata]
    avgdl = sum(len(terms) for terms in doc_terms) / max(1, len(doc_terms))
    doc_freq: defaultdict[str, int] = defaultdict(int)
    for terms in doc_terms:
        for term in set(terms):
            doc_freq[term] += 1

    k1 = 1.5
    b = 0.75
    scores: list[tuple[float, int]] = []
    total_docs = len(metadata)
    query_counter = Counter(query_terms)

    for index, terms in enumerate(doc_terms):
        if not terms:
            continue
        term_counts = Counter(terms)
        score = 0.0
        dl = len(terms)
        for term, qf in query_counter.items():
            tf = term_counts.get(term, 0)
            if tf == 0:
                continue
            idf = math.log(1 + (total_docs - doc_freq[term] + 0.5) / (doc_freq[term] + 0.5))
            denom = tf + k1 * (1 - b + b * dl / max(avgdl, 1))
            score += qf * idf * (tf * (k1 + 1) / denom)
        if score > 0:
            scores.append((score, index))

    if not scores:
        return []

    max_score = max(score for score, _ in scores)
    return [(score / max_score, index) for score, index in sorted(scores, reverse=True)[:limit]]


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
    normalized_query = query.lower()
    document_name = item.get("document_name", "").lower()
    years = query_years(query)
    image_count = len(item.get("image_paths", []))
    is_oil_component_location = any(
        term in normalized_query
        for term in ["oleo", "óleo", "oil", "tampa", "filler"]
    )
    has_oil_component_evidence = any(
        term in text
        for term in [
            "oil filler cap",
            "engine oil filler cap",
            "oil filler neck",
            "engine oil filler",
            "fluid containers",
        ]
    )

    score = 0.0
    has_location_evidence = False

    if is_oil_component_location and not has_oil_component_evidence:
        return 0.0

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
    if (
        any(term in normalized_query for term in ["oleo", "óleo", "oil", "tampa", "reservatorio", "reservatório"])
        and any(term in text for term in ["oil filler cap", "engine oil filler cap", "oil filler neck", "fluid containers"])
    ):
        score += 0.4
        has_location_evidence = True
    if (
        not is_oil_component_location
        and any(term in text for term in ["engine compartment", "under the hood", "bonnet"])
    ):
        score += 0.12
        has_location_evidence = True
    if not has_location_evidence:
        return 0.0

    if image_count > 0:
        score += 0.25
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
        (float(min(score, 1.0)), vector_id, item)
        for score, vector_id, item in candidates[:limit]
    ]


def metadata_score(item: dict[str, Any], query: str) -> float:
    document_name = item.get("document_name", "").lower()
    metadata = item.get("metadata", {})
    vehicle = infer_vehicle(document_name, metadata)
    years = query_years(query)
    score = 0.0
    requested_year_mismatch = bool(
        years and vehicle.get("vehicle_year") and str(vehicle["vehicle_year"]) not in years
    )
    if years and vehicle.get("vehicle_year"):
        score += 0.45 if str(vehicle["vehicle_year"]) in years else -0.35
    brand = str(vehicle.get("vehicle_make") or "").lower()
    if brand and brand in query.lower():
        score += 0.15 if requested_year_mismatch else 0.3
    model = str(vehicle.get("vehicle_model") or "").lower()
    if model and all(part in query.lower() for part in model.split()[:2]):
        score += 0.1 if requested_year_mismatch else 0.25
    return max(0.0, min(score, 1.0))


def domain_score(item: dict[str, Any], query: str) -> float:
    score = 0.0
    if is_wheel_size_query(query):
        score = max(score, wheel_lexical_score(item, query))
    if is_visual_location_query(query):
        score = max(score, visual_location_lexical_score(item, query))
    if is_oil_query(query) and not is_visual_location_query(query):
        score = max(score, oil_lexical_score(item, query))
    return min(score, 1.0)


def merge_candidates(
    metadata: list[dict[str, Any]],
    vector_hits: list[tuple[float, int]],
    bm25_hits: list[tuple[float, int]],
    lexical_hits: list[tuple[float, int, dict[str, Any]]],
    query: str,
) -> list[dict[str, Any]]:
    merged: dict[int, dict[str, Any]] = {}

    def ensure(vector_id: int) -> dict[str, Any]:
        if vector_id not in merged:
            merged[vector_id] = {
                "vector_id": vector_id,
                "item": metadata[vector_id],
                "scores": {},
            }
        return merged[vector_id]

    for score, vector_id in vector_hits:
        ensure(vector_id)["scores"]["vector"] = float(score)
    for score, vector_id in bm25_hits:
        ensure(vector_id)["scores"]["bm25"] = float(score)
    for score, vector_id, item in lexical_hits:
        entry = ensure(vector_id)
        entry["item"] = item
        entry["scores"]["lexical"] = float(score)

    for entry in merged.values():
        scores = entry["scores"]
        scores["metadata"] = metadata_score(entry["item"], query)
        scores["domain"] = max(scores.get("lexical", 0.0), domain_score(entry["item"], query))
        scores["final"] = (
            0.36 * scores.get("vector", 0.0)
            + 0.18 * scores.get("bm25", 0.0)
            + 0.28 * scores.get("domain", 0.0)
            + 0.18 * scores.get("metadata", 0.0)
        )

    return sorted(merged.values(), key=lambda entry: entry["scores"]["final"], reverse=True)


def apply_reranker(candidates: list[dict[str, Any]], query: str, model_name: str, limit: int) -> None:
    if not model_name or not candidates:
        return

    rerank_candidates = candidates[: max(1, limit)]
    with contextlib.redirect_stdout(sys.stderr):
        reranker = CrossEncoder(model_name)
        predictions = reranker.predict(
            [(query, candidate["item"].get("text", "")[:4000]) for candidate in rerank_candidates]
        )

    values = [float(value) for value in predictions]
    if not values:
        return
    min_value = min(values)
    max_value = max(values)
    span = max(max_value - min_value, 1e-9)
    for candidate, value in zip(rerank_candidates, values):
        normalized = (value - min_value) / span
        candidate["scores"]["reranker"] = normalized
        candidate["scores"]["final"] = 0.58 * normalized + 0.42 * candidate["scores"].get("final", 0.0)


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

    vector_hits = []
    existing_vector_ids = set()
    for score, vector_id in zip(scores[0], vector_ids[0]):
        if vector_id < 0:
            continue
        existing_vector_ids.add(int(vector_id))
        vector_hits.append((float(score), int(vector_id)))

    lexical_hits = lexical_supplements(
        metadata,
        args.query,
        existing_vector_ids,
        args.lexical_supplements,
    )
    bm25_hits = bm25_scores(metadata, args.query, args.bm25_top_k)
    candidates = merge_candidates(metadata, vector_hits, bm25_hits, lexical_hits, args.query)
    apply_reranker(candidates, args.query, args.reranker_model, args.reranker_top_k)
    candidates.sort(key=lambda entry: entry["scores"]["final"], reverse=True)

    results = [
        compact_chunk(candidate["item"], float(candidate["scores"]["final"]), candidate["scores"])
        for candidate in candidates[:top_k]
    ]

    print(json.dumps({"query": args.query, "results": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
