// Public API of the core layer. Pure TypeScript: no React, no DOM.
export * from './spec';
export * from './issues';
export { validateSpec, parseSpec, SPEC_VERSION } from './validate';
export type { ValidationResult } from './validate';
export { checkCrossReferences } from './crossRefs';
export * from './model';
export * from './csv';
export * from './time';
export * from './dataset';
export * from './statfiles';
