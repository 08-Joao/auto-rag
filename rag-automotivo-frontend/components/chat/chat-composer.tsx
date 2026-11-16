"use client";

import { ArrowUp, Square } from "lucide-react";
import { FormEvent, RefObject, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function resizeTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "0px";
  element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  element.style.overflowY = element.scrollHeight > 160 ? "auto" : "hidden";
}

export function ChatComposer({
  disabled,
  isSending,
  onCancel,
  onChange,
  onSubmit,
  prompt,
  textareaRef,
}: {
  disabled: boolean;
  isSending: boolean;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  prompt: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  useEffect(() => resizeTextarea(textareaRef.current), [prompt, textareaRef]);

  return (
    <div className="shrink-0 bg-background px-3 pb-3 pt-2 sm:px-5 sm:pb-5">
      <div className="mx-auto w-full max-w-3xl">
        <form
          className="relative rounded-xl border bg-background shadow-sm transition-shadow focus-within:ring-1 focus-within:ring-ring"
          onSubmit={onSubmit}
        >
          <Textarea
            aria-label="Mensagem"
            className="min-h-[3.25rem] w-full resize-none border-0 bg-transparent px-4 pb-3 pr-14 pt-3.5 text-[0.9375rem] leading-6 shadow-none focus-visible:ring-0"
            disabled={disabled}
            onChange={(event) => {
              onChange(event.target.value);
              resizeTextarea(event.currentTarget);
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Pergunte sobre seu veículo…"
            ref={textareaRef}
            rows={1}
            value={prompt}
          />
          {isSending ? (
            <Button
              aria-label="Interromper resposta"
              className="absolute bottom-2 right-2 size-8 rounded-md"
              onClick={onCancel}
              size="icon"
              type="button"
              variant="secondary"
            >
              <Square className="size-3 fill-current" />
            </Button>
          ) : (
            <Button
              aria-label="Enviar mensagem"
              className="absolute bottom-2 right-2 size-8 rounded-md"
              disabled={!prompt.trim()}
              size="icon"
              type="submit"
            >
              <ArrowUp />
            </Button>
          )}
        </form>
        <p className="mt-2 text-center text-[0.6875rem] text-muted-foreground">
          As respostas podem conter imprecisões. Confira sempre as fontes do
          manual.
        </p>
      </div>
    </div>
  );
}
