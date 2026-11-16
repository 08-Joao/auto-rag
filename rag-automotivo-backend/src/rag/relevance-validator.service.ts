import { Injectable } from '@nestjs/common';

import type {
  RagAnswerability,
  RagConversationVehicle,
  RagSource,
  RetrievedChunkEvaluation,
} from './types';

type AutomotiveConcept = {
  id: string;
  terms: RegExp[];
};

type EvidenceSelection = {
  accepted: RagSource[];
  selected: RagSource[];
  evaluations: RetrievedChunkEvaluation[];
  answerability: RagAnswerability;
  selectionThreshold: number;
};

const STOP_WORDS = new Set([
  'a',
  'o',
  'as',
  'os',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'em',
  'no',
  'na',
  'para',
  'por',
  'com',
  'como',
  'qual',
  'quais',
  'onde',
  'fica',
  'esta',
  'está',
  'um',
  'uma',
  'the',
  'of',
  'in',
  'on',
  'to',
  'for',
  'how',
  'what',
  'where',
  'is',
  'are',
  'vehicle',
  'veiculo',
  'veículo',
]);

const CONCEPTS: AutomotiveConcept[] = [
  {
    id: 'fuel_filler',
    terms: [
      /\b(?:fuel|petrol|gas(?:oline)?)\s+(?:tank\s+)?(?:filler\s+)?(?:cap|flap|door|neck)\b/i,
      /\b(?:tank cap|tank flap|refuell?ing flap)\b/i,
      /\b(?:tampa|portinhola|bocal).{0,30}\b(?:combust[ií]vel|gasolina|tanque)\b/i,
      /\b(?:combust[ií]vel|gasolina|tanque).{0,30}\b(?:tampa|portinhola|bocal)\b/i,
    ],
  },
  {
    id: 'oil_filler',
    terms: [
      /\b(?:engine\s+)?oil\s+filler\s+(?:cap|neck|opening)\b/i,
      /\b(?:tampa|bocal).{0,25}\b(?:[oó]leo(?:\s+do\s+motor)?)\b/i,
      /\b(?:[oó]leo(?:\s+do\s+motor)?).{0,25}\b(?:tampa|bocal)\b/i,
    ],
  },
  {
    id: 'brake_fluid',
    terms: [
      /\bbrake fluid(?: reservoir)?\b/i,
      /\b(?:reservat[oó]rio|fluido).{0,25}\bfreio\b/i,
    ],
  },
  {
    id: 'coolant',
    terms: [
      /\b(?:coolant|cooling system|expansion tank)\b/i,
      /\b(?:l[ií]quido|reservat[oó]rio|tanque).{0,30}\b(?:arrefecimento|expans[aã]o)\b/i,
    ],
  },
  {
    id: 'oil_dipstick',
    terms: [/\b(?:engine\s+)?oil dipstick\b/i, /\bvareta.{0,20}\b[oó]leo\b/i],
  },
  {
    id: 'battery',
    terms: [/\b(?:vehicle |car )?battery\b/i, /\bbateria\b/i],
  },
  {
    id: 'fuse',
    terms: [/\b(?:fuse box|fuses?)\b/i, /\bfus[ií]ve(?:l|is)\b/i],
  },
  {
    id: 'tire_pressure',
    terms: [
      /\b(?:tire|tyre) (?:inflation )?pressure\b/i,
      /\b(?:calibragem|press[aã]o).{0,25}\b(?:pneu|pneus)\b/i,
    ],
  },
  {
    id: 'tank_capacity',
    terms: [
      /\bfuel tank capacity\b/i,
      /\bcapacidade.{0,25}\b(?:tanque|combust[ií]vel)\b/i,
    ],
  },
  {
    id: 'oil_specification',
    terms: [
      /\b(?:engine )?oil (?:specification|standard|viscosity|grade)\b/i,
      /\b(?:qual|tipo|viscosidade|norma).{0,30}\b[oó]leo\b/i,
      /\b[oó]leo.{0,30}\b(?:recomendad|tipo|viscosidade|norma)\b/i,
    ],
  },
  {
    id: 'fuel_specification',
    terms: [
      /\b(?:fuel|gasoline|petrol) (?:grade|recommendation|octane)\b/i,
      /\b(?:qual|tipo).{0,25}\bcombust[ií]vel\b/i,
    ],
  },
  {
    id: 'trunk',
    terms: [/\b(?:trunk|boot lid|luggage compartment)\b/i, /\bporta-malas\b/i],
  },
  {
    id: 'air_conditioning',
    terms: [
      /\b(?:air conditioning|climate control)\b/i,
      /\bar[- ]condicionado\b/i,
    ],
  },
  {
    id: 'spare_wheel',
    terms: [/\bspare (?:wheel|tire|tyre)\b/i, /\bestepe\b/i],
  },
  {
    id: 'hood_opening',
    terms: [
      /\b(?:opening|open|unlocking).{0,25}\b(?:hood|bonnet)\b/i,
      /\b(?:hood|bonnet).{0,25}\b(?:lever|release|handle|latch)\b/i,
      /\b(?:abrir|abro|abertura|alavanca|trava).{0,25}\bcap[oô]\b/i,
      /\bcap[oô].{0,25}\b(?:abrir|abro|alavanca|trava)\b/i,
    ],
  },
  {
    id: 'oil_pressure_warning',
    terms: [
      /\b(?:engine )?oil pressure\b/i,
      /\boil pressure (?:warning|indicator|light)\b/i,
      /\b(?:aviso|luz|indicador).{0,35}\bpress[aã]o.{0,20}\b[oó]leo\b/i,
      /\bpress[aã]o.{0,20}\b[oó]leo.{0,30}\b(?:baixa|aviso|luz|indicador)\b/i,
    ],
  },
  {
    id: 'tire_pressure_store',
    terms: [
      /\b(?:storing|store|save).{0,25}\b(?:tire|tyre) pressures?\b/i,
      /\btire pressure monitoring\b/i,
      /\b(?:salv|armazen).{0,30}\bpress[aã]o.{0,20}\bpneus?\b/i,
      /\bpress[aã]o.{0,20}\bpneus?.{0,30}\b(?:salv|armazen|sistema)\b/i,
    ],
  },
  {
    id: 'cruise_control',
    terms: [
      /\bcruise control\b/i,
      /\bcontrole de cruzeiro\b/i,
    ],
  },
  {
    id: 'fuel_filler_emergency_release',
    terms: [
      /\bfuel filler (?:door|flap).{0,30}\bemergency release\b/i,
      /\bemergency release.{0,30}\bfuel filler (?:door|flap)\b/i,
      /\b(?:portinhola|tampa).{0,40}\btanque.{0,45}\b(?:manual|emerg[eê]ncia|falha|falhar)\b/i,
      /\b(?:manual|emerg[eê]ncia|falha|falhar).{0,45}\b(?:portinhola|tampa).{0,40}\btanque\b/i,
    ],
  },
  {
    id: 'washer_fluid',
    terms: [
      /\b(?:windshield|windscreen|headlamp|headlight) washer (?:fluid )?(?:system|reservoir|container|cap)?\b/i,
      /\bwasher fluid(?: reservoir| container| cap|s)?\b/i,
      /\b(?:reservat[oó]rio|tampa).{0,35}\b(?:limpador|lavador|para-brisa)\b/i,
      /\b(?:limpador|lavador|para-brisa).{0,35}\b(?:reservat[oó]rio|tampa)\b/i,
    ],
  },
  {
    id: 'washer_capacity',
    terms: [
      /\b(?:washer|washing)[\s\S]{0,120}\b(?:filling )?capacity\b/i,
      /\b(?:filling )?capacity[\s\S]{0,120}\b(?:washer|washing)\b/i,
      /\bcapacidade.{0,35}\b(?:reservat[oó]rio|limpador|lavador)\b/i,
    ],
  },
  {
    id: 'jump_start_positive',
    terms: [
      /\bjump-starting connection\b/i,
      /\b(?:jumper cables?|jump start).{0,35}\bpositive terminal\b/i,
      /\b(?:cabo|terminal|polo).{0,25}\bpositivo.{0,45}\bpartida auxiliar\b/i,
      /\bpartida auxiliar.{0,45}\b(?:positivo|terminal|polo)\b/i,
    ],
  },
];

