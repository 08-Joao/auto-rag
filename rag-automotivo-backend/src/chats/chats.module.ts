import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RagModule } from '../rag/rag.module';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';

@Module({
  imports: [AuthModule, PrismaModule, RagModule],
  controllers: [ChatsController],
  providers: [ChatsService],
})
export class ChatsModule {}
