import { generateProofCapsule } from './analyze';
import type { ProofCapsule } from './types';

export const demoProofCapsule: ProofCapsule = generateProofCapsule(
  {
    sourceType: 'demo',
    repo: { owner: 'acme', name: 'checkout-api' },
    prNumber: 284,
    prTitle: 'Agent updates checkout workflow and dependencies',
    headSha: '5e18a7b1f0d2c4a9b6e3d2c1a0f9e8d7c6b5a4f3',
    baseSha: '2a79b6e1d0c3f4a5b6c7d8e9f0123456789abcd',
    changedFiles: [
      { path: '.github/workflows/release.yml', additions: 34, deletions: 8, status: 'modified' },
      { path: 'package.json', additions: 6, deletions: 2, status: 'modified' },
      { path: 'bun.lock', additions: 210, deletions: 180, status: 'modified' },
      { path: 'src/billing/checkout.ts', additions: 78, deletions: 12, status: 'modified' },
      {
        path: 'src/config/payment.ts',
        additions: 12,
        deletions: 1,
        status: 'modified',
        patch: '+ export const STRIPE_SECRET = "FAKE_sk_live_51abcdefghijklmnopqrstuvwxyz";',
      },
    ],
    transcript: 'Agent: tests passed and release workflow looks good.',
    ciOutput: '',
  },
  new Date('2026-06-21T12:00:00.000Z'),
);
