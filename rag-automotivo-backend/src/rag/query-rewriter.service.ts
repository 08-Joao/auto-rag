import { Injectable } from '@nestjs/common';

import type {
  RagChatHistoryMessage,
  RagConversationState,
  RagConversationVehicle,
  RagMessageIntent,
  RagQueryRewriteResult,
} from './types';

type ParsedMessage = {
  vehicle: RagConversationVehicle;
  intent: string;
  isQuestion: boolean;
  isVehicleOnly: boolean;
  isFollowUpLike: boolean;
};

const EMPTY_STATE: RagConversationState = {
  lastUserQuestion: '',
  pendingQuestion: '',
  resolvedQuery: '',
  intent: '',
  vehicle: {},
  missingSlots: [],
  lastAnswerNeededClarification: false,
};

@Injectable()
export class QueryRewriterService {
  private readonly brands = [
    'audi',
    'bmw',
    'byd',
    'chevrolet',
    'citroen',
    'fiat',
    'ford',
    'honda',
    'hyundai',
    'jeep',
    'kia',
    'nissan',
    'peugeot',
    'renault',
    'toyota',
    'volkswagen',
    'vw',
  ];

  private readonly modelBrandMap: Record<string, string> = {
    a3: 'audi',
    a4: 'audi',
    a5: 'audi',
    a6: 'audi',
    q5: 'audi',
    q7: 'audi',
    corolla: 'toyota',
    civic: 'honda',
    fit: 'honda',
    onix: 'chevrolet',
    cruze: 'chevrolet',
    corsa: 'chevrolet',
    vectra: 'chevrolet',
    gol: 'volkswagen',
    golf: 'volkswagen',
    polo: 'volkswagen',
    uno: 'fiat',
    palio: 'fiat',
  };

  rewrite(
    rawMessage: string,
    history: RagChatHistoryMessage[] = [],
    previousState?: RagConversationState | null,
  ): RagQueryRewriteResult {
    const normalizedRaw = this.normalizeWhitespace(rawMessage);
    const state = this.normalizeState(previousState);
    const parsed = this.parseMessage(normalizedRaw);
    const historyVehicle = this.extractVehicleFromHistory(history);
    const baseVehicle = this.mergeVehicle(
      historyVehicle,
      state.vehicle,
      parsed.vehicle,
    );

    const hasPendingQuestion =
      Boolean(state.pendingQuestion) && state.lastAnswerNeededClarification;
    const currentHasVehicle = Boolean(
      parsed.vehicle.brand ||
      parsed.vehicle.model ||
      parsed.vehicle.year ||
      parsed.vehicle.engine,
    );
    const isFollowUp =
      (hasPendingQuestion && (parsed.isVehicleOnly || !parsed.isQuestion)) ||
      (!hasPendingQuestion && parsed.isFollowUpLike && !currentHasVehicle);

    const sourceQuestion =
      hasPendingQuestion && isFollowUp
        ? state.pendingQuestion
        : isFollowUp
          ? this.resolveFollowUpQuestion(normalizedRaw, state, history)
          : normalizedRaw;
    const resolvedQuery = this.composeResolvedQuery(
      sourceQuestion,
      baseVehicle,
    );
    const intent =
      parsed.intent !== 'manual_lookup'
        ? parsed.intent
        : state.intent || this.detectIntent(resolvedQuery);
    const missingSlots = this.getMissingSlots(
      resolvedQuery,
      baseVehicle,
      intent,
    );
    const pendingQuestion = missingSlots.length > 0 ? resolvedQuery : '';
    const messageIntent = this.classifyMessageIntent(
      normalizedRaw,
      parsed,
      state,
      isFollowUp,
    );
    const openIntent = this.buildOpenIntent(
      normalizedRaw,
      resolvedQuery,
      baseVehicle,
    );
    const nextState: RagConversationState = {
      lastUserQuestion: normalizedRaw,
      pendingQuestion,
      resolvedQuery,
      intent,
      vehicle: baseVehicle,
      missingSlots,
      lastAnswerNeededClarification: missingSlots.length > 0,
      messageIntent,
    };

    return {
      rawMessage: normalizedRaw,
      isFollowUp,
      resolvedQuery,
      intent,
      vehicle: baseVehicle,
      missingSlots,
      pendingQuestion,
      lastAnswerNeededClarification: nextState.lastAnswerNeededClarification,
      messageIntent,
      openIntent,
      state: nextState,
    };
  }

