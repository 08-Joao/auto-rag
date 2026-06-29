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
  clip_results?: ClipImageResult[];
};

export type RagRetrievalResult = {
  query: string;
  results: RagSource[];
};

export type ClipImageResult = {
  imagePath: string;
  score: number;
  page?: number;
  source?: string;
  chunkId?: string;
};

export type RagAnswer = {
  answer: string;
  sources: RagSource[];
  returnImages: boolean;
};

export type RagChatHistoryMessage = {
  sender: 'USER' | 'SYSTEM';
  content: string;
};

export type RagStreamEvent =
  | {
      type: 'sources';
      sources: RagSource[];
      returnImages: boolean;
      visualIntent: boolean;
    }
  | { type: 'token'; token: string }
  | {
      type: 'done';
      answer: string;
      sources: RagSource[];
      returnImages: boolean;
      visualIntent: boolean;
    }
  | {
      type: 'error';
      message: string;
      sources: RagSource[];
      returnImages: boolean;
      visualIntent: boolean;
    };
