"use client";

import {
  Bot,
  Car,
  ChevronRight,
  FileText,
  ImageIcon,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  Send,
  Share2,
  Square,
  Trash2,
  UserCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useSidebarContext } from "@/contexts/sidebar-context";
import { cn } from "@/lib/utils";
import {
  createChat,
  deleteChat,
  getChat,
  getRagImageUrl,
  streamChatMessage,
  type ChatDetail,
  type ChatMessage,
  type RagSource,
} from "@/services/chats";
import { getMe, logout, type AuthUser } from "@/services/auth";

function getInitials(name?: string) {
  if (!name) {
    return "US";
  }

  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function createOptimisticMessage(
  content: string,
  sender: "USER" | "SYSTEM",
): ChatMessage {
  return {
    id: `tmp-${crypto.randomUUID()}`,
    content,
    metadata: sender === "SYSTEM" ? { sources: [] } : null,
    sender,
    createdAt: new Date().toISOString(),
  };
}

function getSources(message: ChatMessage): RagSource[] {
  return message.metadata?.sources ?? [];
}

function getImagePaths(message: ChatMessage) {
  const approvedImages = message.metadata?.images ?? [];
  if (approvedImages.length > 0) {
    return Array.from(new Set(approvedImages.map((image) => image.imagePath)));
  }

  const sources = getSources(message);
  return Array.from(
    new Set(
      sources.flatMap((source) =>
        source.clip_results?.length
          ? source.clip_results.map((result) => result.imagePath)
          : [],
      ),
    ),
  );
}

function shouldShowImageGallery(message: ChatMessage) {
  return (
    message.metadata?.return_images === true ||
    message.metadata?.visual_intent === true
  );
}

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

function dedupeRepeatedWords(words: string[]) {
  const midpoint = Math.floor(words.length / 2);

  if (
    words.length % 2 === 0 &&
    words.slice(0, midpoint).join(" ") === words.slice(midpoint).join(" ")
  ) {
    return words.slice(0, midpoint);
  }

  return words;
}

function formatSourceDocumentName(source: RagSource) {
  const rawName = source.pdf_path?.split("/").pop() ?? source.document_name;
  const baseName = rawName
    .replace(/\.pdf$/i, "")
    .replace(/_[a-f0-9]{12,}$/i, "")
    .replace(/_[a-f0-9-]{12,}$/i, "");
  const normalized = baseName.replace(/_/g, "-");
  const parts = normalized.split("-").filter(Boolean);
  const year = parts.find((part) => /^(19|20)\d{2}$/.test(part));

  if (year && parts[0] === year && parts.length > 2) {
    const brand = parts[1];
    const modelWords = dedupeRepeatedWords(
      parts.slice(2).filter((part) => part !== year),
    );

    if (brand && modelWords.length > 0) {
      return `${titleCase([brand, ...modelWords].join(" "))} ${year}`;
    }
  }

  return titleCase(
    normalized
      .replace(/(?:^|-)(?:manual|owner|owners|proprietario)(?:-|$)/gi, " ")
      .replace(/-/g, " ")
      .trim(),
  );
}

function SourceItem({
  index,
  source,
  visualIntent,
}: {
  index: number;
  source: RagSource;
  visualIntent: boolean;
}) {
  const images = visualIntent
    ? (source.clip_results ?? []).map((result) => result.imagePath)
    : [];
  const documentName = formatSourceDocumentName(source);

  return (
    <div className="space-y-2 rounded-md border border-border bg-background p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
          <FileText className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-xs font-semibold">Fonte {index + 1}</p>
            <p className="text-xs text-muted-foreground">
              Páginas {source.page_start}-{source.page_end}
              {source.metadata?.brand ? ` · ${source.metadata.brand}` : ""}
            </p>
          </div>
          <p
            className="mt-1 truncate text-xs text-foreground"
            title={source.document_name}
          >
            {documentName}
          </p>
          {source.section_title && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {source.section_title}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Score {source.score.toFixed(3)}</span>
            {images.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <ImageIcon className="size-3" />
                {images.length} imagem(ns)
              </span>
            )}
          </div>
        </div>
      </div>

      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 pl-10">
          {images.slice(0, 3).map((imagePath) => (
            <a
              href={getRagImageUrl(imagePath)}
              key={imagePath}
              rel="noreferrer"
              target="_blank"
            >
              <img
                alt="Imagem associada ao chunk"
                className="aspect-video rounded-md border border-border bg-card object-contain"
                src={getRagImageUrl(imagePath)}
              />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function SourcesDropdown({
  sources,
  visualIntent,
}: {
  sources: RagSource[];
  visualIntent: boolean;
}) {
  return (
    <HoverCard openDelay={120}>
      <HoverCardTrigger asChild>
        <Button className="h-8 rounded-lg px-3 text-xs" variant="outline">
          <FileText className="size-3.5" />
          Fontes
          <span className="rounded bg-muted px-1.5 py-0.5 text-[0.625rem] leading-none text-muted-foreground">
            {sources.length}
          </span>
          <ChevronRight className="size-3.5" />
        </Button>
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        className="max-h-[min(32rem,calc(100vh-8rem))] w-[32rem] max-w-[calc(100vw-2rem)] overflow-y-auto p-3"
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 px-1 pb-1">
            <p className="text-sm font-semibold">Fontes recuperadas</p>
            <p className="text-xs text-muted-foreground">
              {sources.length} fonte(s)
            </p>
          </div>
          {sources.map((source, index) => (
            <SourceItem
              index={index}
              key={source.chunk_id}
              source={source}
              visualIntent={visualIntent}
            />
          ))}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function MessageSources({
  isStreaming,
  message,
}: {
  isStreaming: boolean;
  message: ChatMessage;
}) {
  const sources = getSources(message);
  const imagePaths = getImagePaths(message);
  const visualIntent = shouldShowImageGallery(message);
  const confidence = message.metadata?.confidence;
  const status = message.metadata?.status;

  if (isStreaming || sources.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SourcesDropdown sources={sources} visualIntent={visualIntent} />
        {typeof confidence === "number" && (
          <span className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
            Confiança {Math.round(confidence * 100)}%
          </span>
        )}
        {status && status !== "answered" && (
          <span className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
            {status}
          </span>
        )}
      </div>

      {visualIntent && imagePaths.length > 0 && shouldShowImageGallery(message) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {imagePaths.slice(0, 4).map((imagePath) => (
            <a
              className="group overflow-hidden rounded-lg border border-border bg-card"
              href={getRagImageUrl(imagePath)}
              key={imagePath}
              rel="noreferrer"
              target="_blank"
            >
              <img
                alt="Imagem recuperada do manual"
                className="h-44 w-full object-contain p-2 transition group-hover:bg-muted"
                src={getRagImageUrl(imagePath)}
              />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function AssistantTyping() {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <span className="size-1.5 animate-pulse rounded-full bg-current" />
      <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
      <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
    </span>
  );
}

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }

        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

function MarkdownText({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap">
      {text.split("\n").map((line, index, lines) => (
        <span key={`${index}-${line}`}>
          <InlineMarkdown text={line} />
          {index < lines.length - 1 && "\n"}
        </span>
      ))}
    </div>
  );
}

export function DashboardClient({ initialChatId }: { initialChatId?: string }) {
  const router = useRouter();
  const {
    chats,
    clearChats,
    loadChats,
    removeChat,
    status: sidebarStatus,
    upsertChat,
  } = useSidebarContext();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeChat, setActiveChat] = useState<ChatDetail | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isBooting, setIsBooting] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);
  const [shareLabel, setShareLabel] = useState("Compartilhar");
  const abortControllerRef = useRef<AbortController | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  const initials = getInitials(user?.name);
  const activeMessages = activeChat?.message ?? [];

  const suggestions = useMemo(
    () => [
      "Audi A4 2008: qual óleo recomendado?",
      "Honda Civic 2014: como calibrar pneus?",
      "Jeep Renegade 2022: resetar manutenção",
      "Chevrolet Onix 2020: onde ficam os fusíveis?",
    ],
    [],
  );

  function focusPromptInput() {
    window.setTimeout(() => {
      promptRef.current?.focus();
    }, 0);
  }

  useEffect(() => {
    let isMounted = true;

    Promise.all([getMe(), loadChats()])
      .then(async ([currentUser, chatList]) => {
        if (!isMounted) {
          return;
        }

        setUser(currentUser);

        const chatIdToOpen = initialChatId ?? chatList[0]?.id;

        if (chatIdToOpen) {
          const detail = await getChat(chatIdToOpen);
          if (isMounted) {
            setActiveChat(detail);
            router.replace(`/c/${detail.id}`);
            focusPromptInput();
          }
        }
      })
      .catch(() => {
        router.replace("/signin");
      })
      .finally(() => {
        if (isMounted) {
          setIsBooting(false);
        }
      });

    return () => {
      isMounted = false;
      abortControllerRef.current?.abort();
    };
  }, [initialChatId, loadChats, router]);

  async function handleCreateChat() {
    abortControllerRef.current?.abort();
    if (activeChat && activeChat.message.length === 0) {
      setPrompt("");
      setIsSidebarOpen(false);
      setIsSending(false);
      router.replace(`/c/${activeChat.id}`);
      focusPromptInput();
      return;
    }

    const chat = await createChat();
    upsertChat(chat);
    setActiveChat(chat);
    router.push(`/c/${chat.id}`);
    setPrompt("");
    setIsSidebarOpen(false);
    setIsSending(false);
    focusPromptInput();
  }

  async function handleSelectChat(chatId: string) {
    abortControllerRef.current?.abort();
    setIsSending(false);
    setActiveChat(await getChat(chatId));
    router.push(`/c/${chatId}`);
    setIsSidebarOpen(false);
    focusPromptInput();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = prompt.trim();

    if (!content || isSending) {
      return;
    }

    const chat = activeChat ?? (await createChat());
    if (!activeChat) {
      upsertChat(chat);
    }
    router.replace(`/c/${chat.id}`);
    const userMessage = createOptimisticMessage(content, "USER");
    const assistantMessage = createOptimisticMessage("", "SYSTEM");
    const controller = new AbortController();

    abortControllerRef.current = controller;
    setIsSending(true);
    setPrompt("");
    setActiveChat({
      ...chat,
      message: [...chat.message, userMessage, assistantMessage],
    });

    try {
      await streamChatMessage(chat.id, content, {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "user_message") {
            setActiveChat((current) =>
              current
                ? {
                    ...current,
                    message: current.message.map((message) =>
                      message.id === userMessage.id ? event.message : message,
                    ),
                  }
                : current,
            );
          }

          if (event.type === "assistant_start") {
            setActiveChat((current) =>
              current
                ? {
                    ...current,
                    message: current.message.map((message) =>
                      message.id === assistantMessage.id
                        ? { ...message, id: event.messageId }
                        : message,
                    ),
                  }
                : current,
            );
          }

          if (event.type === "sources") {
            setActiveChat((current) =>
              current
                ? {
                    ...current,
                    message: current.message.map((message) =>
                      message.id === assistantMessage.id ||
                      message.id.startsWith("tmp-") ||
                      message.id ===
                        current.message[current.message.length - 1]?.id
                        ? {
                            ...message,
                            metadata: {
                              sources: event.sources,
                              return_images:
                                event.returnImages ?? event.visualIntent,
                              visual_intent: event.visualIntent,
                            },
                          }
                        : message,
                    ),
                  }
                : current,
            );
          }

          if (event.type === "token") {
            setActiveChat((current) =>
              current
                ? {
                    ...current,
                    message: current.message.map((message, index) =>
                      index === current.message.length - 1
                        ? { ...message, content: message.content + event.token }
                        : message,
                    ),
                  }
                : current,
            );
          }

          if (event.type === "done") {
            setActiveChat(event.chat);
            upsertChat(event.chat);
          }

          if (event.type === "error") {
            setActiveChat((current) =>
              current
                ? {
                    ...current,
                    message: current.message.map((message, index) =>
                      index === current.message.length - 1
                        ? { ...message, content: event.message }
                        : message,
                    ),
                  }
                : current,
            );
          }
        },
      });

    } catch (error) {
      if (!controller.signal.aborted) {
        const message =
          error instanceof Error
            ? error.message
            : "Nao foi possivel enviar a mensagem.";
        setActiveChat((current) =>
          current
            ? {
                ...current,
                message: current.message.map((chatMessage, index) =>
                  index === current.message.length - 1
                    ? { ...chatMessage, content: message }
                    : chatMessage,
                ),
              }
            : current,
        );
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsSending(false);
      focusPromptInput();
    }
  }

  async function handleCancelMessage() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsSending(false);
    if (activeChat) {
      const chat = await getChat(activeChat.id);
      setActiveChat(chat);
      upsertChat(chat);
      focusPromptInput();
    }
  }

  async function handleDeleteChat(chatId: string) {
    const chat = chats.find((item) => item.id === chatId);
    const confirmed = window.confirm(
      `Excluir "${chat?.title ?? "este chat"}"? Essa acao nao pode ser desfeita.`,
    );

    if (!confirmed) {
      return;
    }

    abortControllerRef.current?.abort();
    setDeletingChatId(chatId);

    try {
      await deleteChat(chatId);
      const nextChat = chats.find((item) => item.id !== chatId);
      removeChat(chatId);

      if (activeChat?.id === chatId) {
        setActiveChat(null);
        if (nextChat) {
          const detail = await getChat(nextChat.id);
          setActiveChat(detail);
          router.replace(`/c/${detail.id}`);
        } else {
          router.replace("/");
        }
      }
    } finally {
      setDeletingChatId(null);
      setIsSending(false);
      focusPromptInput();
    }
  }

  async function handleShareChat() {
    if (!activeChat) {
      return;
    }

    const url = `${window.location.origin}/c/${activeChat.id}`;
    await navigator.clipboard.writeText(url);
    setShareLabel("Copiado");
    window.setTimeout(() => setShareLabel("Compartilhar"), 1600);
  }

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      clearChats();
      router.replace("/signin");
      router.refresh();
    }
  }

  const sidebar = (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 flex w-80 flex-col border-r border-sidebar-active bg-sidebar-bg text-sidebar-text transition-transform lg:static lg:translate-x-0",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <div className="flex h-16 items-center justify-between border-b border-sidebar-active px-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg border border-sidebar-active bg-sidebar-hover text-primary-foreground">
            <Car className="size-5" />
          </div>
          <div>
            <p className="text-sm text-sidebar-text-muted">RAG Automotivo</p>
            <h1 className="font-semibold text-primary-foreground">Chats</h1>
          </div>
        </div>
      </div>

      <div className="p-4">
        <Button className="w-full" onClick={handleCreateChat} variant="secondary">
          <Plus />
          Novo chat
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-3">
        <div className="space-y-1 pb-4">
          {chats.map((chat) => {
            const lastMessage = chat.message[0]?.content ?? "Sem mensagens ainda";
            return (
              <div
                className="group relative"
                key={chat.id}
              >
                <Button
                  className="h-auto w-full justify-start px-3 py-3 pr-12 text-left"
                  data-active={activeChat?.id === chat.id}
                  onClick={() => handleSelectChat(chat.id)}
                  variant="sidebar"
                >
                  <MessageSquare className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-primary-foreground">
                      {chat.title}
                    </span>
                    <span className="mt-1 block truncate text-xs text-sidebar-text-muted">
                      {lastMessage}
                    </span>
                  </span>
                </Button>
                <Button
                  aria-label={`Excluir chat ${chat.title}`}
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 px-0 text-sidebar-text-muted opacity-100 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                  disabled={deletingChatId === chat.id}
                  onClick={() => handleDeleteChat(chat.id)}
                  size="icon"
                  type="button"
                  variant="sidebar"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            );
          })}

          {!isBooting && sidebarStatus !== "loading" && chats.length === 0 && (
            <div className="rounded-lg border border-sidebar-active bg-sidebar-hover p-4 text-sm text-sidebar-text-muted">
              Nenhum chat ainda.
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-sidebar-active p-4">
        <div className="mb-3 flex items-center gap-3 rounded-lg bg-sidebar-hover p-3">
          <div className="flex size-10 items-center justify-center rounded-lg border border-sidebar-active text-primary-foreground">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-primary-foreground">
              {user?.name ?? "Usuario"}
            </p>
            <p className="truncate text-xs text-sidebar-text-muted">
              {user?.email ?? "Sessao ativa"}
            </p>
          </div>
        </div>
        <Button
          className="w-full"
          disabled={isLoggingOut}
          onClick={handleLogout}
          variant="sidebar"
        >
          <LogOut />
          {isLoggingOut ? "Saindo..." : "Sair"}
        </Button>
      </div>
    </aside>
  );

  return (
    <main className="flex h-screen overflow-hidden bg-background text-foreground">
      {isSidebarOpen && (
        <button
          aria-label="Fechar menu"
          className="fixed inset-0 z-20 bg-sidebar-bg/40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
          type="button"
        />
      )}

      {sidebar}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border bg-navbar-bg px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              aria-label="Abrir menu"
              className="lg:hidden"
              onClick={() => setIsSidebarOpen(true)}
              size="icon"
              variant="ghost"
            >
              <Menu />
            </Button>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">
                {activeChat?.title ?? "Novo diagnostico"}
              </h2>
              <p className="truncate text-xs text-muted-foreground">
                Respostas fundamentadas em manuais e diagramas recuperados
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground sm:flex">
            <UserCircle className="size-4" />
            {user?.name ?? "Usuario"}
          </div>
          {activeChat && (
            <Button
              className="hidden sm:inline-flex"
              onClick={handleShareChat}
              variant="outline"
            >
              <Share2 className="size-4" />
              {shareLabel}
            </Button>
          )}
        </header>

        <ScrollArea className="flex-1">
          <div className="mx-auto flex min-h-[calc(100vh-10rem)] w-full max-w-3xl flex-col px-4 py-8">
            {!activeChat || activeMessages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="w-full max-w-2xl text-center">
                  <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-lg border border-border bg-card">
                    <Bot className="size-7" />
                  </div>
                  <h2 className="text-3xl font-semibold">
                    Qual manual vamos consultar?
                  </h2>
                  <p className="mt-4 text-muted-foreground">
                    Informe marca, modelo, ano e o procedimento ou sintoma. Se faltar
                    contexto, o assistente vai perguntar antes de responder.
                  </p>
                  <div className="mt-8 grid gap-3 text-left sm:grid-cols-2">
                    {suggestions.map((suggestion) => (
                      <Card
                        className="cursor-pointer p-4 text-sm transition hover:bg-muted"
                        key={suggestion}
                        onClick={() => setPrompt(suggestion)}
                      >
                        {suggestion}
                      </Card>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-8">
                {activeMessages.map((message, index) => {
                  const isUser = message.sender === "USER";
                  const isLastAssistant =
                    !isUser && index === activeMessages.length - 1 && isSending;

                  return (
                    <article
                      className={cn(
                        "flex gap-4",
                        isUser ? "justify-end" : "justify-start",
                      )}
                      key={message.id}
                    >
                      {!isUser && (
                        <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                          <Bot className="size-4" />
                        </div>
                      )}

                      <div
                        className={cn(
                          "min-w-0 text-sm leading-6",
                          isUser
                            ? "max-w-[78%] rounded-lg bg-primary px-4 py-3 text-primary-foreground"
                            : "max-w-full flex-1",
                        )}
                      >
                        {message.content ? (
                          <MarkdownText text={message.content} />
                        ) : (
                          <AssistantTyping />
                        )}
                        {!isUser && (
                          <MessageSources
                            isStreaming={isLastAssistant}
                            message={message}
                          />
                        )}
                        {isLastAssistant && message.content && (
                          <div className="mt-2">
                            <AssistantTyping />
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t border-border bg-background px-4 py-4">
          <form
            className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg border border-border bg-card p-2"
            onSubmit={handleSubmit}
          >
            <Textarea
              className="max-h-40 min-h-12 flex-1 border-0 bg-transparent py-3 focus-visible:ring-0"
              disabled={isSending}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Pergunte sobre um veículo, procedimento, fluido, aviso ou diagrama..."
              ref={promptRef}
              value={prompt}
            />
            {isSending ? (
              <Button
                aria-label="Cancelar resposta"
                className="h-10 w-10 shrink-0"
                onClick={handleCancelMessage}
                size="icon"
                type="button"
                variant="outline"
              >
                <Square className="size-4 fill-current" />
              </Button>
            ) : (
              <Button
                aria-label="Enviar mensagem"
                className="h-10 w-10 shrink-0"
                disabled={!prompt.trim()}
                size="icon"
                type="submit"
              >
                <Send />
              </Button>
            )}
          </form>
        </div>
      </section>
    </main>
  );
}
