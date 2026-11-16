import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';

import { AsyncSemaphore } from './async-semaphore';
import type {
  RagRetrievalFilters,
  RagRetrievalResult,
  RagSource,
} from './types';

const execFileAsync = promisify(execFile);

@Injectable()
export class RagRetrieverService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RagRetrieverService.name);
  private readonly resultCache = new Map<
    string,
    { expiresAt: number; sources: RagSource[] }
  >();
  private readonly inFlight = new Map<string, Promise<RagSource[]>>();
  private readonly cacheTtlMs = Number(
    process.env.RAG_RETRIEVAL_CACHE_TTL_MS ?? 10 * 60 * 1000,
  );
  private readonly cacheMaxEntries = Number(
    process.env.RAG_RETRIEVAL_CACHE_MAX_ENTRIES ?? 64,
  );

  private readonly pythonBin =
    process.env.RAG_PYTHON_BIN ?? this.resolveDefaultPython();
  private readonly retrieverScript = resolve(
    process.env.RAG_RETRIEVER_SCRIPT ??
      join(process.cwd(), 'scripts', 'retrieve_chunks.py'),
  );
  private readonly workerScript = resolve(
    process.env.RAG_RETRIEVER_WORKER_SCRIPT ??
      join(process.cwd(), 'scripts', 'retrieve_worker.py'),
  );
  private readonly persistentWorkerEnabled =
    process.env.RAG_PERSISTENT_RETRIEVER_ENABLED !== 'false';
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
  private readonly bm25TopK = Number(process.env.RAG_BM25_TOP_K ?? 40);
  private readonly rerankerModel = process.env.RAG_RERANKER_MODEL ?? '';
  private readonly rerankerTopK = Number(process.env.RAG_RERANKER_TOP_K ?? 40);
  private readonly embeddingDevice = process.env.RAG_EMBEDDING_DEVICE ?? 'cpu';
  private readonly rerankerDevice = process.env.RAG_RERANKER_DEVICE ?? 'cpu';
  private readonly semaphore = new AsyncSemaphore(
    Number(process.env.RAG_MAX_CONCURRENT_RETRIEVALS ?? 1),
  );
  private worker?: ChildProcessWithoutNullStreams;
  private workerReady?: Promise<void>;
  private readonly workerPending = new Map<
    string,
    {
      resolve: (result: RagRetrievalResult) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  onModuleInit(): void {
    const indexPath = join(this.outputDir, 'manual_chunks.faiss');
    const metadataPath = join(this.outputDir, 'chunks_metadata.json');
    const ready = existsSync(indexPath) && existsSync(metadataPath);
    this.logger.log(
      JSON.stringify({
        event: 'rag_retrieval_health',
        ready,
        indexPath,
        metadataPath,
        embeddingModel: this.embeddingModel,
        embeddingDevice: this.embeddingDevice,
        rerankerDevice: this.rerankerDevice,
        persistentWorkerEnabled: this.persistentWorkerEnabled,
      }),
    );
  }

  onModuleDestroy(): void {
    this.stopWorker(new Error('Retriever encerrado pela aplicacao.'));
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

  async retrieve(
    query: string,
    filters: RagRetrievalFilters = {},
  ): Promise<RagSource[]> {
    const cacheKey = this.buildCacheKey(query, filters);
    const cached = this.resultCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.log(
        JSON.stringify({
          event: 'rag_retrieval_cache_hit',
          query,
          filters,
          resultCount: cached.sources.length,
        }),
      );
      return this.cloneSources(cached.sources);
    }
    if (cached) this.resultCache.delete(cacheKey);

    const existing = this.inFlight.get(cacheKey);
    if (existing) return this.cloneSources(await existing);

    const retrieval = this.semaphore.run(() =>
      this.executeRetrieval(query, filters),
    );
    this.inFlight.set(cacheKey, retrieval);
    try {
      const sources = await retrieval;
      this.storeCache(cacheKey, sources);
      return this.cloneSources(sources);
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  private buildCacheKey(
    query: string,
    filters: RagRetrievalFilters,
  ): string {
    return JSON.stringify({
      query: query.trim().toLocaleLowerCase('pt-BR'),
      filters: Object.fromEntries(
        Object.entries(filters)
          .filter(([, value]) => Boolean(value))
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    });
  }

  private storeCache(cacheKey: string, sources: RagSource[]): void {
    if (this.cacheTtlMs <= 0 || this.cacheMaxEntries <= 0) return;
    while (this.resultCache.size >= this.cacheMaxEntries) {
      const oldest = this.resultCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.resultCache.delete(oldest);
    }
    this.resultCache.set(cacheKey, {
      expiresAt: Date.now() + this.cacheTtlMs,
      sources: this.cloneSources(sources),
    });
  }

  private cloneSources(sources: RagSource[]): RagSource[] {
    return structuredClone(sources);
  }

  private async executeRetrieval(
    query: string,
    filters: RagRetrievalFilters,
  ): Promise<RagSource[]> {
    const startedAt = Date.now();
    const args = this.buildRetrieverArgs(query, filters);

    try {
      const parsed = this.persistentWorkerEnabled
        ? await this.executeWithWorker(query, filters)
        : await this.executeWithProcess(args);
      this.logger.log(
        JSON.stringify({
          event: 'rag_retrieval_result',
          query,
          status: parsed.status ?? 'SUCCESS_WITH_EVIDENCE',
          warnings: parsed.warnings ?? [],
          diagnostics: parsed.diagnostics ?? {},
          resultCount: parsed.results?.length ?? 0,
          durationMs: Date.now() - startedAt,
        }),
      );
      return this.rerankAndLimit(parsed.results ?? [], query);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = this.classifyFailure(message);
      this.logger.error(
        JSON.stringify({
          event: 'rag_retrieval_failure',
          query,
          code,
          retryable: !['INDEX_UNAVAILABLE', 'EMBEDDING_FAILURE'].includes(code),
          durationMs: Date.now() - startedAt,
          detail: message.slice(0, 2000),
        }),
      );
      throw new RagRetrievalError(code, message);
    }
  }

  private async executeWithProcess(args: string[]): Promise<RagRetrievalResult> {
    const { stdout, stderr } = await execFileAsync(this.pythonBin, args, {
      timeout: Number(process.env.RAG_RETRIEVER_TIMEOUT_MS ?? 120000),
      maxBuffer: 1024 * 1024 * 8,
    });
    if (stderr.trim()) this.logger.warn(stderr.trim());
    return JSON.parse(stdout) as RagRetrievalResult;
  }

  private async executeWithWorker(
    query: string,
    filters: RagRetrievalFilters,
  ): Promise<RagRetrievalResult> {
    try {
      await this.ensureWorker();
      const worker = this.worker;
      if (!worker || worker.killed || !worker.stdin.writable) {
        throw new Error('Persistent retriever worker unavailable.');
      }

      const id = randomUUID();
      const timeoutMs = Number(
        process.env.RAG_RETRIEVER_TIMEOUT_MS ?? 120000,
      );
      const result = new Promise<RagRetrievalResult>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.workerPending.delete(id);
          reject(new Error(`Persistent retriever timeout after ${timeoutMs}ms.`));
        }, timeoutMs);
        this.workerPending.set(id, { resolve, reject, timeout });
      });
      worker.stdin.write(
        `${JSON.stringify({
          id,
          query,
          filters,
          topK: this.candidateK,
          lexicalSupplements: this.lexicalSupplements,
          bm25TopK: this.bm25TopK,
          rerankerModel: this.rerankerModel.trim(),
          rerankerTopK: this.rerankerTopK,
        })}\n`,
      );
      return await result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Worker persistente indisponivel; usando processo isolado: ${message}`,
      );
      const fallbackArgs = this.buildRetrieverArgs(query, filters);
      return this.executeWithProcess(fallbackArgs);
    }
  }

  private buildRetrieverArgs(
    query: string,
    filters: RagRetrievalFilters,
  ): string[] {
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
      '--bm25-top-k',
      String(this.bm25TopK),
      '--reranker-top-k',
      String(this.rerankerTopK),
      '--embedding-device',
      this.embeddingDevice,
      '--reranker-device',
      this.rerankerDevice,
      '--minimum-free-vram-mb',
      String(process.env.RAG_MINIMUM_FREE_VRAM_MB ?? 2048),
    ];
    for (const [name, value] of Object.entries(filters)) {
      if (value) args.push(`--vehicle-${name}`, String(value));
    }
    if (this.rerankerModel.trim()) {
      args.push('--reranker-model', this.rerankerModel.trim());
    }
    return args;
  }

  private ensureWorker(): Promise<void> {
    if (this.workerReady) return this.workerReady;
    this.workerReady = new Promise<void>((resolveReady, rejectReady) => {
      const worker = spawn(
        this.pythonBin,
        [
          this.workerScript,
          '--output-dir',
          this.outputDir,
          '--model',
          this.embeddingModel,
          '--embedding-device',
          this.embeddingDevice,
          '--reranker-device',
          this.rerankerDevice,
          '--minimum-free-vram-mb',
          String(process.env.RAG_MINIMUM_FREE_VRAM_MB ?? 2048),
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      this.worker = worker;
      let ready = false;
      const startupTimeout = setTimeout(() => {
        if (!ready) rejectReady(new Error('Persistent retriever startup timeout.'));
      }, Number(process.env.RAG_RETRIEVER_STARTUP_TIMEOUT_MS ?? 120000));
      const lines = createInterface({ input: worker.stdout });
      lines.on('line', (line) => {
        try {
          const payload = JSON.parse(line) as {
            event?: string;
            id?: string;
            result?: RagRetrievalResult;
            error?: { message?: string };
          };
          if (payload.event === 'ready') {
            ready = true;
            clearTimeout(startupTimeout);
            resolveReady();
            return;
          }
          if (!payload.id) return;
          const pending = this.workerPending.get(payload.id);
          if (!pending) return;
          clearTimeout(pending.timeout);
          this.workerPending.delete(payload.id);
          if (payload.result) pending.resolve(payload.result);
          else pending.reject(new Error(payload.error?.message ?? 'Retriever worker failure.'));
        } catch (error) {
          this.logger.warn(`Saida invalida do worker de retrieval: ${String(error)}`);
        }
      });
      worker.stderr.on('data', (chunk: Buffer) => {
        const message = chunk.toString().trim();
        if (message) this.logger.debug(message.slice(0, 2000));
      });
      worker.once('error', (error) => {
        clearTimeout(startupTimeout);
        if (!ready) rejectReady(error);
        this.stopWorker(error);
      });
      worker.once('exit', (code, signal) => {
        clearTimeout(startupTimeout);
        const error = new Error(
          `Persistent retriever exited (code=${String(code)}, signal=${String(signal)}).`,
        );
        if (!ready) rejectReady(error);
        this.stopWorker(error);
      });
    }).catch((error) => {
      this.workerReady = undefined;
      throw error;
    });
    return this.workerReady;
  }

  private stopWorker(error: Error): void {
    const worker = this.worker;
    this.worker = undefined;
    this.workerReady = undefined;
    if (worker && !worker.killed) worker.kill();
    for (const [id, pending] of this.workerPending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.workerPending.delete(id);
    }
  }

  private classifyFailure(message: string): RetrievalFailureCode {
    const normalized = message.toLowerCase();
    if (normalized.includes('out of memory')) return 'RESOURCE_EXHAUSTED';
    if (normalized.includes('timed out') || normalized.includes('timeout'))
      return 'TIMEOUT';
    if (
      normalized.includes('faiss não encontrado') ||
      normalized.includes('chunks não encontrados') ||
      normalized.includes('index_metadata_count_mismatch')
    )
      return 'INDEX_UNAVAILABLE';
    if (
      normalized.includes('sentence') ||
      normalized.includes('embedding_dimension_mismatch')
    )
      return 'EMBEDDING_FAILURE';
    return 'INTERNAL_ERROR';
  }

  private rerankAndLimit(results: RagSource[], query: string): RagSource[] {
    const seen = new Set<string>();
    const ranked = results
      .map((source, index) => ({
        source: {
          ...source,
          score: Math.max(
            0,
            Math.min(1, source.score + this.relevanceBonus(source, query)),
          ),
          retrieval_scores: {
            ...source.retrieval_scores,
            final: Math.max(
              0,
              Math.min(1, source.score + this.relevanceBonus(source, query)),
            ),
          },
        },
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
      });
    const primary = ranked.slice(0, this.topK).map(({ source }) => source);
    const neighbors = this.procedureNeighbors(
      results,
      primary,
      query,
      Math.min(2, Math.max(0, this.topK - 1)),
    );
    if (neighbors.length === 0) return primary;

    const neighborIds = new Set(neighbors.map((source) => source.chunk_id));
    return [
      ...primary.slice(0, Math.max(1, this.topK - neighbors.length)),
      ...neighbors,
      ...primary.filter((source) => !neighborIds.has(source.chunk_id)),
    ]
      .filter(
        (source, index, items) =>
          items.findIndex((item) => item.chunk_id === source.chunk_id) === index,
      )
      .slice(0, this.topK);
  }

  /**
   * Recupera continuações estruturais de procedimentos quebrados pelo OCR.
   * O vizinho só é promovido quando existe um trecho-semente explícito e ele
   * pertence ao mesmo documento/página, evitando expansão global por posição.
   */
  private procedureNeighbors(
    candidates: RagSource[],
    primary: RagSource[],
    query: string,
    limit: number,
  ): RagSource[] {
    if (limit <= 0 || !/\b(como|manual|emerg[eê]ncia|abrir|destravar|configurar|trocar|how|open|release)\b/i.test(query)) {
      return [];
    }
    const exactSeed = primary.find((source) => {
      const evidence = `${source.section_title ?? ''}\n${source.text}`;
      return /\b(fuel filler door emergency release|opening the hood|storing tire pressures?)\b/i.test(
        evidence,
      );
    });
    const seed =
      exactSeed ??
      primary.find((source) => {
        const evidence = `${source.section_title ?? ''}\n${source.text}`;
        return /\b(emergency release|fuel(?:\s+filler)? door.{0,30}(?:manual|faulty))\b/i.test(
          evidence,
        );
      });
    const seedVector = seed?.metadata?.faiss_vector_id;
    if (!seed || typeof seedVector !== 'number') return [];
    const seedStart = seed.page_start ?? seed.page_end;
    const seedEnd = seed.page_end ?? seed.page_start;
    if (typeof seedStart !== 'number' || typeof seedEnd !== 'number') return [];

    const primaryIds = new Set(primary.map((source) => source.chunk_id));
    return candidates
      .filter((source) => {
        const vectorId = source.metadata?.faiss_vector_id;
        const pageStart = source.page_start ?? source.page_end;
        const pageEnd = source.page_end ?? source.page_start;
        return (
          !primaryIds.has(source.chunk_id) &&
          source.document_name === seed.document_name &&
          typeof vectorId === 'number' &&
          Math.abs(vectorId - seedVector) <= 6 &&
          typeof pageStart === 'number' &&
          typeof pageEnd === 'number' &&
          pageEnd >= seedStart - 1 &&
          pageStart <= seedEnd + 1
        );
      })
      .map((source) => {
        const actionCount = (
          source.text.match(
            /\b(remove|pull|press|loosen|turn|lift|open|release|screwdriver|alavanca|puxe|pressione|remova|solte|abra)\b/gi,
          ) ?? []
        ).length;
        return { source, actionCount };
      })
      .filter(({ actionCount }) => actionCount >= 2)
      .sort(
        (left, right) =>
          right.actionCount - left.actionCount ||
          Math.abs(
            (left.source.metadata?.faiss_vector_id ?? seedVector) - seedVector,
          ) -
            Math.abs(
              (right.source.metadata?.faiss_vector_id ?? seedVector) - seedVector,
            ),
      )
      .slice(0, limit)
      .map(({ source }) => ({
        ...source,
        retrieval_scores: {
          ...source.retrieval_scores,
          structural_neighbor: 1,
        },
      }));
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
    const isOilPressureQuery =
      /press[aã]o.{0,25}(?:[oó]leo|oil)|(?:[oó]leo|oil).{0,25}press[aã]o/i.test(
        normalizedQuery,
      );
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
    const hasOilLocationEvidence = [
      'oil filler cap',
      'engine oil filler cap',
      'oil filler neck',
      'engine oil filler',
      'fluid containers',
    ].some((term) => text.includes(term));

    let bonus = 0;

    const matchesRequestedYear = years.some((year) =>
      documentName.includes(year),
    );

    if (matchesRequestedYear) {
      bonus += 0.08;
    } else if (years.length > 0) {
      bonus -= 0.2;
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
        const yearAwareImageBonus =
          years.length > 0 && !matchesRequestedYear
            ? 0.04
            : isOilLocationQuery
              ? hasOilLocationEvidence
                ? 0.18
                : -0.22
              : 0.22;
        bonus += yearAwareImageBonus;
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
        if (!hasOilLocationEvidence) {
          bonus -= 0.24;
        }
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

    if (isOilQuery && !isOilPressureQuery && !isOilLocationQuery) {
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

export type RetrievalFailureCode =
  | 'INDEX_UNAVAILABLE'
  | 'EMBEDDING_FAILURE'
  | 'TIMEOUT'
  | 'RESOURCE_EXHAUSTED'
  | 'INTERNAL_ERROR';

export class RagRetrievalError extends Error {
  constructor(
    readonly code: RetrievalFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'RagRetrievalError';
  }
}
