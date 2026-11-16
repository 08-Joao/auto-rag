"use client";

import { BookOpen, FileText, ImageIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  getRagImageUrl,
  type ChatMessage as ChatMessageType,
  type RagSource,
} from "@/services/chats";

function titleCase(text: string) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word.length <= 3
        ? word.toUpperCase()
        : `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`,
    )
    .join(" ");
}

function formatRawDocumentName(rawName: string) {
  rawName = rawName.split("/").pop() ?? rawName;
  const baseName = rawName
    .replace(/\.pdf$/i, "")
    .replace(/_[a-f0-9-]{12,}$/i, "");
  const parts = baseName.replace(/_/g, "-").split("-").filter(Boolean);
  const year = parts.find((part) => /^(19|20)\d{2}$/.test(part));
  if (year && parts[0] === year && parts.length > 2) {
    let words = parts.slice(1).filter((part) => part !== year);
    const midpoint = Math.floor(words.length / 2);
    if (
      words.length % 2 === 0 &&
      words.slice(0, midpoint).join(" ") === words.slice(midpoint).join(" ")
    )
      words = words.slice(0, midpoint);
    return `${titleCase(words.join(" "))} ${year}`;
  }
  return titleCase(baseName.replace(/[_-]+/g, " "));
}

function formatDocumentName(source: RagSource) {
  return formatRawDocumentName(
    source.pdf_path?.split("/").pop() ?? source.document_name,
  );
}

function evidenceLabel(confidence?: number) {
  if (confidence === undefined) return null;
  if (confidence >= 0.75) return "Evidência forte";
  if (confidence >= 0.5) return "Evidência moderada";
  return "Evidência insuficiente";
}

