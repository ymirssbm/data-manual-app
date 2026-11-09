import type { StudySpec } from '../core';

/**
 * How the app talks to whatever is hosting it (a plain browser page, R/Shiny, ...).
 * Components only ever use this interface, never Shiny or window globals directly.
 */
export interface HostAdapter {
  readonly kind: 'standalone' | 'widget';
  /** A spec the host wants loaded at startup, if any. */
  initialSpec: unknown | null;
  /** Called whenever the user's spec changes (loaded, edited). */
  onSpecChange(spec: StudySpec | null): void;
}
