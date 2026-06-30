import { QueryRewriterService } from './query-rewriter.service';
import { RagService } from './rag.service';
import type { RagConversationState, RagSource } from './types';

describe('RagService conversation rewrite', () => {
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
    const service = new RagService(
      new QueryRewriterService(),
      retriever as never,
      ollama as never,
      visualImages as never,
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

  it('answers the pending oil cap location directly after year follow-up and suppresses bad images', async () => {
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
      metadata: { vehicle_make: 'Audi', vehicle_model: 'A4', vehicle_year: 2010 },
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
    const service = new RagService(
      new QueryRewriterService(),
      retriever as never,
      ollama as never,
      visualImages as never,
    );
    jest.spyOn(service as any, 'generateStructuredAnswer').mockResolvedValue({
      answer:
        'Para encontrar a tampa de óleo no seu Audi A4 2010, consulte o diagrama ou tabela na página 270 do manual.',
      returnImages: true,
      citations: [],
      warnings: [],
      missingInformation: [],
    } as never);
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
    expect(result.answer).toContain('compartimento do motor');
    expect(result.answer).toContain('engine oil filler cap');
    expect(result.answer.toLowerCase()).not.toMatch(
      /^para encontrar.*consulte o diagrama/,
    );
    expect(result.returnImages).toBe(false);
    expect(result.images).toEqual([]);
    expect(result.confidence).toBeLessThan(0.85);
  });

  it('replaces hallucinated oil reservoir wording with grounded oil filler cap wording', async () => {
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
      metadata: { vehicle_make: 'Audi', vehicle_model: 'A4', vehicle_year: 2008 },
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
    const service = new RagService(
      new QueryRewriterService(),
      retriever as never,
      ollama as never,
      visualImages as never,
    );
    jest.spyOn(service as any, 'generateStructuredAnswer').mockResolvedValue({
      answer:
        'A tampa do óleo do motor está localizada na parte superior do reservatório de óleo, geralmente perto da mangueira de vedação (gasket) ⇒ Fig. 256.',
      returnImages: true,
      citations: [],
      warnings: [],
      missingInformation: [],
    } as never);

    const result = await service.answer('Onde fica a tampa do oleo do Audi A4 2008?');

    expect(result.answer).toContain('tampa/bocal');
    expect(result.answer).toContain('engine oil filler cap');
    expect(result.answer.toLowerCase()).not.toContain('reservatório de óleo');
    expect(result.answer.toLowerCase()).not.toContain('reservatorio de oleo');
    expect(result.answer.toLowerCase()).not.toContain('gasket');
    expect(result.confidence).toBeLessThan(0.9);
  });
});
