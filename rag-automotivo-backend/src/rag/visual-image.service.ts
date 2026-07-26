import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import type {
  ClipImageResult,
  ImageRerankCandidate,
  ImageRerankResult,
  RagConversationVehicle,
  RagSource,
} from './types';

const execFileAsync = promisify(execFile);

type ClipCandidate = {
  imagePath: string;
  page: number;
  source: string;
  chunkId: string;
};

type ImageRerankInput = {
  resolvedQuery: string;
  intent: string;
  component?: string;
  vehicle?: RagConversationVehicle;
  sources: RagSource[];
  clipResults: ClipImageResult[];
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
        clip_results: imagePaths.map(
          (imagePath) => approvedByPath.get(imagePath)!,
        ),
        metadata: {
          ...source.metadata,
          image_count: imagePaths.length,
        },
      };
    });
  }

  rerankImages(input: ImageRerankInput): ImageRerankResult {
    const clipByPath = new Map(
      input.clipResults.map((result) => [result.imagePath, result]),
    );
    const candidates = this.buildRerankCandidates(input, clipByPath);
    const selectedImages = candidates
      .filter((candidate) => candidate.isRelevant)
      .sort(
        (left, right) =>
          right.textScore + right.clipScore - (left.textScore + left.clipScore),
      )
      .slice(0, this.maxImages)
      .map((candidate) => ({
        imagePath: candidate.imagePath,
        score: candidate.clipScore,
        page: candidate.page,
        source: candidate.source,
        chunkId: candidate.chunkId,
        caption: candidate.caption,
        ocrText: candidate.ocrText,
        textScore: candidate.textScore,
        isRelevant: true,
        reason: this.buildImageSelectionReason(candidate, input.component),
        confidence: Number(
          Math.max(
            0,
            Math.min(
              0.99,
              0.55 * candidate.clipScore + 0.45 * candidate.textScore,
            ),
          ).toFixed(2),
        ),
      }));

    const selectedPaths = new Set(
      selectedImages.map((image) => image.imagePath),
    );
    const rejectedImages = candidates
      .filter((candidate) => !selectedPaths.has(candidate.imagePath))
      .map((candidate) => ({
        imageId: candidate.imageId,
        imagePath: candidate.imagePath,
        page: candidate.page,
        reason:
          candidate.rejectionReason ||
          'Imagem abaixo do limiar final de relevancia.',
      }));

    this.logger.debug(
      JSON.stringify({
        resolvedQuery: input.resolvedQuery,
        intent: input.intent,
        component: input.component ?? '',
        selectedImages: selectedImages.map((image) => ({
          imagePath: image.imagePath,
          page: image.page,
          confidence: image.confidence,
          reason: image.reason,
        })),
        rejectedImages,
      }),
    );

    return { selectedImages, rejectedImages, candidates };
  }

  filterSourcesByRerankResult(
    sources: RagSource[],
    rerank: ImageRerankResult,
  ): RagSource[] {
    if (rerank.selectedImages.length === 0) {
      return this.stripImages(sources);
    }

    const approvedByPath = new Map(
      rerank.selectedImages.map((result) => [result.imagePath, result]),
    );

    return sources.map((source) => {
      const imagePaths = source.image_paths.filter((imagePath) =>
        approvedByPath.has(imagePath),
      );

      return {
        ...source,
        image_paths: imagePaths,
        clip_results: imagePaths.map(
          (imagePath) => approvedByPath.get(imagePath)!,
        ),
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

  private buildCandidates(
    question: string,
    sources: RagSource[],
  ): ClipCandidate[] {
    const candidates: ClipCandidate[] = [];
    const seenPaths = new Set<string>();
    const requestedYears = new Set(question.match(/\b(?:19|20)\d{2}\b/g) ?? []);

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

  private buildRerankCandidates(
    input: ImageRerankInput,
    clipByPath: Map<string, ClipImageResult>,
  ): ImageRerankCandidate[] {
    const candidates: ImageRerankCandidate[] = [];
    const seen = new Set<string>();
    const queryTerms = this.extractQueryTerms(
      input.resolvedQuery,
      input.component,
    );

    for (const source of input.sources) {
      for (const imagePath of source.image_paths) {
        if (seen.has(imagePath)) {
          continue;
        }
        seen.add(imagePath);

        const clip = clipByPath.get(imagePath);
        const caption = this.extractCaption(source.text, imagePath);
        const ocrText = this.normalizeText(
          [
            source.section_title ?? '',
            source.metadata.entities?.join(' ') ?? '',
            caption,
            this.truncate(source.text, 1400),
          ].join(' '),
        );
        const textScore = this.scoreTextEvidence(ocrText, queryTerms);
        const validation = this.validateImage({
          imagePath,
          source,
          caption,
          ocrText,
          clipScore: clip?.score ?? 0,
          positiveScore: clip?.positiveScore,
          negativeScore: clip?.negativeScore,
          negativeLabel: clip?.negativeLabel,
          textScore,
          queryTerms,
          component: input.component,
        });

        candidates.push({
          imageId: imagePath,
          imagePath,
          page: clip?.page ?? source.page_start,
          caption,
          ocrText,
          clipScore: clip?.score ?? 0,
          textScore,
          isRelevant: validation.isRelevant,
          rejectionReason: validation.rejectionReason,
          source: clip?.source ?? source.document_name,
          chunkId: clip?.chunkId ?? source.chunk_id,
        });
      }
    }

    return candidates;
  }

  private validateImage(input: {
    imagePath: string;
    source: RagSource;
    caption: string;
    ocrText: string;
    clipScore: number;
    positiveScore?: number;
    negativeScore?: number;
    negativeLabel?: string;
    textScore: number;
    queryTerms: Set<string>;
    component?: string;
  }): { isRelevant: boolean; rejectionReason: string } {
    const lowerPath = input.imagePath.toLowerCase();
    const text = input.ocrText;
    const component = this.normalizeText(input.component ?? '');

    if (!this.isReadableImage(input.imagePath)) {
      return {
        isRelevant: false,
        rejectionReason: 'Imagem vazia, quebrada ou inacessivel.',
      };
    }

    if (
      /\b(capa|cover|owner'?s manual|manual do proprietario|manual proprietor)\b/i.test(
        `${lowerPath} ${text}`,
      ) &&
      !/(engine|motor|oil|oleo|óleo|filler|cap|tampa|compartment)/i.test(text)
    ) {
      return {
        isRelevant: false,
        rejectionReason:
          'Imagem e capa do manual ou pagina inicial sem relacao com a peca.',
      };
    }

    if (
      /\b(audi a4|owner'?s manual|manual)\b/i.test(text) &&
      !/(engine compartment|compartimento|oil filler|engine oil filler|tampa|oleo|óleo|bocal|cap)/i.test(
        text,
      )
    ) {
      return {
        isRelevant: false,
        rejectionReason:
          'Imagem parece ser generica do veiculo/manual, sem evidência da tampa de oleo.',
      };
    }

    if (input.clipScore < this.threshold) {
      return {
        isRelevant: false,
        rejectionReason: `CLIP abaixo do limiar (${input.clipScore.toFixed(2)} < ${this.threshold}).`,
      };
    }

    if (
      component.includes('tampa') &&
      component.includes('oleo') &&
      this.isHoodOpeningVisual(input.negativeLabel ?? '', text) &&
      (input.negativeScore ?? 0) >
        (input.positiveScore ?? input.clipScore) + 0.015
    ) {
      return {
        isRelevant: false,
        rejectionReason:
          'CLIP identificou a imagem como alavanca/trava de abertura do capo, nao como tampa de oleo.',
      };
    }

    if (input.textScore < 0.42) {
      return {
        isRelevant: false,
        rejectionReason:
          'Sem OCR, legenda ou contexto textual suficiente relacionado a tampa/bocal de oleo.',
      };
    }

    const hasComponentEvidence = [...input.queryTerms].some((term) =>
      text.includes(term),
    );
    const hasEngineContext =
      /(engine compartment|compartimento do motor|motor|filler cap|oil filler|tampa|bocal)/i.test(
        text,
      );

    if (!hasComponentEvidence || !hasEngineContext) {
      return {
        isRelevant: false,
        rejectionReason:
          'Nao ha evidencia textual e visual conjunta da peca perguntada.',
      };
    }

    return { isRelevant: true, rejectionReason: '' };
  }

  private isHoodOpeningVisual(negativeLabel: string, text: string): boolean {
    const combined = this.normalizeText(`${negativeLabel} ${text}`);
    return [
      'hood release',
      'bonnet release',
      'release lever',
      'hood latch',
      'bonnet latch',
      'opening the car hood',
      'opening the car bonnet',
      'alavanca do capo',
      'abrir o capo',
      'trava do capo',
    ].some((term) => combined.includes(this.normalizeText(term)));
  }

  private isReadableImage(imagePath: string): boolean {
    const absolute = resolve(this.projectRoot, imagePath);
    try {
      const stat = statSync(absolute);
      return stat.isFile() && stat.size >= 1024;
    } catch {
      return false;
    }
  }

  private extractCaption(text: string, imagePath: string): string {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const figureIndex = lines.findIndex((line) =>
      /\b(fig\.?|figure)\s*\d+/i.test(line),
    );
    if (figureIndex >= 0) {
      return this.truncate(
        lines.slice(figureIndex, figureIndex + 6).join(' '),
        500,
      );
    }

    const fileHint = imagePath.split('/').pop() ?? imagePath;
    return this.truncate([fileHint, ...lines.slice(0, 4)].join(' '), 500);
  }

  private scoreTextEvidence(text: string, queryTerms: Set<string>): number {
    if (!text) {
      return 0;
    }

    const matches = [...queryTerms].filter((term) =>
      text.includes(term),
    ).length;
    const componentScore = Math.min(0.55, matches * 0.14);
    const figureScore = /\b(fig|figure|diagrama|layout|typical layout)\b/i.test(
      text,
    )
      ? 0.12
      : 0;
    const engineScore =
      /(engine compartment|compartimento do motor|motor|engine oil|oleo do motor|óleo do motor)/i.test(
        text,
      )
        ? 0.16
        : 0;
    const labelScore =
      /(item|@|\(d\)|\(3\)|\b3\b|seta|identifica|filler cap|tampa|bocal)/i.test(
        text,
      )
        ? 0.12
        : 0;
    const negative =
      /\b(cover|owner'?s manual|manual)\b/i.test(text) &&
      !/(engine|oil|filler|cap|motor|oleo|óleo|tampa|bocal)/i.test(text)
        ? 0.4
        : 0;

    return Number(
      Math.max(
        0,
        Math.min(
          1,
          componentScore + figureScore + engineScore + labelScore - negative,
        ),
      ).toFixed(2),
    );
  }

  private extractQueryTerms(query: string, component?: string): Set<string> {
    const text = this.normalizeText(`${query} ${component ?? ''}`);
    const terms = new Set<string>();
    const addTerms = (values: string[]) => {
      for (const value of values) {
        terms.add(this.normalizeText(value));
      }
    };

    if (/tampa|oleo|óleo|oil|filler/.test(text)) {
      addTerms([
        'tampa de oleo',
        'tampa do oleo',
        'bocal de abastecimento',
        'oil filler cap',
        'engine oil filler cap',
        'engine oil filler',
        'filler cap',
        'engine oil',
        'oleo do motor',
        'compartimento do motor',
        'engine compartment',
      ]);
    }

    if (/reservatorio|reservatório|reservoir|fluido|fluid/.test(text)) {
      addTerms([
        'reservatorio',
        'reservoir',
        'fluid reservoir',
        'fluid container',
        'fluid containers',
        'coolant expansion tank',
        'brake fluid reservoir',
        'washer container',
        'compartimento do motor',
        'engine compartment',
      ]);
    }

    if (/fusivel|fusível|fuse/.test(text)) {
      addTerms([
        'fusivel',
        'fuse',
        'fuse box',
        'fuse panel',
        'fuses',
        'caixa de fusiveis',
        'painel de fusiveis',
      ]);
    }

    if (/bateria|battery/.test(text)) {
      addTerms([
        'bateria',
        'battery',
        'battery compartment',
        'jump start',
        'positive terminal',
        'negative terminal',
      ]);
    }

    if (/painel|luz|icone|ícone|simbolo|símbolo|dashboard|warning/.test(text)) {
      addTerms([
        'painel',
        'dashboard',
        'instrument cluster',
        'warning lamp',
        'indicator lamp',
        'symbol',
        'simbolo',
      ]);
    }

    for (const token of text.split(/\s+/)) {
      if (
        [
          'tampa',
          'oleo',
          'óleo',
          'oil',
          'filler',
          'cap',
          'motor',
          'reservatorio',
          'reservatório',
          'reservoir',
          'fuse',
          'fusivel',
          'fusível',
          'battery',
          'bateria',
          'painel',
          'dashboard',
        ].includes(token)
      ) {
        terms.add(token);
      }
    }

    return terms;
  }

  private buildImageSelectionReason(
    candidate: ImageRerankCandidate,
    component?: string,
  ): string {
    const target = component || 'peca perguntada';
    return `Mostra contexto textual/visual relacionado a ${target}, com legenda ou OCR na pagina ${candidate.page}.`;
  }

  private normalizeText(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private truncate(text: string, maxLength: number): string {
    return text.length <= maxLength
      ? text
      : `${text.slice(0, maxLength).trim()}...`;
  }
}
