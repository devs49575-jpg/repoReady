import { isPrivateId, type Visibility } from '@repoready/shared';
import type { AnalysisStore, PublicAnalysisStore } from './types';

export * from './types';

export interface AnalysisStores {
  public: PublicAnalysisStore;
  /** In-memory store for private reports (Addendum 01, Phase P). */
  private?: AnalysisStore;
}

/** `p_` ids live in the private (memory) store; everything else in the public (Mongo) store. */
export function storeFor(stores: AnalysisStores, id: string): AnalysisStore | null {
  return isPrivateId(id) ? (stores.private ?? null) : stores.public;
}

export function storeForMode(stores: AnalysisStores, mode: Visibility): AnalysisStore | null {
  return mode === 'private' ? (stores.private ?? null) : stores.public;
}
