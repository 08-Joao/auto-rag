"use client";

import { AlertCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

import { AppSidebar } from "@/components/chat/app-sidebar";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatMessages } from "@/components/chat/chat-message";
import { EmptyChat } from "@/components/chat/empty-chat";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSidebarContext } from "@/contexts/sidebar-context";
import { getMe, logout, type AuthUser } from "@/services/auth";
import {
  createChat,
  deleteChat,
  getChat,
  streamChatMessage,
  updateChatReranker,
  type ChatDetail,
  type ChatMessage,
  type VisualReranker,
} from "@/services/chats";

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

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  if (normalized.includes("failed to fetch") || normalized.includes("network"))
    return "Não foi possível conectar ao servidor. Verifique se o backend está em execução.";
  if (normalized.includes("ollama") || normalized.includes("model"))
    return "O modelo local está indisponível no momento. Verifique o Ollama e tente novamente.";
  if (normalized.includes("timeout") || normalized.includes("tempo limite"))
    return "A consulta demorou mais que o esperado. Tente novamente em alguns instantes.";
  if (
    normalized.includes("índice") ||
    normalized.includes("indice") ||
    normalized.includes("retrieval")
  )
    return "Não foi possível consultar os manuais indexados. Tente novamente ou revise os filtros da pergunta.";
  return message || "Não foi possível concluir esta ação. Tente novamente.";
}

function ChatLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-10 sm:px-6">
      <div className="flex justify-end">
        <Skeleton className="h-16 w-2/5" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-3/5" />
      </div>
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
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isUpdatingReranker, setIsUpdatingReranker] = useState(false);
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);
  const [shareLabel, setShareLabel] = useState("Copiar link");
  const [requestStatus, setRequestStatus] = useState("");
  const [applicationError, setApplicationError] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingChatIdRef = useRef<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const activeMessages = activeChat?.message ?? [];
  const lastMessageContent = activeMessages.at(-1)?.content;

  function focusPromptInput() {
    window.setTimeout(() => promptRef.current?.focus(), 0);
  }

  useEffect(() => {
    let isMounted = true;
    Promise.all([getMe(), loadChats()])
      .then(async ([currentUser, chatList]) => {
        if (!isMounted) return;
        setUser(currentUser);
        const chatIdToOpen = initialChatId ?? chatList[0]?.id;
        if (chatIdToOpen) {
          const detail = await getChat(chatIdToOpen);
          if (isMounted && streamingChatIdRef.current !== detail.id) {
            setActiveChat(detail);
            if (!initialChatId) router.replace(`/c/${detail.id}`);
          }
        }
      })
      .catch(() => router.replace("/signin"))
      .finally(() => isMounted && setIsBooting(false));
    return () => {
      isMounted = false;
      abortControllerRef.current?.abort();
    };
  }, [initialChatId, loadChats, router]);

  useEffect(() => {
    if (activeMessages.length > 0)
      messagesEndRef.current?.scrollIntoView({
        behavior: isSending ? "smooth" : "auto",
        block: "end",
      });
  }, [activeMessages.length, isSending, lastMessageContent]);

  async function handleCreateChat() {
    abortControllerRef.current?.abort();
    setApplicationError("");
    if (activeChat && activeChat.message.length === 0) {
      setPrompt("");
      setIsSidebarOpen(false);
      focusPromptInput();
      return;
    }
    try {
      const chat = await createChat();
      upsertChat(chat);
      setActiveChat(chat);
      setPrompt("");
      setIsSidebarOpen(false);
      router.push(`/c/${chat.id}`);
      focusPromptInput();
    } catch (error) {
      setApplicationError(friendlyError(error));
    }
  }

  async function handleSelectChat(chatId: string) {
    if (chatId === activeChat?.id) {
      setIsSidebarOpen(false);
      return;
    }
    abortControllerRef.current?.abort();
    setIsSending(false);
    setIsChatLoading(true);
    setApplicationError("");
    setIsSidebarOpen(false);
    try {
      const chat = await getChat(chatId);
      setActiveChat(chat);
      router.push(`/c/${chatId}`);
      focusPromptInput();
    } catch (error) {
      setApplicationError(friendlyError(error));
    } finally {
      setIsChatLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = prompt.trim();
    if (!content || isSending) return;
    let chat: ChatDetail;
    try {
      chat = activeChat ?? (await createChat());
    } catch (error) {
      setApplicationError(friendlyError(error));
      return;
    }
    const createdForSubmit = !activeChat;
    if (!activeChat) upsertChat(chat);
    const userMessage = createOptimisticMessage(content, "USER");
    const assistantMessage = createOptimisticMessage("", "SYSTEM");
    const controller = new AbortController();
    const optimisticChat = {
      ...chat,
      message: [...chat.message, userMessage, assistantMessage],
    };
    abortControllerRef.current = controller;
    streamingChatIdRef.current = chat.id;
    setIsSending(true);
    setApplicationError("");
    setRequestStatus("Consultando os manuais…");
    setPrompt("");
    setActiveChat(optimisticChat);
    upsertChat(optimisticChat);

    try {
      await streamChatMessage(chat.id, content, {
        signal: controller.signal,
        onEvent: (streamEvent) => {
          if (streamEvent.type === "user_message")
            setActiveChat((current) =>
              current
                ? {
                    ...current,
                    message: current.message.map((message) =>
                      message.id === userMessage.id
                        ? streamEvent.message
                        : message,
                    ),
                  }
                : current,
            );
          if (streamEvent.type === "assistant_start")
            setActiveChat((current) =>
              current
                ? {
                    ...current,
                    message: current.message.map((message) =>
                      message.id === assistantMessage.id
                        ? { ...message, id: streamEvent.messageId }
                        : message,
                    ),
                  }
                : current,
            );
          if (streamEvent.type === "sources") {
            setRequestStatus(
              streamEvent.sources.length > 0
                ? "Analisando as fontes recuperadas…"
                : "Verificando evidências disponíveis…",
            );
            setActiveChat((current) =>
              current
                ? {
                    ...current,
                    message: current.message.map((message, index) =>
                      index === current.message.length - 1
                        ? {
                            ...message,
                            metadata: {
                              sources: streamEvent.sources,
                              return_images:
                                streamEvent.returnImages ??
                                streamEvent.visualIntent,
                              visual_intent: streamEvent.visualIntent,
                            },
                          }
                        : message,
                    ),
                  }
                : current,
            );
          }
          if (streamEvent.type === "token") {
            setRequestStatus("Gerando resposta…");
            setActiveChat((current) =>
              current
                ? {
                    ...current,
                    message: current.message.map((message, index) =>
                      index === current.message.length - 1
                        ? {
                            ...message,
                            content: message.content + streamEvent.token,
                          }
                        : message,
                    ),
                  }
                : current,
            );
          }
          if (streamEvent.type === "done") {
            setActiveChat(streamEvent.chat);
            upsertChat(streamEvent.chat);
            if (createdForSubmit) router.replace(`/c/${streamEvent.chat.id}`);
          }
          if (streamEvent.type === "error") {
            const errorMessage = friendlyError(streamEvent.message);
            setApplicationError(errorMessage);
            setActiveChat((current) =>
              current
                ? {
                    ...current,
                    message: current.message.map((message, index) =>
                      index === current.message.length - 1
                        ? { ...message, content: errorMessage }
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
        const errorMessage = friendlyError(error);
        setApplicationError(errorMessage);
        setActiveChat((current) =>
          current
            ? {
                ...current,
                message: current.message.map((message, index) =>
                  index === current.message.length - 1
                    ? { ...message, content: errorMessage }
                    : message,
                ),
              }
            : current,
        );
      }
    } finally {
      if (abortControllerRef.current === controller)
        abortControllerRef.current = null;
      if (streamingChatIdRef.current === chat.id)
        streamingChatIdRef.current = null;
      setIsSending(false);
      setRequestStatus("");
      focusPromptInput();
    }
  }

  async function handleCancelMessage() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsSending(false);
    setRequestStatus("");
    if (activeChat) {
      try {
        const chat = await getChat(activeChat.id);
        setActiveChat(chat);
        upsertChat(chat);
      } catch (error) {
        setApplicationError(friendlyError(error));
      }
    }
    focusPromptInput();
  }

  async function handleDeleteChat(chatId: string) {
    abortControllerRef.current?.abort();
    setDeletingChatId(chatId);
    setApplicationError("");
    try {
      await deleteChat(chatId);
      const nextChat = chats.find((item) => item.id !== chatId);
      removeChat(chatId);
      if (activeChat?.id === chatId) {
        if (nextChat) {
          const detail = await getChat(nextChat.id);
          setActiveChat(detail);
          router.replace(`/c/${detail.id}`);
        } else {
          setActiveChat(null);
          router.replace("/");
        }
      }
    } catch (error) {
      setApplicationError(friendlyError(error));
    } finally {
      setDeletingChatId(null);
      setIsSending(false);
      focusPromptInput();
    }
  }

  async function handleShareChat() {
    if (!activeChat) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/c/${activeChat.id}`,
      );
      setShareLabel("Link copiado");
      window.setTimeout(() => setShareLabel("Copiar link"), 1600);
    } catch {
      setApplicationError("Não foi possível copiar o link desta conversa.");
    }
  }

  async function handleRerankerChange(visualReranker: VisualReranker) {
    if (
      !activeChat ||
      isSending ||
      visualReranker === activeChat.visualReranker
    )
      return;
    const previous = activeChat;
    const optimistic = { ...activeChat, visualReranker };
    setIsUpdatingReranker(true);
    setActiveChat(optimistic);
    upsertChat(optimistic);
    try {
      const updated = await updateChatReranker(activeChat.id, visualReranker);
      setActiveChat(updated);
      upsertChat(updated);
    } catch (error) {
      setActiveChat(previous);
      upsertChat(previous);
      setApplicationError(friendlyError(error));
    } finally {
      setIsUpdatingReranker(false);
    }
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

  return (
    <TooltipProvider delayDuration={300}>
      <main className="flex h-dvh overflow-hidden bg-background text-foreground">
        <AppSidebar
          activeChatId={activeChat?.id}
          chats={chats}
          deletingChatId={deletingChatId}
          isLoading={isBooting || sidebarStatus === "loading"}
          isLoggingOut={isLoggingOut}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          onCreateChat={() => void handleCreateChat()}
          onDeleteChat={handleDeleteChat}
          onLogout={() => void handleLogout()}
          onSelectChat={(id) => void handleSelectChat(id)}
          user={user}
        />
        <section className="flex min-w-0 flex-1 flex-col bg-background">
          <ChatHeader
            hasChat={Boolean(activeChat)}
            isBusy={isSending || isUpdatingReranker}
            onOpenSidebar={() => setIsSidebarOpen(true)}
            onRerankerChange={(value) => void handleRerankerChange(value)}
            onShare={() => void handleShareChat()}
            reranker={activeChat?.visualReranker ?? "clip"}
            shareLabel={shareLabel}
            title={
              !activeChat || activeChat.title === "Novo diagnostico"
                ? "Nova consulta"
                : activeChat.title
            }
          />
          {applicationError && (
            <div
              className="mx-auto mt-3 flex w-[calc(100%-1.5rem)] max-w-3xl items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
              role="alert"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span className="flex-1 leading-5">{applicationError}</span>
              <Button
                aria-label="Fechar aviso"
                className="-mr-1 -mt-1 size-7 text-destructive hover:bg-destructive/10"
                onClick={() => setApplicationError("")}
                size="icon"
                variant="ghost"
              >
                <X />
              </Button>
            </div>
          )}
          <div
            className="min-h-0 flex-1 overflow-y-auto"
            role="log"
            aria-live="polite"
          >
            {isBooting || isChatLoading ? (
              <ChatLoading />
            ) : activeMessages.length === 0 ? (
              <EmptyChat
                onSelectSuggestion={(suggestion) => {
                  setPrompt(suggestion);
                  focusPromptInput();
                }}
              />
            ) : (
              <ChatMessages
                isSending={isSending}
                messages={activeMessages}
                requestStatus={requestStatus}
              />
            )}
            <div ref={messagesEndRef} />
          </div>
          <ChatComposer
            disabled={isBooting || isChatLoading || isSending}
            isSending={isSending}
            onCancel={() => void handleCancelMessage()}
            onChange={setPrompt}
            onSubmit={handleSubmit}
            prompt={prompt}
            textareaRef={promptRef}
          />
        </section>
      </main>
    </TooltipProvider>
  );
}
