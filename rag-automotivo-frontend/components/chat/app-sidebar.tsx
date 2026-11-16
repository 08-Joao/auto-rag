"use client";

import {
  CarFront,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import type { ChatSummary } from "@/services/chats";

type SidebarUser = { name?: string; email?: string } | null;

function getInitials(name?: string) {
  if (!name) return "US";
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function groupChats(chats: ChatSummary[]) {
  const groups = new Map<string, ChatSummary[]>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const chat of chats) {
    const day = new Date(chat.updatedAt);
    day.setHours(0, 0, 0, 0);
    const days = Math.floor((today.getTime() - day.getTime()) / 86400000);
    const label =
      days === 0
        ? "Hoje"
        : days === 1
          ? "Ontem"
          : days <= 7
            ? "Últimos 7 dias"
            : "Mais antigos";
    groups.set(label, [...(groups.get(label) ?? []), chat]);
  }
  return [...groups.entries()];
}

function displayTitle(title: string) {
  return title === "Novo diagnostico"
    ? "Nova conversa"
    : title || "Nova conversa";
}

export function AppSidebar({
  activeChatId,
  chats,
  deletingChatId,
  isLoading,
  isLoggingOut,
  isOpen,
  onClose,
  onCreateChat,
  onDeleteChat,
  onLogout,
  onSelectChat,
  user,
}: {
  activeChatId?: string;
  chats: ChatSummary[];
  deletingChatId: string | null;
  isLoading: boolean;
  isLoggingOut: boolean;
  isOpen: boolean;
  onClose: () => void;
  onCreateChat: () => void;
  onDeleteChat: (chatId: string) => Promise<void>;
  onLogout: () => void;
  onSelectChat: (chatId: string) => void;
  user: SidebarUser;
}) {
  const grouped = useMemo(() => groupChats(chats), [chats]);
  const [chatToDelete, setChatToDelete] = useState<ChatSummary | null>(null);

  return (
    <>
      {isOpen && (
        <button
          aria-label="Fechar menu"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onClose}
          type="button"
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center gap-2.5 px-3">
          <div className="flex size-8 items-center justify-center rounded-md border bg-background">
            <CarFront className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">
              Auto RAG
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Manuais automotivos
            </p>
          </div>
        </div>
        <div className="px-2 pb-2">
          <Button
            className="w-full justify-start bg-background shadow-xs"
            onClick={onCreateChat}
            variant="outline"
          >
            <Plus />
            Novo chat
          </Button>
        </div>
        <Separator />
        <ScrollArea className="min-h-0 flex-1 px-2 py-3">
          <nav aria-label="Histórico de conversas" className="space-y-5">
            {isLoading &&
              [0, 1, 2, 3].map((item) => (
                <div className="space-y-2 px-2" key={item}>
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ))}
            {!isLoading && chats.length === 0 && (
              <div className="px-3 py-10 text-center">
                <MessageSquare className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">Nenhuma conversa</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Comece uma consulta usando o botão acima.
                </p>
              </div>
            )}
            {grouped.map(([label, group]) => (
              <section key={label}>
                <h2 className="mb-1 px-2 text-[0.6875rem] font-medium text-muted-foreground">
                  {label}
                </h2>
                <div className="space-y-0.5">
                  {group.map((chat) => (
                    <div className="group/item relative" key={chat.id}>
                      <button
                        aria-current={
                          activeChatId === chat.id ? "page" : undefined
                        }
                        className={cn(
                          "flex h-9 min-w-0 w-full items-center gap-2 overflow-hidden rounded-md px-2 pr-9 text-left text-sm transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          activeChatId === chat.id &&
                            "bg-sidebar-accent font-medium",
                        )}
                        onClick={() => onSelectChat(chat.id)}
                        type="button"
                      >
                        <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">
                          {displayTitle(chat.title)}
                        </span>
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            aria-label={`Opções do chat ${displayTitle(chat.title)}`}
                            className={cn(
                              "absolute right-1 top-0 size-9 opacity-0 group-hover/item:opacity-100 group-focus-within/item:opacity-100",
                              activeChatId === chat.id && "opacity-100",
                            )}
                            size="icon"
                            variant="ghost"
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setChatToDelete(chat)}
                          >
                            <Trash2 />
                            Excluir conversa
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </nav>
        </ScrollArea>
        <Separator />
        <div className="flex items-center gap-1 p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-2 text-left hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                type="button"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-xs font-medium">
                  {getInitials(user?.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {user?.name ?? "Usuário"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {user?.email ?? "Sessão ativa"}
                  </span>
                </span>
                <MoreHorizontal className="size-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56" side="top">
              <DropdownMenuItem disabled={isLoggingOut} onSelect={onLogout}>
                <LogOut />
                {isLoggingOut ? "Saindo…" : "Sair"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ThemeToggle />
        </div>
      </aside>

      <AlertDialog
        onOpenChange={(open) => !open && setChatToDelete(null)}
        open={Boolean(chatToDelete)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conversa?</AlertDialogTitle>
            <AlertDialogDescription>
              “{displayTitle(chatToDelete?.title ?? "")}” será removida
              permanentemente, incluindo todo o histórico de mensagens.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingChatId === chatToDelete?.id}
              onClick={() => chatToDelete && void onDeleteChat(chatToDelete.id)}
            >
              {deletingChatId ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