  emptyState(): RagConversationState {
    return { ...EMPTY_STATE, vehicle: {}, missingSlots: [] };
  }

  private parseMessage(message: string): ParsedMessage {
    const vehicle = this.extractVehicle(message);
    const intent = this.detectIntent(message);
    const isQuestion = this.isQuestionLike(message);
    const isVehicleOnly = this.isVehicleOnly(message, vehicle);
    const isFollowUpLike = this.isFollowUpLike(message);

    return { vehicle, intent, isQuestion, isVehicleOnly, isFollowUpLike };
  }

  private normalizeState(
    state?: RagConversationState | null,
  ): RagConversationState {
    if (!state) {
      return this.emptyState();
    }

    return {
      lastUserQuestion: state.lastUserQuestion ?? '',
      pendingQuestion: state.pendingQuestion ?? '',
      resolvedQuery: state.resolvedQuery ?? '',
      intent: state.intent ?? '',
      vehicle: state.vehicle ?? {},
      missingSlots: Array.isArray(state.missingSlots) ? state.missingSlots : [],
      lastAnswerNeededClarification:
        state.lastAnswerNeededClarification === true,
    };
  }

  private composeResolvedQuery(
    question: string,
    vehicle: RagConversationVehicle,
  ): string {
    let resolved = this.normalizeWhitespace(question);
    if (!resolved) {
      resolved = this.vehicleToText(vehicle);
    }

    resolved = this.expandPronouns(resolved, vehicle);

    const vehicleText = this.vehicleToText(vehicle);
    if (vehicleText) {
      const replaced = this.replaceVehicleInQuestion(resolved, vehicleText);
      if (replaced !== resolved) {
        resolved = replaced;
      } else if (!this.queryHasFullVehicle(resolved, vehicle)) {
        resolved = `${resolved.replace(/[?.!]+$/, '')} ${vehicleText}?`;
      }
    }

    return this.normalizeWhitespace(resolved);
  }

  private replaceVehicleInQuestion(
    question: string,
    vehicleText: string,
  ): string {
    const brandPattern = this.brands.join('|');
    const modelPattern = Object.keys(this.modelBrandMap).join('|');
    const pattern = new RegExp(
      `\\b(?:${brandPattern})\\s+(?:${modelPattern}|[a-z0-9-]{1,16})(?:\\s+(?:19|20)\\d{2})?(?:\\s+\\d\\.\\d\\s*(?:tfsi|tsi|tdi|flex|turbo)?)?`,
      'i',
    );

    if (pattern.test(question)) {
      return question.replace(pattern, vehicleText);
    }

    const standaloneModel = Object.keys(this.modelBrandMap).find((model) =>
      new RegExp(`\\b${model}\\b`, 'i').test(question),
    );
    const vehicleAddsMissingDetails =
      (/\b(?:19|20)\d{2}\b/.test(vehicleText) &&
        !/\b(?:19|20)\d{2}\b/.test(question)) ||
      (/\b\d\.\d\b/.test(vehicleText) && !/\b\d\.\d\b/.test(question));
    if (standaloneModel && vehicleAddsMissingDetails) {
      return question.replace(
        new RegExp(`\\b${standaloneModel}\\b`, 'i'),
        vehicleText,
      );
    }

    return question;
  }

  private resolveFollowUpQuestion(
    message: string,
    state: RagConversationState,
    history: RagChatHistoryMessage[],
  ): string {
    if (this.isFollowUpLike(message)) {
      if (
        state.intent === 'oil_specification' &&
        /\btampa\s+(dele|dela)\b/i.test(message)
      ) {
        return message.replace(
          /\btampa\s+(dele|dela)\b/i,
          'tampa do oleo dele',
        );
      }

      return message;
    }

    return (
      state.pendingQuestion ||
      state.resolvedQuery ||
      this.lastUserQuestionFromHistory(history) ||
      message
    );
  }

