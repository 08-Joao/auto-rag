"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { PasswordField } from "@/components/auth/password-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { signIn } from "@/services/auth";

type FieldErrors = {
  email?: string;
  password?: string;
};

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const isValid = useMemo(
    () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && password.length >= 8,
    [email, password],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApiError("");
    setSuccess("");

    const nextErrors: FieldErrors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      nextErrors.email = "Informe um e-mail válido.";
    }
    if (password.length < 8) {
      nextErrors.password = "A senha precisa ter pelo menos 8 caracteres.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsLoading(true);
    try {
      await signIn({ email, password });
      setSuccess("Acesso autorizado. Redirecionando...");
      router.replace("/");
      router.refresh();
    } catch (error) {
      setApiError(
        error instanceof ApiError
          ? error.message
          : "Não foi possível entrar. Revise os dados e tente novamente.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Acesso seguro"
      highlights={["Manuais", "Diagnóstico", "Histórico"]}
      side="left"
      subtitle="Entre para continuar suas consultas aos manuais automotivos."
      title="Acessar sua conta"
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            autoComplete="email"
            id="email"
            inputMode="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="voce@empresa.com"
            value={email}
          />
          {errors.email && (
            <p className="text-sm text-destructive">{errors.email}</p>
          )}
        </div>

        <PasswordField
          autoComplete="current-password"
          error={errors.password}
          id="password"
          label="Senha"
          onChange={setPassword}
          placeholder="Sua senha"
          value={password}
        />

        {apiError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
            {apiError}
          </div>
        )}
        {success && (
          <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2.5 text-sm text-success">
            {success}
          </div>
        )}

        <Button className="w-full" disabled={!isValid || isLoading}>
          {isLoading ? "Validando credenciais…" : "Entrar"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Ainda não tem conta?{" "}
        <Link className="font-semibold text-foreground" href="/signup">
          Criar conta
        </Link>
      </p>
    </AuthShell>
  );
}
