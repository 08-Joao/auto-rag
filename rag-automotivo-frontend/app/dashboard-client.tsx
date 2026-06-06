"use client";

import {
  Bot,
  Car,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  Send,
  UserCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  createChat,
  getChat,
  listChats,
  sendChatMessage,
  type ChatDetail,
  type ChatSummary,
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

export function DashboardClient() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChat, setActiveChat] = useState<ChatDetail | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isBooting, setIsBooting] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const initials = getInitials(user?.name);

  useEffect(() => {
    let isMounted = true;

    Promise.all([getMe(), listChats()])
      .then(async ([currentUser, chatList]) => {
        if (!isMounted) {
          return;
        }

        setUser(currentUser);
        setChats(chatList);

        if (chatList[0]) {
          const detail = await getChat(chatList[0].id);
          if (isMounted) {
            setActiveChat(detail);
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
    };
  }, [router]);

  async function refreshChats(nextActiveId?: string) {
    const chatList = await listChats();
    setChats(chatList);

    const activeId = nextActiveId ?? activeChat?.id ?? chatList[0]?.id;
    if (activeId) {
      setActiveChat(await getChat(activeId));
    }
  }

  async function handleCreateChat() {
    const chat = await createChat();
    setActiveChat(chat);
    setPrompt("");
    setIsSidebarOpen(false);
    await refreshChats(chat.id);
  }

  async function handleSelectChat(chatId: string) {
    setActiveChat(await getChat(chatId));
    setIsSidebarOpen(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = prompt.trim();

    if (!content || isSending) {
      return;
    }

    setIsSending(true);
    setPrompt("");

    try {
      const chat = activeChat ?? (await createChat());
      const updatedChat = await sendChatMessage(chat.id, content);
      setActiveChat(updatedChat);
      await refreshChats(updatedChat.id);
    } finally {
      setIsSending(false);
    }
  }

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
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
              <Button
                className="h-auto w-full justify-start px-3 py-3 text-left"
                data-active={activeChat?.id === chat.id}
                key={chat.id}
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
            );
          })}

          {!isBooting && chats.length === 0 && (
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
        <header className="flex h-16 items-center justify-between border-b border-border bg-navbar-bg px-4 shadow-[var(--navbar-shadow)]">
          <div className="flex items-center gap-3">
            <Button
              aria-label="Abrir menu"
              className="lg:hidden"
              onClick={() => setIsSidebarOpen(true)}
              size="icon"
              variant="ghost"
            >
              <Menu />
            </Button>
            <div>
              <p className="text-sm text-muted-foreground">Central tecnica</p>
              <h2 className="truncate text-lg font-semibold">
                {activeChat?.title ?? "Novo diagnostico"}
              </h2>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground sm:flex">
            <UserCircle className="size-4" />
            {user?.name ?? "Usuario"}
          </div>
        </header>

        <ScrollArea className="flex-1">
          <div className="mx-auto flex min-h-[calc(100vh-10rem)] w-full max-w-4xl flex-col px-4 py-8">
            {!activeChat || activeChat.message.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="max-w-2xl text-center">
                  <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-lg border border-border bg-card">
                    <Bot className="size-7" />
                  </div>
                  <h2 className="text-3xl font-semibold">
                    Como posso ajudar no diagnostico?
                  </h2>
                  <p className="mt-4 text-muted-foreground">
                    Descreva o veiculo, sintomas, ano, motor, codigos de falha
                    ou procedimento desejado para iniciar o contexto do RAG.
                  </p>
                  <div className="mt-8 grid gap-3 text-left sm:grid-cols-2">
                    {[
                      "Onix 2022 falhando em marcha lenta",
                      "Como resetar aviso de manutencao?",
                      "Procedimento para sangria do ABS",
                      "Interpretar codigo P0301",
                    ].map((suggestion) => (
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
              <div className="space-y-6">
                {activeChat.message.map((message) => {
                  const isUser = message.sender === "USER";
                  return (
                    <div
                      className={cn("flex gap-3", isUser && "justify-end")}
                      key={message.id}
                    >
                      {!isUser && (
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                          <Bot className="size-5" />
                        </div>
                      )}
                      <div
                        className={cn(
                          "max-w-[82%] whitespace-pre-wrap rounded-lg border border-border px-4 py-3 text-sm leading-6",
                          isUser
                            ? "bg-primary text-primary-foreground"
                            : "bg-card text-card-foreground",
                        )}
                      >
                        {message.content}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t border-border bg-background px-4 py-4">
          <form className="mx-auto flex max-w-4xl gap-3" onSubmit={handleSubmit}>
            <Textarea
              className="max-h-40 min-h-12 flex-1 py-3"
              disabled={isSending}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Pergunte sobre sintomas, procedimentos ou codigos de falha..."
              value={prompt}
            />
            <Button
              className="h-12 w-12 shrink-0"
              disabled={!prompt.trim() || isSending}
              size="icon"
              type="submit"
            >
              <Send />
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
