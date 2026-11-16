#!/usr/bin/env python3
"""Worker JSONL persistente para recuperação sem recarregar FAISS/modelo."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from retrieve_chunks import RetrieverRuntime


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--embedding-device", default="cpu")
    parser.add_argument("--reranker-device", default="cpu")
    parser.add_argument("--minimum-free-vram-mb", type=int, default=2048)
    return parser.parse_args()


def request_args(payload: dict[str, Any]) -> argparse.Namespace:
    filters = payload.get("filters") or {}
    return argparse.Namespace(
        query=str(payload.get("query") or ""),
        top_k=int(payload.get("topK") or 24),
        lexical_supplements=int(payload.get("lexicalSupplements") or 3),
        bm25_top_k=int(payload.get("bm25TopK") or 40),
        reranker_model=str(payload.get("rerankerModel") or ""),
        reranker_top_k=int(payload.get("rerankerTopK") or 40),
        vehicle_brand=str(filters.get("brand") or ""),
        vehicle_model=str(filters.get("model") or ""),
        vehicle_year=str(filters.get("year") or ""),
        vehicle_engine=str(filters.get("engine") or ""),
        vehicle_version=str(filters.get("version") or ""),
    )


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> None:
    args = parse_args()
    runtime = RetrieverRuntime(
        args.output_dir,
        args.model,
        args.embedding_device,
        args.reranker_device,
        args.minimum_free_vram_mb,
    )
    emit({"event": "ready"})

    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        request_id = ""
        try:
            payload = json.loads(raw_line)
            request_id = str(payload.get("id") or "")
            if not request_id:
                raise ValueError("request id ausente")
            result = runtime.retrieve(request_args(payload))
            emit({"id": request_id, "result": result})
        except Exception as error:  # o processo continua para a próxima consulta
            emit(
                {
                    "id": request_id,
                    "error": {
                        "type": type(error).__name__,
                        "message": str(error)[:2000],
                    },
                }
            )


if __name__ == "__main__":
    main()
