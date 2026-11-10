import { useMemo, useState } from 'react';
import schema from '../../../../schema/study.schema.json';
import { GLOSSARY, MACHINE_INTRO, STANDARD_INTRO, STANDARD_NOTE, STANDARD_SECTIONS, type StdItem } from '../../standard/human';
import { Icon, PageTitle } from '../ui';
import { download } from '../util';

const REPO_SCHEMA = 'https://github.com/ymirssbm/data-manual-app/blob/main/schema/study.schema.json';

type Json = Record<string, unknown>;

/** The data description standard: the human-facing checklist and the machine-facing JSON Schema. */
export function StandardPage() {
  const [tab, setTab] = useState<'human' | 'machine'>('human');
  return (
    <>
      <PageTitle>Data Description Standard</PageTitle>
      <div className="dm-segmented dm-segmented-inline dm-import-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'human'} className={tab === 'human' ? 'is-active' : ''} onClick={() => setTab('human')}>
          Human-facing standard
        </button>
        <button role="tab" aria-selected={tab === 'machine'} className={tab === 'machine' ? 'is-active' : ''} onClick={() => setTab('machine')}>
          Machine-facing standard (JSON Schema)
        </button>
      </div>
      {tab === 'human' ? <HumanStandard /> : <MachineStandard />}
    </>
  );
}

/** Everything a section lists, counting nested items but not the group headings. */
const countItems = (items: StdItem[]): number => items.reduce((n, it) => n + (it.children ? countItems(it.children) : 1), 0);

