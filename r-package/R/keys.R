#' Saved API keys
#'
#' The same saved keys as the standalone app: a list in `keys.json` in the key folder
#' (`~/.data-manual`, the folder chosen in the app's Settings, or `DATA_MANUAL_HOME`), with each
#' key kept by the operating system:
#'
#' * Windows: encrypted for your Windows account (DPAPI) inside `keys.json`.
#' * macOS: the login Keychain.
#' * Linux: the Secret Service (`secret-tool`), or an AES-256-GCM file whose key is
#'   `master.key` in the key folder.
#'
#' The app inside Shiny asks the R session for keys by reference only; R fills them into API
#' requests for the key's own server and never sends a key to the browser.
#'
#' @return `dm_keys()`: a data frame of saved keys (no secrets). `dm_key_folder()`: the folder.
#' @examples
#' \dontrun{
#' dm_keys()
#' dm_add_key("redcap", "Sleep study", Sys.getenv("REDCAP_TOKEN"), url = "https://redcap.example.edu/api/")
#' }
#' @export
dm_keys <- function() {
  list <- key_list()
  if (!length(list)) return(data.frame(id = character(), kind = character(), label = character(), hint = character(), created = character()))
  data.frame(
    id = vapply(list, `[[`, "", "id"),
    kind = vapply(list, `[[`, "", "kind"),
    label = vapply(list, `[[`, "", "label"),
    hint = vapply(list, `[[`, "", "hint"),
    created = vapply(list, function(k) k[["created"]] %||% NA_character_, ""),
    stringsAsFactors = FALSE
  )
}

#' @rdname dm_keys
#' @export
dm_key_folder <- function() key_dir()

#' @rdname dm_keys
#' @param kind One of `"wearit"`, `"redcap"`, `"qualtrics"`, `"anthropic"`, `"openai"`.
#' @param label Your name for the key.
#' @param secret The key itself.
#' @param url For REDCap, the project's API URL. For `"openai"`, the provider's base URL.
#' @param datacenter For Qualtrics, the datacenter ID (e.g. `"iad1"`).
#' @export
dm_add_key <- function(kind, label, secret, url = NULL, datacenter = NULL) {
  kind <- match.arg(kind, KEY_KINDS)
  meta <- list()
  if (!is.null(url)) meta[[if (kind == "openai") "baseUrl" else "url"]] <- url
  if (!is.null(datacenter)) meta$datacenter <- datacenter
  entry <- key_save(kind, label, secret, meta)
  entry[c("id", "kind", "label", "hint")]
}

#' @rdname dm_keys
#' @param key A key's id or label.
#' @export
dm_remove_key <- function(key) {
  list <- key_list()
  hit <- Filter(function(k) identical(k$id, key) || identical(tolower(k$label), tolower(key)), list)
  if (!length(hit)) stop("No saved key called ", key, call. = FALSE)
  key_delete(hit[[1]]$id)
  invisible(TRUE)
}

KEY_KINDS <- c("wearit", "redcap", "qualtrics", "anthropic", "openai")
SERVICE <- "data-manual"
.key_cache <- new.env(parent = emptyenv())

# ---- Folder (same rules as web/src/keystore/node.ts)
home_dir <- function() {
  h <- if (.Platform$OS.type == "windows") Sys.getenv("USERPROFILE") else Sys.getenv("HOME")
  if (!nzchar(h)) h <- path.expand("~")
  normalizePath(h, winslash = "\\", mustWork = FALSE)
}
key_dir <- function() {
  env <- Sys.getenv("DATA_MANUAL_HOME")
  if (nzchar(env)) return(env)
  default <- normalizePath(file.path(home_dir(), ".data-manual"), winslash = "\\", mustWork = FALSE)
  pointer <- file.path(default, "location.json")
  if (file.exists(pointer)) {
    dir <- tryCatch(jsonlite::read_json(pointer)$dir, error = function(e) NULL)
    if (is.character(dir) && length(dir) == 1 && nzchar(dir)) return(dir)
  }
  default
}
key_folder_info <- function() {
  list(folder = key_dir(), source = if (nzchar(Sys.getenv("DATA_MANUAL_HOME"))) "env" else "host")
}
storage_name <- function() {
  if (.Platform$OS.type == "windows") "Windows (encrypted for your user account)"
  else if (Sys.info()[["sysname"]] == "Darwin") "macOS Keychain"
  else "your system keyring"
}

