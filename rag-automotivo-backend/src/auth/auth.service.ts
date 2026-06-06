import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import type { Response } from 'express';
import { promisify } from 'util';

import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SignInDto } from './dto/signin.dto';
import { SignUpDto } from './dto/signup.dto';
import type { AuthenticatedUser } from './types/authenticated-request';

const scrypt = promisify(scryptCallback);

type PublicUser = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
};

type TokenPair = {
  accessToken: string;
  refreshToken: string;
};

type JwtPayload = {
  sub: string;
  email: string;
};

@Injectable()
export class AuthService {
  private readonly accessCookieName = 'accessToken';
  private readonly refreshCookieName = 'refreshToken';
  private readonly accessTokenTtl = '15m';
  private readonly refreshTokenTtl = '7d';
  private readonly accessCookieMaxAge = 15 * 60 * 1000;
  private readonly refreshCookieMaxAge = 7 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async signUp(
    dto: SignUpDto,
  ): Promise<{ user: PublicUser; tokens: TokenPair }> {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('As senhas informadas nao conferem.');
    }

    try {
      const passwordHash = await this.hashSecret(dto.password);
      const user = await this.prisma.user.create({
        data: {
          name: dto.name.trim(),
          email: dto.email.toLowerCase().trim(),
          passwordHash,
        },
        select: this.publicUserSelect(),
      });
      const tokens = await this.createSession(user.id, user.email);

      return { user, tokens };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ja existe uma conta com este e-mail.');
      }

      throw error;
    }
  }

  async signIn(
    dto: SignInDto,
  ): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
      select: {
        id: true,
        name: true,
        email: true,
        passwordHash: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user || !(await this.verifySecret(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('E-mail ou senha invalidos.');
    }

    const tokens = await this.createSession(user.id, user.email);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      tokens,
    };
  }

  async refresh(
    cookieHeader?: string,
  ): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const refreshToken = this.getCookieValue(
      cookieHeader,
      this.refreshCookieName,
    );

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token ausente.');
    }

    const payload = await this.verifyRefreshToken(refreshToken);
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        ...this.publicUserSelect(),
        refreshTokenHash: true,
      },
    });

    if (
      !user?.refreshTokenHash ||
      !(await this.verifySecret(refreshToken, user.refreshTokenHash))
    ) {
      throw new UnauthorizedException('Sessao invalida. Faca login novamente.');
    }

    const tokens = await this.createSession(user.id, user.email);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      tokens,
    };
  }

  async logout(cookieHeader?: string): Promise<void> {
    const refreshToken = this.getCookieValue(
      cookieHeader,
      this.refreshCookieName,
    );

    if (!refreshToken) {
      return;
    }

    try {
      const payload = await this.verifyRefreshToken(refreshToken);
      await this.prisma.user.update({
        where: { id: payload.sub },
        data: { refreshTokenHash: null },
      });
    } catch {
      return;
    }
  }

  async getMe(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: this.publicUserSelect(),
    });

    if (!user) {
      throw new UnauthorizedException('Usuario nao encontrado.');
    }

    return user;
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.getAccessTokenSecret(),
      });
      return { id: payload.sub, email: payload.email };
    } catch {
      throw new UnauthorizedException('Sessao expirada. Faca login novamente.');
    }
  }

  setAuthCookies(response: Response, tokens: TokenPair): void {
    response.cookie(this.accessCookieName, tokens.accessToken, {
      ...this.cookieBaseOptions(),
      maxAge: this.accessCookieMaxAge,
    });
    response.cookie(this.refreshCookieName, tokens.refreshToken, {
      ...this.cookieBaseOptions(),
      maxAge: this.refreshCookieMaxAge,
    });
  }

  clearAuthCookies(response: Response): void {
    response.clearCookie(this.accessCookieName, this.cookieBaseOptions());
    response.clearCookie(this.refreshCookieName, this.cookieBaseOptions());
  }

  getCookieValue(
    cookieHeader: string | undefined,
    name: string,
  ): string | null {
    if (!cookieHeader) {
      return null;
    }

    const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());
    const cookie = cookies.find((item) => item.startsWith(`${name}=`));

    if (!cookie) {
      return null;
    }

    return decodeURIComponent(cookie.slice(name.length + 1));
  }

  private async createSession(
    userId: string,
    email: string,
  ): Promise<TokenPair> {
    const payload: JwtPayload = { sub: userId, email };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.getAccessTokenSecret(),
        expiresIn: this.accessTokenTtl,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.getRefreshTokenSecret(),
        expiresIn: this.refreshTokenTtl,
      }),
    ]);
    const refreshTokenHash = await this.hashSecret(refreshToken);

    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash },
    });

    return { accessToken, refreshToken };
  }

  private async verifyRefreshToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.getRefreshTokenSecret(),
      });
    } catch {
      throw new UnauthorizedException('Refresh token invalido ou expirado.');
    }
  }

  private async hashSecret(secret: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await scrypt(secret, salt, 64)) as Buffer;

    return `${salt}:${derivedKey.toString('hex')}`;
  }

  private async verifySecret(secret: string, hash: string): Promise<boolean> {
    const [salt, key] = hash.split(':');

    if (!salt || !key) {
      return false;
    }

    const derivedKey = (await scrypt(secret, salt, 64)) as Buffer;
    const storedKey = Buffer.from(key, 'hex');

    return (
      storedKey.length === derivedKey.length &&
      timingSafeEqual(storedKey, derivedKey)
    );
  }

  private publicUserSelect() {
    return {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      updatedAt: true,
    };
  }

  private cookieBaseOptions() {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };
  }

  private getAccessTokenSecret(): string {
    return process.env.JWT_ACCESS_SECRET ?? 'dev-access-token-secret';
  }

  private getRefreshTokenSecret(): string {
    return process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-token-secret';
  }
}
