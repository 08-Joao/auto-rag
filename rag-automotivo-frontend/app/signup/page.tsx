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
import { signUp } from "@/services/auth";

type FieldErrors = {
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
};

const strongPasswordPattern =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const isValid = useMemo(
    () =>
      name.trim().length >= 2 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
      strongPasswordPattern.test(password) &&
      password === confirmPassword,
    [confirmPassword, email, name, password],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApiError("");
    setSuccess("");

    const nextErrors: FieldErrors = {};
    if (name.trim().length < 2) {
      nextErrors.name = "Informe seu nome completo.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      nextErrors.email = "Informe um e-mail válido.";
    }
    if (!strongPasswordPattern.test(password)) {
      nextErrors.password =
        "Use 8+ caracteres com maiúscula, minúscula, número e símbolo.";
    }
    if (password !== confirmPassword) {
      nextErrors.confirmPassword = "A confirmação precisa ser igual à senha.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsLoading(true);
    try {
      await signUp({ name, email, password, confirmPassword });
      setSuccess("Conta criada. Redirecionando...");
      router.replace("/");
      router.refresh();
    } catch (error) {
      setApiError(
        error instanceof ApiError
          ? error.message
          : "Não foi possível criar a conta. Tente novamente.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Crie seu acesso"
      highlights={["Histórico", "Fontes", "Imagens"]}
      side="right"
      subtitle="Salve suas conversas e consulte respostas fundamentadas nos manuais disponíveis."
      title="Criar uma conta"
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="name">Nome</Label>
          <Input
            autoComplete="name"
            id="name"
            onChange={(event) => setName(event.target.value)}
            placeholder="Seu nome"
            value={name}
          />
          {errors.name && (
            <p className="text-sm text-destructive">{errors.name}</p>
          )}
        </div>

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
          autoComplete="new-password"
          error={errors.password}
          id="password"
          label="Senha"
          onChange={setPassword}
          placeholder="Senha forte"
          value={password}
        />

        <PasswordField
          autoComplete="new-password"
          error={errors.confirmPassword}
          id="confirmPassword"
          label="Confirmar senha"
          onChange={setConfirmPassword}
          placeholder="Repita a senha"
          value={confirmPassword}
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
          {isLoading ? "Criando acesso…" : "Criar conta"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Já tem uma conta?{" "}
        <Link className="font-semibold text-foreground" href="/signin">
          Entrar
        </Link>
      </p>
    </AuthShell>
  );
}
