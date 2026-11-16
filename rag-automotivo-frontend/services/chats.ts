import { API_URL, apiFetch, ApiError } from "@/lib/api";

export type VisualReranker = "clip" | "qwen";

export type RagSource = {
  score: number;
  chunk_id: string;
  document_name: string;
  pdf_path?: string;
  page_start: number;
  page_end: number;
  section_title?: string | null;
  text?: string;
  image_paths: string[];
  metadata?: {
    brand?: string;
    vehicle_make?: string;
    vehicle_model?: string;
    vehicle_year?: number;
    document_type?: string;
    content_type?: string;
    entities?: string[];
    faiss_vector_id?: number;
    image_count?: number;
    split_reason?: string;
  };
  retrieval_scores?: {
    vector?: number;
    lead_vector?: number;
    bm25?: number;
    lexical?: number;
    domain?: number;
    reranker?: number;
    metadata?: number;
    final?: number;
  };
  clip_results?: {
    imagePath: string;
    score: number;
    positiveScore?: number;
    positiveLabel?: string;
    negativeScore?: number;
    negativeLabel?: string;
    page?: number;
    source?: string;
    chunkId?: string;
  }[];
};

export type MessageMetadata = {
  sources?: RagSource[];
  return_images?: boolean;
  visual_intent?: boolean;
  confidence?: number;
  status?: string;
  reasoning_type?: string;
  resolved_query?: string;
  is_follow_up?: boolean;
  visual_reranker?: VisualReranker;
  conversation_state?: {
    lastUserQuestion: string;
    pendingQuestion: string;
    resolvedQuery: string;
    intent: string;
    vehicle: {
      brand?: string;
      model?: string;
      year?: string;
      engine?: string;
      version?: string;
    };
    missingSlots: string[];
    lastAnswerNeededClarification: boolean;
  };
  vehicle_detected?: {
    make?: string;
    model?: string;
    year?: number;
    engine?: string;
    certainty: number;
  };
  citations?: {
    claim: string;
    sourceIndex: number;
    page: number;
    document: string;
    quote?: string;
  }[];
  images?: {
    imagePath: string;
    score: number;
    positiveScore?: number;
    positiveLabel?: string;
    negativeScore?: number;
    negativeLabel?: string;
    page?: number;
    source?: string;
    chunkId?: string;
  }[];
  warnings?: string[];
  missing_information?: string[];
};

export type ChatMessage = {
  id: string;
  content: string;
  metadata?: MessageMetadata | null;
  sender: "USER" | "SYSTEM";
  createdAt: string;
};

export type ChatSummary = {
  id: string;
  title: string;
  visualReranker: VisualReranker;
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
  visualReranker: VisualReranker;
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

export function deleteChat(chatId: string) {
  return apiFetch<{ id: string }>(`/chats/${chatId}`, {
    method: "DELETE",
  });
}

export function updateChatReranker(
  chatId: string,
  visualReranker: VisualReranker,
) {
  return apiFetch<ChatDetail>(`/chats/${chatId}/reranker`, {
    method: "PATCH",
    body: JSON.stringify({ visualReranker }),
  });
}

export function sendChatMessage(chatId: string, content: string) {
  return apiFetch<ChatDetail>(`/chats/${chatId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export type ChatStreamEvent =
  | { type: "user_message"; message: ChatMessage }
  | { type: "assistant_start"; messageId: string }
  | {
      type: "sources";
      sources: RagSource[];
      returnImages?: boolean;
      visualIntent: boolean;
    }
  | { type: "token"; token: string }
  | { type: "done"; chat: ChatDetail }
  | { type: "error"; message: string };

type StreamOptions = {
  signal?: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
};

export async function streamChatMessage(
  chatId: string,
  content: string,
  { signal, onEvent }: StreamOptions,
) {
  let response = await fetch(`${API_URL}/chats/${chatId}/messages/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
    signal,
  });

  if (response.status === 401) {
    const refreshed = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      signal,
    });

    if (refreshed.ok) {
      response = await fetch(`${API_URL}/chats/${chatId}/messages/stream`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        signal,
      });
    }
  }

  if (!response.ok || !response.body) {
    throw new ApiError("Nao foi possivel iniciar o streaming da mensagem.", response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const rawEvent of events) {
      const line = rawEvent
        .split("\n")
        .find((part) => part.startsWith("data: "));
      if (!line) {
        continue;
      }

      onEvent(JSON.parse(line.slice(6)) as ChatStreamEvent);
    }
  }
}

export function getRagImageUrl(imagePath: string) {
  return `${API_URL}/rag/assets?path=${encodeURIComponent(imagePath)}`;
}
