import { Injectable } from '@nestjs/common';
import { Ollama } from '@langchain/ollama';

@Injectable()
export class OllamaService {
  private readonly baseUrl =
    process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  private readonly model = process.env.OLLAMA_MODEL ?? 'deepseek-r1:8b';
  private readonly llm = new Ollama({
    baseUrl: this.baseUrl,
    model: this.model,
    temperature: Number(
      process.env.RAG_GENERATION_TEMPERATURE ??
        process.env.OLLAMA_TEMPERATURE ??
        0,
    ),
    topP: Number(
      process.env.RAG_GENERATION_TOP_P ?? process.env.OLLAMA_TOP_P ?? 1,
    ),
    numCtx: Number(process.env.OLLAMA_NUM_CTX ?? 8192),
    think: false,
  });

  getModel(): Ollama {
    return this.llm;
  }

  cleanOutput(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  cleanStreamToken(token: string): string {
    return token.replace(/<think>[\s\S]*?<\/think>/gi, '');
  }
}
