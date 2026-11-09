import type { HostAdapter } from './types';

export function createStandaloneAdapter(): HostAdapter {
  return {
    kind: 'standalone',
    initialSpec: null,
    onSpecChange() {
      // Nothing to sync with in a plain browser page (yet).
    },
  };
}
