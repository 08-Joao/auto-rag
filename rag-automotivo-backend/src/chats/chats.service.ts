import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { MessageSender } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { RagService } from '../rag/rag.service';
import type { RagChatHistoryMessage, RagSource } from '../rag/types';

type PersistedChat = Awaited<ReturnType<ChatsService['findOne']>>;
type PersistedUserMessage = Awaited<ReturnType<ChatsService['createUserMessage']>>;

export type ChatStreamEvent =
  | { type: 'user_message'; message: PersistedUserMessage }
  | { type: 'assistant_start'; messageId: string }
  | { type: 'sources'; sources: RagSource[]; visualIntent: boolean }
  | { type: 'token'; token: string }
  | { type: 'done'; chat: PersistedChat }
  | { type: 'error'; message: string };

@Injectable()
export class ChatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ragService: RagService,
  ) {}

  findAll(userId: string) {
    return this.prisma.chats.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        message: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            content: true,
            metadata: true,
            sender: true,
            createdAt: true,
          },
        },
        _count: {
          select: { message: true },
        },
      },
    });
  }

  async create(userId: string) {
    return this.prisma.chats.create({
      data: { userId, title: 'Novo diagnostico' },
      select: this.chatWithMessagesSelect(),
    });
  }

  async findOne(id: string, userId: string) {
    const chat = await this.prisma.chats.findUnique({
      where: { id },
      select: this.chatWithMessagesSelect(),
    });

    if (!chat) {
      throw new NotFoundException('Chat nao encontrado.');
    }

    if (chat.userId !== userId) {
      throw new ForbiddenException('Voce nao tem acesso a este chat.');
    }

    return chat;
  }

  async sendMessage(id: string, userId: string, content: string) {
    const chat = await this.getOwnedChat(id, userId);
    const trimmedContent = content.trim();
    const history = await this.getRecentHistory(id);
    const ragAnswer = await this.ragService.answer(trimmedContent, history);
    const shouldUpdateTitle = chat._count.message === 0;

    await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          chatId: id,
          userId,
          content: trimmedContent,
          sender: MessageSender.USER,
        },
      }),
      this.prisma.message.create({
        data: {
          chatId: id,
          content: ragAnswer.answer,
          metadata: this.buildMessageMetadata(
            ragAnswer.sources,
            ragAnswer.visualIntent,
          ),
          sender: MessageSender.SYSTEM,
        },
      }),
      this.prisma.chats.update({
        where: { id },
        data: {
          title: shouldUpdateTitle
            ? this.createTitleFromPrompt(trimmedContent)
            : chat.title,
        },
      }),
    ]);

    return this.findOne(id, userId);
  }

  async *streamMessage(
    id: string,
    userId: string,
    content: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    const chat = await this.getOwnedChat(id, userId);
    const trimmedContent = content.trim();
    const shouldUpdateTitle = chat._count.message === 0;
    const history = await this.getRecentHistory(id);
    const userMessage = await this.createUserMessage(id, userId, trimmedContent);
    const assistantMessageId = randomUUID();

    yield { type: 'user_message', message: userMessage };
    yield { type: 'assistant_start', messageId: assistantMessageId };

    let answer = '';
    let sources: RagSource[] = [];
    let visualIntent = false;

    for await (const event of this.ragService.streamAnswer(
      trimmedContent,
      history,
      signal,
    )) {
      if (signal?.aborted) {
        return;
      }

      if (event.type === 'sources') {
        sources = event.sources;
        visualIntent = event.visualIntent;
        yield event;
        continue;
      }

      if (event.type === 'token') {
        answer += event.token;
        yield event;
        continue;
      }

      if (event.type === 'error') {
        answer = event.message;
        sources = event.sources;
        visualIntent = event.visualIntent;
        yield { type: 'token', token: event.message };
      }
    }

    if (signal?.aborted || !answer.trim()) {
      return;
    }

    await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          id: assistantMessageId,
          chatId: id,
          content: answer.trim(),
          metadata: this.buildMessageMetadata(sources, visualIntent),
          sender: MessageSender.SYSTEM,
        },
      }),
      this.prisma.chats.update({
        where: { id },
        data: {
          title: shouldUpdateTitle
            ? this.createTitleFromPrompt(trimmedContent)
            : chat.title,
        },
      }),
    ]);

    yield { type: 'done', chat: await this.findOne(id, userId) };
  }

  private async getOwnedChat(id: string, userId: string) {
    const chat = await this.prisma.chats.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        title: true,
        _count: { select: { message: true } },
      },
    });

    if (!chat) {
      throw new NotFoundException('Chat nao encontrado.');
    }

    if (chat.userId !== userId) {
      throw new ForbiddenException('Voce nao tem acesso a este chat.');
    }

    return chat;
  }

  private chatWithMessagesSelect() {
    return {
      id: true,
      userId: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      message: {
        orderBy: { createdAt: 'asc' as const },
        select: {
          id: true,
          content: true,
          metadata: true,
          sender: true,
          createdAt: true,
        },
      },
    };
  }

  private createTitleFromPrompt(content: string): string {
    const title = content.replace(/\s+/g, ' ').slice(0, 48).trim();
    return title.length >= 8 ? title : 'Novo diagnostico';
  }

  private async createUserMessage(chatId: string, userId: string, content: string) {
    return this.prisma.message.create({
      data: {
        chatId,
        userId,
        content,
        sender: MessageSender.USER,
      },
      select: {
        id: true,
        content: true,
        metadata: true,
        sender: true,
        createdAt: true,
      },
    });
  }

  private async getRecentHistory(chatId: string): Promise<RagChatHistoryMessage[]> {
    const messages = await this.prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        content: true,
        sender: true,
      },
    });

    return messages.reverse().map((message) => ({
      sender: message.sender,
      content: message.content,
    }));
  }

  private buildMessageMetadata(sources: RagSource[], visualIntent: boolean) {
    return {
      visual_intent: visualIntent,
      sources: sources.map((source) => ({
        score: source.score,
        chunk_id: source.chunk_id,
        document_name: source.document_name,
        pdf_path: source.pdf_path,
        page_start: source.page_start,
        page_end: source.page_end,
        section_title: source.section_title,
        image_paths: source.image_paths,
        metadata: source.metadata,
      })),
    };
  }
}
