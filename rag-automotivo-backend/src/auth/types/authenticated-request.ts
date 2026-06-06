import type { Request } from 'express';

export type AuthenticatedUser = {
  id: string;
  email: string;
};

export type RequestWithUser = Request & {
  user: AuthenticatedUser;
};
