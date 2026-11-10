#' The Data Manual app as an htmlwidget
#'
#' Shows the whole app (import, codebook, data dictionary, flowchart, schedule, survey editor,
#' export, AI) in the RStudio viewer, a browser, R Markdown, or a Shiny app.
#'
#' In Shiny, every change the user makes (loading, importing, editing) comes back as
#' `input$<outputId>_spec`, a `dm_study`. API pulls and AI calls made in the app go through the R
#' session, which fills in saved API keys (see [dm_keys()]); keys never reach the browser.
#'
#' @param spec A study to open: a `dm_study`, a list, JSON text, or a path to a `.json` file.
#'   `NULL` starts empty.
#' @param width,height Widget size (CSS units or pixels).
#' @param elementId Optional element id.
#' @param relay In Shiny, relay the app's API calls through this R session (default `TRUE`).
#' @return An htmlwidget.
#' @examples
#' \dontrun{
#' dataManual("my-study.json")
#' }
#' @export
dataManual <- function(spec = NULL, width = NULL, height = NULL, elementId = NULL, relay = TRUE) {
  x <- list()
  if (!is.null(spec)) x$spec_json <- study_json(spec)
  session <- shiny::getDefaultReactiveDomain()
  if (isTRUE(relay) && !is.null(session)) x$relay <- dm_relay_url(session)
  htmlwidgets::createWidget(
    name = "dataManual",
    x = x,
    width = width,
    height = height,
    package = "datamanual",
    elementId = elementId,
    sizingPolicy = htmlwidgets::sizingPolicy(
      defaultWidth = "100%", defaultHeight = 800,
      viewer.fill = TRUE, browser.fill = TRUE, viewer.padding = 0, browser.padding = 0, knitr.figure = FALSE
    )
  )
}

#' Shiny bindings for Data Manual
#'
#' @param outputId Output variable to read from.
#' @param width,height Size of the app (CSS units). The app is laid out for a full page, so
#'   give it the whole page or a tall area.
#' @param expr An expression that returns a [dataManual()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` a quoted expression?
#' @export
dataManualOutput <- function(outputId, width = "100%", height = "800px") {
  htmlwidgets::shinyWidgetOutput(outputId, "dataManual", width, height, package = "datamanual")
}

#' @rdname dataManualOutput
#' @export
renderDataManual <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) expr <- substitute(expr)
  htmlwidgets::shinyRenderWidget(expr, dataManualOutput, env, quoted = TRUE)
}

#' Load a study into a running Data Manual widget
#'
#' Replaces the study shown by `dataManualOutput(outputId)` without re-rendering the output.
#'
#' @param session The Shiny session.
#' @param outputId The widget's output id.
#' @param spec The study to show (anything [as_study()] accepts).
#' @export
updateDataManual <- function(session = shiny::getDefaultReactiveDomain(), outputId, spec) {
  session$sendCustomMessage("datamanual-update", list(id = session$ns(outputId), spec_json = study_json(spec)))
  invisible(NULL)
}

#' Open Data Manual from R
#'
#' Starts a small Shiny app with the whole Data Manual app and opens it in your browser.
#' When you close the tab (or stop the app), the study as you left it is returned.
#'
#' @param spec A study to open (anything [as_study()] accepts), or `NULL`.
#' @param launch.browser Passed to [shiny::runApp()].
#' @param port Port for the app, or `NULL` for a random one.
#' @return The last study shown in the app, as a `dm_study` (invisibly `NULL` if none).
#' @examples
#' \dontrun{
#' edited <- run_data_manual("my-study.json")
#' write_study(edited, "my-study-edited.json")
#' }
#' @export
run_data_manual <- function(spec = NULL, launch.browser = TRUE, port = NULL) {
  start <- if (is.null(spec)) NULL else as_study(spec)
  ui <- shiny::fillPage(
    shiny::tags$head(shiny::tags$title("Data Manual")),
    dataManualOutput("dm", height = "100%")
  )
  server <- function(input, output, session) {
    latest <- start
    output$dm <- renderDataManual(dataManual(start))
    shiny::observeEvent(input$dm_spec, latest <<- input$dm_spec, ignoreNULL = TRUE)
    session$onSessionEnded(function() shiny::stopApp(latest))
  }
  result <- shiny::runApp(shiny::shinyApp(ui, server), launch.browser = launch.browser, port = port)
  if (is.null(result)) invisible(NULL) else result
}
