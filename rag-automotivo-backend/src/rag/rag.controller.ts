import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('rag')
export class RagController {
  private readonly projectRoot = resolve(process.cwd(), '..');

  @Get('assets')
  getAsset(@Query('path') assetPath: string, @Res() res: Response) {
    if (!assetPath || assetPath.includes('..')) {
      throw new BadRequestException('Caminho de imagem invalido.');
    }

    const absolutePath = resolve(this.projectRoot, assetPath);
    const allowedRoot = resolve(this.projectRoot, 'rag_chunks_output', 'images');

    if (!absolutePath.startsWith(allowedRoot) || !existsSync(absolutePath)) {
      throw new BadRequestException('Imagem nao encontrada.');
    }

    return res.sendFile(absolutePath);
  }
}
