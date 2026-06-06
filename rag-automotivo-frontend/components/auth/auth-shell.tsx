import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AuthShellProps = {
  children: ReactNode;
  eyebrow: string;
  highlights: string[];
  side: "left" | "right";
  subtitle: string;
  title: string;
};

export function AuthShell({
  children,
  eyebrow,
  highlights,
  side,
  subtitle,
  title,
}: AuthShellProps) {
  const form = (
    <section className="flex items-center justify-center px-5 py-10 sm:px-8">
      <div className="w-full max-w-md">
        <div className="mb-8 lg:hidden">
          <p className="text-sm text-muted-foreground">RAG Automotivo</p>
          <h1 className="text-3xl font-semibold">Oficina cognitiva</h1>
        </div>
        <Card className="shadow-[0_24px_80px_var(--border)]">
          <CardHeader className="pb-6">
            <p className="text-sm font-medium text-muted-foreground">{eyebrow}</p>
            <CardTitle className="text-3xl">{title}</CardTitle>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </section>
  );

  const brand = (
    <section className="relative hidden overflow-hidden bg-sidebar-bg px-12 py-10 text-sidebar-text lg:flex lg:flex-col lg:justify-between">
      <div className="absolute inset-0 opacity-30 [background:radial-gradient(circle_at_18%_20%,var(--sidebar-active),transparent_34%),radial-gradient(circle_at_82%_18%,var(--sidebar-hover),transparent_30%)]" />
      <div className="relative flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-sidebar-active bg-sidebar-hover text-primary-foreground">
          AI
        </div>
        <div>
          <p className="text-sm text-sidebar-text-muted">RAG Automotivo</p>
          <h2 className="text-xl font-semibold text-primary-foreground">
            Oficina cognitiva
          </h2>
        </div>
      </div>

      <div className="relative max-w-xl">
        <p className="mb-5 text-sm font-medium uppercase text-sidebar-text-muted">
          Inteligencia para diagnostico
        </p>
        <h2 className="text-5xl font-semibold leading-tight text-primary-foreground">
          {subtitle}
        </h2>
        <p className="mt-6 max-w-lg text-lg leading-8 text-sidebar-text">
          Consulte manuais, registre hipoteses e prepare cada conversa para
          respostas fundamentadas por documentos automotivos.
        </p>
      </div>

      <div className="relative grid grid-cols-3 gap-4">
        {highlights.map((item) => (
          <div
            className="rounded-lg border border-sidebar-active bg-sidebar-hover p-4"
            key={item}
          >
            <p className="text-sm text-sidebar-text-muted">{item}</p>
            <p className="mt-2 text-lg font-semibold text-primary-foreground">
              Ativo
            </p>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-[1fr_1fr]">
        {side === "left" ? brand : form}
        {side === "left" ? form : brand}
      </div>
    </main>
  );
}
