#' Read, write and convert study specs
#'
#' A study spec is the JSON format the app works in (see `schema/study.schema.json` in the
#' repository). In R it is a nested list of class `dm_study`, parsed without simplification so
#' every JSON array stays a list and one-element arrays survive the round trip.
#'
#' @param path Path to a `.json` study spec.
#' @param x A `dm_study`, a list, JSON text, or a path to a `.json` file.
#' @return `read_study()` and `as_study()` return a `dm_study`.
#' @examples
#' \dontrun{
#' study <- read_study("my-study.json")
#' study
#' write_study(study, "copy.json")
#' }
#' @export
read_study <- function(path) {
  if (!file.exists(path)) stop("No file at ", path, call. = FALSE)
  as_study(read_text(path))
}

#' @rdname read_study
#' @export
as_study <- function(x) {
  if (inherits(x, "dm_study")) return(x)
  if (is.list(x)) return(structure(x, class = c("dm_study", "list")))
  if (is.character(x) && length(x) == 1) {
    if (!grepl("^\\s*[{[]", x) && file.exists(x)) x <- read_text(x)
    spec <- jsonlite::parse_json(x, simplifyVector = FALSE)
    if (!is.list(spec) || is.null(spec[["Study.Metadata"]])) stop("This is not a Data Manual study spec (no Study.Metadata).", call. = FALSE)
    return(structure(spec, class = c("dm_study", "list")))
  }
  stop("Give a study as a list, JSON text, or a path to a .json file.", call. = FALSE)
}

#' @rdname read_study
#' @param spec A study (anything `as_study()` accepts).
#' @param pretty Indent the JSON.
#' @return `study_json()` returns JSON text.
#' @export
study_json <- function(spec, pretty = FALSE) {
  if (is.character(spec) && length(spec) == 1 && !grepl("^\\s*[{[]", spec) && file.exists(spec)) return(read_text(spec))
  if (is.character(spec) && length(spec) == 1) {
    if (!jsonlite::validate(spec)) stop("This text is not valid JSON.", call. = FALSE)
    return(spec)
  }
  as.character(jsonlite::toJSON(unclass(as_study(spec)), auto_unbox = TRUE, null = "null", na = "null", digits = NA, pretty = pretty))
}

#' @rdname read_study
#' @param file Where to write the `.json` file.
#' @export
write_study <- function(spec, file, pretty = TRUE) {
  json <- study_json(spec, pretty = pretty)
  if (!pretty) json <- study_json(as_study(json), pretty = FALSE)
  writeLines(json, file, useBytes = TRUE)
  invisible(file)
}

#' Responses and surveys as data frames
#'
#' @param spec A study (anything [as_study()] accepts).
#' @return `study_responses()`: one row per response with the columns of the spec's `data`
#'   (Participant.ID, Session.ID, Survey.Date.Completed, Question.ID, User.Response, ...).
#'   `study_surveys()`: one row per survey with its number of questions.
#' @export
study_responses <- function(spec) {
  data <- as_study(spec)[["data"]]
  if (is.null(data) || !length(data)) return(data.frame())
  cols <- lapply(data, function(col) {
    vals <- vapply(col, function(v) if (is.null(v) || !length(v)) NA_character_ else paste(as.character(unlist(v)), collapse = ";"), character(1))
    utils::type.convert(vals, as.is = TRUE)
  })
  as.data.frame(cols, check.names = FALSE, stringsAsFactors = FALSE)
}

#' @rdname study_responses
#' @export
study_surveys <- function(spec) {
  surveys <- as_study(spec)[["surveys"]]
  if (!length(surveys)) return(data.frame(survey = character(), name = character(), questions = integer()))
  data.frame(
    survey = vapply(surveys, function(s) s[["Survey.Name"]] %||% NA_character_, character(1)),
    name = vapply(surveys, function(s) s[["Survey.LongName"]] %||% s[["Survey.Name"]] %||% NA_character_, character(1)),
    questions = vapply(surveys, function(s) sum(vapply(s[["questions"]], is_question, logical(1))), integer(1)),
    stringsAsFactors = FALSE
  )
}

#' @export
print.dm_study <- function(x, ...) {
  meta <- x[["Study.Metadata"]]
  s <- study_surveys(x)
  n <- length(x[["data"]][["Question.ID"]])
  cat("<Data Manual study> ", meta[["Study.Name"]] %||% "(untitled)", "\n", sep = "")
  cat(nrow(s), " survey", if (nrow(s) != 1) "s", ", ", sum(s$questions), " questions, ",
      length(x[["schedules"]]), " schedule", if (length(x[["schedules"]]) != 1) "s", ", ",
      format(n, big.mark = ","), " responses\n", sep = "")
  if (nrow(s)) cat(paste0("  ", s$name, " (", s$questions, ")", collapse = "\n"), "\n", sep = "")
  invisible(x)
}

# Same rule as the app (web/src/core/model.ts).
is_question <- function(q) identical(q[["Item.Type"]], "Question") && !identical(q[["Question.Type.Display.Name"]], "End Block")

read_text <- function(path) paste(readLines(path, warn = FALSE, encoding = "UTF-8"), collapse = "\n")

`%||%` <- function(a, b) if (is.null(a)) b else a
