# Writes the SPSS, SAS and Stata test files in this folder with haven (ReadStat).
# Run from this folder: Rscript make.R
library(haven)

df <- data.frame(
  id = c("P1", "P2", "P3", "P4", "P5"),
  mood = labelled(c(1, 5, NA, 3, 2), c(Low = 1, Neutral = 3, High = 5), label = "How is your mood right now?"),
  stress = c(12.5, 80, 47.25, NA, 0.1),
  when = as.POSIXct(c("2026-02-02 09:15:00", "2026-02-02 20:05:30", "2026-02-03 09:00:00", "2026-02-03 21:45:00", "2026-02-04 08:30:00"), tz = "UTC"),
  day = as.Date(c("2026-02-02", "2026-02-02", "2026-02-03", "2026-02-03", "2026-02-04")),
  note = c("fine", "café later", "", "long day at work", "ok"),
  stringsAsFactors = FALSE
)
attr(df$stress, "label") <- "How stressed are you?"
attr(df$note, "label") <- "Anything else?"

write_sav(df, "study.sav", compress = "byte")
write_sav(df, "study-plain.sav", compress = "none")
write_sav(df, "study.zsav", compress = "zsav")
write_xpt(df, "study-v5.xpt", version = 5, name = "study")
write_xpt(df, "study-v8.xpt", version = 8, name = "study")
write_sas(df, "study.sas7bdat")
write_dta(df, "study-14.dta", version = 14)
write_dta(df, "study-13.dta", version = 13)
write_dta(df, "study-12.dta", version = 12)
