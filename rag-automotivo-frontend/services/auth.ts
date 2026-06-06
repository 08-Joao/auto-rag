import { apiFetch } from "@/lib/api";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};

type AuthResponse = {
  user: AuthUser;
};

export type SignInPayload = {
  email: string;
  password: string;
};

export type SignUpPayload = SignInPayload & {
  name: string;
  confirmPassword: string;
};

export function signIn(payload: SignInPayload) {
  return apiFetch<AuthResponse>("/auth/signin", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function signUp(payload: SignUpPayload) {
  return apiFetch<AuthResponse>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getMe() {
  return apiFetch<AuthUser>("/auth/me");
}

export function logout() {
  return apiFetch<{ success: true }>("/auth/logout", {
    method: "POST",
    retryOnUnauthorized: false,
  });
}
