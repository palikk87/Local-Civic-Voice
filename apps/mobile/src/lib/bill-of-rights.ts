// Re-export shim. The implementation lives in packages/civic-core, shared with
// apps/web — see that package's README for why, and for what qualifies.
//
// This file stays so the existing `@/lib/bill-of-rights` imports keep working. It can be
// deleted once those import sites point at '@civic/core/bill-of-rights' directly.
export * from '@civic/core/bill-of-rights';