@Injectable()
export class RelevanceValidatorService {
  evaluate(
    query: string,
    sources: RagSource[],
    vehicle: RagConversationVehicle,
  ): EvidenceSelection {
    const queryConcepts = this.detectConcepts(query);
    const queryTerms = this.contentTerms(query, vehicle);
    const evaluations = sources.map((source) =>
      this.evaluateSource(queryConcepts, queryTerms, source, vehicle),
    );
    const acceptedIds = new Set(
      evaluations
        .filter((evaluation) => evaluation.isAnswerable)
        .map((evaluation) => evaluation.chunkId),
    );
    for (const source of sources) {
      if ((source.retrieval_scores?.structural_neighbor ?? 0) >= 0.8) {
        acceptedIds.add(source.chunk_id);
      }
    }

    const accepted = sources.filter((source) =>
      acceptedIds.has(source.chunk_id),
    );
    const rankedEvaluations = evaluations
      .filter((item) => item.isAnswerable)
      .sort(
        (left, right) =>
          (right.selectionScore ?? 0) - (left.selectionScore ?? 0),
      );
    const bestScore = rankedEvaluations[0]?.selectionScore ?? 0;
    const selectionThreshold =
      bestScore > 0 ? Math.max(0.28, bestScore * 0.72, bestScore - 0.16) : 1;
    const selectedIds = new Set(
      rankedEvaluations
        .filter(
          (item) =>
            (item.evidenceClass === 'DIRECTLY_ANSWERS' ||
              item.evidenceClass === 'COMPLEMENTS') &&
            (item.selectionScore ?? 0) >=
              ((sources.find((source) => source.chunk_id === item.chunkId)
                ?.retrieval_scores?.structural_neighbor ?? 0) >= 0.8
                ? 0.22
                : selectionThreshold),
        )
        .slice(0, 8)
        .map((item) => item.chunkId),
    );
    for (const source of sources) {
      if ((source.retrieval_scores?.structural_neighbor ?? 0) >= 0.8) {
        selectedIds.add(source.chunk_id);
      }
    }
    const sourceById = new Map(
      accepted.map((source) => [source.chunk_id, source]),
    );
    const rankedSelected = rankedEvaluations
      .filter((item) => selectedIds.has(item.chunkId))
      .map((item) => sourceById.get(item.chunkId))
      .filter((source): source is RagSource => Boolean(source));
    const rankedSelectedIds = new Set(
      rankedSelected.map((source) => source.chunk_id),
    );
    const selected = [
      ...rankedSelected,
      ...sources.filter(
        (source) =>
          selectedIds.has(source.chunk_id) &&
          !rankedSelectedIds.has(source.chunk_id),
      ),
    ];
    const selectedEvaluations = evaluations.filter((item) =>
      selectedIds.has(item.chunkId),
    );
    const directCount = selectedEvaluations.filter(
      (item) => item.evidenceClass === 'DIRECTLY_ANSWERS',
    ).length;
    const answerability: RagAnswerability =
      directCount > 0
        ? 'DIRECT'
        : selectedEvaluations.length >= 2
          ? 'SYNTHESIZABLE'
          : selectedEvaluations.length === 1
            ? 'PARTIAL'
            : 'NOT_ANSWERABLE';

    return {
      accepted,
      selected,
      evaluations,
      answerability,
      selectionThreshold,
    };
  }

