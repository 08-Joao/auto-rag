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
      nextErrors.email = "Informe um e-mail valido.";
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
          : "Nao foi possivel entrar. Revise os dados e tente novamente.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Acesso seguro"
      highlights={["Manuais", "Diagnostico", "Historico"]}
      side="left"
      subtitle="Consulte manuais automotivos com precisao operacional."
      title="Entrar na plataforma"
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
          <div className="rounded-lg border border-destructive bg-card px-4 py-3 text-sm text-destructive">
            {apiError}
          </div>
        )}
        {success && (
          <div className="rounded-lg border border-success bg-card px-4 py-3 text-sm text-success">
            {success}
          </div>
        )}

        <Button className="h-12 w-full" disabled={!isValid || isLoading}>
          {isLoading ? "Validando credenciais..." : "Entrar"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Ainda nao tem conta?{" "}
        <Link className="font-semibold text-foreground" href="/signup">
          Criar acesso
        </Link>
      </p>
    </AuthShell>
  );
}
