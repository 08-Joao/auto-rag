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
    lead_vector?: number;
    bm25?: number;
    lexical?: number;
    domain?: number;
    reranker?: number;
    metadata?: number;
    rrf?: number;
    structural_neighbor?: number;
    final?: number;
  };
  clip_results?: ClipImageResult[];
};

export type RagRetrievalResult = {
  query: string;
  status?: RetrievalStatus;
  results: RagSource[];
  warnings?: RetrievalWarning[];
  diagnostics?: Record<string, unknown>;
};

export type RetrievalStatus =
  | 'SUCCESS_WITH_EVIDENCE'
  | 'SUCCESS_WITHOUT_EVIDENCE'
  | 'INDEX_UNAVAILABLE'
  | 'EMBEDDING_FAILURE'
  | 'RERANKER_FAILURE_WITH_FALLBACK'
  | 'VISUAL_FAILURE_WITH_TEXT_SUCCESS'
  | 'TIMEOUT'
  | 'RESOURCE_EXHAUSTED'
  | 'INTERNAL_ERROR';

export type RetrievalWarning = {
  code: string;
  message?: string;
};

export type RetrievalErrorDetail = {
  code: RetrievalStatus;
  message: string;
  retryable: boolean;
};

export type RagRetrievalFilters = {
  brand?: string;
  model?: string;
  year?: string;
  engine?: string;
  version?: string;
};

export type RetrievedChunkEvaluation = {
  chunkId: string;
  semanticScore: number;
  lexicalScore: number;
  rerankScore?: number;
  vehicleMatch: boolean;
  intentMatch: boolean;
  componentMatch: boolean;
  isAnswerable: boolean;
  evidenceClass?:
    | 'DIRECTLY_ANSWERS'
    | 'COMPLEMENTS'
    | 'ONLY_RELATED'
    | 'UNRELATED';
  selectionScore?: number;
  queryTermCoverage?: number;
  matchedTerms?: string[];
  rejectionReason?: string;
};

export type RagAnswerability =
  | 'DIRECT'
  | 'SYNTHESIZABLE'
  | 'PARTIAL'
  | 'NOT_ANSWERABLE';

export type OpenQueryIntent = {
  action?: string;
  subject?: string;
  attributes: string[];
  constraints: string[];
  originalMeaning: string;
  standaloneQuery: string;
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

export type VisualReranker = 'clip' | 'qwen';

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

export type RagMultimodalDiagnostics = {
  requestedReranker: VisualReranker;
  effectiveReranker: VisualReranker;
  durationMs: number;
  rawCandidateCount: number;
  evaluatedCandidateCount: number;
  selectedImageCount: number;
  rejectedImageCount: number;
  selectedImages: Array<{
    imagePath: string;
    page?: number;
    score: number;
  }>;
};

export type RagAnswer = {
  answer: string;
  sources: RagSource[];
  returnImages: boolean;
  confidence?: number;
  status?:
    | 'answered'
    | 'needs_clarification'
    | 'insufficient_context'
    | 'error';
  reasoningType?: string;
  vehicleDetected?: RagVehicleDetected;
  citations?: RagCitation[];
  images?: ClipImageResult[];
  warnings?: string[];
  missingInformation?: string[];
  conversationState?: RagConversationState;
  resolvedQuery?: string;
  isFollowUp?: boolean;
  visualReranker?: VisualReranker;
  multimodalDiagnostics?: RagMultimodalDiagnostics;
  chunkEvaluations?: RetrievedChunkEvaluation[];
  retrievalStatus?: RetrievalStatus;
};

export type RagAnswerOptions = {
  chatId?: string;
  conversationState?: RagConversationState;
  visualReranker?: VisualReranker;
};

export type RagConversationVehicle = {
  brand?: string;
  model?: string;
  year?: string;
  engine?: string;
  version?: string;
};

export type RagMessageIntent =
  | 'NEW_QUESTION'
  | 'CLARIFICATION_RESPONSE'
  | 'CORRECTION'
  | 'FOLLOW_UP'
  | 'TOPIC_CHANGE';

export type RagConversationState = {
  lastUserQuestion: string;
  pendingQuestion: string;
  resolvedQuery: string;
  intent: string;
  vehicle: RagConversationVehicle;
  missingSlots: string[];
  lastAnswerNeededClarification: boolean;
  messageIntent?: RagMessageIntent;
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
  messageIntent: RagMessageIntent;
  openIntent: OpenQueryIntent;
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
      visualReranker?: VisualReranker;
      multimodalDiagnostics?: RagMultimodalDiagnostics;
    }
  | {
      type: 'error';
      message: string;
      sources: RagSource[];
      returnImages: boolean;
      visualIntent: boolean;
    };
