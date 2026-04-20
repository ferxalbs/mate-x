export interface TokenEstimator {
  estimateTokens: (text: string) => number;
}

export class FallbackEstimator implements TokenEstimator {
  estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }
}

export function createTokenEstimator(_modelId?: string | null): TokenEstimator {
  return new FallbackEstimator();
}
