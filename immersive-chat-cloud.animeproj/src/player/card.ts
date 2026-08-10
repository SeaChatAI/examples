import type { CharacterCard } from '@seachat/sdk/render/render';
import { ccv3ToCharacterCard, type Ccv3CardData } from '@seachat/sdk/render/cards';
import defaultCardEnvelope from '../card.json';

/** ccv3 envelope injected by a card Experience or loaded by the shared runtime. */
export type CardEnvelope = {
  spec?: string;
  spec_version?: string;
  data: Ccv3CardData | Record<string, unknown>;
};

export type BoundCard = {
  envelope: CardEnvelope;
  card: CharacterCard;
  preset: ReturnType<typeof ccv3ToCharacterCard>['preset'];
  presetCharacterId: ReturnType<typeof ccv3ToCharacterCard>['presetCharacterId'];
};

export function bindCard(envelope: CardEnvelope): BoundCard {
  const converted = ccv3ToCharacterCard(envelope.data as Ccv3CardData);
  return {
    envelope,
    card: converted.card,
    preset: converted.preset,
    presetCharacterId: converted.presetCharacterId,
  };
}

export const DEFAULT_BOUND = bindCard(defaultCardEnvelope as CardEnvelope);
export const CARD = DEFAULT_BOUND.card;

export function isStub(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('stub');
}
