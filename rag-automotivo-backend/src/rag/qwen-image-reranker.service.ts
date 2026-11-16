import { Injectable, Logger } from '@nestjs/common';
import { readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

import type {
  ClipImageResult,
  ImageRerankCandidate,
  ImageRerankResult,
  RagConversationVehicle,
  RagSource,
} from './types';

type QwenRerankInput = {
  resolvedQuery: string;
  intent: string;
  component?: string;
  vehicle?: RagConversationVehicle;
  sources: RagSource[];
};

type QwenCandidate = ImageRerankCandidate & {
  textPreview: string;
};

type QwenVerdict = {
  relevant: boolean;
  score: number;
  reason: string;
};

@Injectable()
export class QwenImageRerankerService {
  private readonly logger = new Logger(QwenImageRerankerService.name);
  private readonly baseUrl =
    process.env.OLLAMA_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:11434';
  private readonly model =
    process.env.RAG_QWEN_RERANKER_MODEL ?? 'qwen2.5vl:7b';
  private readonly projectRoot = resolve(process.cwd(), '..');
  private readonly maxImages = Number(process.env.RAG_QWEN_MAX_IMAGES ?? 2);
  private readonly candidateLimit = Number(
    process.env.RAG_QWEN_CANDIDATE_LIMIT ?? 8,
  );
  private readonly threshold = Number(process.env.RAG_QWEN_THRESHOLD ?? 0.55);
  private readonly timeoutMs = Number(
    process.env.RAG_QWEN_RERANKER_TIMEOUT_MS ?? 180000,
  );
  private readonly textOnly = process.env.RAG_QWEN_TEXT_ONLY === 'true';
  private visionCapability?: Promise<boolean>;

  async rerankImages(input: QwenRerankInput): Promise<ImageRerankResult> {
    const candidates = this.buildCandidates(input)
      .sort(
        (left, right) =>
          right.textScore + right.clipScore -
          (left.textScore + left.clipScore),
      )
      .slice(0, this.candidateLimit);

    if (candidates.length === 0) {
      return { selectedImages: [], rejectedImages: [], candidates: [] };
    }

    this.logger.log(
      `Analisando ${candidates.length} imagem(ns) candidata(s) com ${this.model}.`,
    );
    const useImageInput = await this.supportsVisionInput();

    const selectedImages: ClipImageResult[] = [];
    const rejectedImages: ImageRerankResult['rejectedImages'] = [];
    const evaluatedCandidates: ImageRerankCandidate[] = [];

    for (const candidate of candidates) {
      const verdict = await this.evaluateCandidate(
        input,
        candidate,
        useImageInput,
      );
      const isRelevant = verdict.relevant && verdict.score >= this.threshold;
      const evaluated = {
        ...candidate,
        clipScore: verdict.score,
        isRelevant,
        rejectionReason: isRelevant
          ? ''
          : verdict.reason || 'Qwen avaliou a imagem como pouco relevante.',
      };

      evaluatedCandidates.push(evaluated);

      if (isRelevant) {
        selectedImages.push({
          imagePath: candidate.imagePath,
          score: verdict.score,
          page: candidate.page,
          source: candidate.source,
          chunkId: candidate.chunkId,
          caption: candidate.caption,
          ocrText: candidate.ocrText,
          textScore: candidate.textScore,
          isRelevant: true,
          reason: verdict.reason,
          confidence: Number(
            Math.max(0, Math.min(0.99, verdict.score)).toFixed(2),
          ),
        });
      } else {
        rejectedImages.push({
          imageId: candidate.imageId,
          imagePath: candidate.imagePath,
          page: candidate.page,
          reason: evaluated.rejectionReason,
        });
      }
    }

    const selectedPaths = new Set(
      selectedImages
        .sort((left, right) => right.score - left.score)
        .slice(0, this.maxImages)
        .map((image) => image.imagePath),
    );

    return {
      selectedImages: selectedImages.filter((image) =>
        selectedPaths.has(image.imagePath),
      ),
      rejectedImages: [
        ...rejectedImages,
        ...selectedImages
          .filter((image) => !selectedPaths.has(image.imagePath))
          .map((image) => ({
            imageId: image.imagePath,
            imagePath: image.imagePath,
            page: image.page,
            reason: 'Imagem relevante, mas fora do limite maximo de retorno.',
          })),
      ],
      candidates: evaluatedCandidates,
    };
  }

  private async evaluateCandidate(
    input: QwenRerankInput,
    candidate: QwenCandidate,
    useImageInput: boolean,
  ): Promise<QwenVerdict> {
    if (!useImageInput && candidate.textScore < 0.18) {
      return {
        relevant: false,
        score: Math.min(0.35, candidate.textScore),
        reason:
          'Sem legenda, OCR ou contexto textual suficiente para a pergunta.',
      };
    }

    const prompt = this.buildPrompt(input, candidate);

    try {
      const text = await this.callOllama(prompt, candidate, useImageInput);
      return this.parseVerdict(text, candidate);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Falha no reranker Qwen: ${message}`);
    }

    return {
      relevant: candidate.textScore >= this.threshold,
      score: candidate.textScore,
      reason: 'Fallback local baseado em legenda/OCR/contexto textual.',
    };
  }

  private async callOllama(
    prompt: string,
    candidate: QwenCandidate,
    useImageInput: boolean,
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const message: Record<string, unknown> = {
        role: 'user',
        content: prompt,
      };

      if (useImageInput) {
        const image = this.readImageAsBase64(candidate.imagePath);
        if (image) {
          message.images = [image];
        }
      }

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: [message],
          options: {
            temperature: Number(process.env.RAG_QWEN_TEMPERATURE ?? 0),
            num_ctx: Number(process.env.RAG_QWEN_NUM_CTX ?? 4096),
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = (await response.text()).trim().slice(0, 500);
        throw new Error(
          `Ollama retornou HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
        );
      }

      const payload = (await response.json()) as {
        message?: { content?: unknown };
        response?: unknown;
      };

      const content = payload.message?.content ?? payload.response;
      return typeof content === 'string' ? content : '';
    } finally {
      clearTimeout(timeout);
    }
  }

  private supportsVisionInput(): Promise<boolean> {
    if (this.textOnly) {
      return Promise.resolve(false);
    }

    this.visionCapability ??= this.fetchVisionCapability();
    return this.visionCapability;
  }

  private async fetchVisionCapability(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = (await response.text()).trim().slice(0, 500);
        this.logger.warn(
          `Nao foi possivel inspecionar ${this.model} no Ollama (HTTP ${response.status}${detail ? `: ${detail}` : ''}). ` +
            'O reranking seguira apenas com texto/OCR.',
        );
        return false;
      }

      const payload = (await response.json()) as { capabilities?: unknown };
      const capabilities = Array.isArray(payload.capabilities)
        ? payload.capabilities.filter(
            (capability): capability is string =>
              typeof capability === 'string',
          )
        : [];
      const supportsVision = capabilities.includes('vision');

      if (!supportsVision) {
        this.logger.warn(
          `${this.model} nao possui a capacidade "vision" no Ollama; ` +
            'o reranking seguira apenas com legenda/OCR/contexto. ' +
            'Configure RAG_QWEN_RERANKER_MODEL=qwen2.5vl:7b para reranking visual.',
        );
      }

      return supportsVision;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Falha ao verificar as capacidades de ${this.model}: ${message}. ` +
          'O reranking seguira apenas com texto/OCR.',
      );
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildPrompt(
    input: QwenRerankInput,
    candidate: QwenCandidate,
  ): string {
    const vehicle = [
      input.vehicle?.brand,
      input.vehicle?.model,
      input.vehicle?.year,
      input.vehicle?.engine,
    ]
      .filter(Boolean)
      .join(' ');

    return [
      'Voce e um reranker visual local para manuais automotivos.',
      'Decida se a imagem candidata ajuda a responder a pergunta do usuario.',
      'Use a imagem quando ela estiver disponivel. Use tambem legenda, OCR e contexto do chunk.',
      'Responda somente JSON valido no formato {"relevant":true,"score":0.82,"reason":"motivo curto"}.',
      'score deve ir de 0 a 1. Seja conservador: capa, foto generica, pagina inicial e imagem sem evidencia devem ser false.',
      'Uma imagem so e relevante se mostrar diretamente a peca, simbolo, comando, etiqueta ou etapa operacional perguntada.',
      'Rejeite imagens apenas proximas na pagina, diagramas de outro componente e duplicatas sem ganho informacional.',
      'Julgue primeiro o que esta VISIVEL na imagem. O texto do chunk e apenas apoio e nao torna uma imagem relevante por si so.',
      'Use score >= 0.80 apenas quando o alvo visual estiver claramente presente; use <= 0.35 para pagina apenas relacionada.',
      `Criterio visual especifico: ${this.visualTargetGuidance(input.resolvedQuery)}`,
      '',
      `Pergunta: ${input.resolvedQuery}`,
      `Intencao: ${input.intent}`,
      `Componente: ${input.component ?? 'nao identificado'}`,
      `Veiculo: ${vehicle || 'nao identificado'}`,
      `Documento: ${candidate.source ?? 'desconhecido'}, pagina ${candidate.page}`,
      `Legenda/OCR/contexto: ${candidate.textPreview}`,
    ].join('\n');
  }

  private visualTargetGuidance(query: string): string {
    const normalized = this.normalizeText(query);
    if (
      /(?:manual|emergencia|falha|falhar).{0,70}(?:portinhola|tanque)|(?:portinhola|tanque).{0,70}(?:manual|emergencia|falha|falhar)/.test(
        normalized,
      )
    ) {
      return 'aceite somente se mostrar a liberacao de emergencia da portinhola, como a cobertura da lanterna direita e a alca no porta-malas; rejeite abastecimento comum e AdBlue.';
    }
    if (/capo|hood|bonnet/.test(normalized)) {
      return 'aceite a alavanca interna ou a trava dianteira usada para abrir o capo; rejeite vistas genericas do motor.';
    }
    if (/estepe|spare wheel|coluna b|b-pillar/.test(normalized)) {
      return 'aceite a etiqueta de pressao ou sua localizacao na coluna B do motorista; rejeite rodas genericas.';
    }
    if (/limpador|lavador|washer/.test(normalized)) {
      return 'aceite a tampa/simbolo do reservatorio do lavador ou o diagrama que a identifica; rejeite outros reservatorios.';
    }
    if (/partida auxiliar|jump.start|positivo|positive terminal/.test(normalized)) {
      return 'aceite o terminal positivo de partida auxiliar e sua tampa marcada com +; rejeite bateria ou cabos sem esse ponto identificado.';
    }
    if (/pressao.{0,25}oleo|oleo.{0,25}pressao|oil pressure/.test(normalized)) {
      return 'aceite o simbolo/aviso de pressao do oleo ou a pagina que o identifica claramente; rejeite troca de oleo generica.';
    }
    return 'aceite somente se a imagem mostrar diretamente o objeto ou a operacao perguntada.';
  }

  private parseVerdict(text: string, candidate: QwenCandidate): QwenVerdict {
    const cleaned = text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    const jsonText =
      start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;

    try {
      const parsed = JSON.parse(jsonText) as {
        relevant?: unknown;
        score?: unknown;
        reason?: unknown;
      };
      const score =
        typeof parsed.score === 'number'
          ? parsed.score
          : Number(parsed.score ?? candidate.textScore);

      return {
        relevant:
          typeof parsed.relevant === 'boolean'
            ? parsed.relevant
            : Number.isFinite(score) && score >= this.threshold,
        score: Number(
          Math.max(
            0,
            Math.min(1, Number.isFinite(score) ? score : candidate.textScore),
          ).toFixed(2),
        ),
        reason:
          typeof parsed.reason === 'string' && parsed.reason.trim()
            ? parsed.reason.trim()
            : 'Qwen avaliou a relacao entre pergunta, imagem e contexto.',
      };
    } catch {
      return {
        relevant: candidate.textScore >= this.threshold,
        score: candidate.textScore,
        reason: 'Resposta do Qwen nao veio em JSON; fallback textual local.',
      };
    }
  }

  private buildCandidates(input: QwenRerankInput): QwenCandidate[] {
    const candidates: QwenCandidate[] = [];
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
        const unreadableReason = this.getUnreadableReason(imagePath);
        const clipPrior = source.clip_results?.find(
          (result) => result.imagePath === imagePath,
        )?.score;
        const candidate: QwenCandidate = {
          imageId: imagePath,
          imagePath,
          page: source.page_start,
          caption,
          ocrText,
          clipScore: clipPrior ?? textScore,
          textScore,
          isRelevant: false,
          rejectionReason: unreadableReason,
          source: source.document_name,
          chunkId: source.chunk_id,
          textPreview: this.truncate(ocrText, 1200),
        };

        if (!unreadableReason) {
          candidates.push(candidate);
        }
      }
    }

    return candidates;
  }

  private readImageAsBase64(imagePath: string): string | null {
    const absolute = resolve(this.projectRoot, imagePath);
    try {
      const extension = extname(absolute).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
        return null;
      }
      return readFileSync(absolute).toString('base64');
    } catch {
      return null;
    }
  }

  private getUnreadableReason(imagePath: string): string {
    const absolute = resolve(this.projectRoot, imagePath);
    try {
      const stat = statSync(absolute);
      if (!stat.isFile() || stat.size < 1024) {
        return 'Imagem vazia, quebrada ou inacessivel.';
      }
      return '';
    } catch {
      return 'Imagem vazia, quebrada ou inacessivel.';
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
      /(item|@|\(d\)|\(3\)|\b3\b|seta|identifica|filler cap|tampa|bocal|reservoir|reservatorio|fusivel|fusível)/i.test(
        text,
      )
        ? 0.12
        : 0;
    const negative =
      /\b(cover|owner'?s manual|manual)\b/i.test(text) &&
      !/(engine|oil|filler|cap|motor|oleo|óleo|tampa|bocal|reservoir|fluid|fusivel|fusível)/i.test(
        text,
      )
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
        'engine oil',
        'compartimento do motor',
        'engine compartment',
      ]);
    }

    if (/reservatorio|reservatório|reservoir|fluido|fluid/.test(text)) {
      addTerms([
        'reservatorio',
        'reservoir',
        'fluido',
        'fluid',
        'compartimento do motor',
        'engine compartment',
      ]);
    }

    if (/fusivel|fusível|fuse/.test(text)) {
      addTerms([
        'fusivel',
        'fusíveis',
        'fuse',
        'fuse box',
        'caixa de fusiveis',
      ]);
    }

    for (const token of text.split(/\s+/)) {
      if (token.length >= 4) {
        terms.add(token);
      }
    }

    return terms;
  }

  private normalizeText(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private truncate(value: string, maxLength: number): string {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  }
}
