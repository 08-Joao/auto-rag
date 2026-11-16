import { CarFront } from "lucide-react";
import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/theme-toggle";

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
  subtitle,
  title,
}: AuthShellProps) {
  return (
    <main className="relative grid min-h-dvh place-items-center bg-background px-5 py-16 text-foreground">
      <div className="absolute left-5 top-5 flex items-center gap-2.5 sm:left-8 sm:top-7">
        <div className="flex size-8 items-center justify-center rounded-md border bg-background shadow-xs">
          <CarFront className="size-4" />
        </div>
        <div>
          <p className="text-sm font-semibold tracking-tight">Auto RAG</p>
          <p className="text-xs text-muted-foreground">Manuais automotivos</p>
        </div>
      </div>
      <ThemeToggle className="absolute right-5 top-5 sm:right-8 sm:top-7" />
      <section className="w-full max-w-sm">
        <div className="mb-7">
          <p className="mb-2 text-sm text-muted-foreground">{eyebrow}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {subtitle}
          </p>
        </div>
        {children}
      </section>
    </main>
  );
}
