import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OllamaService } from './ollama.service';
import { QueryRewriterService } from './query-rewriter.service';
import { RagController } from './rag.controller';
import { RagRetrieverService } from './rag-retriever.service';
import { RagService } from './rag.service';
import { VisualImageService } from './visual-image.service';

@Module({
  imports: [AuthModule],
  controllers: [RagController],
  providers: [
    OllamaService,
    QueryRewriterService,
    RagRetrieverService,
    RagService,
    VisualImageService,
  ],
  exports: [RagService],
})
export class RagModule {}
