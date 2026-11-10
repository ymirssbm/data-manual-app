# The app's "local server" inside Shiny: saved keys and the API relay, answered by this R session
# at one session-scoped URL (session$registerDataObj). Mirrors web/src/server/relay.ts.
#
# Only this session's page knows the URL, every request must carry "x-data-manual: 1", and keys
# are only filled into requests for their own server, so another page can't use them.

dm_relay_url <- function(session) {
  session$registerDataObj("datamanual_relay", NULL, relay_handler)
}

relay_handler <- function(data, req) {
  route <- query_param(req$QUERY_STRING, "route")
  method <- req$REQUEST_METHOD
  if (!identical(req$HTTP_X_DATA_MANUAL, "1")) return(json_response(403, error = "Not allowed."))
  tryCatch({
    if (identical(route, "/keys") && method == "GET") {
      return(json_response(200, body = c(list(storage = storage_name()), key_folder_info(), list(keys = lapply(key_list(), public_entry)))))
    }
    if (identical(route, "/keys") && method == "POST") {
      k <- jsonlite::parse_json(read_body(req), simplifyVector = FALSE)
      if (!isTRUE(k$kind %in% KEY_KINDS) || !is.character(k$secret)) return(json_response(400, error = "Invalid key."))
      return(json_response(200, body = key_save(k$kind, k$label %||% "", k$secret, k$meta %||% list())))
    }
    if (startsWith(route %||% "", "/keys/") && method == "DELETE") {
      key_delete(utils::URLdecode(sub("^/keys/", "", route)))
      return(json_response(200, body = list(ok = TRUE)))
    }
    if (identical(route, "/keys/open-folder") && method == "POST") {
      dir <- key_dir()
      if (!dir.exists(dir)) dir.create(dir, recursive = TRUE, mode = "0700")
      if (.Platform$OS.type == "windows") shell.exec(dir) else system2(if (Sys.info()[["sysname"]] == "Darwin") "open" else "xdg-open", shQuote(dir), wait = FALSE)
      return(json_response(200, body = list(ok = TRUE)))
    }
    if (identical(route, "/keys/folder")) {
      return(json_response(400, error = "Inside R the key folder is fixed for this session. Change it in the standalone app's Settings, or set DATA_MANUAL_HOME before starting R."))
    }
    if (route %in% c("/proxy/http", "/proxy/ai")) return(relay_http(req, method))
    json_response(404, error = "Unknown route.")
  }, error = function(e) json_response(502, error = conditionMessage(e)))
}

# Which URLs the relay forwards: REDCap /api/, Qualtrics /API/v3/, chat completions, the
# Anthropic /v1/ API, and Wear-IT getData. Always https.
relay_allowed <- function(url, method) {
  p <- tryCatch(curl::curl_parse_url(url), error = function(e) NULL)
  if (is.null(p) || !identical(tolower(p$scheme), "https")) return(FALSE)
  host <- tolower(p$host)
  path <- p$path %||% "/"
  if (endsWith(host, ".qualtrics.com") && startsWith(path, "/API/v3/")) return(method %in% c("GET", "POST"))
  if (host == "wearables.vmhost.psu.edu" && grepl("^/[^/]+/api/getData/", path)) return(method == "GET")
  if (method != "POST") return(FALSE)
  if (host == "api.anthropic.com") return(startsWith(path, "/v1/"))
  grepl("/api/?$", path, ignore.case = TRUE) || endsWith(path, "/chat/completions")
}

FORWARD_HEADERS <- c("authorization", "api-key", "x-api-token", "x-api-key", "content-type", "accept", "anthropic-version", "anthropic-beta")

relay_http <- function(req, method) {
  target <- req$HTTP_X_TARGET_URL
  if (is.null(target) || !nzchar(target)) return(json_response(400, error = "Missing x-target-url"))
  if (!relay_allowed(target, method)) return(json_response(403, error = "This URL is not one the relay forwards (REDCap /api/, Qualtrics /API/v3/, Wear-IT getData, the Anthropic API, or /chat/completions over https)."))
  headers <- list()
  for (h in FORWARD_HEADERS) {
    v <- if (h == "content-type") req$CONTENT_TYPE else req[[paste0("HTTP_", toupper(gsub("-", "_", h)))]]
    if (!is.null(v) && nzchar(v)) headers[[h]] <- fill_secrets(v, target)
  }
  body <- if (method == "POST") fill_secrets(read_body(req), target) else NULL
  url <- fill_secrets(target, target)
  h <- curl::new_handle()
  curl::handle_setopt(h, customrequest = method, followlocation = FALSE)
  if (!is.null(body)) curl::handle_setopt(h, copypostfields = body)
  if (length(headers)) curl::handle_setheaders(h, .list = headers)
  res <- tryCatch(curl::curl_fetch_memory(url, handle = h), error = function(e) stop("Could not reach ", url_host(target), ": ", conditionMessage(e), call. = FALSE))
  type <- curl::parse_headers_list(res$headers)[["content-type"]] %||% "application/octet-stream"
  shiny::httpResponse(res$status_code, content_type = type, content = res$content, headers = list(`Cache-Control` = "no-store"))
}

read_body <- function(req) {
  input <- req$rook.input
  if (is.null(input)) return("")
  input$rewind()
  raw <- input$read()
  if (!length(raw)) "" else rawToChar(raw)
}

query_param <- function(qs, name) {
  if (is.null(qs) || !nzchar(qs)) return(NULL)
  parts <- strsplit(sub("^\\?", "", qs), "&", fixed = TRUE)[[1]]
  for (p in parts) {
    kv <- strsplit(p, "=", fixed = TRUE)[[1]]
    if (identical(utils::URLdecode(kv[1]), name)) return(utils::URLdecode(paste(kv[-1], collapse = "=")))
  }
  NULL
}

json_response <- function(status, body = NULL, error = NULL) {
  if (!is.null(error)) body <- list(error = list(message = error))
  shiny::httpResponse(status, content_type = "application/json", content = as.character(jsonlite::toJSON(body, auto_unbox = TRUE, null = "null")), headers = list(`Cache-Control` = "no-store"))
}
