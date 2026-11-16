import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';

import { AppModule } from '../src/app.module';
import { RagService } from '../src/rag/rag.service';

type Question = {
  id: string;
  text: string;
};

type SystemId = 'deepseek-no-rag' | 'rag-clip' | 'rag-qwen';

const projectRoot = resolve(process.cwd(), '..');
function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const experimentRoot = resolve(projectRoot, 'experiments');

const outputFolders: Record<SystemId, string> = {
  'deepseek-no-rag': 'deepseek-sem-rag',
  'rag-clip': 'rag-com-clip',
  'rag-qwen': 'rag-com-qwen',
};

function visibleAnswer(response: string): string {
  return response.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function selectedSystems(): SystemId[] {
  const raw = argValue('--systems') ?? 'deepseek-no-rag,rag-clip,rag-qwen';
  const allowed = new Set<SystemId>([
    'deepseek-no-rag',
    'rag-clip',
    'rag-qwen',
  ]);
  return raw
    .split(',')
    .map((value) => value.trim() as SystemId)
    .filter((value) => allowed.has(value));
}

async function saveResult(
  question: Question,
  system: SystemId,
  response: string,
  metadata: Record<string, unknown>,
) {
  const outputDir = resolve(
    experimentRoot,
    question.id,
    outputFolders[system],
  );
  await mkdir(outputDir, { recursive: true });
  const imagesDir = resolve(outputDir, 'imagens');
  await rm(imagesDir, { recursive: true, force: true });

  const ragMetadata = metadata.rag_metadata as
    | { images?: Array<{ imagePath?: string }> }
    | undefined;
  const copiedImages: string[] = [];
  for (const [index, image] of (ragMetadata?.images ?? []).entries()) {
    if (!image.imagePath) continue;
    const source = resolve(projectRoot, image.imagePath);
    const extension = extname(source) || '.png';
    const fileName = `${String(index + 1).padStart(2, '0')}-${basename(
      source,
      extension,
    )}${extension}`;
    await mkdir(imagesDir, { recursive: true });
    await copyFile(source, resolve(imagesDir, fileName));
    copiedImages.push(fileName);
  }

  const imageMarkdown = copiedImages.length
    ? `\n\n## Imagens exibidas\n\n${copiedImages
        .map(
          (fileName, index) =>
            `![Imagem ${index + 1}](imagens/${fileName})`,
        )
        .join('\n\n')}\n`
    : '\n';
  await writeFile(
    resolve(outputDir, 'resposta.md'),
    `${visibleAnswer(response)}${imageMarkdown}`,
  );
}

async function loadQuestions(): Promise<Question[]> {
  const entries = await readdir(experimentRoot, { withFileTypes: true });
  const directories = entries
    .filter(
      (entry) => entry.isDirectory() && /^pergunta-\d{2}$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    directories.map(async (id) => {
      const content = await readFile(
        resolve(experimentRoot, id, 'pergunta.md'),
        'utf8',
      );
      return {
        id,
        text: content.replace(/^#\s+Pergunta\s+\d+\s*/i, '').trim(),
      };
    }),
  );
}

async function runDeepSeekNoRag(question: Question) {
  const startedAt = new Date();
  const started = performance.now();
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-r1:8b',
      prompt: question.text,
      stream: false,
      think: false,
      options: { temperature: 0, top_p: 1, num_ctx: 8192 },
    }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  const answer = String(payload.response ?? '').trim();
  await saveResult(question, 'deepseek-no-rag', answer, {
    origin: 'Ollama local, chamada stateless sem contexto documental',
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    latency_ms: Math.round(performance.now() - started),
    model: 'deepseek-r1:8b',
    parameters: {
      temperature: 0,
      top_p: 1,
      top_k: 'Ollama default (not overridden)',
      seed: 'not set',
      num_ctx: 8192,
      think: false,
      system_prompt: null,
      manual_context: null,
    },
    ollama_metrics: {
      total_duration_ns: payload.total_duration,
      load_duration_ns: payload.load_duration,
      prompt_eval_count: payload.prompt_eval_count,
      prompt_eval_duration_ns: payload.prompt_eval_duration,
      eval_count: payload.eval_count,
      eval_duration_ns: payload.eval_duration,
    },
    technical_retries: 0,
  });
}

async function runRag(
  rag: RagService,
  question: Question,
  system: 'rag-clip' | 'rag-qwen',
) {
  const reranker = system === 'rag-qwen' ? 'qwen' : 'clip';
  const startedAt = new Date();
  const started = performance.now();
  const ragAnswer = await rag.answer(question.text, [], {
    chatId: `experimento-${question.id}-${system}`,
    visualReranker: reranker,
  });
  const latencyMs = Math.round(performance.now() - started);
  await saveResult(question, system, ragAnswer.answer, {
    origin: 'Auto RAG local, pergunta isolada sem persistência de chat',
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    latency_ms: latencyMs,
    model: 'deepseek-r1:8b',
    visual_reranker_requested: reranker,
    parameters: {
      temperature: 0,
      top_p: 1,
      top_k: 'Ollama default (not overridden)',
      seed: 'not set',
      num_ctx: 8192,
    },
    rag_metadata: {
      return_images: ragAnswer.returnImages,
      confidence: ragAnswer.confidence,
      status: ragAnswer.status,
      citations: ragAnswer.citations ?? [],
      images: ragAnswer.images ?? [],
      sources: ragAnswer.sources,
      visual_reranker: ragAnswer.visualReranker,
      multimodal_diagnostics: ragAnswer.multimodalDiagnostics,
    },
    technical_retries: 0,
  });
}

async function main() {
  process.env.RAG_QWEN_RERANKER_ENABLED = 'true';
  process.env.RAG_RETRIEVAL_CACHE_TTL_MS = '0';
  process.env.RAG_QWEN_RERANKER_MODEL = 'qwen2.5vl:7b';

  const requested = new Set(selectedSystems());
  const questionFilter = new Set(
    (argValue('--questions') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const questions = (await loadQuestions()).filter(
    (question) => questionFilter.size === 0 || questionFilter.has(question.id),
  );

  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | null =
    null;
  try {
    if (requested.has('rag-clip') || requested.has('rag-qwen')) {
      app = await NestFactory.createApplicationContext(AppModule, {
        logger: ['error', 'warn', 'log'],
      });
    }
    const rag = app?.get(RagService);

    for (const [index, question] of questions.entries()) {
      if (requested.has('deepseek-no-rag')) {
        await runDeepSeekNoRag(question);
      }
      const pairedOrder: Array<'rag-clip' | 'rag-qwen'> =
        index % 2 === 0 ? ['rag-clip', 'rag-qwen'] : ['rag-qwen', 'rag-clip'];
      for (const system of pairedOrder) {
        if (requested.has(system)) {
          await runRag(rag!, question, system);
        }
      }
    }
  } finally {
    await app?.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
