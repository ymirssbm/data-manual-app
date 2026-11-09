# Survey Editor

**Survey Editor** (side panel) edits the loaded study's surveys directly: questions, blocks, response options and skip logic. A live form lets you click through the survey and watch the skip logic work.

## Editing

- **Surveys**: pick a survey from the row of tabs at the top, rename it, or add one with **+ Survey**.
- **Items**: the list on the left shows every question and block in order, indented inside blocks. Each row shows the variable name, the question type, and "if …" when it has skip logic. Click one to edit it.
- **Add**: **+ Question** and **+ Block** insert after the selected item, inside the same block.
- **Question fields**: text, variable name (Question ID, kept unique), block, question type, type of data, response options (value = label), and description.
- **Show this question**: "Always", or "Only if" an earlier question:
  - for choice questions, tick the options that show it ("is any of" / "includes any of" for multi-select);
  - for other questions, a comparison such as "is at least 70".
- **Move up / down** reorders an item among its siblings (a block moves with its contents). **Delete** removes an item (a block takes its questions with it) and clears any skip logic that pointed at it.

Edits stay in a draft until you click **Apply changes**, which validates the study like any import. **Discard** throws the draft away. Every output (codebook, dictionary, flowchart, exports) then uses the edited study.

## Try the survey

The **Try the survey** tab runs the current draft as a real form, built with the open-source [SurveyJS](https://surveyjs.io) form library (MIT license). Answer questions to check the skip logic; **Start over** resets it. Nothing you enter is saved.

## SurveyJS JSON

- **SurveyJS JSON** (under the item list) downloads the current survey in SurveyJS format.
- **Import** replaces the current survey with a SurveyJS JSON file, for example one edited in SurveyJS Creator. Items keep their IDs and skip logic when they still exist (matched by the `dm` details the export adds, or by variable name).

SurveyJS Creator, the drag-and-drop designer, is a commercial product with its own license, so it isn't built in. The free form library is used for the preview, and the JSON import/export lets you use Creator alongside this app if you have a license.
