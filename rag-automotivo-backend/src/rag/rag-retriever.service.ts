import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';

import type { RagRetrievalResult, RagSource } from './types';

const execFileAsync = promisify(execFile);

@Injectable()
export class RagRetrieverService {
  private readonly logger = new Logger(RagRetrieverService.name);

  private readonly pythonBin =
    process.env.RAG_PYTHON_BIN ?? this.resolveDefaultPython();
  private readonly retrieverScript = resolve(
    process.env.RAG_RETRIEVER_SCRIPT ??
      join(process.cwd(), 'scripts', 'retrieve_chunks.py'),
  );
  private readonly outputDir = resolve(
    process.env.RAG_OUTPUT_DIR ??
      join(process.cwd(), '..', 'rag_chunks_output'),
  );
  private readonly embeddingModel =
    process.env.RAG_EMBEDDING_MODEL ??
    'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';
  private readonly topK = Number(process.env.RAG_TOP_K ?? 8);
  private readonly candidateK = Number(
    process.env.RAG_CANDIDATE_K ?? Math.max(this.topK * 3, 20),
  );
  private readonly lexicalSupplements = Number(
    process.env.RAG_LEXICAL_SUPPLEMENTS ?? 3,
  );

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

  async retrieve(query: string): Promise<RagSource[]> {
    const args = [
      this.retrieverScript,
      '--query',
      query,
      '--output-dir',
      this.outputDir,
      '--model',
      this.embeddingModel,
      '--top-k',
      String(this.candidateK),
      '--lexical-supplements',
      String(this.lexicalSupplements),
    ];

    try {
      const { stdout, stderr } = await execFileAsync(this.pythonBin, args, {
        timeout: Number(process.env.RAG_RETRIEVER_TIMEOUT_MS ?? 120000),
        maxBuffer: 1024 * 1024 * 8,
      });

      if (stderr.trim()) {
        this.logger.warn(stderr.trim());
      }

      const parsed = JSON.parse(stdout) as RagRetrievalResult;
      return this.rerankAndLimit(parsed.results ?? [], query);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha ao recuperar chunks: ${message}`);
      throw error;
    }
  }

  private rerankAndLimit(results: RagSource[], query: string): RagSource[] {
    const seen = new Set<string>();

    return results
      .map((source, index) => ({
        source,
        index,
        score: source.score + this.relevanceBonus(source, query),
      }))
      .sort(
        (left, right) => right.score - left.score || left.index - right.index,
      )
      .filter(({ source }) => {
        if (seen.has(source.chunk_id)) {
          return false;
        }
        seen.add(source.chunk_id);
        return true;
      })
      .slice(0, this.topK)
      .map(({ source }) => source);
  }

  private relevanceBonus(source: RagSource, query: string): number {
    const normalizedQuery = query.toLowerCase();
    const documentName = source.document_name.toLowerCase();
    const text = source.text.toLowerCase();
    const years = normalizedQuery.match(/\b(?:19|20)\d{2}\b/g) ?? [];
    const isWheelSizeQuery = [
      'aro',
      'rim size',
      'rim diameter',
      'wheel size',
      'tamanho da roda',
      'tamanho do aro',
      'diametro do aro',
      'diâmetro do aro',
    ].some((term) => normalizedQuery.includes(term));
    const isVisualQuery = [
      'imagem',
      'imagens',
      'diagrama',
      'diagramas',
      'figura',
      'foto',
      'onde fica',
      'onde esta',
      'onde está',
      'localizado',
      'localizada',
      'localizacao',
      'localização',
      'mostrar',
      'mostre',
      'identificar',
      'como trocar',
      'como verificar',
      'como acessar',
    ].some((term) => normalizedQuery.includes(term));
    const isOilQuery = [
      'oleo',
      'óleo',
      'engine oil',
      'oil standard',
      'viscosidade',
      'viscosity',
    ].some((term) => normalizedQuery.includes(term));
    const isOilLocationQuery =
      isVisualQuery &&
      [
        'oleo',
        'óleo',
        'oil',
        'reservatorio',
        'reservatório',
        'tampa',
        'filler',
      ].some((term) => normalizedQuery.includes(term));

    let bonus = 0;

    const matchesRequestedYear = years.some((year) =>
      documentName.includes(year),
    );

    if (matchesRequestedYear) {
      bonus += 0.08;
    }

    if (isWheelSizeQuery) {
      if (
        text.includes('rim size') &&
        (text.includes('tyre size') || text.includes('tire size'))
      ) {
        bonus += 0.12;
      }
      if (text.includes('rim diameter code')) {
        bonus += 0.06;
      }
      if (/\b\d{1,2}j\s*x\s*\d{2}\b/.test(text)) {
        bonus += 0.08;
      }
      if (/\b\d{3}\s*\/\s*\d{2}\s*r\s*\d{2}\b/.test(text)) {
        bonus += 0.05;
      }
    }

    if (isVisualQuery) {
      if ((source.image_paths?.length ?? 0) > 0) {
        bonus += isOilLocationQuery ? 0.42 : 0.22;
      }
      if (
        text.includes('fig.') ||
        text.includes('fig ') ||
        text.includes('engine compartment') ||
        text.includes('oil filler') ||
        text.includes('typical locations')
      ) {
        bonus += 0.12;
      }
      if (isOilLocationQuery) {
        if (matchesRequestedYear) {
          bonus += 0.17;
        }
        if (text.includes('oil filler cap location')) {
          bonus += 0.3;
        }
        if (
          text.includes('typical layout') &&
          (text.includes('oil filler cap') ||
            text.includes('engine oil filler cap'))
        ) {
          bonus += 0.22;
        }
        if (
          text.includes('typical locations of fluid containers') ||
          (text.includes('engine compartment') &&
            (text.includes('oil filler cap') ||
              text.includes('oil filler neck')))
        ) {
          bonus += 0.2;
        }
        if (
          text.includes('vw 502 00') ||
          text.includes('viscosity') ||
          text.includes('oil level indicator')
        ) {
          bonus -= 0.16;
        }
      }
    }

    if (isOilQuery && !isOilLocationQuery) {
      if (
        text.includes('vw 502 00') ||
        text.includes('audi oil standard') ||
        text.includes('oil standard vw')
      ) {
        bonus += 0.14;
      }
      if (text.includes('viscosity') || text.includes('viscosidade')) {
        bonus += 0.12;
      }
      if (/\b(?:sae\s*)?[05sow]{1,2}w[-\s]?\d{2}\b/i.test(text)) {
        bonus += 0.12;
      }
      if (
        text.includes('index') &&
        !text.includes('vw 502 00') &&
        !text.includes('viscosity')
      ) {
        bonus -= 0.08;
      }
    }

    return bonus;
  }
}
