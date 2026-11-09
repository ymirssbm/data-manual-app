// Wear-IT "Question Type" integer codes -> display name, result type.
// Source: the platform's question type table (32 codes).
// `spec` is the closest display type the study spec supports; `approx` marks
// codes that don't have an exact equivalent, so the translator can say so.

export interface WearitType {
  name: string;
  resultType: 'integer' | 'numeric' | 'character' | null;
  spec: string;
  approx?: boolean;
}

export const WEARIT_TYPES: Record<number, WearitType> = {
  0: { name: 'Multiple Choice', resultType: 'integer', spec: 'Multiple Choice' },
  1: { name: 'Time Picker', resultType: 'integer', spec: 'Time Picker' },
  2: { name: 'Time Scale Slider', resultType: 'integer', spec: 'Time Scale Slider' },
  3: { name: 'Slider', resultType: 'numeric', spec: 'Slider' },
  4: { name: 'Core Affect Grid', resultType: 'integer', spec: 'Multiple Slider', approx: true },
  5: { name: 'Multimedia Response', resultType: 'character', spec: 'Free Response', approx: true },
  6: { name: 'Informational Fullscreen', resultType: null, spec: 'Informational Fullscreen' },
  7: { name: 'Multiple Select', resultType: 'integer', spec: 'Multiple Select' },
  8: { name: 'Discrete Slider', resultType: 'integer', spec: 'Slider', approx: true },
  9: { name: 'One Question Survey', resultType: null, spec: 'Informational Fullscreen', approx: true },
  10: { name: 'Draw Graph', resultType: 'character', spec: 'Free Response', approx: true },
  11: { name: 'Free Response', resultType: 'character', spec: 'Free Response' },
  12: { name: 'Time Picker With Response', resultType: 'integer', spec: 'Time Picker', approx: true },
  13: { name: 'Continuous Location', resultType: 'character', spec: 'Free Response', approx: true },
  14: { name: 'Multiple Reducing Slider', resultType: null, spec: 'Multiple Slider', approx: true },
  15: { name: 'Multiple Time Scale Slider', resultType: null, spec: 'Multiple Slider', approx: true },
  16: { name: 'Multiple Unit Scale Slider', resultType: null, spec: 'Multiple Slider', approx: true },
  17: { name: 'Multiple Slider', resultType: null, spec: 'Multiple Slider' },
  18: { name: 'Multiple Discrete Slider', resultType: null, spec: 'Multiple Slider', approx: true },
  19: { name: 'Time Picker Spinner', resultType: 'integer', spec: 'Time Picker', approx: true },
  20: { name: 'End Survey', resultType: null, spec: 'Informational Fullscreen', approx: true },
  21: { name: 'End Block', resultType: null, spec: 'End Block' },
  22: { name: 'Time Picker With Checkboxes', resultType: 'integer', spec: 'Time Picker', approx: true },
  23: { name: 'Multimedia Image', resultType: 'character', spec: 'Free Response', approx: true },
  24: { name: 'Webview', resultType: 'character', spec: 'Informational Fullscreen', approx: true },
  25: { name: 'Numeric', resultType: 'numeric', spec: 'Free Response', approx: true },
  26: { name: 'Image Select Response', resultType: 'integer', spec: 'Multiple Choice', approx: true },
  27: { name: 'Cognitive Test', resultType: 'character', spec: 'Free Response', approx: true },
  28: { name: 'Multiple Short Free Response', resultType: 'character', spec: 'Free Response', approx: true },
  29: { name: 'Multimedia Video', resultType: 'character', spec: 'Free Response', approx: true },
  30: { name: 'Numeric Picker', resultType: 'numeric', spec: 'Free Response', approx: true },
  31: { name: 'Cognitive Test - Webview', resultType: 'character', spec: 'Free Response', approx: true },
  32: { name: 'Forced Choice', resultType: 'integer', spec: 'Multiple Choice', approx: true },
};
// Code 2 is shared with "Reducing Slider" and "Unit Scale Slider" on the platform.