  private expandPronouns(
    question: string,
    vehicle: RagConversationVehicle,
  ): string {
    const vehicleText = this.vehicleToText(vehicle);
    if (!vehicleText) {
      return question;
    }

    return question
      .replace(/\bdele\b/gi, `do ${vehicleText}`)
      .replace(/\bdela\b/gi, `do ${vehicleText}`)
      .replace(/\bdesse carro\b/gi, `do ${vehicleText}`)
      .replace(/\bdeste carro\b/gi, `do ${vehicleText}`)
      .replace(/\bdo carro\b/gi, `do ${vehicleText}`);
  }

  private extractVehicleFromHistory(
    history: RagChatHistoryMessage[],
  ): RagConversationVehicle {
    return history
      .filter((message) => message.sender === 'USER')
      .map((message) => this.extractVehicle(message.content))
      .reduce(
        (acc, vehicle) => this.mergeVehicle(acc, vehicle),
        {} as RagConversationVehicle,
      );
  }

  private lastUserQuestionFromHistory(
    history: RagChatHistoryMessage[],
  ): string {
    return (
      history
        .filter((message) => message.sender === 'USER')
        .map((message) => message.content)
        .reverse()
        .find((content) => this.isQuestionLike(content)) ?? ''
    );
  }

  private extractVehicle(text: string): RagConversationVehicle {
    const normalized = text.toLowerCase();
    const year = normalized.match(/\b(19|20)\d{2}\b/)?.[0];
    const engine = normalized.match(
      /\b\d\.\d\s*(?:tfsi|tsi|tdi|flex|turbo)?\b/i,
    )?.[0];
    const brandMatch = this.brands.find((brand) =>
      new RegExp(`\\b${brand}\\b`, 'i').test(normalized),
    );
    const model = this.extractModel(normalized, brandMatch);
    const inferredBrand =
      brandMatch ??
      (model ? this.modelBrandMap[model.toLowerCase()] : undefined);

    return {
      brand: this.titleBrand(inferredBrand),
      model: model ? this.titleModel(model) : undefined,
      year,
      engine: engine?.trim(),
    };
  }

  private extractModel(text: string, brand?: string): string | undefined {
    if (brand) {
      const afterBrand = text.match(
        new RegExp(
          `\\b${brand}\\b\\s+([a-z0-9-]{1,16}(?:\\s+[a-z0-9-]{1,16})?)`,
          'i',
        ),
      )?.[1];
      if (afterBrand) {
        const candidate = afterBrand
          .split(/\s+/)
          .filter((part) => !/^(?:19|20)\d{2}$/.test(part))
          .filter((part) => !/^\d\.\d/.test(part))
          .slice(0, 2)
          .join(' ');
        if (candidate) {
          return candidate;
        }
      }
    }

    return Object.keys(this.modelBrandMap).find((model) =>
      new RegExp(`\\b${model}\\b`, 'i').test(text),
    );
  }

  private mergeVehicle(
    ...vehicles: Array<RagConversationVehicle | undefined | null>
  ): RagConversationVehicle {
    return vehicles.reduce<RagConversationVehicle>((acc, vehicle) => {
      if (!vehicle) {
        return acc;
      }

      return {
        brand: vehicle.brand ?? acc.brand,
        model: vehicle.model ?? acc.model,
        year: vehicle.year ?? acc.year,
        engine: vehicle.engine ?? acc.engine,
        version: vehicle.version ?? acc.version,
      };
    }, {} as RagConversationVehicle);
  }

  private getMissingSlots(
    query: string,
    vehicle: RagConversationVehicle,
    intent: string,
  ): string[] {
    const needsVehicle = [
      'oil_specification',
      'locate_oil_cap',
      'locate_component',
      'tire_specification',
      'procedure',
    ].includes(intent);

    if (!needsVehicle) {
      return [];
    }

    const missing: string[] = [];
    if (!vehicle.brand && !this.hasAnyKnownBrandOrModel(query)) {
      missing.push('brand');
    }
    if (!vehicle.model && !this.hasAnyKnownBrandOrModel(query)) {
      missing.push('model');
    }
    if (!vehicle.year) {
      missing.push('year');
    }

    return missing;
  }