  detectPrimaryConcept(text: string): string {
    return this.detectConcepts(text)[0] ?? '';
  }

  private evaluateSource(
    queryConcepts: string[],
    queryTerms: string[],
    source: RagSource,
    vehicle: RagConversationVehicle,
  ): RetrievedChunkEvaluation {
    const fullEvidence = `${source.section_title ?? ''}\n${source.text}`;
    const evidenceLead = fullEvidence.slice(0, 4000);
    const evidenceForConcepts =
      fullEvidence.length > 8000
        ? `${evidenceLead}\n${fullEvidence.slice(-4000)}`
        : fullEvidence;
    const sourceConcepts = this.detectConcepts(evidenceForConcepts);
    const sourceTerms = new Set(
      this.contentTerms(`${source.section_title ?? ''}\n${source.text}`, {}),
    );
    const matchedTerms = queryTerms.filter((term) => sourceTerms.has(term));
    const queryTermCoverage =
      queryTerms.length > 0 ? matchedTerms.length / queryTerms.length : 0;
    const vehicleMatch = this.vehicleMatches(source, vehicle);
    const knownComponentMatch = queryConcepts.some((concept) =>
      sourceConcepts.includes(concept),
    );
    const specificConcept = [
      'fuel_filler_emergency_release',
      'oil_pressure_warning',
      'tire_pressure_store',
      'washer_capacity',
      'jump_start_positive',
      'hood_opening',
      'cruise_control',
      'spare_wheel',
    ].find((concept) => queryConcepts.includes(concept));
    const requiredConceptMatch = specificConcept
      ? sourceConcepts.includes(specificConcept)
      : knownComponentMatch;
    const conceptCoverage =
      queryConcepts.length > 0
        ? queryConcepts.filter((concept) => sourceConcepts.includes(concept))
            .length / queryConcepts.length
        : 0;
    const componentMatch =
      queryConcepts.length === 0
        ? queryTermCoverage >= 0.12
        : requiredConceptMatch;
    const conflictingConcept =
      queryConcepts.length > 0 && sourceConcepts.length > 0 && !componentMatch;
    const semanticScore = Math.max(
      source.retrieval_scores?.lead_vector ?? 0,
      source.retrieval_scores?.vector ?? 0,
      source.score ?? 0,
    );
    const lexicalScore = Math.max(
      source.retrieval_scores?.lexical ?? 0,
      source.retrieval_scores?.bm25 ?? 0,
      source.retrieval_scores?.domain ?? 0,
    );
    const finalScore = source.retrieval_scores?.final ?? source.score ?? 0;
    const structuralNeighbor =
      (source.retrieval_scores?.structural_neighbor ?? 0) >= 0.8;
    const intentMatch = !conflictingConcept;
    const singleLetterSection = /^[A-Z]$/i.test(
      (source.section_title ?? '').trim(),
    );
    const indexLike =
      singleLetterSection &&
      (/(?:^|\n)\s*ind\s*ex\s*(?:\n|$)/i.test(evidenceForConcepts) ||
        (evidenceLead.match(/\.{3,}\s*\d+/g)?.length ?? 0) >= 3);
    const hasDirectEvidence =
      requiredConceptMatch ||
      queryTermCoverage >= 0.45 ||
      (queryTerms.length === 0 && semanticScore >= 0.62);
    const scorePass =
      finalScore >= 0.22 || semanticScore >= 0.52 || lexicalScore >= 0.45;
    const selectionScore = Math.max(
      0,
      Math.min(
        1,
        0.5 * finalScore +
          0.25 * semanticScore +
          0.2 * queryTermCoverage +
          (knownComponentMatch ? 0.05 : 0) +
          0.08 * conceptCoverage,
      ),
    );
    let evidenceClass: RetrievedChunkEvaluation['evidenceClass'];
    if (!vehicleMatch || conflictingConcept || indexLike) {
      evidenceClass = 'UNRELATED';
    } else if (
      hasDirectEvidence &&
      (requiredConceptMatch || queryTermCoverage >= 0.45)
    ) {
      evidenceClass = 'DIRECTLY_ANSWERS';
    } else if (
      structuralNeighbor &&
      scorePass
    ) {
      evidenceClass = 'COMPLEMENTS';
    } else if (
      queryConcepts.length === 0 &&
      scorePass &&
      (queryTermCoverage >= 0.12 || semanticScore >= 0.58)
    ) {
      evidenceClass = 'COMPLEMENTS';
    } else if (scorePass) {
      evidenceClass = 'ONLY_RELATED';
    } else {
      evidenceClass = 'UNRELATED';
    }
    const isAnswerable =
      vehicleMatch &&
      intentMatch &&
      scorePass &&
      !indexLike &&
      (evidenceClass === 'DIRECTLY_ANSWERS' || evidenceClass === 'COMPLEMENTS');

    let rejectionReason: string | undefined;
    if (!vehicleMatch) {
      rejectionReason = 'vehicle_mismatch';
    } else if (indexLike) {
      rejectionReason = 'index_reference_not_answer_evidence';
    } else if (conflictingConcept) {
      rejectionReason = `component_conflict:${sourceConcepts.join(',')}`;
    } else if (evidenceClass === 'ONLY_RELATED') {
      rejectionReason = 'only_related_not_answer_evidence';
    } else if (!componentMatch && semanticScore < 0.58) {
      rejectionReason = 'component_not_evidenced';
    } else if (!scorePass) {
      rejectionReason = 'below_relevance_threshold';
    }

    return {
      chunkId: source.chunk_id,
      semanticScore,
      lexicalScore,
      rerankScore: source.retrieval_scores?.reranker,
      vehicleMatch,
      intentMatch,
      componentMatch,
      isAnswerable,
      evidenceClass,
      selectionScore,
      queryTermCoverage,
      matchedTerms,
      rejectionReason,
    };
  }