key_list <- function() {
  f <- file.path(key_dir(), "keys.json")
  if (!file.exists(f)) return(list())
  tryCatch(jsonlite::read_json(f, simplifyVector = FALSE), error = function(e) list())
}
write_key_list <- function(list) {
  dir <- key_dir()
  if (!dir.exists(dir)) dir.create(dir, recursive = TRUE, mode = "0700")
  json <- jsonlite::toJSON(lapply(list, function(k) { if (!length(k$meta)) k$meta <- structure(list(), names = character()); k }), auto_unbox = TRUE, pretty = TRUE, null = "null")
  writeLines(json, file.path(dir, "keys.json"), useBytes = TRUE)
  Sys.chmod(file.path(dir, "keys.json"), "0600")
}
public_entry <- function(k) {
  k$method <- NULL
  k$blob <- NULL
  if (!length(k$meta)) k$meta <- structure(list(), names = character())
  k
}
key_hint <- function(s) if (nchar(s) > 8) paste0(substr(s, 1, 3), "…", substr(s, nchar(s) - 3, nchar(s))) else "••••"

# ---- OS commands, with secrets passed on stdin (never on the command line)
run_cmd <- function(cmd, args, input = NULL) {
  p <- processx::process$new(cmd, args, stdin = if (is.null(input)) NULL else "|", stdout = "|", stderr = "|", windows_hide_window = TRUE)
  if (!is.null(input)) {
    p$write_input(input)
    close(p$get_input_connection())
  }
  out <- p$read_all_output()
  err <- p$read_all_error()
  p$wait()
  if (p$get_exit_status() != 0) stop(trimws(err) %||% paste(cmd, "failed"), call. = FALSE)
  out
}
PS <- c("-NoProfile", "-NonInteractive", "-Command")
has_secret_tool <- function() nzchar(Sys.which("secret-tool"))

