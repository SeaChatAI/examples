/** Test-only bind of src/card.json (product boot binds in main.tsx). */
import { bindCard, type BoundCard, type CardEnvelope } from '../src/player/card.ts';
import cardEnvelope from '../src/card.json';

export const BOUND: BoundCard = bindCard(cardEnvelope as CardEnvelope);
export const CARD = BOUND.card;
export { cardEnvelope };
