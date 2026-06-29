"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  listChats,
  type ChatDetail,
  type ChatSummary,
} from "@/services/chats";

type SidebarStatus = "idle" | "loading" | "ready";

type SidebarContextValue = {
  chats: ChatSummary[];
  status: SidebarStatus;
  loadChats: () => Promise<ChatSummary[]>;
  upsertChat: (chat: ChatDetail) => void;
  removeChat: (chatId: string) => void;
  clearChats: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

function chatDetailToSummary(chat: ChatDetail): ChatSummary {
  const lastMessage = chat.message.at(-1);

  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    message: lastMessage ? [lastMessage] : [],
    _count: {
      message: chat.message.length,
    },
  };
}

function sortChats(chats: ChatSummary[]) {
  return [...chats].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [status, setStatus] = useState<SidebarStatus>("idle");
  const chatsRef = useRef<ChatSummary[]>([]);
  const hasLoadedRef = useRef(false);
  const loadPromiseRef = useRef<Promise<ChatSummary[]> | null>(null);

  const loadChats = useCallback(async () => {
    if (hasLoadedRef.current) {
      return chatsRef.current;
    }

    if (loadPromiseRef.current) {
      return loadPromiseRef.current;
    }

    setStatus("loading");
    loadPromiseRef.current = listChats()
      .then((chatList) => {
        chatsRef.current = chatList;
        hasLoadedRef.current = true;
        setChats(chatList);
        setStatus("ready");
        return chatList;
      })
      .catch((error) => {
        setStatus("idle");
        loadPromiseRef.current = null;
        throw error;
      });

    return loadPromiseRef.current;
  }, []);

  const upsertChat = useCallback((chat: ChatDetail) => {
    const summary = chatDetailToSummary(chat);

    setChats((current) => {
      const nextChats = sortChats([
        summary,
        ...current.filter((currentChat) => currentChat.id !== chat.id),
      ]);
      chatsRef.current = nextChats;
      return nextChats;
    });
    hasLoadedRef.current = true;
    setStatus("ready");
  }, []);

  const removeChat = useCallback((chatId: string) => {
    setChats((current) => {
      const nextChats = current.filter((chat) => chat.id !== chatId);
      chatsRef.current = nextChats;
      return nextChats;
    });
  }, []);

  const clearChats = useCallback(() => {
    loadPromiseRef.current = null;
    hasLoadedRef.current = false;
    chatsRef.current = [];
    setChats([]);
    setStatus("idle");
  }, []);

  const value = useMemo(
    () => ({
      chats,
      status,
      loadChats,
      upsertChat,
      removeChat,
      clearChats,
    }),
    [chats, clearChats, loadChats, removeChat, status, upsertChat],
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}

export function useSidebarContext() {
  const context = useContext(SidebarContext);

  if (!context) {
    throw new Error("useSidebarContext deve ser usado dentro de SidebarProvider.");
  }

  return context;
}