function HumanStandard() {
  const ids = [...STANDARD_SECTIONS.map((s) => s.id), 'glossary'];
  // Open sections, and open parts of a section (keyed "codebook/Title page"). The first section starts open.
  const [open, setOpen] = useState<Set<string>>(() => new Set([ids[0]!]));
  const toggle = (id: string, on: boolean) => setOpen((cur) => (cur.has(id) === on ? cur : on ? new Set([...cur, id]) : new Set([...cur].filter((x) => x !== id))));
  const allKeys = [...ids, ...STANDARD_SECTIONS.flatMap((s) => s.items.filter((it) => it.children).map((it) => `${s.id}/${it.text}`))];
  const jump = (id: string) => {
    toggle(id, true);
    requestAnimationFrame(() => document.getElementById(`std-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  return (
    <div className="dm-std">
      <section className="dm-home-section">
        <p className="dm-std-lead">{STANDARD_INTRO}</p>
        <div className="dm-std-bar">
          <nav className="dm-std-toc" aria-label="Sections">
            {STANDARD_SECTIONS.map((s) => (
              <a key={s.id} href={`#std-${s.id}`} onClick={(e) => (e.preventDefault(), jump(s.id))}>
                {s.title}
              </a>
            ))}
            <a href="#std-glossary" onClick={(e) => (e.preventDefault(), jump('glossary'))}>
              Glossary
            </a>
          </nav>
          <span className="dm-std-all">
            <button className="dm-link-btn" onClick={() => setOpen(new Set(allKeys))}>
              Expand all
            </button>
            <button className="dm-link-btn" onClick={() => setOpen(new Set())}>
              Collapse all
            </button>
          </span>
        </div>
      </section>
      {STANDARD_SECTIONS.map((s) => (
        <details key={s.id} id={`std-${s.id}`} className="dm-std-sec" open={open.has(s.id)} onToggle={(e) => toggle(s.id, e.currentTarget.open)}>
          <summary>
            <span className="dm-std-sec-title">{s.title}</span>
            <span className="dm-std-count">{countItems(s.items)} items</span>
          </summary>
          <div className="dm-std-body">
            {s.intro && <p className="dm-std-p">{s.intro}</p>}
            <StdItems items={s.items} section={s.id} open={open} toggle={toggle} />
            {s.id === 'codebook' && <p className="dm-std-note">{STANDARD_NOTE}</p>}
          </div>
        </details>
      ))}
      <details id="std-glossary" className="dm-std-sec" open={open.has('glossary')} onToggle={(e) => toggle('glossary', e.currentTarget.open)}>
        <summary>
          <span className="dm-std-sec-title">Glossary of terms used</span>
          <span className="dm-std-count">{GLOSSARY.length} terms</span>
        </summary>
        <dl className="dm-std-body dm-std-glossary">
          {GLOSSARY.map((g) => (
            <div key={g.term}>
              <dt>{g.term}</dt>
              <dd>
                <p>{g.text}</p>
                {g.points && (
                  <ul>
                    {g.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
                {g.note && <p className="dm-std-note">{g.note}</p>}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

/** A section's items: plain items as a compact checklist; items with parts as rows that fold open. */
function StdItems({ items, section, open, toggle }: { items: StdItem[]; section: string; open: Set<string>; toggle(id: string, on: boolean): void }) {
  const leaves = items.filter((it) => !it.children);
  const groups = items.filter((it) => it.children);
  return (
    <>
      {leaves.length > 0 && <Checklist items={leaves} />}
      {groups.length > 0 && (
        <div className="dm-std-parts">
          {groups.map((it) => {
            const key = `${section}/${it.text}`;
            return (
              <details key={key} className="dm-std-part" open={open.has(key)} onToggle={(e) => toggle(key, e.currentTarget.open)}>
                <summary>
                  <span>{it.text}</span>
                  <span className="dm-std-count">{countItems(it.children!)}</span>
                </summary>
                <div className="dm-std-part-body">
                  <StdTree items={it.children!} />
                </div>
              </details>
            );
          })}
        </div>
      )}
    </>
  );
}

function Checklist({ items }: { items: StdItem[] }) {
  return (
    <ul className="dm-std-checks">
      {items.map((it) => (
        <li key={it.text}>{it.text}</li>
      ))}
    </ul>
  );
}

/** Inside a part: sub-groups as small headings over their items, plain items as a checklist. */
function StdTree({ items }: { items: StdItem[] }) {
  const leaves = items.filter((it) => !it.children);
  const groups = items.filter((it) => it.children);
  return (
    <>
      {leaves.length > 0 && <Checklist items={leaves} />}
      {groups.map((g) => (
        <div key={g.text} className="dm-std-sub">
          <h4>{g.text}</h4>
          <StdTree items={g.children!} />
        </div>
      ))}
    </>
  );
}

function MachineStandard() {
  const [raw, setRaw] = useState(false);
  const [filter, setFilter] = useState('');
  const text = useMemo(() => JSON.stringify(schema, null, 2), []);
  const s = schema as Json;
  return (
    <div className="dm-std">
      <section className="dm-home-section">
        {MACHINE_INTRO.map((p) => (
          <p key={p.slice(0, 20)} className="dm-std-p">
            {p}
          </p>
        ))}
        <p className="dm-std-meta">
          <strong>{String(s.title)}</strong> · version {String(s.version)} · <code>{String(s.$id)}</code>
        </p>
        <div className="dm-std-actions">
          <button className="dm-btn dm-btn-primary dm-btn-sm" onClick={() => download('study.schema.json', text, 'application/json')}>
            <Icon name="download" /> Download schema
          </button>
          <a className="dm-btn dm-btn-secondary dm-btn-sm" href={REPO_SCHEMA} target="_blank" rel="noreferrer">
            View on GitHub
          </a>
          <div className="dm-segmented dm-segmented-inline" role="tablist">
            <button className={!raw ? 'is-active' : ''} onClick={() => setRaw(false)}>
              Explore
            </button>
            <button className={raw ? 'is-active' : ''} onClick={() => setRaw(true)}>
              Raw JSON
            </button>
          </div>
        </div>
      </section>
      <section className="dm-home-section">
        {raw ? (
          <pre className="dm-std-raw">{text}</pre>
        ) : (
          <>
            <input className="dm-input dm-std-filter" placeholder="Find a field (e.g. Question.ID, trigger, provenance)" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <SchemaTree root={s} filter={filter.trim().toLowerCase()} />
          </>
        )}
      </section>
    </div>
  );
}

/** Resolve "#/$defs/x" pointers and "#anchor" references within the schema. */
function resolveRef(root: Json, ref: string): Json | null {
  if (ref.startsWith('#/')) {
    let cur: unknown = root;
    for (const part of ref.slice(2).split('/')) cur = (cur as Json)?.[decodeURIComponent(part.replace(/~1/g, '/').replace(/~0/g, '~'))];
    return (cur as Json) ?? null;
  }
  if (ref.startsWith('#')) {
    const anchor = ref.slice(1);
    let found: Json | null = null;
    const walk = (x: unknown) => {
      if (found || !x || typeof x !== 'object') return;
      if ((x as Json).$anchor === anchor) found = x as Json;
      else Object.values(x as Json).forEach(walk);
    };
    walk(root);
    return found;
  }
  return null;
}

function typeLabel(n: Json): string {
  if (n.$ref) return `→ ${String(n.$ref).replace(/^#\/?(\$defs\/)?/, '')}`;
  const t = Array.isArray(n.type) ? n.type.join(' | ') : (n.type as string | undefined);
  if (t === 'array') {
    const it = n.items as Json | undefined;
    return it ? `array of ${it.$ref ? String(it.$ref).replace(/^#\/?(\$defs\/)?/, '') : (it.type as string) ?? 'items'}` : 'array';
  }
  if (t) return t;
  if (n.oneOf) return 'one of';
  if (n.anyOf) return 'any of';
  if (n.enum) return 'enum';
  if (n.const !== undefined) return 'const';
  return 'any';
}

/** Child fields of a node: its properties, its array items' properties, or a referenced definition's. */
function childrenOf(root: Json, n: Json, seen: Set<string>): Array<{ name: string; node: Json; required: boolean; via?: string }> {
  let target = n;
  if (n.$ref && !seen.has(String(n.$ref))) target = resolveRef(root, String(n.$ref)) ?? n;
  if (target.type === 'array' && target.items) {
    const it = target.items as Json;
    target = it.$ref ? resolveRef(root, String(it.$ref)) ?? it : it;
  }
  const out: Array<{ name: string; node: Json; required: boolean; via?: string }> = [];
  const req = new Set((target.required as string[] | undefined) ?? []);
  for (const [k, v] of Object.entries((target.properties as Json | undefined) ?? {})) out.push({ name: k, node: v as Json, required: req.has(k) });
  for (const [k, v] of Object.entries((target.patternProperties as Json | undefined) ?? {})) out.push({ name: `/${k}/`, node: v as Json, required: false, via: 'pattern' });
  for (const key of ['oneOf', 'anyOf'] as const) {
    ((target[key] as Json[] | undefined) ?? []).forEach((v, i) => out.push({ name: `${key === 'oneOf' ? 'Option' : 'Variant'} ${i + 1}${v.title ? `: ${v.title}` : ''}`, node: v, required: false, via: key }));
  }
  return out;
}

function matches(root: Json, name: string, n: Json, f: string, depth = 0): boolean {
  if (!f) return true;
  if (name.toLowerCase().includes(f) || String(n.description ?? '').toLowerCase().includes(f) || String(n.title ?? '').toLowerCase().includes(f)) return true;
  if (depth > 6) return false;
  return childrenOf(root, n, new Set()).some((c) => matches(root, c.name, c.node, f, depth + 1));
}

function SchemaTree({ root, filter }: { root: Json; filter: string }) {
  const top = childrenOf(root, root, new Set());
  const shown = top.filter((c) => matches(root, c.name, c.node, filter));
  if (!shown.length) return <p className="dm-hint">No field matches “{filter}”.</p>;
  return (
    <ul className="dm-schema">
      {shown.map((c) => (
        <SchemaNode key={c.name} root={root} name={c.name} node={c.node} required={c.required} filter={filter} seen={new Set()} depth={0} />
      ))}
    </ul>
  );
}

function SchemaNode({ root, name, node, required, filter, seen, depth }: { root: Json; name: string; node: Json; required: boolean; filter: string; seen: Set<string>; depth: number }) {
  const ref = node.$ref ? String(node.$ref) : null;
  const nextSeen = ref ? new Set([...seen, ref]) : seen;
  const looped = !!ref && seen.has(ref);
  const kids = looped || depth > 8 ? [] : childrenOf(root, node, seen).filter((c) => matches(root, c.name, c.node, filter));
  const resolved = ref ? resolveRef(root, ref) : null;
  const description = (node.description ?? resolved?.description) as string | undefined;
  const values = (node.enum ?? (node.items as Json | undefined)?.enum ?? resolved?.enum) as unknown[] | undefined;
  const head = (
    <span className="dm-schema-head">
      <code className="dm-schema-name">{name}</code>
      <span className="dm-schema-type">{typeLabel(node)}</span>
      {required && <span className="dm-schema-req">required</span>}
      {node.format ? <span className="dm-schema-type">{String(node.format)}</span> : null}
    </span>
  );
  const body = (
    <>
      {description && <p className="dm-schema-desc">{description}</p>}
      {values && values.length > 0 && (
        <p className="dm-schema-enum">
          Allowed:{' '}
          {values.map((v) => (
            <code key={String(v)}>{JSON.stringify(v)}</code>
          ))}
        </p>
      )}
      {looped && <p className="dm-hint">Same structure as above (recursive).</p>}
    </>
  );
  return (
    <li>
      {kids.length ? (
        <details open={!!filter} key={filter ? 'filtered' : 'all'}>
          <summary>{head}</summary>
          {body}
          <ul className="dm-schema">
            {kids.map((c) => (
              <SchemaNode key={c.name} root={root} name={c.name} node={c.node} required={c.required} filter={filter} seen={nextSeen} depth={depth + 1} />
            ))}
          </ul>
        </details>
      ) : (
        <div className="dm-schema-leaf">
          {head}
          {body}
        </div>
      )}
    </li>
  );
}
