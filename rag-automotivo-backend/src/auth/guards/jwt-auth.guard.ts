import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthService } from '../auth.service';
import type { RequestWithUser } from '../types/authenticated-request';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const accessToken = this.authService.getCookieValue(
      request.headers.cookie,
      'accessToken',
    );

    if (!accessToken) {
      throw new UnauthorizedException('Sessao expirada. Faca login novamente.');
    }

    request.user = await this.authService.verifyAccessToken(accessToken);
    return true;
  }
}