function SourcesDialog({ message }: { message: ChatMessageType }) {
  const sources = message.metadata?.sources ?? [];
  const citations = new Map(
    (message.metadata?.citations ?? [])
      .filter((item) => item.quote)
      .map((item) => [item.sourceIndex, item.quote ?? ""]),
  );
  if (sources.length === 0) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
          variant="ghost"
        >
          <BookOpen className="size-3.5" />
          {sources.length}{" "}
          {sources.length === 1 ? "fonte consultada" : "fontes consultadas"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl p-0">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>Fontes da resposta</DialogTitle>
          <DialogDescription>
            Trechos recuperados dos manuais que fundamentaram esta resposta.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto px-6">
          {sources.map((source, index) => {
            const excerpt = (citations.get(index) ?? source.text ?? "")
              .replace(/\s+/g, " ")
              .trim();
            const pageLabel =
              source.page_start === source.page_end
                ? `Página ${source.page_start}`
                : `Páginas ${source.page_start}–${source.page_end}`;
            return (
              <div className="py-5" key={`${source.chunk_id}-${index}`}>
                <div className="flex gap-3">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                    <FileText className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-sm font-medium">
                        {formatDocumentName(source)}
                      </h3>
                      <span className="text-xs font-medium text-foreground">
                        {pageLabel}
                      </span>
                    </div>
                    {source.section_title && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {source.section_title}
                      </p>
                    )}
                    {excerpt && (
                      <blockquote className="mt-3 border-l-2 pl-3 text-sm leading-6 text-muted-foreground">
                        {excerpt}
                      </blockquote>
                    )}
                  </div>
                </div>
                {index < sources.length - 1 && <Separator className="mt-5" />}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImageResults({ message }: { message: ChatMessageType }) {
  const approved = message.metadata?.images ?? [];
  const fallback = (message.metadata?.sources ?? []).flatMap((source) =>
    (source.clip_results ?? []).map((image) => ({
      ...image,
      source: image.source ?? formatDocumentName(source),
      page: image.page ?? source.page_start,
    })),
  );
  const images = approved.length > 0 ? approved : fallback;
  const unique = images
    .filter(
      (image, index, list) =>
        list.findIndex((item) => item.imagePath === image.imagePath) === index,
    )
    .slice(0, 4);
  const shouldShow =
    message.metadata?.return_images === true ||
    message.metadata?.visual_intent === true;
  if (!shouldShow || unique.length === 0) return null;

  return (
    <section className="mt-5" aria-label="Imagens recuperadas">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <ImageIcon className="size-3.5" />
        {unique.length === 1 ? "Imagem do manual" : "Imagens do manual"}
      </div>
      <div className={cn("grid gap-2", unique.length > 1 && "grid-cols-2")}>
        {unique.map((image) => (
          <Dialog key={image.imagePath}>
            <DialogTrigger asChild>
              <button
                className="group relative overflow-hidden rounded-md border bg-muted/30 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                type="button"
              >
                {/* A rota exige o cookie HTTP-only da sessão. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt="Ilustração recuperada do manual"
                  className="h-40 w-full object-contain p-2 transition-colors group-hover:bg-muted/60 sm:h-48"
                  src={getRagImageUrl(image.imagePath)}
                />
                {image.page && (
                  <span className="absolute bottom-2 left-2 rounded-sm bg-background/90 px-2 py-1 text-[0.6875rem] font-medium shadow-sm">
                    Página {image.page}
                  </span>
                )}
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl">
              <DialogHeader>
                <DialogTitle>Ilustração do manual</DialogTitle>
                <DialogDescription>
                  {image.source
                    ? `${formatRawDocumentName(image.source)}${image.page ? ` · Página ${image.page}` : ""}`
                    : image.page
                      ? `Página ${image.page}`
                      : "Imagem associada à resposta"}
                </DialogDescription>
              </DialogHeader>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="Ilustração ampliada do manual"
                className="max-h-[70vh] w-full rounded-md bg-muted/30 object-contain"
                src={getRagImageUrl(image.imagePath)}
              />
            </DialogContent>
          </Dialog>
        ))}
      </div>
    </section>
  );
}

function GenerationState({ status }: { status: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
      <span className="flex gap-1">
        <span className="size-1.5 animate-pulse rounded-full bg-current" />
        <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
        <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
      </span>
      <span>{status || "Preparando resposta…"}</span>
    </div>
  );
}

export function ChatMessage({
  isStreaming,
  message,
  requestStatus,
}: {
  isStreaming: boolean;
  message: ChatMessageType;
  requestStatus: string;
}) {
  const isUser = message.sender === "USER";
  const confidence = evidenceLabel(message.metadata?.confidence);
  return (
    <article
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      {isUser ? (
        <div className="max-w-[85%] rounded-xl bg-muted px-4 py-2.5 text-sm leading-6 sm:max-w-[72%]">
          {message.content}
        </div>
      ) : (
        <div className="min-w-0 w-full">
          {message.content ? (
            <div className="max-w-none text-[0.9375rem] leading-7 text-foreground [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_h1]:mt-6 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-5 [&_h3]:text-base [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_p:first-child]:mt-0 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-4 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          ) : (
            <GenerationState status={requestStatus} />
          )}
          {isStreaming && message.content && (
            <div className="mt-3">
              <GenerationState status={requestStatus} />
            </div>
          )}
          {!isStreaming && <ImageResults message={message} />}
          {!isStreaming && (message.metadata?.sources?.length ?? 0) > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1 border-t pt-3">
              <SourcesDialog message={message} />
              {confidence && (
                <span className="inline-flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      confidence === "Evidência forte"
                        ? "bg-success"
                        : confidence === "Evidência moderada"
                          ? "bg-warning"
                          : "bg-destructive",
                    )}
                  />
                  {confidence}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function ChatMessages({
  messages,
  isSending,
  requestStatus,
}: {
  messages: ChatMessageType[];
  isSending: boolean;
  requestStatus: string;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      {messages.map((message, index) => (
        <ChatMessage
          isStreaming={
            message.sender !== "USER" &&
            index === messages.length - 1 &&
            isSending
          }
          key={message.id}
          message={message}
          requestStatus={requestStatus}
        />
      ))}
    </div>
  );
}
