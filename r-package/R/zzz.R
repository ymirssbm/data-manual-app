.onLoad <- function(libname, pkgname) {
  # input$<outputId>_spec arrives as JSON text tagged "datamanual.spec"; parse it without
  # simplifying so one-element arrays stay arrays.
  shiny::registerInputHandler("datamanual.spec", function(x, shinysession, name) {
    if (is.null(x) || !nzchar(x)) NULL else as_study(x)
  }, force = TRUE)
}
