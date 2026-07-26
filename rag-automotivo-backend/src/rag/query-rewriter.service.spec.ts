import { QueryRewriterService } from './query-rewriter.service';
import type { RagConversationState } from './types';

describe('QueryRewriterService', () => {
  let service: QueryRewriterService;

  beforeEach(() => {
    service = new QueryRewriterService();
  });

  it('resolves an incomplete visual question followed by vehicle/year', () => {
    const first = service.rewrite('Onde fica a tampa do oleo do Audi A4?');

    expect(first.pendingQuestion).toBe('Onde fica a tampa do oleo do Audi A4?');
    expect(first.missingSlots).toContain('year');
    expect(first.intent).toBe('locate_oil_cap');

    const second = service.rewrite('Audi A4 2010', [], first.state);

    expect(second.isFollowUp).toBe(true);
    expect(second.resolvedQuery).toBe(
      'Onde fica a tampa do oleo do Audi A4 2010?',
    );
    expect(second.intent).toBe('locate_oil_cap');
    expect(second.vehicle).toMatchObject({
      brand: 'Audi',
      model: 'A4',
      year: '2010',
    });
    expect(second.missingSlots).toEqual([]);
  });

  it('uses previous vehicle context for pronoun follow-up', () => {
    const first = service.rewrite('Qual oleo do Audi A4 2010?');
    const second = service.rewrite('Onde fica a tampa dele?', [], first.state);

    expect(second.isFollowUp).toBe(true);
    expect(second.resolvedQuery).toBe(
      'Onde fica a tampa do oleo do Audi A4 2010?',
    );
    expect(second.vehicle).toMatchObject({
      brand: 'Audi',
      model: 'A4',
      year: '2010',
    });
  });

  it('does not use previous context when the current message is a new complete question', () => {
    const previous = service.rewrite('Qual oleo do Audi A4 2010?');
    const current = service.rewrite(
      'Qual oleo do Corolla 2015?',
      [],
      previous.state,
    );

    expect(current.isFollowUp).toBe(false);
    expect(current.resolvedQuery).toBe('Qual oleo do Corolla 2015?');
    expect(current.vehicle).toMatchObject({
      brand: 'Toyota',
      model: 'COROLLA',
      year: '2015',
    });
  });

  it('handles vehicle correction during a pending question', () => {
    const pending = service.rewrite('Onde fica o reservatorio do Audi A4?');
    const correction = service.rewrite('BMW X3 2017', [], pending.state);

    expect(correction.isFollowUp).toBe(true);
    expect(correction.resolvedQuery).toBe(
      'Onde fica o reservatorio do BMW X3 2017?',
    );
    expect(correction.vehicle).toMatchObject({
      brand: 'BMW',
      model: 'X3',
      year: '2017',
    });
  });

  it.each(['2010', '2.0', 'Audi A4 2010'])(
    'treats short message "%s" as complement when there is a pending question',
    (message) => {
      const state: RagConversationState = {
        lastUserQuestion: 'Onde fica a tampa do oleo do Audi A4?',
        pendingQuestion: 'Onde fica a tampa do oleo do Audi A4?',
        resolvedQuery: 'Onde fica a tampa do oleo do Audi A4?',
        intent: 'locate_oil_cap',
        vehicle: { brand: 'Audi', model: 'A4' },
        missingSlots: ['year'],
        lastAnswerNeededClarification: true,
      };

      const result = service.rewrite(message, [], state);

      expect(result.isFollowUp).toBe(true);
      expect(result.resolvedQuery).toContain('Onde fica a tampa do oleo');
    },
  );

  it('keeps visual intent for rewritten visual questions', () => {
    const pending = service.rewrite('Onde fica a tampa do oleo do Audi A4?');
    const resolved = service.rewrite('2010', [], pending.state);

    expect(resolved.intent).toBe('locate_oil_cap');
    expect(resolved.resolvedQuery).toBe(
      'Onde fica a tampa do oleo do Audi A4 2010?',
    );
  });

  it('keeps textual intent for oil specification questions', () => {
    const result = service.rewrite('Qual oleo do Audi A4 2010?');

    expect(result.isFollowUp).toBe(false);
    expect(result.intent).toBe('oil_specification');
    expect(result.missingSlots).toEqual([]);
  });

  it('asks for clarification when vehicle-specific context is incomplete', () => {
    const result = service.rewrite('Qual oleo usar?');

    expect(result.missingSlots).toEqual(['brand', 'model', 'year']);
    expect(result.lastAnswerNeededClarification).toBe(true);
  });

  it('resolves a fuel filler question after a year-only clarification', () => {
    const first = service.rewrite('Onde fica a tampa de gasolina do Audi A4?');
    const second = service.rewrite('2008', [], first.state);

    expect(second.messageIntent).toBe('CLARIFICATION_RESPONSE');
    expect(second.resolvedQuery).toBe(
      'Onde fica a tampa de gasolina do Audi A4 2008?',
    );
    expect(second.intent).toBe('locate_component');
  });

  it('keeps the oil intent after year and engine clarification', () => {
    const first = service.rewrite('Qual o óleo recomendado para o Civic?');
    const second = service.rewrite('2015, 2.0.', [], first.state);

    expect(second.resolvedQuery).toContain('Qual o óleo recomendado');
    expect(second.resolvedQuery).toContain('Honda CIVIC 2015 2.0');
    expect(second.intent).toBe('oil_specification');
  });

  it('changes topic while preserving the structured vehicle', () => {
    const first = service.rewrite('Qual o óleo do Civic 2015 2.0?');
    const second = service.rewrite('E onde fica a bateria?', [], first.state);

    expect(second.messageIntent).toBe('TOPIC_CHANGE');
    expect(second.resolvedQuery).toContain('bateria');
    expect(second.resolvedQuery).toContain('Honda CIVIC 2015 2.0');
    expect(second.resolvedQuery).not.toContain('óleo do Civic');
  });

  it('keeps a corrected year in subsequent turns', () => {
    const first = service.rewrite('Audi A4 2008.');
    const correction = service.rewrite('Na verdade é 2009.', [], first.state);
    const followUp = service.rewrite(
      'Onde fica a bateria?',
      [],
      correction.state,
    );

    expect(correction.messageIntent).toBe('CORRECTION');
    expect(followUp.vehicle.year).toBe('2009');
    expect(followUp.resolvedQuery).toContain('2009');
    expect(followUp.resolvedQuery).not.toContain('2008');
  });

  it('does not share vehicle or pending intent between independent chat states', () => {
    const chatA = service.rewrite('Onde fica a bateria do Audi A4?');
    const chatB = service.rewrite('Qual óleo do Civic?');
    const continuedA = service.rewrite('2008', [], chatA.state);
    const continuedB = service.rewrite('2015, 2.0', [], chatB.state);

    expect(continuedA.resolvedQuery).toContain('bateria do Audi A4 2008');
    expect(continuedA.resolvedQuery).not.toContain('CIVIC');
    expect(continuedB.resolvedQuery).toContain('óleo do Honda CIVIC 2015 2.0');
    expect(continuedB.resolvedQuery).not.toContain('Audi');
  });
});
