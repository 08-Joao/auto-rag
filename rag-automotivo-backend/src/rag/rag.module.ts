import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OllamaService } from './ollama.service';
import { RagController } from './rag.controller';
import { RagRetrieverService } from './rag-retriever.service';
import { RagService } from './rag.service';

@Module({
  imports: [AuthModule],
  controllers: [RagController],
  providers: [OllamaService, RagRetrieverService, RagService],
  exports: [RagService],
})
export class RagModule {}
