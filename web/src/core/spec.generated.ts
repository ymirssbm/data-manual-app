/* eslint-disable */
/** AUTO-GENERATED from schema/study.schema.json by scripts/gen-types.mjs. Do not edit by hand. */

/**
 * Contains all the information needed to specify a question or variable in a survey, observation, or passive data collection context.
 *
 * @minItems 0
 */
export type QuestionSpecification = {
  /**
   * Name of the variable as it appears in the dataset. Identifies a question within a single survey — unique per survey (e.g. a morning survey and an evening survey use different Question.IDs even for the 'same' item), but shared across repeated deliveries of that same survey (e.g. the same morning survey repeated over 10 days keeps the same Question.ID each day).
   */
  "Question.ID": string;
  /**
   * Human readable name for the variable
   */
  "Question.Long.Name"?: string;
  /**
   * Exact text of the question as presented to the participant. Only applicable for survey questions.
   */
  "Question.Text"?: string;
  /**
   * Description of the variable in layman's terms. If layman's terms are not possible, provide a citation to a longer explanation.
   */
  "Question.Description"?: string;
  /**
   * How the data was obtained. Must match one of the supported question display types.
   */
  "Question.Type.Display.Name":
    | "Free Response"
    | "Informational Fullscreen"
    | "Multiple Choice"
    | "Multiple Select"
    | "Multiple Slider"
    | "Slider"
    | "Time Picker"
    | "Time Scale Slider"
    | "Block"
    | "End Block";
  /**
   * List of response value-definition pairs.
   *
   * @minItems 0
   */
  responseKey?: {
    /**
     * Coded response value.
     */
    value: string;
    /**
     * Human-readable label for the response value.
     */
    definition: string;
  }[];
  /**
   * Block or question.
   */
  "Item.Type": "Block" | "Question" | null;
  /**
   * Item ID of the parent item. NOTE: This is different than the conditional master which points to the item which if successful, delivers the current. Parent may point to a block many questions up.
   */
  Parent: string | null;
  /**
   * Contains all the conditional info for a question
   */
  "Conditional.Info"?: {
    /**
     * One entry per possible response option, pairing it with the child Item ID it triggers. If multiple response options trigger the same child, that Item ID appears in multiple entries.
     */
    "Conditional.Child.Mappings"?:
      | {
          /**
           * Item ID triggered by this response option.
           */
          "Conditional.Child.Item.ID": string;
          /**
           * The single response option that triggers this child.
           */
          Definition: string;
        }[]
      | null;
    /**
     * Item ID for the fail child of the current question.
     */
    "Conditional.Fail.Item.ID"?: string | null;
    /**
     * Item ID for the parent of the current question.
     */
    "Conditional.Master.Item.ID"?: string | null;
    /**
     * Threshold is the preset value being compared to the user response.
     */
    "Conditional.Threshold"?: string | null;
    /**
     * Conditional type is the comparator (in order: =, <=, >=, <, >, !=)
     */
    "Conditional.Type"?: "1" | "2" | "3" | "4" | "5" | "6" | null;
    /**
     * If the current question is a multi conditional (aka, branches off into mutually exclusive branches
     */
    "Multi.Conditional"?: boolean;
    /**
     * Number of mutually exclusive conditional branches that can be triggered by this question. For example, if RCC and home trigger two separate branches, the user selects both, and the conditional limit is 1, the first of the two options in the internal ordering of the possible responses will be the only conditional triggered.
     */
    "Conditional.Limit"?: number;
  };
  /**
   * The type of data captured by this variable. Oldname: Result.Type
   */
  "Data.Type"?: "integer" | "character" | "numeric" | null;
  /**
   * Item ID for this question. Identifies a single question definition, reused across repeated deliveries of the same survey (e.g. the same Item.ID appears across all 10 days a morning survey is repeated).
   */
  "Item.ID": string;
}[];
/**
 * Array of survey specifications within this burst. Each survey represents a distinct instrument delivered to participants. May be empty if no surveys have been defined yet.
 *
 * @minItems 0
 */
