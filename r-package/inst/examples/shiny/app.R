# Data Manual inside a Shiny app.
#
#   shiny::runApp(system.file("examples/shiny", package = "datamanual"))
#
# The left panel is ordinary Shiny reading what the app sends back: every import or edit made in
# Data Manual arrives as input$dm_spec. API pulls and AI calls made in the app are relayed by this R
# session, using the keys saved on this computer (see datamanual::dm_keys()).
library(shiny)
library(datamanual)

example <- "https://raw.githubusercontent.com/ymirssbm/data-manual-app/main/examples/branching-ema-study.json"

ui <- fillPage(
  padding = 0,
  tags$style("
    .dm-shell { display: grid; grid-template-columns: 300px 1fr; height: 100vh; }
    .dm-r-side { padding: 16px; border-right: 1px solid #ddd; overflow: auto; font-family: system-ui, sans-serif; font-size: 14px; }
    .dm-r-side h3 { margin-top: 0; }
  "),
  div(
    class = "dm-shell",
    div(
      class = "dm-r-side",
      h3("From R"),
      actionButton("load_example", "Load the example study"),
      tags$hr(),
      h4("What the app sent back"),
      verbatimTextOutput("summary"),
      tableOutput("surveys"),
      downloadButton("save", "Save study (JSON)")
    ),
    dataManualOutput("dm", height = "100vh")
  )
)

server <- function(input, output, session) {
  output$dm <- renderDataManual(dataManual())

  observeEvent(input$load_example, {
    updateDataManual(session, "dm", jsonlite::read_json(example, simplifyVector = FALSE))
  })

  study <- reactive(input$dm_spec)
  output$summary <- renderPrint({
    req(study())
    print(study())
  })
  output$surveys <- renderTable(if (!is.null(study())) study_surveys(study()))
  output$save <- downloadHandler(
    filename = function() "study.json",
    content = function(file) write_study(req(study()), file)
  )
}

shinyApp(ui, server)
