/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { QueryRewriterService } from './query-rewriter.service';
import { RelevanceValidatorService } from './relevance-validator.service';
import { RagService } from './rag.service';
import type { RagConversationState, RagSource } from './types';
import { RunnableLambda } from '@langchain/core/runnables';

describe('RagService conversation rewrite', () => {
  it('extrai normas de oleo sem inventar viscosidade ou relacao com combustivel', () => {
    const service = new RagService(
      new QueryRewriterService(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new RelevanceValidatorService(),
    );
    const source = {
      score: 0.9,
      chunk_id: 'oil-spec',
      document_name: '2008-audi-a4.pdf',
      page_start: 325,
      page_end: 326,
      text: 'Inspection Service VW 502 00, VW 503 00 VW 504 00. LongLife Service VW 503 00, VW 504 00.',
      image_paths: [],
      metadata: {},
    } as RagSource;

    const answer = (service as any).buildGroundedExtractiveAnswer(
      'Qual óleo é recomendado?',
      [source],
    );

    expect(answer).toContain('VW 502 00, VW 503 00, VW 504 00');
    expect(answer).toContain('não uma viscosidade SAE específica');
    expect(answer).not.toMatch(/premium|gasolina|combustível/i);
  });

  it('extrai o procedimento da portinhola sem inventar o lado da carroceria', () => {
    const service = new RagService(
      new QueryRewriterService(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new RelevanceValidatorService(),
    );
    const source = {
      score: 0.9,
      chunk_id: 'fuel-flap',
      document_name: '2008-audi-a4.pdf',
      page_start: 254,
      page_end: 254,
      text: 'Press the left side of the flap to open it. Unscrew the tank cap anti-clockwise. Automatically by the central locking.',
      image_paths: [],
      metadata: {},
    } as RagSource;

    const answer = (service as any).buildGroundedExtractiveAnswer(
      'Onde fica a portinhola do tanque e como abrir?',
      [source],
    );

    expect(answer).toContain('não informa com clareza');
    expect(answer).toContain('sentido anti-horário');
    expect(answer).not.toMatch(/traseira direita|traseira esquerda/);
  });

  it('remove referencias a figuras que nao foram anexadas', () => {
    const service = new RagService(
      new QueryRewriterService(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new RelevanceValidatorService(),
    );

    const cleaned = (service as any).removeUnavailableVisualReferences(
      [
        'Para abrir, pressione o lado esquerdo -arrow-.',
        'O manual menciona a abertura, conforme ilustração na página 254.',
      ].join(' '),
    );

    expect(cleaned).toBe('Para abrir, pressione o lado esquerdo.');
    expect(cleaned).not.toMatch(/figura|ilustra|arrow/i);
  });

  it('normaliza quebras de linha do OCR ao validar detalhes da resposta', () => {
    const service = new RagService(
      new QueryRewriterService(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new RelevanceValidatorService(),
    );
    const source = {
      score: 0.9,
      chunk_id: 'ocr-engine-compartment',
      document_name: 'manual.pdf',
      page_start: 260,
      page_end: 260,
      section_title: 'Fig. 256',
      text: 'Engine\ncompartment: Engine\noil filler cap',
      image_paths: [],
      metadata: {},
    } as RagSource;

    const unsupported = (service as any).findUnsupportedSpecificDetails(
      'A tampa fica no compartimento do motor.',
      [source],
    );

    expect(unsupported).toEqual([]);
  });

  it('rejeita capo quando a evidencia fala somente de fuel cap', () => {
    const service = new RagService(
      new QueryRewriterService(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new RelevanceValidatorService(),
    );
    const source = {
      score: 0.9,
      chunk_id: 'fuel-flap',
      document_name: 'manual.pdf',
      page_start: 254,
      page_end: 254,
      text: 'Fuel tank flap with cap attached.',
      image_paths: [],
      metadata: {},
    } as RagSource;

    const unsupported = (service as any).findUnsupportedSpecificDetails(
      'O flap está conectado ao capô.',
      [source],
    );

    expect(unsupported).toContain('capo');
  });

  it('simplifica termos inequivocos sem expor confianca interna', () => {
    const service = new RagService(
      new QueryRewriterService(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new RelevanceValidatorService(),
    );

    const simplified = (service as any).normalizePublicLanguage(
      [
        'The fuel tank flap fica próximo ao luggage compartment.',
        'Confiança: 57%.',
      ].join('\n'),
    );

    expect(simplified).toContain('portinhola do tanque de combustível');
    expect(simplified).toContain('porta-malas');
    expect(simplified).not.toMatch(/fuel tank flap|luggage compartment/i);
    expect(simplified).not.toMatch(/confian[cç]a/i);
  });

  it('apresenta fonte publica amigavel com pagina singular', () => {
    const service = new RagService(
      new QueryRewriterService(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new RelevanceValidatorService(),
    );
    const source = {
      score: 0.9,
      chunk_id: 'fuel-flap',
      document_name: '2008-audi-a4-audi-a4_2008_bbb9f770c8cb74dba7ce.pdf',
      page_start: 254,
      page_end: 254,
      text: 'Fuel tank flap.',
      image_paths: [],
      metadata: {
        vehicle_make: 'Audi',
        vehicle_model: 'A4',
        vehicle_year: 2008,
      },
    } as RagSource;

    const answer = (service as any).ensureAnswerHasSourceFooter(
      'A portinhola fica na lateral traseira direita.\n\nConfiança: 57%.',
      [source],
    );

    expect(answer).toContain('Fonte: Manual do Audi A4 2008, página 254.');
    expect(answer).not.toContain('bbb9f770c8cb74dba7ce');
    expect(answer).not.toMatch(/confian[cç]a/i);
    expect(answer).not.toContain('254-254');
  });

  it('identifica linguagem inadequada para publico leigo', () => {
    const service = new RagService(
      new QueryRewriterService(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new RelevanceValidatorService(),
    );

    const issues = (service as any).findPublicClarityIssues(
      'O fuel tank flap fica atrás da coluna de arrimo. Confiança: 57%.',
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        'termo em ingles sem explicacao',
        'traducao literal pouco natural',
        'percentual interno de confianca',
      ]),
    );
  });

  it('repara uma recusa do gerador quando a evidencia foi validada como direta', async () => {
    const outputs = [
      JSON.stringify({
        answer: 'Não possuo conhecimento sobre este assunto.',
        returnImages: false,
        citations: [],
        warnings: [],
        missingInformation: [],
      }),
      JSON.stringify({
        answer:
          'A tampa de abastecimento do óleo do motor fica no compartimento do motor.',
        returnImages: false,
        citations: [],
        warnings: [],
        missingInformation: [],
      }),
    ];
    const model = RunnableLambda.from(async () => outputs.shift() ?? '');
    const service = new RagService(
      new QueryRewriterService(),
      { retrieve: jest.fn() } as never,
      {
        getModel: jest.fn(() => model),
        cleanOutput: jest.fn((value: string) => value),
      } as never,
      {} as never,
      {} as never,
      new RelevanceValidatorService(),
    );
    const source = {
      score: 0.9,
      chunk_id: 'engine-oil-cap',
      document_name: '2008-audi-a4.pdf',
      page_start: 260,
      page_end: 260,
      section_title: 'Engine compartment',
      text: 'Fig. 256 Engine compartment: Engine oil filler cap.',
      image_paths: [],
      metadata: {
        vehicle_make: 'Audi',
        vehicle_model: 'A4',
        vehicle_year: 2008,
      },
    } as RagSource;

    const result = await (service as any).generateStructuredAnswer(
      'Onde fica a tampa do óleo do Audi A4 2008?',
      [],
      [source],
      true,
    );

    expect(result.answer).toContain('compartimento do motor');
    expect(outputs).toHaveLength(0);
  });

  it('uses resolvedQuery instead of rawMessage when consulting retrieval', async () => {
    let ragQueryUsed = '';
    const retriever = {
      retrieve: jest.fn(async (query: string) => {
        ragQueryUsed = query;
        throw new Error('stop after retrieval');
      }),
    };
    const ollama = {
      getModel: jest.fn(),
      cleanOutput: jest.fn((value: string) => value),
    };
    const visualImages = {
      stripImages: jest.fn((sources) => sources),
    };
    const qwenImageReranker = {
      rerankImages: jest.fn(),
    };
    const service = new RagService(
      new QueryRewriterService(),
      retriever as never,
      ollama as never,
      visualImages as never,
      qwenImageReranker as never,
      {
        evaluate: jest.fn((_query, sources) => ({
          accepted: sources,
          selected: sources,
          evaluations: [],
          answerability: 'DIRECT',
          selectionThreshold: 0,
        })),
      } as never,
    );
    const state: RagConversationState = {
      lastUserQuestion: 'Onde fica a tampa do oleo do Audi A4?',
      pendingQuestion: 'Onde fica a tampa do oleo do Audi A4?',
      resolvedQuery: 'Onde fica a tampa do oleo do Audi A4?',
      intent: 'locate_oil_cap',
      vehicle: { brand: 'Audi', model: 'A4' },
      missingSlots: ['year'],
      lastAnswerNeededClarification: true,
    };

    await service.answer('Audi A4 2010', [], {
      chatId: 'chat-test',
      conversationState: state,
    });

    expect(ragQueryUsed).toContain('Onde fica a tampa do oleo do Audi A4 2010');
    expect(ragQueryUsed).not.toBe('Audi A4 2010');
  });

  it('preserves the pending query and refuses a model answer that only refers to a diagram', async () => {
    const source: RagSource = {
      score: 0.95,
      chunk_id: 'chunk-a4-2010-engine',
      document_name: '2010-audi-a4.pdf',
      page_start: 270,
      page_end: 271,
      section_title: 'Engine compartment',
      text: [
        'Engine compartment',
        'Fig. 199 Typical layout for containers and engine oil filler cap',
        'Engine oil filler cap(~)',
        'Screw the cap back on the filling hole.',
      ].join('\n'),
      image_paths: [
        'rag_chunks_output/images/cover.jpg',
        'rag_chunks_output/images/empty.jpg',
      ],
      metadata: {
        vehicle_make: 'Audi',
        vehicle_model: 'A4',
        vehicle_year: 2010,
      },
      retrieval_scores: { final: 0.95, reranker: 0.95, metadata: 1 },
    };
    let ragQueryUsed = '';
    const retriever = {
      retrieve: jest.fn(async (query: string) => {
        ragQueryUsed = query;
        return [source];
      }),
    };
    const ollama = {
      getModel: jest.fn(),
      cleanOutput: jest.fn((value: string) => value),
    };
    const visualImages = {
      stripImages: jest.fn((sources: RagSource[]) =>
        sources.map((item) => ({ ...item, image_paths: [], clip_results: [] })),
      ),
      analyzeImagesWithClip: jest.fn(async () => [
        { imagePath: 'rag_chunks_output/images/cover.jpg', score: 0.91 },
      ]),
      rerankImages: jest.fn(() => ({
        selectedImages: [],
        rejectedImages: [
          {
            imageId: 'rag_chunks_output/images/cover.jpg',
            imagePath: 'rag_chunks_output/images/cover.jpg',
            page: 1,
            reason: 'Imagem e capa do manual, nao mostra a tampa de oleo.',
          },
          {
            imageId: 'rag_chunks_output/images/empty.jpg',
            imagePath: 'rag_chunks_output/images/empty.jpg',
            page: 270,
            reason: 'Imagem vazia, quebrada ou inacessivel.',
          },
        ],
        candidates: [],
      })),
      filterSourcesByRerankResult: jest.fn(),
    };
    const qwenImageReranker = {
      rerankImages: jest.fn(),
    };
    const service = new RagService(
      new QueryRewriterService(),
      retriever as never,
      ollama as never,
      visualImages as never,
      qwenImageReranker as never,
      {
        evaluate: jest.fn((_query, sources) => ({
          accepted: sources,
          selected: sources,
          evaluations: [],
          answerability: 'DIRECT',
          selectionThreshold: 0,
        })),
      } as never,
    );
    jest.spyOn(service as any, 'generateStructuredAnswer').mockResolvedValue({
      answer:
        'Para encontrar a tampa de óleo no seu Audi A4 2010, consulte o diagrama ou tabela na página 270 do manual.',
      returnImages: true,
      citations: [],
      warnings: [],
      missingInformation: [],
    });
    jest.spyOn(service as any, 'repairStructuredAnswer').mockResolvedValue({
      answer: 'Não possuo conhecimento sobre este assunto.',
      returnImages: false,
      citations: [],
      warnings: [],
      missingInformation: [],
    });
    const state: RagConversationState = {
      lastUserQuestion: 'Onde fica a tampa de óleo do Audi A4?',
      pendingQuestion: 'Onde fica a tampa de óleo do Audi A4?',
      resolvedQuery: 'Onde fica a tampa de óleo do Audi A4?',
      intent: 'locate_oil_cap',
      vehicle: { brand: 'Audi', model: 'A4' },
      missingSlots: ['year'],
      lastAnswerNeededClarification: true,
    };

    const result = await service.answer('2010', [], {
      chatId: 'chat-test',
      conversationState: state,
    });

    expect(ragQueryUsed).toContain('Onde fica a tampa de óleo do Audi A4 2010');
    expect(ragQueryUsed).not.toBe('2010');
    expect(result.answer).toBe('Não possuo conhecimento sobre este assunto.');
    expect(result.returnImages).toBe(false);
    expect(result.images).toEqual([]);
    expect(result.sources).toEqual([]);
  });

  it('repara detalhes alucinados quando existe localizacao documental direta', async () => {
    const source: RagSource = {
      score: 0.96,
      chunk_id: 'chunk-a4-2008-engine',
      document_name: '2008-audi-a4.pdf',
      page_start: 257,
      page_end: 258,
      section_title: 'Engine compartment layout',
      text: [
        'Fig. 252 Typical locations of fluid containers, engine oil dipstick and engine oil filler cap',
        'Engine oil filler cap (oil symbol)',
        'Main components for checking and refilling',
      ].join('\n'),
      image_paths: ['rag_chunks_output/images/2008-audi-a4/engine-layout.jpg'],
      metadata: {
        vehicle_make: 'Audi',
        vehicle_model: 'A4',
        vehicle_year: 2008,
      },
      retrieval_scores: { final: 0.96, reranker: 0.96, metadata: 1 },
    };
    const retriever = {
      retrieve: jest.fn(async () => [source]),
    };
    const ollama = {
      getModel: jest.fn(),
      cleanOutput: jest.fn((value: string) => value),
    };
    const visualImages = {
      stripImages: jest.fn((sources: RagSource[]) =>
        sources.map((item) => ({ ...item, image_paths: [], clip_results: [] })),
      ),
      analyzeImagesWithClip: jest.fn(async () => []),
      rerankImages: jest.fn(),
      filterSourcesByRerankResult: jest.fn(),
    };
    const qwenImageReranker = {
      rerankImages: jest.fn(),
    };
    const service = new RagService(
      new QueryRewriterService(),
      retriever as never,
      ollama as never,
      visualImages as never,
      qwenImageReranker as never,
      {
        evaluate: jest.fn((_query, sources) => ({
          accepted: sources,
          selected: sources,
          evaluations: [],
          answerability: 'DIRECT',
          selectionThreshold: 0,
        })),
      } as never,
    );
    jest.spyOn(service as any, 'generateStructuredAnswer').mockResolvedValue({
      answer:
        'A tampa do óleo do motor está localizada na parte superior do reservatório de óleo, geralmente perto da mangueira de vedação (gasket) ⇒ Fig. 256.',
      returnImages: true,
      citations: [],
      warnings: [],
      missingInformation: [],
    });
    jest.spyOn(service as any, 'repairStructuredAnswer').mockResolvedValue({
      answer:
        'A tampa de abastecimento do óleo do motor fica no compartimento do motor.',
      returnImages: false,
      citations: [],
      warnings: [],
      missingInformation: [],
    });

    const result = await service.answer(
      'Onde fica a tampa do oleo do Audi A4 2008?',
    );

    expect(result.answer).toContain('compartimento do motor');
    expect(result.sources).toHaveLength(1);
    expect(result.answer.toLowerCase()).not.toContain('gasket');
    expect(result.answer.toLowerCase()).not.toContain('reservatório de óleo');
  });

  it('refuses exactly and exposes no sources when all chunks conflict with the requested component', async () => {
    const conflicting = [
      {
        score: 0.95,
        chunk_id: 'oil',
        document_name: '2008-audi-a4.pdf',
        page_start: 257,
        page_end: 258,
        text: 'Engine oil filler cap in the engine compartment.',
        image_paths: [],
        metadata: {
          vehicle_make: 'Audi',
          vehicle_model: 'A4',
          vehicle_year: 2008,
        },
        retrieval_scores: { vector: 0.95, final: 0.95 },
      },
      {
        score: 0.9,
        chunk_id: 'brake',
        document_name: '2008-audi-a4.pdf',
        page_start: 260,
        page_end: 260,
        text: 'Brake fluid reservoir.',
        image_paths: [],
        metadata: {
          vehicle_make: 'Audi',
          vehicle_model: 'A4',
          vehicle_year: 2008,
        },
        retrieval_scores: { vector: 0.9, final: 0.9 },
      },
    ] as RagSource[];
    const service = new RagService(
      new QueryRewriterService(),
      { retrieve: jest.fn(async () => conflicting) } as never,
      { getModel: jest.fn(), cleanOutput: jest.fn() } as never,
      { stripImages: jest.fn((sources) => sources) } as never,
      { rerankImages: jest.fn() } as never,
      new RelevanceValidatorService(),
    );

    const result = await service.answer(
      'Onde fica a tampa do tanque de combustível do Audi A4 2008?',
    );

    expect(result.answer).toBe('Não possuo conhecimento sobre este assunto.');
    expect(result.sources).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.status).toBe('insufficient_context');
  });
});
