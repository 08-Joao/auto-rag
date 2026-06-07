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

  private readonly pythonBin = process.env.RAG_PYTHON_BIN ?? this.resolveDefaultPython();
  private readonly retrieverScript = resolve(
    process.env.RAG_RETRIEVER_SCRIPT ?? join(process.cwd(), 'scripts', 'retrieve_chunks.py'),
  );
  private readonly outputDir = resolve(
    process.env.RAG_OUTPUT_DIR ?? join(process.cwd(), '..', 'rag_chunks_output'),
  );
  private readonly embeddingModel =
    process.env.RAG_EMBEDDING_MODEL ??
    'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';
  private readonly topK = Number(process.env.RAG_TOP_K ?? 5);

  private resolveDefaultPython(): string {
    const localVenvPython = resolve(process.cwd(), '..', '.venv', 'bin', 'python');
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
      String(this.topK),
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
      return parsed.results ?? [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha ao recuperar chunks: ${message}`);
      throw error;
    }
  }
}
