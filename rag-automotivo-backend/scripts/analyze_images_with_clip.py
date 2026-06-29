#!/usr/bin/env python3
"""Filtra imagens candidatas com CLIP local."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import torch
from PIL import Image, UnidentifiedImageError
from transformers import CLIPModel, CLIPProcessor


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compara semanticamente uma pergunta com imagens candidatas.",
    )
    parser.add_argument("--question", required=True, help="Pergunta do usuário.")
    parser.add_argument(
        "--candidates-json",
        required=True,
        help="Lista JSON de candidatos com imagePath, page e source.",
    )
    parser.add_argument(
        "--project-root",
        required=True,
        help="Raiz do projeto usada para resolver caminhos relativos.",
    )
    parser.add_argument(
        "--model",
        default="openai/clip-vit-base-patch32",
        help="Modelo CLIP local/Hugging Face cacheado.",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.24,
        help="Score mínimo de similaridade.",
    )
    parser.add_argument("--max-images", type=int, default=5)
    return parser.parse_args()


def resolve_image_path(project_root: Path, image_path: str) -> Path:
    path = Path(image_path)
    if path.is_absolute():
        return path
    return project_root / path


def load_image(path: Path) -> Image.Image | None:
    try:
        return Image.open(path).convert("RGB")
    except (FileNotFoundError, UnidentifiedImageError, OSError) as error:
        print(f"[clip] imagem ignorada {path}: {error}", file=sys.stderr)
        return None


def as_embedding(value: Any) -> torch.Tensor:
    if isinstance(value, torch.Tensor):
        return value

    pooler_output = getattr(value, "pooler_output", None)
    if isinstance(pooler_output, torch.Tensor):
        return pooler_output

    text_embeds = getattr(value, "text_embeds", None)
    if isinstance(text_embeds, torch.Tensor):
        return text_embeds

    image_embeds = getattr(value, "image_embeds", None)
    if isinstance(image_embeds, torch.Tensor):
        return image_embeds

    raise TypeError(f"Saida de embedding CLIP inesperada: {type(value)!r}")


def enrich_question(question: str) -> str:
    normalized = question.lower()
    hints: list[str] = []

    if any(term in normalized for term in ["óleo", "oleo", "oil", "tampa"]):
        hints.append("engine oil filler cap location in engine compartment")
    if any(term in normalized for term in ["fusível", "fusivel", "fuse"]):
        hints.append("vehicle fuse box location diagram")
    if any(term in normalized for term in ["reservatório", "reservatorio", "fluido"]):
        hints.append("vehicle fluid reservoir in engine compartment")
    if any(term in normalized for term in ["macaco", "estepe", "spare tire", "jack"]):
        hints.append("vehicle jack and spare tire storage location")
    if any(term in normalized for term in ["painel", "luz", "ícone", "icone", "símbolo", "simbolo"]):
        hints.append("dashboard warning light icon")

    if not hints:
        return question

    return f"{question}. Visual search hints: {'; '.join(hints)}."


def main() -> None:
    args = parse_args()
    project_root = Path(args.project_root).resolve()
    candidates: list[dict[str, Any]] = json.loads(args.candidates_json)

    unique_candidates: list[dict[str, Any]] = []
    seen_paths: set[str] = set()
    for candidate in candidates:
        image_path = str(candidate.get("imagePath") or "")
        if not image_path or image_path in seen_paths:
            continue
        seen_paths.add(image_path)
        unique_candidates.append(candidate)

    if not unique_candidates:
        print(json.dumps([], ensure_ascii=False))
        return

    requested_device = os.getenv("RAG_CLIP_DEVICE", "cpu").lower()
    device = "cuda" if requested_device == "cuda" and torch.cuda.is_available() else "cpu"
    model = CLIPModel.from_pretrained(args.model).to(device)
    processor = CLIPProcessor.from_pretrained(args.model)
    model.eval()

    text_inputs = processor(
        text=[enrich_question(args.question)],
        return_tensors="pt",
        padding=True,
        truncation=True,
    ).to(device)

    with torch.no_grad():
        text_features = as_embedding(model.get_text_features(**text_inputs))
        text_features = text_features / text_features.norm(dim=-1, keepdim=True)

    scored: list[dict[str, Any]] = []
    for candidate in unique_candidates:
        absolute_path = resolve_image_path(project_root, str(candidate["imagePath"]))
        image = load_image(absolute_path)
        if image is None:
            continue

        image_inputs = processor(images=image, return_tensors="pt").to(device)
        with torch.no_grad():
            image_features = as_embedding(model.get_image_features(**image_inputs))
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)
            score = float((text_features @ image_features.T).item())

        if score < args.threshold:
            continue

        scored.append(
            {
                "imagePath": candidate["imagePath"],
                "score": score,
                "page": candidate.get("page"),
                "source": candidate.get("source"),
                "chunkId": candidate.get("chunkId"),
            },
        )

    scored.sort(key=lambda item: item["score"], reverse=True)
    print(json.dumps(scored[: max(1, args.max_images)], ensure_ascii=False))


if __name__ == "__main__":
    main()