  private detectConcepts(text: string): string[] {
    return CONCEPTS.filter((concept) =>
      concept.terms.some((term) => term.test(text)),
    ).map((concept) => concept.id);
  }

  private contentTerms(
    text: string,
    vehicle: RagConversationVehicle,
  ): string[] {
    const vehicleTerms = new Set(
      Object.values(vehicle)
        .flatMap((value) => this.tokenize(String(value ?? '')))
        .filter(Boolean),
    );
    return [
      ...new Set(
        this.tokenize(text).filter(
          (term) =>
            term.length >= 2 &&
            !STOP_WORDS.has(term) &&
            !vehicleTerms.has(term),
        ),
      ),
    ];
  }

  private tokenize(text: string): string[] {
    return (
      text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .match(/[a-z0-9]+(?:[./-][a-z0-9]+)*/g) ?? []
    );
  }

  private vehicleMatches(
    source: RagSource,
    requested: RagConversationVehicle,
  ): boolean {
    const normalize = (value: unknown) =>
      (typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : ''
      )
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const make = normalize(
      source.metadata.vehicle_make ?? source.metadata.brand,
    );
    const model = normalize(source.metadata.vehicle_model);
    const year = String(source.metadata.vehicle_year ?? '');
    const requestedModel = normalize(requested.model);
    const modelAliases: Record<string, string[]> = {
      '750il': ['750il', '7 series'],
      '750i': ['750i', '7 series'],
      '740i': ['740i', '7 series'],
      '330': ['330', '3 series'],
    };

    if (requested.brand && make !== normalize(requested.brand)) {
      return false;
    }
    if (
      requested.model &&
      !model.split(' ').includes(requestedModel) &&
      !(modelAliases[requestedModel] ?? [requestedModel]).some(
        (alias) => model === alias || model.replace(/\s+/g, '') === alias.replace(/\s+/g, ''),
      )
    ) {
      return false;
    }
    if (requested.year && year !== requested.year) {
      return false;
    }
    return true;
  }
}
