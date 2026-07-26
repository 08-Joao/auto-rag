import { RelevanceValidatorService } from './relevance-validator.service';
import type { RagSource } from './types';

const source = (
  chunkId: string,
  text: string,
  vehicle = { vehicle_make: 'Audi', vehicle_model: 'A4', vehicle_year: 2008 },
): RagSource => ({
  score: 0.8,
  chunk_id: chunkId,
  document_name: '2008-audi-a4.pdf',
  page_start: 252,
  page_end: 254,
  text,
  image_paths: [],
  metadata: vehicle,
  retrieval_scores: { vector: 0.8, lexical: 0.8, final: 0.8 },
});

describe('RelevanceValidatorService', () => {
  const validator = new RelevanceValidatorService();

  it('accepts matching fuel filler evidence and rejects oil filler evidence', () => {
    const result = validator.evaluate(
      'Onde fica a tampa do tanque de combustível do Audi A4 2008?',
      [
        source(
          'fuel',
          'Press the left side of the fuel tank flap. Unscrew the tank cap.',
        ),
        source(
          'oil',
          'The engine oil filler cap is in the engine compartment.',
        ),
      ],
      { brand: 'Audi', model: 'A4', year: '2008' },
    );

    expect(result.accepted.map((item) => item.chunk_id)).toEqual(['fuel']);
    expect(result.evaluations[1]).toMatchObject({
      componentMatch: false,
      isAnswerable: false,
      rejectionReason: 'component_conflict:oil_filler',
    });
  });

  it('rejects semantically conflicting automotive components', () => {
    const result = validator.evaluate(
      'Onde fica a tampa do tanque de combustível?',
      [
        source('oil', 'Engine oil filler cap'),
        source('brake', 'Brake fluid reservoir'),
        source('coolant', 'Coolant expansion tank'),
        source('dipstick', 'Engine oil dipstick'),
      ],
      {},
    );

    expect(result.accepted).toEqual([]);
    expect(result.evaluations.every((item) => !item.isAnswerable)).toBe(true);
  });

  it('rejects an otherwise relevant chunk for a different vehicle year', () => {
    const result = validator.evaluate(
      'Como abrir a portinhola de combustível do Audi A4 2008?',
      [
        source('other-year', 'Press the fuel filler door to open it.', {
          vehicle_make: 'Audi',
          vehicle_model: 'A4',
          vehicle_year: 2010,
        }),
      ],
      { brand: 'Audi', model: 'A4', year: '2008' },
    );

    expect(result.accepted).toEqual([]);
    expect(result.evaluations[0].rejectionReason).toBe('vehicle_mismatch');
  });

  it.each([
    ['Onde fica a tampa de combustível?', 'Fuel tank flap and tank cap.'],
    ['Onde fica a tampa de óleo?', 'Engine oil filler cap.'],
    ['Onde fica o reservatório do fluido de freio?', 'Brake fluid reservoir.'],
    [
      'Onde fica o reservatório do líquido de arrefecimento?',
      'Coolant expansion tank.',
    ],
    ['Onde fica a vareta de óleo?', 'Engine oil dipstick.'],
    [
      'Onde fica a bateria?',
      'The vehicle battery is in the luggage compartment.',
    ],
    [
      'Como abrir a portinhola do tanque?',
      'Press the fuel filler flap to open it.',
    ],
    ['Qual a capacidade do tanque?', 'Fuel tank capacity is 65 litres.'],
    ['Qual óleo utilizar?', 'Engine oil specification and viscosity.'],
    [
      'Qual combustível utilizar?',
      'Fuel grade recommendation: gasoline octane.',
    ],
  ])('preserves the concept in evaluation: %s', (query, evidence) => {
    const result = validator.evaluate(
      query,
      [
        source('relevant', evidence),
        source(
          'distractor',
          'Engine oil filler cap and brake fluid reservoir.',
        ),
      ],
      {},
    );

    expect(result.accepted.map((item) => item.chunk_id)).toContain('relevant');
  });

  it('does not block an unforeseen subject that is supported by the chunk', () => {
    const result = validator.evaluate(
      'Como ajustar a cortina elétrica do teto panorâmico?',
      [
        source(
          'sunroof',
          'Para ajustar a cortina elétrica do teto panorâmico, pressione o comando no console superior.',
        ),
        source('unrelated', 'Pressão recomendada dos pneus.'),
      ],
      {},
    );

    expect(result.selected.map((item) => item.chunk_id)).toEqual(['sunroof']);
    expect(result.answerability).toBe('DIRECT');
    expect(result.evaluations[0].evidenceClass).toBe('DIRECTLY_ANSWERS');
  });

  it('selects evidence adaptively by quality instead of forwarding every accepted chunk', () => {
    const strong = source(
      'strong',
      'Fuel tank flap and tank cap. Press the fuel filler flap to open it.',
    );
    strong.retrieval_scores = { vector: 0.9, lexical: 0.95, final: 0.95 };
    const complementary = source(
      'complementary',
      'The fuel filler flap is unlocked by the central locking system.',
    );
    complementary.retrieval_scores = {
      vector: 0.8,
      lexical: 0.8,
      final: 0.8,
    };
    const weak = source(
      'weak',
      'The fuel filler flap may be mentioned in vehicle labels.',
    );
    weak.retrieval_scores = { vector: 0.53, lexical: 0.45, final: 0.23 };

    const result = validator.evaluate(
      'Como abrir a portinhola do tanque de combustível?',
      [strong, complementary, weak],
      {},
    );

    expect(result.accepted).toHaveLength(3);
    expect(result.selected.map((item) => item.chunk_id)).toEqual([
      'strong',
      'complementary',
    ]);
    expect(result.selectionThreshold).toBeGreaterThan(0.5);
  });
});
