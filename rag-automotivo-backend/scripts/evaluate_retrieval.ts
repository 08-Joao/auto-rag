import 'dotenv/config';

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { QueryRewriterService } from '../src/rag/query-rewriter.service';
import { RagRetrieverService } from '../src/rag/rag-retriever.service';
import { RelevanceValidatorService } from '../src/rag/relevance-validator.service';

type Question = {
  id: string;
  text: string;
};

type GroundTruthItem = {
  question_id: string;
  supporting_chunk_ids: string[];
};

type EvaluationItem = {
  questionId: string;
  resolvedQuery: string;
  vehicle: Record<string, string | undefined>;
  expectedChunkIds: string[];
  retrievedChunkIds: string[];
  selectedChunkIds: string[];
  expectedRetrievedRanks: Record<string, number | null>;
  expectedSelectedRanks: Record<string, number | null>;
  retrievalHit: boolean;
  selectionHit: boolean;
  answerability: string;
  selectionThreshold: number;
  durationMs: number;
};

const projectRoot = resolve(process.cwd(), '..');
const experimentRoot = resolve(projectRoot, 'experiments', 'experiment-v1');

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function rankById(ids: string[], expected: string[]): Record<string, number | null> {
  return Object.fromEntries(
    expected.map((chunkId) => {
      const index = ids.indexOf(chunkId);
      return [chunkId, index >= 0 ? index + 1 : null];
    }),
  );
}

async function main() {
  const questionsPayload = JSON.parse(
    await readFile(
      resolve(experimentRoot, 'questions', 'questions.json'),
      'utf8',
    ),
  ) as { questions: Question[] };
  const groundTruthPayload = JSON.parse(
    await readFile(
      resolve(experimentRoot, 'ground-truth', 'ground-truth.json'),
      'utf8',
    ),
  ) as { items: GroundTruthItem[] };
  const expectedByQuestion = new Map(
    groundTruthPayload.items.map((item) => [item.question_id, item]),
  );
  const filter = new Set(
    (argValue('--questions') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const questions = questionsPayload.questions.filter(
    (question) => filter.size === 0 || filter.has(question.id),
  );

  const rewriter = new QueryRewriterService();
  const retriever = new RagRetrieverService();
  const validator = new RelevanceValidatorService();
  const items: EvaluationItem[] = [];

  for (const question of questions) {
    const startedAt = performance.now();
    const expected = expectedByQuestion.get(question.id);
    if (!expected) throw new Error(`Ground truth ausente para ${question.id}`);

    const rewrite = rewriter.rewrite(question.text);
    const retrieved = await retriever.retrieve(rewrite.resolvedQuery, {
      brand: rewrite.vehicle.brand,
      model: rewrite.vehicle.model,
      year: rewrite.vehicle.year,
      engine: rewrite.vehicle.engine,
      version: rewrite.vehicle.version,
    });
    const validation = validator.evaluate(
      rewrite.resolvedQuery,
      retrieved,
      rewrite.vehicle,
    );
    const retrievedIds = retrieved.map((source) => source.chunk_id);
    const selectedIds = validation.selected.map((source) => source.chunk_id);
    const expectedRetrievedRanks = rankById(
      retrievedIds,
      expected.supporting_chunk_ids,
    );
    const expectedSelectedRanks = rankById(
      selectedIds,
      expected.supporting_chunk_ids,
    );

    items.push({
      questionId: question.id,
      resolvedQuery: rewrite.resolvedQuery,
      vehicle: rewrite.vehicle,
      expectedChunkIds: expected.supporting_chunk_ids,
      retrievedChunkIds: retrievedIds,
      selectedChunkIds: selectedIds,
      expectedRetrievedRanks,
      expectedSelectedRanks,
      retrievalHit: Object.values(expectedRetrievedRanks).some(Boolean),
      selectionHit: Object.values(expectedSelectedRanks).some(Boolean),
      answerability: validation.answerability,
      selectionThreshold: validation.selectionThreshold,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }

  const summary = {
    questionCount: items.length,
    retrievalRecallAtFinalK:
      items.filter((item) => item.retrievalHit).length / Math.max(1, items.length),
    selectionRecall:
      items.filter((item) => item.selectionHit).length / Math.max(1, items.length),
    directAnswerabilityRate:
      items.filter((item) => item.answerability === 'DIRECT').length /
      Math.max(1, items.length),
    meanDurationMs: Math.round(
      items.reduce((total, item) => total + item.durationMs, 0) /
        Math.max(1, items.length),
    ),
    steadyStateMeanDurationMs: Math.round(
      items.slice(1).reduce((total, item) => total + item.durationMs, 0) /
        Math.max(1, items.length - 1),
    ),
  };
  const payload = {
    generatedAt: new Date().toISOString(),
    summary,
    items,
  };
  const outputPath = resolve(
    projectRoot,
    argValue('--output') ??
      'experiments/development-tests/retrieval-evaluation.json',
  );
  await mkdir(resolve(outputPath, '..'), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  retriever.onModuleDestroy();
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
