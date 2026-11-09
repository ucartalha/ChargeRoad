import type { SourceReference } from '@chargeroad/shared' with { 'resolution-mode': 'import' };

// Adapters normalize their raw responses before crossing this boundary.
export type ProviderResponse<T> = { data: T; source: SourceReference };
