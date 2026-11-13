// A drawn stand-in for a question's app screen: a phone with the question text and its answer
// control (choices, slider, text box, time picker), built from the question definition alone.
// Used in codebooks when no real screenshot was uploaded; always labelled as a drawing.
import { responseOptions, stripHtml, itemLabel, type Question } from '../core';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Greedy word wrap to about `max` characters a line. */
function wrap(text: string, max: number, lines = 6): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if ((cur + ' ' + word).trim().length > max && cur) {
      out.push(cur);
      cur = word;
    } else cur = (cur + ' ' + word).trim();
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    const kept = out.slice(0, lines);
    kept[lines - 1] = `${kept[lines - 1]!.replace(/\s*\S*$/, '')}…`;
    return kept;
  }
  return out;
}

const W = 300;
const H = 560;
const PAD = 26;
const INK = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const ACCENT = '#2563eb';

export function mockScreenSvg(q: Question, surveyLabel: string): string {
  const type = q['Question.Type.Display.Name'];
  const text = stripHtml(q['Question.Text'] ?? '') || itemLabel(q);
  const parts: string[] = [];
  let y = 92;
  const lines = wrap(text, 30, type === 'Informational Fullscreen' ? 12 : 5);
  parts.push(`<text x="${PAD}" y="${y}" font-size="17" font-weight="700" fill="${INK}">${lines.map((l, i) => `<tspan x="${PAD}" dy="${i ? 22 : 0}">${esc(l)}</tspan>`).join('')}</text>`);
  y += lines.length * 22 + 18;

  const opts = responseOptions(q);
  const numeric = opts.length > 0 && opts.every((o) => Number.isFinite(Number(o.value)));
  const span = (min: string, max: string) => {
    parts.push(
      `<rect x="${PAD}" y="${y + 10}" width="${W - PAD * 2}" height="6" rx="3" fill="${LINE}"/>`,
      `<rect x="${PAD}" y="${y + 10}" width="${(W - PAD * 2) * 0.55}" height="6" rx="3" fill="${ACCENT}"/>`,
      `<circle cx="${PAD + (W - PAD * 2) * 0.55}" cy="${y + 13}" r="11" fill="#fff" stroke="${ACCENT}" stroke-width="3"/>`,
      `<text x="${PAD}" y="${y + 44}" font-size="12" fill="${MUTED}">${esc(min)}</text>`,
      `<text x="${W - PAD}" y="${y + 44}" font-size="12" fill="${MUTED}" text-anchor="end">${esc(max)}</text>`,
    );
    y += 64;
  };
  if (type === 'Multiple Choice' || type === 'Multiple Select') {
    const multi = type === 'Multiple Select';
    const shown = opts.slice(0, 7);
    shown.forEach((o, i) => {
      const cy = y + i * 44;
      parts.push(
        `<rect x="${PAD}" y="${cy}" width="${W - PAD * 2}" height="36" rx="9" fill="#fff" stroke="${LINE}"/>`,
        multi
          ? `<rect x="${PAD + 12}" y="${cy + 10}" width="16" height="16" rx="4" fill="#fff" stroke="${MUTED}" stroke-width="1.5"/>`
          : `<circle cx="${PAD + 20}" cy="${cy + 18}" r="8" fill="#fff" stroke="${MUTED}" stroke-width="1.5"/>`,
        `<text x="${PAD + 38}" y="${cy + 23}" font-size="14" fill="${INK}">${esc(wrap(o.label, 26, 1)[0] ?? '')}</text>`,
      );
    });
    y += shown.length * 44;
    if (opts.length > shown.length) {
      parts.push(`<text x="${W / 2}" y="${y + 6}" font-size="12" fill="${MUTED}" text-anchor="middle">+ ${opts.length - shown.length} more</text>`);
      y += 18;
    }
  } else if (type === 'Slider' || type === 'Time Scale Slider') {
    const first = opts[0];
    const last = opts[opts.length - 1];
    if (type === 'Time Scale Slider') span(first?.label ?? '12 AM', last?.label ?? '11 PM');
    else span(first ? (numeric && first.label === first.value ? first.value : first.label) : '0', last ? (numeric && last.label === last.value ? last.value : last.label) : '100');
  } else if (type === 'Multiple Slider') {
    const rows = opts.length ? opts.slice(0, 4) : [{ value: '', label: '' }];
    for (const o of rows) {
      if (o.label) {
        parts.push(`<text x="${PAD}" y="${y + 2}" font-size="13" fill="${INK}">${esc(wrap(o.label, 34, 1)[0] ?? '')}</text>`);
        y += 8;
      }
      span('', '');
      y -= 18;
    }
  } else if (type === 'Time Picker') {
    parts.push(
      `<rect x="${PAD + 40}" y="${y}" width="${W - PAD * 2 - 80}" height="110" rx="12" fill="#f3f4f6"/>`,
      `<rect x="${PAD + 40}" y="${y + 38}" width="${W - PAD * 2 - 80}" height="34" fill="#e5e7eb"/>`,
      `<text x="${W / 2}" y="${y + 26}" font-size="15" fill="${MUTED}" text-anchor="middle">7 : 45 AM</text>`,
      `<text x="${W / 2}" y="${y + 61}" font-size="19" font-weight="700" fill="${INK}" text-anchor="middle">8 : 00 AM</text>`,
      `<text x="${W / 2}" y="${y + 96}" font-size="15" fill="${MUTED}" text-anchor="middle">8 : 15 AM</text>`,
    );
    y += 126;
  } else if (type === 'Free Response') {
    parts.push(
      `<rect x="${PAD}" y="${y}" width="${W - PAD * 2}" height="${q['Data.Type'] === 'numeric' || q['Data.Type'] === 'integer' ? 44 : 110}" rx="9" fill="#fff" stroke="${LINE}"/>`,
      `<text x="${PAD + 12}" y="${y + 27}" font-size="13" fill="#9ca3af">${q['Data.Type'] === 'numeric' || q['Data.Type'] === 'integer' ? 'Enter a number' : 'Type your answer'}</text>`,
    );
  }

  return `<svg class="cb-mock" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Drawing of the ${esc(type ?? 'question')} screen for ${esc(q['Item.ID'])}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="34" fill="#f9fafb" stroke="#111827" stroke-width="2"/>
<rect x="${W / 2 - 40}" y="12" width="80" height="16" rx="8" fill="#111827"/>
<text x="${PAD}" y="58" font-size="12" font-weight="600" fill="${MUTED}" letter-spacing=".04em">${esc(surveyLabel.toUpperCase())}</text>
<line x1="${PAD}" x2="${W - PAD}" y1="68" y2="68" stroke="${LINE}"/>
${parts.join('\n')}
<rect x="${PAD}" y="${H - 74}" width="${W - PAD * 2}" height="44" rx="12" fill="${ACCENT}"/>
<text x="${W / 2}" y="${H - 46}" font-size="15" font-weight="700" fill="#fff" text-anchor="middle">Next</text>
</svg>`;
}