key_save <- function(kind, label, secret, meta = list()) {
  secret <- trimws(secret)
  if (!nzchar(secret)) stop("The key is empty.", call. = FALSE)
  id <- uuid()
  blob <- NULL
  sys <- Sys.info()[["sysname"]]
  if (.Platform$OS.type == "windows") {
    method <- "dpapi"
    blob <- trimws(run_cmd("powershell.exe", c(PS, "$s = [Console]::In.ReadToEnd(); ConvertTo-SecureString -String $s -AsPlainText -Force | ConvertFrom-SecureString"), secret))
  } else if (sys == "Darwin") {
    method <- "keychain"
    run_cmd("security", c("add-generic-password", "-U", "-s", SERVICE, "-a", id, "-l", paste0("Data Manual: ", label), "-w", secret))
  } else if (has_secret_tool()) {
    method <- "libsecret"
    run_cmd("secret-tool", c("store", paste0("--label=Data Manual: ", label), "service", SERVICE, "id", id), secret)
  } else {
    method <- "file"
    blob <- file_encrypt(secret)
  }
  entry <- list(id = id, kind = kind, label = if (nzchar(trimws(label))) trimws(label) else kind, meta = meta,
                hint = key_hint(secret), created = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3Z", tz = "UTC"), method = method)
  if (!is.null(blob)) entry$blob <- blob
  write_key_list(c(key_list(), list(entry)))
  assign(id, secret, envir = .key_cache)
  public_entry(entry)
}

key_delete <- function(id) {
  list <- key_list()
  e <- Filter(function(k) identical(k$id, id), list)
  if (!length(e)) return(invisible(FALSE))
  e <- e[[1]]
  if (identical(e$method, "keychain")) try(run_cmd("security", c("delete-generic-password", "-s", SERVICE, "-a", id)), silent = TRUE)
  if (identical(e$method, "libsecret")) try(run_cmd("secret-tool", c("clear", "service", SERVICE, "id", id)), silent = TRUE)
  write_key_list(Filter(function(k) !identical(k$id, id), list))
  if (exists(id, envir = .key_cache, inherits = FALSE)) rm(list = id, envir = .key_cache)
  invisible(TRUE)
}

key_secret <- function(id) {
  if (exists(id, envir = .key_cache, inherits = FALSE)) return(get(id, envir = .key_cache))
  e <- Filter(function(k) identical(k$id, id), key_list())
  if (!length(e)) stop("That saved key no longer exists.", call. = FALSE)
  e <- e[[1]]
  secret <- switch(e$method,
    dpapi = sub("\r?\n$", "", run_cmd("powershell.exe", c(PS, "$b = [Console]::In.ReadToEnd().Trim(); $s = ConvertTo-SecureString -String $b; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"), e$blob)),
    keychain = sub("\n$", "", run_cmd("security", c("find-generic-password", "-s", SERVICE, "-a", id, "-w"))),
    libsecret = run_cmd("secret-tool", c("lookup", "service", SERVICE, "id", id)),
    file = file_decrypt(e$blob),
    stop("Unknown key storage method.", call. = FALSE)
  )
  assign(id, secret, envir = .key_cache)
  secret
}

# ---- File fallback: AES-256-GCM, "iv.tag.data" in base64, same as the Node key store.
master_key <- function() {
  if (!requireNamespace("openssl", quietly = TRUE)) stop("Install the openssl package to use keys saved in the encrypted-file store.", call. = FALSE)
  f <- file.path(key_dir(), "master.key")
  if (!file.exists(f)) {
    dir.create(key_dir(), recursive = TRUE, showWarnings = FALSE, mode = "0700")
    writeLines(jsonlite::base64_enc(openssl::rand_bytes(32)), f)
    Sys.chmod(f, "0600")
  }
  jsonlite::base64_dec(trimws(read_text(f)))
}
# R's openssl package doesn't expose the GCM authentication tag, so R reads these keys (GCM is
# counter mode starting at IV || 00000002) but leaves saving them to the app.
file_encrypt <- function(secret) {
  stop("Saving keys on this computer needs the system keyring (secret-tool). Save the key in the standalone app instead, or install libsecret-tools.", call. = FALSE)
}
file_decrypt <- function(blob) {
  parts <- lapply(strsplit(blob, ".", fixed = TRUE)[[1]], jsonlite::base64_dec)
  counter <- c(parts[[1]], as.raw(c(0, 0, 0, 2)))
  rawToChar(openssl::aes_ctr_decrypt(parts[[3]], master_key(), counter))
}

uuid <- function() {
  b <- as.integer(sample.int(256, 16, replace = TRUE) - 1L)
  if (requireNamespace("openssl", quietly = TRUE)) b <- as.integer(openssl::rand_bytes(16))
  b[7] <- bitwOr(bitwAnd(b[7], 0x0f), 0x40)
  b[9] <- bitwOr(bitwAnd(b[9], 0x3f), 0x80)
  h <- sprintf("%02x", b)
  paste(paste(h[1:4], collapse = ""), paste(h[5:6], collapse = ""), paste(h[7:8], collapse = ""), paste(h[9:10], collapse = ""), paste(h[11:16], collapse = ""), sep = "-")
}

# ---- Where a key may be sent (same rules as web/src/keystore/types.ts)
url_host <- function(u) tryCatch(tolower(curl::curl_parse_url(u)$host %||% ""), error = function(e) "")
key_allowed_for <- function(entry, target) {
  host <- url_host(target)
  switch(entry$kind,
    wearit = host == "wearables.vmhost.psu.edu",
    qualtrics = endsWith(host, ".qualtrics.com"),
    redcap = !is.null(entry$meta$url) && url_host(entry$meta$url) == host,
    anthropic = host == "api.anthropic.com",
    openai = !is.null(entry$meta$baseUrl) && url_host(entry$meta$baseUrl) == host,
    FALSE
  )
}

VAULT_RE <- "vault(:|%3A|%3a)([0-9a-fA-F-]{36})"

# Replace every vault:<id> in `text` with its secret, checking each key may go to `target`.
fill_secrets <- function(text, target) {
  if (!length(text) || is.na(text) || !grepl(VAULT_RE, text)) return(text)
  hits <- regmatches(text, gregexpr(VAULT_RE, text))[[1]]
  keys <- key_list()
  for (m in unique(hits)) {
    id <- tolower(sub(VAULT_RE, "\\2", m))
    e <- Filter(function(k) identical(tolower(k$id), id), keys)
    if (!length(e)) stop("A saved key used by this request no longer exists. Pick another key.", call. = FALSE)
    if (!key_allowed_for(e[[1]], target)) stop(sprintf("The saved key \"%s\" belongs to a different server than %s.", e[[1]]$label, url_host(target)), call. = FALSE)
    s <- key_secret(e[[1]]$id)
    text <- gsub(m, if (grepl(":", m, fixed = TRUE)) s else utils::URLencode(s, reserved = TRUE), text, fixed = TRUE)
  }
  text
}
