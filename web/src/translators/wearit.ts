import { wearitPagesToSpec } from '../connectors/wearit/convert';
import { isObject, parseJson, tryParseJson, TranslationError, type Translator } from './types';

const hasBlockMap = (d: unknown) =>
  (Array.isArray(d) ? d : [d]).some((p) => isObject(p) && Object.keys(p).some((k) => k.toLowerCase().replace(/[^a-z]/g, '') === 'blockidsmap'));

/** A saved Wear-IT getData response (one page, or an array of pages). Live pulls use the same converter. */
export const wearitTranslator: Translator = {
  id: 'wearit',
  label: 'Wear-IT data export (JSON)',
  howToGet: 'Use Data Pull with your study ID and API token, or upload a saved getData JSON response.',
  accept: '.json,application/json',
  detect: ({ text }) => hasBlockMap(tryParseJson(text)),
  translate: (input) => {
    try {
      return wearitPagesToSpec(parseJson(input));
    } catch (e) {
      throw new TranslationError((e as Error).message);
    }
  },
};
