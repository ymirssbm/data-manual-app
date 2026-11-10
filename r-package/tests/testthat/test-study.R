tiny <- '{"Study.Metadata":{"Study.Name":"Tiny"},"schedules":[],"surveys":[{"Survey.Name":"s1","questions":[
  {"Item.ID":"q1","Question.ID":"q1","Item.Type":"Question","Question.Text":"Mood?","Question.Type.Display.Name":"Slider","Data.Type":"integer","Parent":[]}]}],
  "data":{"Participant.ID":["p1"],"Session.ID":["a"],"Survey.Date.Completed":["2026-01-05T09:00:00Z"],"Question.ID":["q1"],"User.Response":["7"]}}'

test_that("one-element arrays survive a round trip", {
  s <- as_study(tiny)
  expect_s3_class(s, "dm_study")
  back <- jsonlite::parse_json(study_json(s))
  expect_type(back$data$Participant.ID, "list")
  expect_length(back$data$Participant.ID, 1)
  expect_type(back$surveys[[1]]$questions[[1]]$Parent, "list")
  expect_equal(back$Study.Metadata$Study.Name, "Tiny")
})

test_that("read and write a study file", {
  f <- tempfile(fileext = ".json")
  write_study(tiny, f)
  s <- read_study(f)
  expect_equal(study_surveys(s)$questions, 1L)
  r <- study_responses(s)
  expect_equal(nrow(r), 1)
  expect_equal(r$User.Response, 7L)
  expect_output(print(s), "Tiny")
})

test_that("the example study reads", {
  ex <- testthat::test_path("..", "..", "..", "examples", "branching-ema-study.json")
  skip_if_not(file.exists(ex))
  s <- read_study(ex)
  expect_equal(nrow(study_surveys(s)), 3)
  expect_equal(sum(study_surveys(s)$questions), 33)
})

test_that("the input handler parses the app's JSON", {
  handler <- shiny:::inputHandlers$get("datamanual.spec")
  s <- handler(tiny, NULL, "dm_spec")
  expect_s3_class(s, "dm_study")
  expect_null(handler(NULL, NULL, "dm_spec"))
})

test_that("the widget carries the study as JSON text", {
  w <- dataManual(tiny)
  expect_s3_class(w, "htmlwidget")
  expect_true(jsonlite::validate(w$x$spec_json))
  expect_null(w$x$relay)
})
