// The human-facing data description standard: what a data manual for a complex study should
// contain. Rendered on the Data Description Standard page; the machine-facing half is
// schema/study.schema.json.

export interface StdItem {
  text: string;
  children?: StdItem[];
}
export interface StdSection {
  id: string;
  title: string;
  intro?: string;
  items: StdItem[];
}

const t = (text: string, ...children: Array<StdItem | string>): StdItem => ({
  text,
  children: children.length ? children.map((c) => (typeof c === 'string' ? { text: c } : c)) : undefined,
});

export const STANDARD_INTRO =
  'For a given study, a researcher should provide the associated data files and an accompanying data manual containing each data dictionary, codebook and survey flowchart, plus a survey scheduling figure. Each should include the following.';

export const STANDARD_NOTE =
  'Not every element in the variable page applies to every question type. For example, there may be no relevant measurement citation for a given item.';

export const STANDARD_SECTIONS: StdSection[] = [
  {
    id: 'manual',
    title: 'Contents of a data manual',
    items: [t('Each codebook'), t('Each data dictionary'), t('Each survey flowchart'), t('Study scheduler')],
  },
  {
    id: 'dictionary',
    title: 'Data dictionary',
    items: [
      t('Survey name'),
      t('Item ID'),
      t('Question ID'),
      t('Question text'),
      t('Question type display name'),
      t('Result type'),
      t('Missingness codes'),
      t('Response range'),
      t('Response text'),
    ],
  },
  {
    id: 'codebook',
    title: 'Codebook',
    items: [
      t('Title page', 'Name of study', 'Authors', 'Any desired graphics', 'Funding sources'),
      t(
        'Abstract page',
        'Brief description of study',
        'Study aims',
        'History and date of data collection',
        'Location of data collection',
        'People involved and their roles',
        'Who, what, where, when, and what was done',
        'Sampling methods: method, target population, sampling frame',
        'Recruitment: setting, methods, start and end dates',
        'Eligibility: inclusion and exclusion criteria',
        'Selection process',
        'Study protocols: IRB, GitHub and preregistration links',
      ),
      t('Participant flow page', 'CONSORT-style flow diagram generated from ordered stages, Ns and exclusion reasons'),
      t('Executive summary', 'A results page summarizing the main findings of the study', 'Published papers that use this dataset'),
      t(
        'Data provenance page',
        'Data version',
        'Ordered processing steps from raw collection to release data: activity, description, inputs, outputs, agent, date, script link',
      ),
      t(
        'Data access and restrictions page',
        'How to access the data: access level, repository, URL, DUA requirement, contact, instructions',
        'Legal and regulatory restrictions: HIPAA, FERPA, 42 CFR Part 2, etc., and Certificate of Confidentiality',
        'Data usage and exhaustion: access grants, publication count, privacy budget, generalizability notes',
        'Linkages to other datasets',
      ),
      t('Table of contents'),
      t(
        'Variable page for each question',
        t(
          'Text and name elements',
          t('Variable name', 'As it appears in the dataset', 'Human-readable name'),
          t('If it is a survey question', 'Exactly as it is presented to the participant'),
          t('If observational, or obtained from passive technology', 'Description of the variable in layman’s terms', 'If layman’s terms are not possible, a citation of a longer explanation of terms'),
        ),
        t(
          'Paradata and metadata elements',
          'Privacy status (e.g. is this identifying information?)',
          'Modeling characteristics (e.g. reaction time data should be log transformed)',
          'Transformations applied to the raw data',
          t('Skip logic', 'For whom and when this data is collected', 'Trigger / just-in-time delivery logic', 'Adaptive design logic'),
          t('How the data was obtained', 'Sensing, survey, observation, circling something on a page, digital slider, etc.'),
          t('Type of data', 'Numeric, categorical, continuous, etc.'),
          t('Possible values of the data, including item codes (1 = strongly disagree)', 'e.g. ranges from 0–10, or 1–5 from strongly disagree to strongly agree'),
          'Screenshot of question',
          'Measurement citation',
          t('Distance between measurements', 'e.g. 1 day, 1 hour (if complex, describe it in the skip logic)'),
        ),
        t(
          'Statistical elements',
          t('Descriptives of the variable', 'Min, max, mean, standard deviation, number of valid observations'),
          t(
            'Missingness',
            'Frequency of missingness',
            t('Structure of missingness', 'MAR, MNAR, MCAR'),
            t('For repeated assessment data', 'ICC, min, max, means, standard deviation, and planned and unplanned missingness range'),
            t('Types of missingness', 'Refused, don’t know, not applicable, not ascertained'),
            t('Codes for types of missingness in the data', '99999, -1, -5, -7, NA, etc.'),
          ),
          t('For questions using uneven assessment intervals', 'Min, max, mean and standard deviation of the distance between measurements'),
        ),
      ),
    ],
  },
  {
    id: 'flowchart',
    title: 'Survey flowchart',
    items: [
      t('Order in which questions are delivered in a survey'),
      t('Skip logic', 'For whom and when this data is collected', 'Trigger / just-in-time delivery logic', 'Adaptive design logic'),
    ],
  },
  {
    id: 'schedule',
    title: 'Study scheduler',
    items: [t('Description of how often and when surveys are delivered'), t('Pings, reminders and snooze for each survey')],
  },
];

export const GLOSSARY: Array<{ term: string; text: string; points?: string[]; note?: string }> = [
  {
    term: 'Item ID',
    text: 'Identifies a reusable unit of content, independent of where or how often it is used. It is agnostic to content type and could be:',
    points: [
      'A question construct (e.g. “How much are you craving right now?”)',
      'An informational display screen (e.g. “Remember to charge your phone tonight”)',
      'An instructional or consent block',
      'Anything else that might be reused across surveys',
    ],
    note: 'The defining property: if the same content appears in multiple surveys, it has the same Item ID.',
  },
  { term: 'Question ID', text: 'Identifies a specific instance of an Item ID within a particular survey.' },
];

export const MACHINE_INTRO = [
  'Alongside the human-facing standard, the study specification is a JSON Schema: a structured, machine-readable version of the same standard. Everything this app imports becomes a study spec that follows it, and every output is generated from that spec.',
  'JSON is a common data format that is far easier to read than alternatives such as XML. JSON Schema is a declarative language for defining the structure and constraints of JSON data, so the standard has clear, enforced rules and built-in documentation. Validators can then check whether a dataset complies with the schema, which makes it easier to exchange data between APIs and storage systems. See json-schema.org for an in-depth explanation.',
];
