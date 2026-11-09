// Friendly names for the generated spec types. Import spec types from here,
// not from spec.generated.ts, so a schema regeneration that renames things
// only needs fixing in one place.
import type { StudySpecification, Event, Rrule } from './spec.generated';

export type StudySpec = StudySpecification;
export type StudyMetadata = StudySpec['Study.Metadata'];
export type Survey = StudySpec['surveys'][number];
export type Question = NonNullable<Survey['questions']>[number];
export type QuestionType = Question['Question.Type.Display.Name'];
export type Schedule = StudySpec['schedules'][number];
export type ScheduleEvent = Event;
export type Recurrence = Rrule;
export type BlockMapEntry = StudySpec['blockMap'][number];