export type SurveySpecifications = {
  /**
   * Human readable survey long name
   */
  "Survey.LongName"?: string;
  /**
   * False when the order the questions are asked in, and any skip logic, are not known, e.g. a survey built from a dataset's columns. Tools then show no flowchart for it instead of guessing a straight line. Omitted or true means the questions are listed in the order they are asked.
   */
  "Survey.Flow.Known"?: boolean;
  /**
   * Human readable survey short name
   */
  "Survey.Name": string;
  questions?: QuestionSpecification;
}[];

/**
 * This specification contains all the information needed to describe a study, including what is needed to make reproducible and replicable codebooks for complex designs.
 */
export interface StudySpecification {
  /**
   * Container for all AI-provenance metadata associated with this study: which model(s) generated which characteristics, and the exact prompts used to generate and subsequently modify the study via the AI Study Assistant.
   */
  "AI.Information"?: {
    /**
     * List of AI-generated characteristics and the model used to generate each one. Supports multi-agent/multi-model provenance, or a single entry with Characteristic='All' if one model generated everything.
     */
    "AI.Disclosure"?: {
      /**
       * The specific data element, section, or design aspect that was AI generated (e.g. 'study design', 'survey text', 'data analysis code', 'summary narrative', 'figure captions'). Use 'All' if a single model was responsible for the entire output.
       */
      Characteristic: string;
      /**
       * String indicating what generative AI model was used to produce this characteristic
       */
      Model: string;
    }[];
    /**
     * The exact user-provided prompt used to initially generate this study via the AI Study Generator. Null or omitted if the study was not AI-generated.
     */
    "AI.Generation.Prompt"?: string | null;
    /**
     * Chronological list of user-provided prompts used to modify this study via the AI Study Modifier, one entry per modification request, in the order they were applied. Empty or omitted if the study has never been modified via the AI assistant.
     */
    "AI.Modification.Prompts"?: string[];
  };
  /**
   * Study- and dataset-level metadata: identification, credits, provenance, sampling, recruitment flow, access, regulatory restrictions, reuse, and linkage to other datasets.
   */
  "Study.Metadata": {
    /**
     * Human readable long name for a study
     */
    "Study.Name": string;
    /**
     * String of all people to be credited for this study. This will appear in the authors section of a generated codebook.
     */
    authors?: string;
    /**
     * String containing relevant funding info for the study
     */
    funding?: string;
    /**
     * String containing qualitative description of the study. This could include main study objectives, relevant findings, study population etc.
     */
    abstract?: string;
    /**
     * Version of the dataset (distinct from the schema 'version' field, which versions this specification format).
     */
    "Data.Version"?: {
      /**
       * Dataset version identifier, e.g. '2.1.0' or 'Wave 3 release'.
       */
      Version: string;
      "Release.Date"?: string;
      /**
       * What changed relative to the previous version.
       */
      Changelog?: string;
    };
    /**
     * Links to IRB documents, GitHub repositories, preregistrations, or other protocol descriptions.
     */
    "Protocol.Links"?: {
      Type: "IRB" | "GitHub" | "Preregistration" | "OSF" | "Protocol Paper" | "Other";
      Label?: string;
      URL: string;
      /**
       * IRB protocol number, if Type is IRB.
       */
      "IRB.Number"?: string;
    }[];
    /**
     * How participants were sampled.
     */
    Sampling?: {
      /**
       * e.g. convenience, probability, stratified, snowball, respondent-driven, census.
       */
      Method: string;
      "Target.Population"?: string;
      /**
       * The list or source from which participants were drawn.
       */
      "Sampling.Frame"?: string;
      Description?: string;
    };
    /**
     * Recruitment, eligibility, selection, and participant flow. Flow stages are free-form so the structure works for both trials and observational designs.
     */
    CONSORT?: {
      Recruitment?: {
        Setting?: string;
        /**
         * e.g. flyers, clinic referral, social media, panel.
         */
        Methods?: string;
        "Start.Date"?: string;
        "End.Date"?: string;
      };
      Eligibility?: {
        "Inclusion.Criteria"?: string[];
        "Exclusion.Criteria"?: string[];
      };
      /**
       * How eligible individuals were selected or allocated into the study (and into arms/groups, if applicable).
       */
      Selection?: string;
      /**
       * Ordered participant-flow stages, e.g. Assessed for eligibility, Excluded, Enrolled, Allocated, Lost to follow-up, Analyzed.
       */
      Flow?: {
        Stage: string;
        N: number;
        Reasons?: {
          Reason: string;
          N?: number;
        }[];
      }[];
    };
    /**
     * Ordered record of how the released data were derived from raw collection, including cleaning, recoding, merging, scoring, and de-identification steps.
     */
    "Data.Provenance"?: {
      /**
       * Position of this activity in the processing sequence.
       */
      Step: number;
      /**
       * Short name for the activity, e.g. 'Remove test accounts', 'Reverse code PSS items', 'Merge sensor data', 'Top-code age'.
       */
      Activity: string;
      Description?: string;
      /**
       * Question.IDs, files, or dataset versions this activity used.
       */
      Inputs?: string[];
      /**
       * Question.IDs, files, or dataset versions this activity produced or modified.
       */
      Outputs?: string[];
      /**
       * Person, team, or software responsible for this activity.
       */
      Agent?: string;
      Date?: string;
      "Script.URL"?: string;
    }[];
    /**
     * How to obtain the data.
     */
    "Data.Access"?: {
      "Access.Level": "Open" | "Registered" | "Controlled" | "Restricted" | "Not Available";
      /**
       * e.g. ICPSR, NDA, OSF, Dataverse.
       */
      Repository?: string;
      URL?: string;
      /**
       * Whether a data use agreement is required.
       */
      "DUA.Required"?: boolean;
      Contact?: string;
      Instructions?: string;
    };
    /**
     * Published papers that use this dataset.
     */
    Publications?: {
      /**
       * APA-formatted citation.
       */
      Citation: string;
      DOI?: string;
      Year?: number;
    }[];
    /**
     * Legal and regulatory frameworks governing this data.
     */
    "Regulatory.Restrictions"?: {
      Frameworks?: ("HIPAA" | "FERPA" | "42 CFR Part 2" | "Common Rule" | "GDPR" | "COPPA" | "State Law" | "Other")[];
      "Certificate.Of.Confidentiality"?: boolean;
      Notes?: string;
    };
    /**
     * Sets of variables that are identifying or high-risk in combination (quasi-identifiers, differential identifiability). Single-item identifiers are flagged in itemMap.Identifying.Info.
     */
    "Identifier.Groups"?: {
      Label?: string;
      /**
       * @minItems 1
       */
      "Question.IDs": [string, ...string[]];
      "Risk.Type":
        "Direct Identifier" | "Quasi-Identifier" | "Differentially Identifiable" | "High Risk to Participant" | "Other";
      Description?: string;
    }[];
    /**
     * How heavily the data have been used, for privacy and generalizability purposes.
     */
    "Data.Usage"?: {
      /**
       * Number of approved data access requests.
       */
      "Access.Grant.Count"?: number;
      "Publication.Count"?: number;
      /**
       * For differentially private releases.
       */
      "Privacy.Budget"?: {
        "Epsilon.Total"?: number;
        "Epsilon.Spent"?: number;
      };
      /**
       * Qualitative notes on overuse, e.g. hypotheses already tested, risk of garden-of-forking-paths.
       */
      "Generalizability.Notes"?: string;
      "Last.Updated"?: string;
    };
    /**
     * Relationships to other datasets.
     */
    Linkages?: {
      "Dataset.Name": string;
      Relationship: "Subset Of" | "Superset Of" | "Linked By ID" | "Overlapping Sample" | "Derived From" | "Other";
      /**
       * Variable used to link records, if any (e.g. External.ID).
       */
      "Linkage.Key"?: string;
      URL?: string;
      Notes?: string;
    }[];
  };
  /**
   * Array containing schedules for a study
   */
  schedules: Items[];
  surveys: SurveySpecifications;
  data?: DataSpecificationColumnVectorFormat;
  itemMap?: ItemMapRepo;
  /**
   * URL of the study's bulk screenshot retrieval endpoint.
   */
  screenshotsURL?: string;
  /**
   * Flattened delivery order of all items across surveys. Used to reconstruct intended question flow independent of data arrival order.
   */
  blockMap: {
    /**
     * Survey this item belongs to
     */
    "Survey.Name": string;
    /**
     * Block grouping
     */
    Block?: string;
    /**
     * Sub-block grouping within block
     */
    "Sub.block"?: string;
    /**
     * Reference to question Item.ID
     */
    "Item.ID": string;
    "Item.Type": "Block" | "Question";
    Parent?: string | null;
  }[];
}
export interface Items {
  /**
   * Unique identifier for the calendar.
   */
  id?: string;
  /**
   * Human-readable name of the calendar.
   */
  name?: string;
  /**
   * @minItems 1
   */
  events: [Event, ...Event[]];
  /**
   * Nested child schedules (e.g. bursts) that belong to this schedule as a whole, as opposed to a single event within it — see the 'children' property under an individual event's extensions for that case.
   */
  children?: Items[];
  /**
   * Vendor-specific extensions.
   */
  extensions?: {
    [k: string]: unknown | undefined;
  };
}
export interface Event {
  /**
   * Unique identifier for the event.
   */
  id: string;
  /**
   * Short summary of the event.
   */
  title: string;
  /**
   * Detailed description of the event.
   */
  description?: string;
  /**
   * Start date/time of the event. ISO-8601 date-time or date (see dateTime/date definitions).
   */
  start: string | string;
  /**
   * End date/time of the event (exclusive). ISO-8601 date-time or date (see dateTime/date definitions).
   */
  end: string | string;
  /**
   * Whether the event details should be hidden from public feeds.
   */
  private?: boolean;
  recurrence?: Rrule;
  /**
   * Per-instance modifications or cancellations (keyed by ISO date / date-time string).
   */
  overrides?: {
    [k: string]: OverrideEvent | undefined;
  };
  /**
   * Items: ISO-8601 timestamp at which the alarm should fire.
   */
  alarms?: string[];
  /**
   * Vendor-specific extensions applicable to this event.
   */
  extensions?: {
    /**
     * Boolean indicating whether the timing window is user specified
     */
    "User.Specified"?: boolean;
    /**
     * Type of timing. Fixed means, no variation in timing window. Random is drawing a random sample from a time period, triggered is based on set rules more in depth than just random in a time period.
     */
    "Timing.Type"?: "Fixed" | "Random" | "Triggered";
    /**
     * Contains the trigger logic if it exists for a given window.
     */
    "Trigger.Info"?: {
      /**
       * Source of measurement to trigger conditional
       */
      "Conditional.Source"?: string;
      /**
       * Threshold is the preset value being compared to the user response.
       */
      "Conditional.Threshold"?: string;
      /**
       * Conditional type is the comparator (in order: =, <=, >=, <, >, !=)
       */
      "Conditional.Type"?: "1" | "2" | "3" | "4" | "5" | "6";
    };
    /**
     * Nested child schedules (e.g. bursts) that belong to this specific event, as opposed to the schedule as a whole — see the schedule-level 'children' property for that case.
     */
    children?: Items[];
    /**
     * Name of the survey delivered by this schedule, referencing a Survey.Name value elsewhere in this document. Optional — some schedules (e.g. passive/sensor sync, administrative reminders) deliver no survey. JSON Schema cannot verify the referenced survey actually exists; any agent or tool generating or consuming this data must independently confirm it resolves to a real Survey.Name in the same study spec.
     */
    "Survey.Name"?: string;
  };
}
export interface Rrule {
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval?: number;
  byDay?: ("MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU")[];
  byMonthDay?: number[];
  byMonth?: number[];
  count?: number;
  /**
   * End of the recurrence. ISO-8601 date-time or date string (see dateTime/date definitions).
   */
  until?: string | string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^.*$".
 */
export interface OverrideEvent {
  cancelled?: boolean;
  title?: string;
  description?: string;
  /**
   * ISO-8601 date-time or date (see dateTime/date definitions).
   */
  start?: string | string;
  /**
   * ISO-8601 date-time or date (see dateTime/date definitions).
   */
  end?: string | string;
  private?: boolean;
  /**
   * Items: ISO-8601 timestamp at which the alarm should fire.
   */
  alarms?: string[];
  extensions?: {
    [k: string]: unknown | undefined;
  };
}
/**
 * All fields are stored as column vectors (arrays), where each position corresponds to a participant/record in the dataset.
 */
export interface DataSpecificationColumnVectorFormat {
  "Participant.ID": string[];
  "Session.ID": number[];
  /**
   * Each entry is a participant-level array of alert times, as ISO-8601 date-time strings.
   */
  "Alert.Times"?: string[][];
  /**
   * Timestamp the survey was started, as an ISO-8601 date-time string.
   */
  "Survey.Start"?: string[];
  /**
   * Timestamp the survey was completed, as an ISO-8601 date-time string.
   */
  "Survey.Date.Completed": string[];
  /**
   * Timestamp the survey was submitted, as an ISO-8601 date-time string.
   */
  "Survey.Date.Submitted"?: string[];
  Timezone?: string[];
  Offset?: number[];
  "Network.Type"?: ("Cellular" | "Wifi")[];
  "App.Version"?: string[];
  OS?: string[];
  Model?: string[];
  "User.Response": string[];
  "Question.ID": string[];
  "External.ID"?: string[];
}
/**
 * This specification contains all the needed information to describe a single item or scale used within a study, including its conceptual, psychometric, and delivery properties.
 */
export interface ItemMapRepo {
  /**
   * Exact text of the item as presented.
   */
  "Item.Text": string;
  /**
   * What construct or concept does this item measure or represent?
   */
  Conceptualization?: string;
  /**
   * Usual modeling characteristics or how this item is typically used in analysis (e.g. predictor, outcome, mediator, covariate). For example, reaction time is often log transformed.
   */
  "Modeling.Characteristics"?: string;
  /**
   * Whether this item is part of a statistically validated measure.
   */
  Validated?: boolean;
  /**
   * Name of the scale this item belongs to.
   */
  "Scale.Name"?: string;
  /**
   * Name of the parent scale if this item belongs to a subscale.
   */
  "Parent.Scale"?: string;
  /**
   * Name of the subscale this item belongs to, if applicable.
   */
  "Sub.Scale"?: string;
  /**
   * Whether this entry represents a full scale or a single item.
   */
  scaleOrItem?: "scale" | "item";
  /**
   * The type of scale this item uses (e.g. Likert, VAS, semantic differential, binary, forced choice).
   */
  "Scale.Type"?: string;
  /**
   * How this item or scale is scored, including any summing, averaging, or weighting rules (e.g. sum score, factor scores, weighted sum scores).
   */
  Scoring?: string;
  /**
   * Whether this item is reverse coded or otherwise transformed before use.
   */
  "Reverse.Coded"?: boolean;
  /**
   * Description of any transformation applied to this item beyond simple reverse coding.
   */
  Transformation?: string;
  /**
   * Whether this item captures data considered sensitive (e.g. substance use, mental health, sexual behavior, criminal justice involvement, immigration status, HIV status).
   */
  "Sensitive.Data"?: boolean;
  /**
   * Category of identifying information this item captures (e.g. 'SSN', 'Government ID', 'HIPAA identifier - medical record number', 'Financial account number', 'Biometric', 'Full legal name', 'Address', 'Other'). Null if the item captures no identifying information.
   */
  "Identifying.Info"?: string | null;
  /**
   * Type of data this item produces.
   */
  "Data.Type": "numeric" | "categorical" | "continuous" | "ordinal" | "binary" | "text" | "other";
  /**
   * The time reference embedded in the item (e.g. 'in the past week', 'right now', 'today').
   */
  "Time.Stem"?: string;
  /**
   * The top-level or parent question this item falls under, if it is a sub-item.
   */
  "Top.Level.Question"?: string;
  /**
   * Numeric mapping of response anchors (e.g. 1-5).
   */
  Values: string;
  /**
   * Nominal or text-based response options or categories.
   */
  Definition: string;
  /**
   * How the item is delivered to the participant (e.g. mobile app, paper, wearable, passive sensor, interviewer).
   */
  "Delivery.Mechanism"?: string;
  /**
   * How frequently this item is delivered (e.g. once daily, every 4 hours, event-contingent).
   */
  "Delivery.Frequency"?: string;
  /**
   * Title of article
   */
  "Article.Title"?: string;
  /**
   * DOI citation for the item or scale source, or APA formatted citation.
   */
  Citation?: string;
  /**
   * Any additional notes about this item.
   */
  notes?: string;
}
