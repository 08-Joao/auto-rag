import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { VisualImageService } from './visual-image.service';
import type { RagSource } from './types';

describe('VisualImageService image reranker', () => {
  const imageDir = join(process.cwd(), 'tmp-reranker-images');

  beforeAll(() => {
    mkdirSync(imageDir, { recursive: true });
    writeFileSync(join(imageDir, 'oil-cap.jpg'), Buffer.alloc(4096, 1));
    writeFileSync(join(imageDir, 'hood-release.jpg'), Buffer.alloc(4096, 1));
    writeFileSync(join(imageDir, 'cover.jpg'), Buffer.alloc(4096, 1));
    writeFileSync(join(imageDir, 'generic-car.jpg'), Buffer.alloc(4096, 1));
    writeFileSync(join(imageDir, 'empty.jpg'), Buffer.alloc(16, 1));
  });

  afterAll(() => {
    rmSync(imageDir, { recursive: true, force: true });
  });

  it('keeps only images with textual and visual evidence for the oil cap', () => {
    const service = new VisualImageService();
    const sources: RagSource[] = [
      {
        score: 0.93,
        chunk_id: 'engine-layout',
        document_name: '2010-audi-a4.pdf',
        page_start: 270,
        page_end: 271,
        section_title: 'Engine compartment',
        text: [
          'Fig. 199 Typical layout for containers and engine oil filler cap',
          'Engine oil filler cap(~)',
          'Engine compartment',
        ].join('\n'),
        image_paths: ['rag-automotivo-backend/tmp-reranker-images/oil-cap.jpg'],
        metadata: {},
      },
      {
        score: 0.92,
        chunk_id: 'engine-layout-with-wrong-neighbor-image',
        document_name: '2008-audi-a4.pdf',
        page_start: 257,
        page_end: 258,
        section_title: 'Engine compartment layout',
        text: [
          'Fig. 252 Typical locations of fluid containers, engine oil dipstick and engine oil filler cap',
          'Engine oil filler cap',
          'Main components for checking and refilling',
        ].join('\n'),
        image_paths: ['rag-automotivo-backend/tmp-reranker-images/hood-release.jpg'],
        metadata: {},
      },
      {
        score: 0.8,
        chunk_id: 'cover',
        document_name: '2010-audi-a4.pdf',
        page_start: 1,
        page_end: 1,
        section_title: 'Cover',
        text: '2010 Audi A4 Owner\'s Manual',
        image_paths: ['rag-automotivo-backend/tmp-reranker-images/cover.jpg'],
        metadata: {},
      },
      {
        score: 0.8,
        chunk_id: 'generic',
        document_name: '2010-audi-a4.pdf',
        page_start: 2,
        page_end: 2,
        section_title: 'Vehicle overview',
        text: 'Audi A4 exterior vehicle overview',
        image_paths: ['rag-automotivo-backend/tmp-reranker-images/generic-car.jpg'],
        metadata: {},
      },
      {
        score: 0.8,
        chunk_id: 'empty',
        document_name: '2010-audi-a4.pdf',
        page_start: 270,
        page_end: 270,
        section_title: 'Engine compartment',
        text: 'Fig. 199 Typical layout for containers and engine oil filler cap',
        image_paths: ['rag-automotivo-backend/tmp-reranker-images/empty.jpg'],
        metadata: {},
      },
    ];

    const result = service.rerankImages({
      resolvedQuery: 'Onde fica a tampa de óleo do Audi A4 2010?',
      intent: 'visual_location',
      component: 'tampa de oleo',
      vehicle: { brand: 'Audi', model: 'A4', year: '2010' },
      sources,
      clipResults: [
        {
          imagePath: 'rag-automotivo-backend/tmp-reranker-images/oil-cap.jpg',
          score: 0.9,
          page: 270,
        },
        {
          imagePath: 'rag-automotivo-backend/tmp-reranker-images/cover.jpg',
          score: 0.95,
          page: 1,
        },
        {
          imagePath: 'rag-automotivo-backend/tmp-reranker-images/hood-release.jpg',
          score: 0.92,
          positiveScore: 0.92,
          negativeScore: 0.95,
          negativeLabel: 'front grille bonnet release latch',
          page: 256,
        },
        {
          imagePath: 'rag-automotivo-backend/tmp-reranker-images/generic-car.jpg',
          score: 0.9,
          page: 2,
        },
        {
          imagePath: 'rag-automotivo-backend/tmp-reranker-images/empty.jpg',
          score: 0.99,
          page: 270,
        },
      ],
    });

    expect(result.selectedImages).toHaveLength(1);
    expect(result.selectedImages[0].imagePath).toContain('oil-cap.jpg');
    expect(result.rejectedImages.map((image) => image.imagePath)).toEqual(
      expect.arrayContaining([
        'rag-automotivo-backend/tmp-reranker-images/cover.jpg',
        'rag-automotivo-backend/tmp-reranker-images/hood-release.jpg',
        'rag-automotivo-backend/tmp-reranker-images/generic-car.jpg',
        'rag-automotivo-backend/tmp-reranker-images/empty.jpg',
      ]),
    );
    expect(result.rejectedImages.map((image) => image.reason).join(' ')).toMatch(
      /capa|capo|generica|vazia|quebrada|inacessivel/i,
    );
  });
});
