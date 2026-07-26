"""Política comum e determinística para modelos PyTorch auxiliares do RAG."""

from __future__ import annotations

import json
import os
import random
import sys
import time
from typing import Any

import numpy as np
import torch

SEED = int(os.getenv("RAG_RANDOM_SEED", "42"))


def configure_determinism() -> None:
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)
    torch.use_deterministic_algorithms(True, warn_only=True)


def resolve_device(
    requested_device: str,
    minimum_free_vram_mb: int | None = None,
) -> str:
    requested = (requested_device or "cpu").strip().lower()
    if requested not in {"cpu", "cuda", "auto"}:
        raise ValueError(f"Dispositivo inválido: {requested_device}")
    if requested == "cpu":
        return "cpu"
    if not torch.cuda.is_available():
        log_runtime("device_fallback", requested=requested, resolved="cpu", reason="CUDA_UNAVAILABLE")
        return "cpu"

    free_bytes, _ = torch.cuda.mem_get_info()
    free_mb = int(free_bytes / (1024 * 1024))
    minimum_mb = minimum_free_vram_mb or 0
    if free_mb < minimum_mb:
        log_runtime(
            "device_fallback",
            requested=requested,
            resolved="cpu",
            reason="INSUFFICIENT_FREE_VRAM",
            freeVramMb=free_mb,
            minimumFreeVramMb=minimum_mb,
        )
        return "cpu"
    return "cuda"


def memory_snapshot(device: str) -> dict[str, Any]:
    snapshot: dict[str, Any] = {"device": device}
    try:
        import resource

        snapshot["ramProcessMaxRssMb"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 2)
    except Exception:
        pass
    if torch.cuda.is_available():
        free_bytes, total_bytes = torch.cuda.mem_get_info()
        snapshot.update(
            {
                "vramFreeMb": round(free_bytes / (1024 * 1024), 2),
                "vramUsedMb": round((total_bytes - free_bytes) / (1024 * 1024), 2),
                "vramTotalMb": round(total_bytes / (1024 * 1024), 2),
            }
        )
    return snapshot


def log_runtime(event: str, **fields: Any) -> None:
    print(
        json.dumps({"event": event, "timestampMs": int(time.time() * 1000), **fields}, ensure_ascii=False),
        file=sys.stderr,
        flush=True,
    )