  private detectIntent(text: string): string {
    const normalized = text.toLowerCase();
    if (
      /(tampa|bocal).*(óleo|oleo|oil)|(?:óleo|oleo|oil).*(tampa|bocal|filler)/i.test(
        normalized,
      )
    ) {
      if (this.hasLocationTerm(normalized)) {
        return 'locate_oil_cap';
      }
    }
    if (this.hasLocationTerm(normalized)) {
      return 'locate_component';
    }
    if (
      /(qual|tipo|recomendad|viscosidade|norma).*(óleo|oleo|oil)|(?:óleo|oleo|oil).*(qual|tipo|recomendad|viscosidade|norma)/i.test(
        normalized,
      )
    ) {
      return 'oil_specification';
    }
    if (/(pneu|aro|roda|calibragem|press[aã]o)/i.test(normalized)) {
      return 'tire_specification';
    }
    if (
      /(como|procedimento|passo a passo|trocar|verificar|resetar)/i.test(
        normalized,
      )
    ) {
      return 'procedure';
    }
    return 'manual_lookup';
  }

  private classifyMessageIntent(
    message: string,
    parsed: ParsedMessage,
    previous: RagConversationState,
    isFollowUp: boolean,
  ): RagMessageIntent {
    if (
      /\b(?:na verdade|corrigindo|corre[cç][aã]o|quis dizer)\b/i.test(message)
    ) {
      return 'CORRECTION';
    }
    if (previous.lastAnswerNeededClarification && isFollowUp) {
      return 'CLARIFICATION_RESPONSE';
    }
    if (
      parsed.isQuestion &&
      previous.intent &&
      parsed.intent !== 'manual_lookup' &&
      parsed.intent !== previous.intent
    ) {
      return 'TOPIC_CHANGE';
    }
    if (isFollowUp) {
      return 'FOLLOW_UP';
    }
    return 'NEW_QUESTION';
  }

  private buildOpenIntent(
    originalMeaning: string,
    standaloneQuery: string,
    vehicle: RagConversationVehicle,
  ): RagQueryRewriteResult['openIntent'] {
    const normalized = standaloneQuery.replace(/[?!.,;:]+/g, ' ').trim();
    const actionMatch = normalized.match(
      /\b(onde fica|onde está|como|qual|quanto|quando|localizar|abrir|fechar|ativar|desativar|trocar|verificar|ajustar|configurar|redefinir|rebocar|usar)\b/i,
    );
    const constraints = [
      vehicle.brand,
      vehicle.model,
      vehicle.year,
      vehicle.engine,
      vehicle.version,
    ].filter((value): value is string => Boolean(value));
    let subject = normalized;
    if (actionMatch) {
      subject = subject.replace(actionMatch[0], '').trim();
    }
    for (const constraint of constraints) {
      subject = subject.replace(new RegExp(`\\b${constraint}\\b`, 'gi'), ' ');
    }
    subject = subject
      .replace(/\b(?:do|da|de|no|na|o|a|um|uma|ve[ií]culo|carro)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      action: actionMatch?.[0].toLowerCase(),
      subject: subject || undefined,
      attributes: this.extractProtectedTerms(standaloneQuery),
      constraints,
      originalMeaning,
      standaloneQuery,
    };
  }

