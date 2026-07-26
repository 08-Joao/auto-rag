import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { MessageSender } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { RagService } from '../rag/rag.service';
import type {
  RagAnswer,
  RagChatHistoryMessage,
  RagConversationState,
  RagSource,
  VisualReranker,
} from '../rag/types';

type PersistedChat = Awaited<ReturnType<ChatsService['findOne']>>;
type PersistedUserMessage = Awaited<
  ReturnType<ChatsService['createUserMessage']>
>;

export type ChatStreamEvent =
  | { type: 'user_message'; message: PersistedUserMessage }
  | { type: 'assistant_start'; messageId: string }
  | {
      type: 'sources';
      sources: RagSource[];
      returnImages: boolean;
      visualIntent: boolean;
    }
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
        visualReranker: true,
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

  async remove(id: string, userId: string) {
    await this.getOwnedChat(id, userId);

    await this.prisma.$transaction([
      this.prisma.message.deleteMany({ where: { chatId: id } }),
      this.prisma.chats.delete({ where: { id } }),
    ]);

    return { id };
  }

  async updateReranker(
    id: string,
    userId: string,
    visualReranker: VisualReranker,
  ) {
    await this.getOwnedChat(id, userId);

    return this.prisma.chats.update({
      where: { id },
      data: { visualReranker },
      select: this.chatWithMessagesSelect(),
    });
  }

  async sendMessage(id: string, userId: string, content: string) {
    const chat = await this.getOwnedChat(id, userId);
    const trimmedContent = content.trim();
    const history = await this.getRecentHistory(id);
    const conversationState = await this.getLatestConversationState(id);
    const ragAnswer = await this.ragService.answer(trimmedContent, history, {
      chatId: id,
      conversationState: conversationState ?? undefined,
      visualReranker: this.normalizeVisualReranker(chat.visualReranker),
    });
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
          metadata: this.buildMessageMetadata(ragAnswer),
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
    const conversationState = await this.getLatestConversationState(id);
    const userMessage = await this.createUserMessage(
      id,
      userId,
      trimmedContent,
    );
    const assistantMessageId = randomUUID();

    yield { type: 'user_message', message: userMessage };
    yield { type: 'assistant_start', messageId: assistantMessageId };

    let answer = '';
    let sources: RagSource[] = [];
    let returnImages = false;
    let ragAnswerMetadata: Partial<RagAnswer> = {
      sources: [],
      returnImages: false,
    };

    for await (const event of this.ragService.streamAnswer(
      trimmedContent,
      history,
      {
        chatId: id,
        conversationState: conversationState ?? undefined,
        visualReranker: this.normalizeVisualReranker(chat.visualReranker),
      },
      signal,
    )) {
      if (signal?.aborted) {
        return;
      }

      if (event.type === 'sources') {
        sources = event.sources;
        returnImages = event.returnImages;
        ragAnswerMetadata = {
          ...ragAnswerMetadata,
          sources,
          returnImages,
        };
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
        returnImages = event.returnImages;
        ragAnswerMetadata = {
          sources,
          returnImages,
          confidence: 0,
          status: 'error',
          warnings: [event.message],
        };
        yield { type: 'token', token: event.message };
        continue;
      }

      if (event.type === 'done') {
        sources = event.sources;
        returnImages = event.returnImages;
        ragAnswerMetadata = {
          answer: event.answer,
          sources,
          returnImages,
          confidence: event.confidence,
          status: event.status,
          reasoningType: event.reasoningType,
          vehicleDetected: event.vehicleDetected,
          citations: event.citations,
          images: event.images,
          warnings: event.warnings,
          missingInformation: event.missingInformation,
          conversationState: event.conversationState,
          resolvedQuery: event.resolvedQuery,
          isFollowUp: event.isFollowUp,
          visualReranker: event.visualReranker,
        };
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
          metadata: this.buildMessageMetadata({
            ...ragAnswerMetadata,
            sources,
            returnImages,
          }),
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
        visualReranker: true,
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
      visualReranker: true,
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

  private normalizeVisualReranker(
    value: string | null | undefined,
  ): VisualReranker {
    return value === 'qwen' ? 'qwen' : 'clip';
  }

  private async createUserMessage(
    chatId: string,
    userId: string,
    content: string,
  ) {
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

  private async getRecentHistory(
    chatId: string,
  ): Promise<RagChatHistoryMessage[]> {
    const messages = await this.prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'desc' },
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

  private async getLatestConversationState(
    chatId: string,
  ): Promise<RagConversationState | null> {
    const messages = await this.prisma.message.findMany({
      where: { chatId, sender: MessageSender.SYSTEM },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { metadata: true },
    });

    for (const message of messages) {
      const state = this.extractConversationState(message.metadata);
      if (state) {
        return state;
      }
    }

    return null;
  }

  private extractConversationState(
    metadata: unknown,
  ): RagConversationState | null {
    if (!metadata || typeof metadata !== 'object') {
      return null;
    }

    const state = (metadata as Record<string, unknown>).conversation_state;
    if (!state || typeof state !== 'object') {
      return null;
    }

    const candidate = state as Partial<RagConversationState>;
    return {
      lastUserQuestion: String(candidate.lastUserQuestion ?? ''),
      pendingQuestion: String(candidate.pendingQuestion ?? ''),
      resolvedQuery: String(candidate.resolvedQuery ?? ''),
      intent: String(candidate.intent ?? ''),
      vehicle:
        candidate.vehicle && typeof candidate.vehicle === 'object'
          ? candidate.vehicle
          : {},
      missingSlots: Array.isArray(candidate.missingSlots)
        ? candidate.missingSlots.filter(
            (slot): slot is string => typeof slot === 'string',
          )
        : [],
      lastAnswerNeededClarification:
        candidate.lastAnswerNeededClarification === true,
      messageIntent: candidate.messageIntent,
    };
  }

  private buildMessageMetadata(ragAnswer: Partial<RagAnswer>) {
    const sources = ragAnswer.sources ?? [];
    const returnImages = ragAnswer.returnImages ?? false;

    return {
      return_images: returnImages,
      visual_intent: returnImages,
      confidence: ragAnswer.confidence,
      status: ragAnswer.status,
      reasoning_type: ragAnswer.reasoningType,
      vehicle_detected: ragAnswer.vehicleDetected,
      citations: ragAnswer.citations ?? [],
      images: ragAnswer.images ?? [],
      warnings: ragAnswer.warnings ?? [],
      missing_information: ragAnswer.missingInformation ?? [],
      conversation_state: ragAnswer.conversationState,
      resolved_query: ragAnswer.resolvedQuery,
      is_follow_up: ragAnswer.isFollowUp,
      visual_reranker: ragAnswer.visualReranker,
      sources: sources.map((source) => ({
        score: source.score,
        chunk_id: source.chunk_id,
        document_name: source.document_name,
        pdf_path: source.pdf_path,
        page_start: source.page_start,
        page_end: source.page_end,
        section_title: source.section_title,
        image_paths: source.image_paths,
        clip_results: source.clip_results,
        metadata: source.metadata,
        retrieval_scores: source.retrieval_scores,
      })),
    };
  }
}
