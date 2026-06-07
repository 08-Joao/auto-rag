export type RagSource = {
  score: number;
  chunk_id: string;
  document_name: string;
  pdf_path?: string;
  page_start: number;
  page_end: number;
  section_title?: string | null;
  text: string;
  image_paths: string[];
  metadata: {
    brand?: string;
    faiss_vector_id?: number;
    image_count?: number;
    split_reason?: string;
  };
};

export type RagRetrievalResult = {
  query: string;
  results: RagSource[];
};

export type RagAnswer = {
  answer: string;
  sources: RagSource[];
  visualIntent: boolean;
};

export type RagChatHistoryMessage = {
  sender: 'USER' | 'SYSTEM';
  content: string;
};

export type RagStreamEvent =
  | { type: 'sources'; sources: RagSource[]; visualIntent: boolean }
  | { type: 'token'; token: string }
  | { type: 'done'; answer: string; sources: RagSource[]; visualIntent: boolean }
  | { type: 'error'; message: string; sources: RagSource[]; visualIntent: boolean };
