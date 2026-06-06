import { apiFetch } from "@/lib/api";

export type ChatMessage = {
  id: string;
  content: string;
  sender: "USER" | "SYSTEM";
  createdAt: string;
};

export type ChatSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  message: ChatMessage[];
  _count: {
    message: number;
  };
};

export type ChatDetail = {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  message: ChatMessage[];
};

export function listChats() {
  return apiFetch<ChatSummary[]>("/chats");
}

export function createChat() {
  return apiFetch<ChatDetail>("/chats", {
    method: "POST",
  });
}

export function getChat(chatId: string) {
  return apiFetch<ChatDetail>(`/chats/${chatId}`);
}

export function sendChatMessage(chatId: string, content: string) {
  return apiFetch<ChatDetail>(`/chats/${chatId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}
