// A translator turns a source file (another platform's export) into a study spec.
// Contract: translate() returns spec-shaped JSON; the app then validates it with
// the same validator as hand-written specs. Translators never generate output
// (codebooks etc.); that's the generators' job, and they only read the spec.

export interface TranslatorInput {
  fileName: string;
  text: string;
}

export interface TranslationResult {
  spec: unknown;
  /** Things the user should know: what was skipped, approximated, or assumed. */
  notes: string[];
}

export interface Translator {
  id: string;
  /** Short name shown in the UI, e.g. "REDCap data dictionary". */
  label: string;
  /** One line: what file to provide and where to get it. */
  howToGet: string;
  /** <input accept> value. */
  accept: string;
  /** Cheap sniff of whether this translator handles the input. */
  detect(input: TranslatorInput): boolean;
  translate(input: TranslatorInput): TranslationResult;
}

export class TranslationError extends Error {}

export function parseJson(input: TranslatorInput): unknown {
  try {
    return JSON.parse(input.text.replace(/^﻿/, ''));
  } catch (e) {
    throw new TranslationError(`${input.fileName} is not valid JSON: ${(e as Error).message}`);
  }
}

export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return undefined;
  }
}

export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
