// Re-export shim. The implementation lives in packages/civic-core, shared with
// apps/web — see that package's README for why, and for what qualifies.
//
// This file stays so the existing `@/lib/feed-algorithm` imports keep working. It can be
// deleted once those import sites point at '@civic/core/feed-algorithm' directly.
export * from '@civic/core/feed-algorithm';
