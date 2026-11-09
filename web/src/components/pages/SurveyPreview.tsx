// Live SurveyJS form for the Survey Editor's "Try the survey" tab (loaded on demand: SurveyJS is
// large). Answers stay in this tab and are never saved.
import { useMemo, useState } from 'react';
import { Model } from 'survey-core';
import { Survey as SurveyForm } from 'survey-react-ui';
import 'survey-core/survey-core.min.css';
import type { Survey } from '../../core';
import { surveyToSurveyJsPage } from '../../exporters';

export default function SurveyPreview({ survey }: { survey: Survey }) {
  const [run, setRun] = useState(0);
  const model = useMemo(() => {
    const page = surveyToSurveyJsPage(survey);
    const m = new Model({ pages: [page], showQuestionNumbers: 'off', completeText: 'Finish', completedHtml: '<p>End of survey. Nothing was saved.</p>', widthMode: 'responsive' });
    return m;
    // `run` restarts the form.
  }, [survey, run]);
  return (
    <div className="dm-preview-survey">
      <div className="dm-preview-survey-bar">
        <span className="dm-hint">Answer to see the skip logic work. Nothing is saved.</span>
        <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => setRun((r) => r + 1)}>
          Start over
        </button>
      </div>
      <SurveyForm model={model} />
    </div>
  );
}
