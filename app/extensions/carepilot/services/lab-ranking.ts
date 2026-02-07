export type InNetworkPreference = "prefer_in_network" | "no_preference";
export type NetworkMatchHint = "in_network_likely" | "out_of_network_likely" | "unknown";

export type LabCandidate = {
  name: string;
  distance_miles: number;
  price_estimate: number;
  price_range: string;
  next_slot: string;
  rating: number;
  network_match_hint: NetworkMatchHint;
};

export type RankedLabOption = {
  name: string;
  distance: number;
  price_range: string;
  next_slot: string;
  rating: number;
  rank_score: number;
  rank_reason: string;
  network_match_hint: NetworkMatchHint;
};

type RankInputs = {
  candidates: LabCandidate[];
  maxDistanceMiles: number;
  budgetCap: number;
  inNetworkPreference: InNetworkPreference;
  now?: Date;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function safePositive(value: number, fallback: number): number {
  if (Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

function waitNorm(nextSlotIso: string, now: Date): number {
  const slotTime = Date.parse(nextSlotIso);
  if (!Number.isFinite(slotTime)) {
    return 1;
  }

  const waitHours = Math.max(0, (slotTime - now.getTime()) / (60 * 60 * 1000));
  return clamp01(waitHours / 168); // 1 week normalization window
}

function networkPenalty(hint: NetworkMatchHint, preference: InNetworkPreference): number {
  if (preference === "no_preference") {
    return 0;
  }
  if (hint === "in_network_likely") {
    return 0;
  }
  if (hint === "unknown") {
    return 0.5;
  }
  return 1;
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function rankLabOptions(input: RankInputs): RankedLabOption[] {
  const now = input.now ?? new Date();
  const maxDistance = safePositive(input.maxDistanceMiles, 1);
  const maxPriceObserved = Math.max(
    input.budgetCap,
    ...input.candidates.map((candidate) => safePositive(candidate.price_estimate, input.budgetCap)),
  );
  const budgetCap = safePositive(input.budgetCap, maxPriceObserved);

  const ranked = input.candidates.map((candidate) => {
    const distanceNorm = clamp01(candidate.distance_miles / maxDistance);
    const priceNorm = clamp01(candidate.price_estimate / safePositive(Math.max(budgetCap, maxPriceObserved), 1));
    const nextSlotWaitNorm = waitNorm(candidate.next_slot, now);
    const ratingNorm = clamp01(candidate.rating / 5);
    const penalty = networkPenalty(candidate.network_match_hint, input.inNetworkPreference);

    // Contract-locked formula from technical design.
    const score =
      0.35 * distanceNorm +
      0.25 * priceNorm +
      0.25 * nextSlotWaitNorm +
      0.1 * (1 - ratingNorm) +
      0.05 * penalty;

    return {
      name: candidate.name,
      distance: Math.round(candidate.distance_miles * 100) / 100,
      price_range: candidate.price_range,
      next_slot: candidate.next_slot,
      rating: Math.round(candidate.rating * 10) / 10,
      rank_score: roundScore(score),
      rank_reason:
        `distance=${roundScore(distanceNorm)}, ` +
        `price=${roundScore(priceNorm)}, ` +
        `wait=${roundScore(nextSlotWaitNorm)}, ` +
        `rating_penalty=${roundScore(1 - ratingNorm)}, ` +
        `network_penalty=${roundScore(penalty)}`,
      network_match_hint: candidate.network_match_hint,
    } satisfies RankedLabOption;
  });

  return ranked.sort((left, right) => left.rank_score - right.rank_score);
}
