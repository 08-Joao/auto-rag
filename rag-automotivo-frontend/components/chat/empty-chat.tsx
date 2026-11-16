"use client";

import { ArrowUpRight, BookOpenText } from "lucide-react";

const suggestions = [
  "Como verifico o nível do óleo do Audi A4 2008?",
  "O que significa uma luz amarela no painel?",
  "Onde fica a caixa de fusíveis?",
  "Qual pressão devo usar nos pneus?",
];

export function EmptyChat({
  onSelectSuggestion,
}: {
  onSelectSuggestion: (suggestion: string) => void;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-5 py-12 sm:px-8">
      <div className="mb-6 flex size-10 items-center justify-center rounded-lg border bg-background shadow-xs">
        <BookOpenText className="size-5" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Como posso ajudar com seu veículo?
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
        Consulte procedimentos, avisos e componentes usando os manuais já
        indexados. Inclua marca, modelo e ano para obter uma resposta mais
        precisa.
      </p>
      <div className="mt-8 grid gap-x-6 sm:grid-cols-2">
        {suggestions.map((suggestion) => (
          <button
            className="group flex min-h-12 items-center justify-between gap-3 border-t py-3 text-left text-sm transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            key={suggestion}
            onClick={() => onSelectSuggestion(suggestion)}
            type="button"
          >
            <span>{suggestion}</span>
            <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </button>
        ))}
      </div>
    </div>
  );
}
