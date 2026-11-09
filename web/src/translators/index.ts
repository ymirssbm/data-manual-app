// Translator registry. To add a new source (e.g. another survey platform):
// write a Translator in its own file and add it to this list. Order matters for
// auto-detection: more specific formats first, the native spec last.
import { legacyTranslator } from './legacy';
import { nativeTranslator } from './native';
import { qualtricsTranslator } from './qualtrics';
import { redcapTranslator } from './redcap';
import { wearitTranslator } from './wearit';
import type { Translator, TranslatorInput } from './types';

export const TRANSLATORS: Translator[] = [wearitTranslator, qualtricsTranslator, redcapTranslator, legacyTranslator, nativeTranslator];

export function detectTranslator(input: TranslatorInput): Translator | null {
  return TRANSLATORS.find((t) => t.detect(input)) ?? null;
}

export * from './types';
export { nativeTranslator, legacyTranslator, qualtricsTranslator, redcapTranslator, wearitTranslator };