  private extractProtectedTerms(text: string): string[] {
    return [
      ...(text.match(/"[^"]+"/g) ?? []),
      ...(text.match(
        /\b(?:\d+(?:[.,]\d+)?\s*(?:v|bar|psi|kpa|nm|litros?|l)|\d{3}\/\d{2}\s*r\s*\d{2}|[a-z]\d{1,3}|[05]w-?\d{2})\b/gi,
      ) ?? []),
      ...(text.match(/\b(?:n[aã]o|sem|nunca|apenas)\b/gi) ?? []),
    ];
  }

  private hasLocationTerm(text: string): boolean {
    return [
      'onde fica',
      'onde esta',
      'onde está',
      'localizado',
      'localizada',
      'localizacao',
      'localização',
      'mostre',
      'mostrar',
      'imagem',
      'diagrama',
      'figura',
      'reservatorio',
      'reservatório',
    ].some((term) => text.includes(term));
  }

  private isQuestionLike(text: string): boolean {
    const normalized = text.toLowerCase();
    return (
      text.includes('?') ||
      [
        'qual',
        'onde',
        'como',
        'quando',
        'quanto',
        'mostre',
        'mostrar',
        'preciso',
        'quero',
        'me diga',
      ].some((term) => normalized.includes(term))
    );
  }

  private isVehicleOnly(
    text: string,
    vehicle: RagConversationVehicle,
  ): boolean {
    const normalized = text.toLowerCase().trim();
    if (!normalized) {
      return false;
    }
    if (this.isQuestionLike(text)) {
      return false;
    }
    if (!vehicle.brand && !vehicle.model && !vehicle.year && !vehicle.engine) {
      return false;
    }

    const stripped = normalized
      .replace(/\b(?:19|20)\d{2}\b/g, '')
      .replace(/\b\d\.\d\s*(?:tfsi|tsi|tdi|flex|turbo)?\b/gi, '')
      .replace(new RegExp(`\\b(${this.brands.join('|')})\\b`, 'gi'), '')
      .replace(
        new RegExp(
          `\\b(${Object.keys(this.modelBrandMap).join('|')})\\b`,
          'gi',
        ),
        '',
      )
      .replace(/\b(ano|motor|vers[aã]o|modelo)\b/gi, '')
      .replace(/[^\wÀ-ÿ]+/g, ' ')
      .trim();

    return stripped.length === 0 || normalized.split(/\s+/).length <= 5;
  }

  private isFollowUpLike(text: string): boolean {
    const normalized = text.toLowerCase();
    return (
      /\b(dele|dela|desse|deste|do carro|da mesma|mesmo)\b/i.test(normalized) ||
      /^(e|tambem|também)\s+(onde|como|qual|quanto)\b/i.test(normalized)
    );
  }

  private hasAnyKnownBrandOrModel(text: string): boolean {
    const normalized = text.toLowerCase();
    return (
      this.brands.some((brand) =>
        new RegExp(`\\b${brand}\\b`).test(normalized),
      ) ||
      Object.keys(this.modelBrandMap).some((model) =>
        new RegExp(`\\b${model}\\b`).test(normalized),
      )
    );
  }

  private queryHasFullVehicle(
    query: string,
    vehicle: RagConversationVehicle,
  ): boolean {
    const normalized = query.toLowerCase();
    if (vehicle.year && !normalized.includes(vehicle.year)) {
      return false;
    }
    if (vehicle.brand && !normalized.includes(vehicle.brand.toLowerCase())) {
      const model = vehicle.model?.toLowerCase();
      const modelImpliesBrand =
        model &&
        normalized.includes(model) &&
        this.modelBrandMap[model] === vehicle.brand.toLowerCase();
      if (!modelImpliesBrand) {
        return false;
      }
    }
    if (vehicle.model && !normalized.includes(vehicle.model.toLowerCase())) {
      return false;
    }
    return Boolean(vehicle.brand || vehicle.model || vehicle.year);
  }

  private vehicleToText(vehicle: RagConversationVehicle): string {
    return [
      vehicle.brand,
      vehicle.model,
      vehicle.year,
      vehicle.engine,
      vehicle.version,
    ]
      .filter(Boolean)
      .join(' ');
  }

  private titleBrand(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }
    if (value.toLowerCase() === 'bmw') {
      return 'BMW';
    }
    return value.toLowerCase() === 'vw'
      ? 'Volkswagen'
      : `${value[0].toUpperCase()}${value.slice(1).toLowerCase()}`;
  }

  private titleModel(value: string): string {
    return value
      .split(/\s+/)
      .map((part) => part.toUpperCase())
      .join(' ');
  }

  private normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }
}
