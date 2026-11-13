# Survey Editor

**Survey Editor** (side panel) edits the loaded study's surveys directly: questions, blocks, response options and skip logic. A live form lets you click through the survey and watch the skip logic work.

## Editing

- **Surveys**: pick a survey from the row of tabs at the top, rename it, or add one with **+ Survey**.
- **Find a question**: the search box beside the survey tabs searches every question in every survey as you type. Type part of an ID (`mo_` lists the morning questions), words from the question text (`craving`), or a type (`multiple select`). The best matches come first, ID matches above wording. Enter or a click opens the question.
- **Items**: the list on the left shows every question and block in order, indented inside blocks. Each row shows the variable name, the question type, and "if …" when it has skip logic. Click one to edit it.
- **Selecting several**: works like a file list. Ctrl-click (Cmd-click on a Mac) adds or removes one item. Shift-click selects everything between the last click and this one.
- **Add**: **+ Question** inserts after the selected item, inside the same block. **+ Block** puts the selected questions into a new block, placed where the first one was. With nothing selected, it adds an empty block instead.
- **Delete**: the Delete key removes the selected items at once (a block takes its questions with it) and clears any skip logic that pointed at them; their responses stay in the data. The **Delete** button asks first and can also remove their responses: tick **Also delete N responses from the data**.
- **Question fields**: text, variable name (Question ID, kept unique), block, question type, type of data, response options (value = label), and description.
- **Move up / down** reorders an item among its siblings (a block moves with its contents).
- **Survey kind**: next to the survey's name, **Assessment** (questions that measure) or **Intervention** (content delivered to the participant, such as a coping tip).

### Repeating and floating blocks

A block's form has two more boxes:

- **Repeat this block**:
  - a set number of times;
  - once for each option chosen in an earlier multiple-select question (e.g. two questions asked about each substance used);
  - or until an answer says stop, with a maximum.

  Each answer in the data records which repetition it was.
- **Floating**: tick it to ask the block in the next survey the participant takes if its own survey is missed, for example last night's sleep moving from a missed morning survey to the afternoon check, then to the evening diary.
  - Set the order of surveys it moves through, and whether it's asked once per day, burst or study.
  - The flowchart marks the block in its own survey and draws it as a dashed step at the start of the other surveys it can move to.

### Logic: both ends in one place

Each question has its logic in two boxes, so you can wire it from either end:

- **Show this question** (or block) sets what controls it: "Always", or "Only if" an earlier question, picked with the same search.
  - For choice questions, tick the options that show it ("is any of" / "includes any of" for multi-select).
  - For other questions, set a comparison such as "is at least 70".
- **What this answer leads to** lists everything the answer controls: later questions or blocks it shows, and other surveys it sends. Each one has its condition, which you can edit or remove.
  - **+ Leads to** searches later questions, blocks and other surveys.
  - Picking a question or block adds a skip rule to it.
  - Picking a survey sends that survey when the answer matches, for example a craving follow-up the next morning when evening craving is 70 or more. It adds one triggered window per delivery of this survey, the same day or the next, between the times you choose.
- The triggered survey's **Schedule** tab shows the same link from the other end, under **Sent when an answer in another survey…**. You can edit or remove it there, or add one by searching for the question that should send it.

## Schedule

The **Schedule** tab lists when the selected survey is sent: each window's title, the study day it starts on, time range, how it repeats (once, daily or weekly, and how many times), and whether the time is fixed, random within the window, or triggered by an answer. **+ Add a delivery window** adds one (a week after the last, or daily 9–10 AM for a week). **Edit this schedule** on the Study Schedule page opens this tab for that survey.

A window can be a **decision point** (for just-in-time adaptive interventions). Tick **Decision point** and give each option (an intervention survey, or no intervention) its chance, e.g. a coping tip 50% and no message 50%. Combined with a trigger, the draw happens only when the answer rule is met.

Schedules are set in study days, not dates. Day 1 is the first day any survey is sent, and each participant's day 1 is when they start. (A study file stores example dates, but only the spacing between them matters.) If you move the first window later, the next one becomes day 1. If everyone starts on the same weekday, set **Participants start on** in the Study Schedule's edit panel: the calendar then shows weekdays and shades weekends.

## Saving and undoing

There is no Save button: edits save as you make them, here and in every other view, and the codebook, dictionary, flowchart, schedule and exports update right away.

