import { isObject, parseJson, tryParseJson, type Translator } from './types';

/** A file already in this app's study spec format. */
export const nativeTranslator: Translator = {
  id: 'native',
  label: 'Study spec (JSON)',
  howToGet: 'A .json file in this app\'s study spec format, e.g. one you saved from here earlier.',
  accept: '.json,application/json',
  detect: ({ text }) => {
    const d = tryParseJson(text);
    return isObject(d) && isObject(d['Study.Metadata']);
  },
  translate: (input) => ({ spec: parseJson(input), notes: [] }),
};
