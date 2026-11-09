// Checks that JSON Schema can't express: IDs that must point at something
// else in the same spec (Parent, conditional item IDs, schedule survey names,
// blockMap entries), and uniqueness of IDs.
import type { Schedule, StudySpec } from './spec';
import type { SpecIssue } from './issues';

const err = (path: string, message: string): SpecIssue => ({ severity: 'error', source: 'reference', path, message });
const warn = (path: string, message: string): SpecIssue => ({ severity: 'warning', source: 'reference', path, message });

export function checkCrossReferences(spec: StudySpec): SpecIssue[] {
  const issues: SpecIssue[] = [];

  // Survey name -> Item.ID -> Item.Type
  const surveyItems = new Map<string, Map<string, string | null>>();

  spec.surveys.forEach((survey, si) => {
    const sPath = `/surveys/${si}`;
    const name = survey['Survey.Name'];
    if (surveyItems.has(name)) {
      issues.push(err(`${sPath}/Survey.Name`, `Duplicate Survey.Name "${name}".`));
    }

    const items = new Map<string, string | null>();
    const questionIds = new Set<string>();
    const questions = survey.questions ?? [];

    questions.forEach((q, qi) => {
      const qPath = `${sPath}/questions/${qi}`;
      if (items.has(q['Item.ID'])) {
        issues.push(err(`${qPath}/Item.ID`, `Duplicate Item.ID "${q['Item.ID']}" in survey "${name}".`));
      }
      items.set(q['Item.ID'], q['Item.Type']);

      if (q['Item.Type'] === 'Question') {
        if (questionIds.has(q['Question.ID'])) {
          issues.push(err(`${qPath}/Question.ID`, `Duplicate Question.ID "${q['Question.ID']}" in survey "${name}".`));
        }
        questionIds.add(q['Question.ID']);
      }
    });
    surveyItems.set(name, items);

    // Second pass: references can point forward, so resolve after collecting IDs.
    questions.forEach((q, qi) => {
      const qPath = `${sPath}/questions/${qi}`;
      const parent = q.Parent;
      if (parent != null && parent !== '') {
        if (!items.has(parent)) {
          issues.push(err(`${qPath}/Parent`, `Parent "${parent}" is not an Item.ID in survey "${name}".`));
        } else if (items.get(parent) !== 'Block') {
          issues.push(warn(`${qPath}/Parent`, `Parent "${parent}" is not a Block.`));
        }
        if (parent === q['Item.ID']) {
          issues.push(err(`${qPath}/Parent`, `Item "${parent}" is its own parent.`));
        }
      }

      const cond = q['Conditional.Info'];
      if (!cond) return;
      const refs: Array<[string, string | null | undefined]> = [
        ['Conditional.Info/Conditional.Master.Item.ID', cond['Conditional.Master.Item.ID']],
        ['Conditional.Info/Conditional.Fail.Item.ID', cond['Conditional.Fail.Item.ID']],
      ];
      (cond['Conditional.Child.Mappings'] ?? []).forEach((m, mi) => {
        refs.push([`Conditional.Info/Conditional.Child.Mappings/${mi}/Conditional.Child.Item.ID`, m['Conditional.Child.Item.ID']]);
      });
      for (const [rel, id] of refs) {
        if (id != null && id !== '' && !items.has(id)) {
          issues.push(err(`${qPath}/${rel}`, `"${id}" is not an Item.ID in survey "${name}".`));
        }
      }
    });
  });

  // Schedules: Survey.Name on events must name a real survey. Schedules nest
  // through both schedule.children and event.extensions.children.
  const visitSchedule = (schedule: Schedule, path: string) => {
    schedule.events.forEach((ev, ei) => {
      const ePath = `${path}/events/${ei}`;
      const surveyName = ev.extensions?.['Survey.Name'];
      if (surveyName != null && !surveyItems.has(surveyName)) {
        issues.push(err(`${ePath}/extensions/Survey.Name`, `Schedule event refers to unknown survey "${surveyName}".`));
      }
      ev.extensions?.children?.forEach((child, ci) => visitSchedule(child, `${ePath}/extensions/children/${ci}`));
    });
    schedule.children?.forEach((child, ci) => visitSchedule(child, `${path}/children/${ci}`));
  };
  spec.schedules.forEach((s, i) => visitSchedule(s, `/schedules/${i}`));

  // blockMap must agree with the surveys it describes.
  spec.blockMap.forEach((entry, bi) => {
    const bPath = `/blockMap/${bi}`;
    const items = surveyItems.get(entry['Survey.Name']);
    if (!items) {
      issues.push(err(`${bPath}/Survey.Name`, `blockMap refers to unknown survey "${entry['Survey.Name']}".`));
      return;
    }
    if (!items.has(entry['Item.ID'])) {
      issues.push(err(`${bPath}/Item.ID`, `blockMap Item.ID "${entry['Item.ID']}" is not in survey "${entry['Survey.Name']}".`));
    }
    if (entry.Parent != null && entry.Parent !== '' && !items.has(entry.Parent)) {
      issues.push(err(`${bPath}/Parent`, `blockMap Parent "${entry.Parent}" is not in survey "${entry['Survey.Name']}".`));
    }
  });

  return issues;
}
