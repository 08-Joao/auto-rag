import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-request';
import { ChatsService } from './chats.service';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateChatRerankerDto } from './dto/update-chat-reranker.dto';

@UseGuards(JwtAuthGuard)
@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.chatsService.findAll(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser) {
    return this.chatsService.create(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.chatsService.findOne(id, user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.chatsService.remove(id, user.id);
  }

  @Patch(':id/reranker')
  updateReranker(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateChatRerankerDto,
  ) {
    return this.chatsService.updateReranker(id, user.id, dto.visualReranker);
  }

  @Post(':id/messages')
  sendMessage(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatsService.sendMessage(id, user.id, dto.content);
  }

  @Post(':id/messages/stream')
  async streamMessage(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SendMessageDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const writeEvent = (event: unknown) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      for await (const event of this.chatsService.streamMessage(
        id,
        user.id,
        dto.content,
        abortController.signal,
      )) {
        if (abortController.signal.aborted) {
          break;
        }
        writeEvent(event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeEvent({ type: 'error', message });
    } finally {
      res.end();
    }
  }
}
