import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { MessageSender } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatsService {
  constructor(private readonly prisma: PrismaService) {}

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

    const trimmedContent = content.trim();
    const answer = this.buildRagPlaceholderAnswer(trimmedContent);
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
          content: answer,
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

  private buildRagPlaceholderAnswer(content: string): string {
    return [
      'Recebi sua pergunta e este chat ja esta preparado para o fluxo RAG.',
      `Consulta registrada: "${content}"`,
      'No proximo passo, conectamos esta etapa ao recuperador de documentos automotivos para retornar trechos, fontes e resposta final fundamentada.',
    ].join('\n\n');
  }
}
