#!/usr/bin/env python3
"""Recupera chunks do índice FAISS gerado pelo notebook de chunking."""

from __future__ import annotations

import argparse
import contextlib
import json
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
    for score, vector_id in zip(scores[0], vector_ids[0]):
        if vector_id < 0:
            continue
        results.append(compact_chunk(metadata[int(vector_id)], float(score)))

    print(json.dumps({"query": args.query, "results": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
