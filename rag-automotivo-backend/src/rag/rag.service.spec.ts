import { QueryRewriterService } from './query-rewriter.service';
import { RagService } from './rag.service';
import type { RagConversationState } from './types';

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
});
