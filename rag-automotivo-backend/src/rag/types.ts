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
    bm25?: number;
    lexical?: number;
    domain?: number;
    reranker?: number;
    metadata?: number;
    final?: number;
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
  positiveScore?: number;
  positiveLabel?: string;
  negativeScore?: number;
  negativeLabel?: string;
  page?: number;
  source?: string;
  chunkId?: string;
  caption?: string;
  ocrText?: string;
  textScore?: number;
  isRelevant?: boolean;
  rejectionReason?: string;
  reason?: string;
  confidence?: number;
};

export type ImageRerankCandidate = {
  imageId: string;
  imagePath: string;
  page: number;
  caption: string;
  ocrText: string;
  clipScore: number;
  textScore: number;
  isRelevant: boolean;
  rejectionReason: string;
  source?: string;
  chunkId?: string;
};

export type ImageRerankResult = {
  selectedImages: ClipImageResult[];
  rejectedImages: Array<{
    imageId: string;
    imagePath: string;
    page?: number;
    reason: string;
  }>;
  candidates: ImageRerankCandidate[];
};

export type RagAnswer = {
  answer: string;
  sources: RagSource[];
  returnImages: boolean;
  confidence?: number;
  status?: 'answered' | 'needs_clarification' | 'insufficient_context' | 'error';
  reasoningType?: string;
  vehicleDetected?: RagVehicleDetected;
  citations?: RagCitation[];
  images?: ClipImageResult[];
  warnings?: string[];
  missingInformation?: string[];
  conversationState?: RagConversationState;
  resolvedQuery?: string;
  isFollowUp?: boolean;
};

export type RagAnswerOptions = {
  chatId?: string;
  conversationState?: RagConversationState;
};

export type RagConversationVehicle = {
  brand?: string;
  model?: string;
  year?: string;
  engine?: string;
  version?: string;
};

export type RagConversationState = {
  lastUserQuestion: string;
  pendingQuestion: string;
  resolvedQuery: string;
  intent: string;
  vehicle: RagConversationVehicle;
  missingSlots: string[];
  lastAnswerNeededClarification: boolean;
};

export type RagQueryRewriteResult = {
  rawMessage: string;
  isFollowUp: boolean;
  resolvedQuery: string;
  intent: string;
  vehicle: RagConversationVehicle;
  missingSlots: string[];
  pendingQuestion: string;
  lastAnswerNeededClarification: boolean;
  state: RagConversationState;
};

export type RagVehicleDetected = {
  make?: string;
  model?: string;
  year?: number;
  engine?: string;
  certainty: number;
};

export type RagCitation = {
  claim: string;
  sourceIndex: number;
  page: number;
  document: string;
  quote?: string;
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
      confidence?: number;
      status?: RagAnswer['status'];
      reasoningType?: string;
      vehicleDetected?: RagVehicleDetected;
      citations?: RagCitation[];
      images?: ClipImageResult[];
      warnings?: string[];
      missingInformation?: string[];
      conversationState?: RagConversationState;
      resolvedQuery?: string;
      isFollowUp?: boolean;
    }
  | {
      type: 'error';
      message: string;
      sources: RagSource[];
      returnImages: boolean;
      visualIntent: boolean;
    };
