// Generates src/core/spec.generated.ts from ../schema/study.schema.json.
// Run after any schema change: npm run gen:types
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { compile } from 'json-schema-to-typescript';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, '../../schema/study.schema.json');
const outPath = resolve(here, '../src/core/spec.generated.ts');

const schema = JSON.parse(await readFile(schemaPath, 'utf8'));

// json-schema-to-typescript doesn't resolve "$anchor" refs ("#event"), so
// rewrite them to JSON-pointer refs into the schedule's $defs first.
const scheduleDefs = '#/properties/schedules/items';
const anchorToPointer = {
  '#schedule': scheduleDefs,
  '#event': `${scheduleDefs}/$defs/event`,
  '#rrule': `${scheduleDefs}/$defs/rrule`,
  '#overrideEvent': `${scheduleDefs}/$defs/overrideEvent`,
  '#dateTime': `${scheduleDefs}/$defs/dateTime`,
  '#date': `${scheduleDefs}/$defs/date`,
  '#alarm': `${scheduleDefs}/$defs/alarm`,
};
const rewrite = (node) => {
  if (Array.isArray(node)) return node.map(rewrite);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') {
        if (!(v in anchorToPointer)) throw new Error(`Unmapped $ref ${v}; add it to anchorToPointer`);
        out[k] = anchorToPointer[v];
      } else if (k !== '$anchor') {
        out[k] = rewrite(v);
      }
    }
    return out;
  }
  return node;
};

const ts = await compile(rewrite(schema), 'StudySpec', {
  bannerComment:
    '/* eslint-disable */\n/** AUTO-GENERATED from schema/study.schema.json by scripts/gen-types.mjs. Do not edit by hand. */',
  additionalProperties: false,
  unreachableDefinitions: false,
  strictIndexSignatures: true,
});

await writeFile(outPath, ts);
console.log(`Wrote ${outPath}`);
