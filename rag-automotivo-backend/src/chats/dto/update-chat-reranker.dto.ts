import { IsIn } from 'class-validator';

import type { VisualReranker } from '../../rag/types';

export class UpdateChatRerankerDto {
  @IsIn(['clip', 'qwen'])
  visualReranker: VisualReranker;
}