- Typing is saved a moment after you stop. Typing in one field counts as one step for undo.
- If an edit would leave the study invalid for a moment (say, an empty variable name), it isn't saved until it's fixed. A **Not saved yet** note says why.
- **Undo** at the top of the window or Ctrl+Z steps back, and **Redo** or Ctrl+Y steps forward. This works for edits made anywhere in the app: the editor, codebook, flowchart, schedule or AI.
- Inside a text box, Ctrl+Z undoes typing in that box.
- Loading a different study starts a fresh history.

## Editing from the flowchart, the codebook and the schedule

Every view has an **✎ Edit** button that turns editing on for that view. Click it again (**Editing: done**) to turn editing off. Each change can be undone with Ctrl+Z.

- **Flowchart**:
  - Click a question to edit it in the side panel, using the same form as here. Drag the panel's left edge to make it wider or narrower; the app remembers the width.
  - Ctrl-click or Shift-click selects several questions.
  - The **Move** and **⬚ Select area** tools sit in the chart's top-left corner while editing. With Select area, drag a box around questions to select them; hold Shift or Ctrl to add to the selection.
  - The Delete key removes the selected questions; their responses stay in the data.
  - With several questions selected, a bar above the chart lets you name a block and click **+ Block**, or **Delete** them.
  - The chart redraws as you edit.
  - **↘ Link** (in the same corner) draws logic: drag from a question to a later question or block, and that one is shown only when the answer matches. The condition starts as the first option (or "at least 1"); change it in the side panel. An item has one show-condition, so linking replaces any it had, and the message says which; Ctrl+Z brings it back. Drag the line onto one of the surveys in the bar above to have the answer send that survey (the next day, 10–10:30 AM).
  - The **Drag in** bar above the chart:
    - **＋ Question** or **＋ Block**: drop on a question to add it after that one, on a block to add it at the end of the block, or on empty space to add it at the end of the survey.
    - **Copy a question from another survey**: search for it, then drag the chip that appears onto the chart.
    - A **survey**: drop it on a question to have that question's answer send it.
    - **＋ New survey**: drop it on a question to have the answer send a new survey, or anywhere to add a survey that runs daily for a week.
    - Clicking a chip instead of dragging adds it after the selected question.
  - In edit mode, clicking a block selects it instead of folding it.
- **Codebook**:
  - **✎ Edit** asks first. A codebook documents the study as it was actually run, so changing question text, options or logic here can make it misdescribe the data. Once it's on, the codebook shows edit buttons; they appear only in the app's view, never in downloads. **Editing: done** turns them off.
  - **Edit study details**, on the title and on the Title Page, Abstract, Executive Summary, Funding and Contact sections, edits the title, authors, abstract, summary, funding and contact. Tick **Also save … into the study file** to keep them in the study, not only in this codebook.
  - Each question has an **Edit** button and a **Delete** button, and Delete gives two choices:
    - **Leave out of this codebook** removes the question from the codebook only. Bring it back on the Variables tab.
    - **Delete from the study and the data** removes the question and its responses.
- **Study schedule**: in edit mode the side panel edits the schedule.
  - Click a window on the calendar to change its title, survey, study day, times, repeats and timing, or remove it with **×**.
  - **+ New repeating survey** creates a survey that repeats daily for a week (9–10 AM) and opens it in the panel. There you can name it, change or add its windows, add questions, or copy questions from other surveys by searching for them. Click a question to edit it in full, logic included.
  - **+ Add a window** adds one for the survey you pick, and **Edit survey** opens that survey in the panel.

## Try the survey

The **Try the survey** tab runs the survey as a real form, built with the open-source [SurveyJS](https://surveyjs.io) form library (MIT license). Answer questions to check the skip logic; **Start over** resets it. Nothing you enter is saved.

## SurveyJS JSON

- **SurveyJS JSON** (under the item list) downloads the current survey in SurveyJS format.
- **Import** replaces the current survey with a SurveyJS JSON file, for example one edited in SurveyJS Creator. Items keep their IDs and skip logic when they still exist (matched by the `dm` details the export adds, or by variable name).

SurveyJS Creator, the drag-and-drop designer, is a commercial product with its own license, so it isn't built in. The free form library is used for the preview, and the JSON import/export lets you use Creator alongside this app if you have a license.
