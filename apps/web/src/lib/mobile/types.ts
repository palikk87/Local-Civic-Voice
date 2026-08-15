// Re-export shim. The implementation lives in packages/civic-core, shared with
// apps/mobile — see that package's README for why, and for what qualifies.
//
// This file stays so the existing `@/lib/mobile/types` imports keep working. It
// can be deleted once those import sites point at '@civic/core/types' directly.
export * from '@civic/core/types';
