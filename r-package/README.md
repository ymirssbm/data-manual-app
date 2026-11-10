# datamanual (R package)

The Data Manual app in R and Shiny: open a study from R, embed the whole app in a Shiny app, and get every change back in R. No Node or other tools needed; the app ships inside the package.

## Install

```r
# install.packages("remotes")
remotes::install_github("ymirssbm/data-manual-app", subdir = "r-package")
```

## Open a study from R

```r
library(datamanual)

study <- read_study("my-study.json")
study                       # surveys, questions, schedules, responses

edited <- run_data_manual(study)   # opens the app in your browser
# ...import, edit surveys, make a codebook... then close the tab:
write_study(edited, "my-study-edited.json")
```

`run_data_manual()` returns the study as you left it when you close the tab. `dataManual(study)` shows the app in the RStudio viewer or an R Markdown document instead.

## In your own Shiny app

```r
library(shiny)
library(datamanual)

ui <- fillPage(dataManualOutput("dm", height = "100vh"))

server <- function(input, output, session) {
  output$dm <- renderDataManual(dataManual("my-study.json"))

  # Every load, import or edit in the app arrives here as a dm_study.
  observeEvent(input$dm_spec, {
    message("Now showing: ", input$dm_spec$Study.Metadata$Study.Name)
  })
}

shinyApp(ui, server)
```

| Function | What it does |
| --- | --- |
| `dataManual(spec)` | The app as an htmlwidget. `spec` is a `dm_study`, a list, JSON text or a `.json` path. |
| `dataManualOutput(id)` / `renderDataManual()` | Shiny output and render functions. |
| `input$<id>_spec` | The study currently in the app, as a `dm_study`, updated on every change. |
| `updateDataManual(session, id, spec)` | Load a different study into a running app. |
| `read_study()`, `write_study()`, `as_study()`, `study_json()` | Study specs to and from R. One-element arrays are kept as arrays. |
| `study_responses()`, `study_surveys()` | Responses and surveys as data frames. |
| `dm_keys()`, `dm_add_key()`, `dm_remove_key()`, `dm_key_folder()` | The API keys saved on this computer. |

A fuller example, with R reading what the app sends back: `shiny::runApp(system.file("examples/shiny", package = "datamanual"))`.

## API pulls and saved keys inside Shiny

Browsers can't call Wear-IT, REDCap, Qualtrics or most AI APIs directly, so in the standalone app a small local server relays those calls. Inside Shiny, **your R session does that job**: the app sends its API requests to a private, per-session address in the Shiny app, and R forwards them.

Saved keys are the **same ones the standalone app uses** (the folder shown in its Settings). R fills a key into a request only when the request goes to that key's own server, and keys never go to the browser. You can also add keys from R:

```r
dm_add_key("redcap", "Sleep study", Sys.getenv("REDCAP_TOKEN"), url = "https://redcap.example.edu/api/")
dm_keys()
```

On Windows keys are encrypted for your Windows account; on macOS they are in the Keychain; on Linux in the system keyring. If your Shiny app runs on a shared server, keys saved there belong to the account the server runs as, so only save keys there if that is what you intend.

## Develop

The package wraps a build of the web app in `inst/htmlwidgets/lib/app/` (committed, so installing needs no Node). After changing `web/src`, rebuild it with `npm run build:widget` in `web/`. Tests: `devtools::test("r-package")`.
