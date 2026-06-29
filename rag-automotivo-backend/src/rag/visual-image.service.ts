import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { ClipImageResult, RagSource } from './types';

const execFileAsync = promisify(execFile);

type ClipCandidate = {
  imagePath: string;
  page: number;
  source: string;
  chunkId: string;
};

@Injectable()
export class VisualImageService {
  private readonly logger = new Logger(VisualImageService.name);

  private readonly pythonBin =
    process.env.RAG_PYTHON_BIN ?? this.resolveDefaultPython();
  private readonly clipScript = resolve(
    process.env.RAG_CLIP_SCRIPT ??
      join(process.cwd(), 'scripts', 'analyze_images_with_clip.py'),
  );
  private readonly projectRoot = resolve(process.cwd(), '..');
  private readonly clipModel =
    process.env.RAG_CLIP_MODEL ?? 'openai/clip-vit-base-patch32';
  private readonly threshold = Number(process.env.RAG_CLIP_THRESHOLD ?? 0.24);
  private readonly maxImages = Number(process.env.RAG_CLIP_MAX_IMAGES ?? 5);

  async analyzeImagesWithClip(
    question: string,
    sources: RagSource[],
  ): Promise<ClipImageResult[]> {
    const candidates = this.buildCandidates(question, sources);
    if (candidates.length === 0) {
      return [];
    }

    const args = [
      this.clipScript,
      '--question',
      question,
      '--candidates-json',
      JSON.stringify(candidates),
      '--project-root',
      this.projectRoot,
      '--model',
      this.clipModel,
      '--threshold',
      String(this.threshold),
      '--max-images',
      String(this.maxImages),
    ];

    try {
      this.logger.log(
        `Analisando ${candidates.length} imagem(ns) candidata(s) com CLIP.`,
      );
      const { stdout, stderr } = await execFileAsync(this.pythonBin, args, {
        timeout: Number(process.env.RAG_CLIP_TIMEOUT_MS ?? 180000),
        maxBuffer: 1024 * 1024 * 8,
      });

      if (stderr.trim()) {
        this.logger.warn(stderr.trim());
      }

      const parsed = JSON.parse(stdout) as ClipImageResult[];
      return parsed
        .filter((item) => item.score >= this.threshold)
        .sort((left, right) => right.score - left.score)
        .slice(0, this.maxImages);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha ao analisar imagens com CLIP: ${message}`);
      return [];
    }
  }

  filterSourcesByClipResults(
    sources: RagSource[],
    results: ClipImageResult[],
  ): RagSource[] {
    if (results.length === 0) {
      return this.stripImages(sources);
    }

    const approvedByPath = new Map(
      results.map((result) => [result.imagePath, result]),
    );

    return sources.map((source) => {
      const imagePaths = source.image_paths.filter((imagePath) =>
        approvedByPath.has(imagePath),
      );

      return {
        ...source,
        image_paths: imagePaths,
        clip_results: imagePaths.map((imagePath) => approvedByPath.get(imagePath)!),
        metadata: {
          ...source.metadata,
          image_count: imagePaths.length,
        },
      };
    });
  }

  stripImages(sources: RagSource[]): RagSource[] {
    return sources.map((source) => ({
      ...source,
      image_paths: [],
      clip_results: [],
      metadata: {
        ...source.metadata,
        image_count: 0,
      },
    }));
  }

  private resolveDefaultPython(): string {
    const localVenvPython = resolve(
      process.cwd(),
      '..',
      '.venv',
      'bin',
      'python',
    );
    return existsSync(localVenvPython) ? localVenvPython : 'python3';
  }

  private buildCandidates(question: string, sources: RagSource[]): ClipCandidate[] {
    const candidates: ClipCandidate[] = [];
    const seenPaths = new Set<string>();
    const requestedYears = new Set(
      question.match(/\b(?:19|20)\d{2}\b/g) ?? [],
    );

    for (const source of sources) {
      if (
        requestedYears.size > 0 &&
        source.metadata.vehicle_year &&
        !requestedYears.has(String(source.metadata.vehicle_year))
      ) {
        continue;
      }

      for (const imagePath of source.image_paths) {
        if (seenPaths.has(imagePath)) {
          continue;
        }

        seenPaths.add(imagePath);
        candidates.push({
          imagePath,
          page: source.page_start,
          source: source.document_name,
          chunkId: source.chunk_id,
        });
      }
    }

    return candidates;
  }
}
