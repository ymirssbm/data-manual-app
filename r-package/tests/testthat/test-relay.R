fake_req <- function(route, method = "GET", headers = list(), body = NULL) {
  req <- new.env()
  req$QUERY_STRING <- paste0("?w=&nonce=x&route=", utils::URLencode(route, reserved = TRUE))
  req$REQUEST_METHOD <- method
  req$HTTP_X_DATA_MANUAL <- "1"
  for (h in names(headers)) assign(h, headers[[h]], envir = req)
  raw <- if (is.null(body)) raw(0) else charToRaw(body)
  pos <- 0
  req$rook.input <- list(read = function() raw, rewind = function() invisible(NULL))
  req
}
body_of <- function(res) jsonlite::parse_json(if (is.raw(res$content)) rawToChar(res$content) else res$content)

with_key_home <- function(code) {
  dir <- tempfile("dm-r-keys-")
  old <- Sys.getenv("DATA_MANUAL_HOME", NA)
  Sys.setenv(DATA_MANUAL_HOME = dir)
  on.exit({
    for (id in dm_keys()$id) datamanual:::key_delete(id)
    if (is.na(old)) Sys.unsetenv("DATA_MANUAL_HOME") else Sys.setenv(DATA_MANUAL_HOME = old)
    unlink(dir, recursive = TRUE)
  })
  force(code)
}

test_that("requests without the app header are refused", {
  req <- fake_req("/keys")
  req$HTTP_X_DATA_MANUAL <- NULL
  expect_equal(datamanual:::relay_handler(NULL, req)$status, 403)
})

test_that("keys saved through the relay are stored encrypted and filled only for their server", {
  skip_on_cran()
  with_key_home({
    secret <- "r-test-token-ABCDEF123456"
    res <- datamanual:::relay_handler(NULL, fake_req("/keys", "POST", body = jsonlite::toJSON(list(kind = "redcap", label = "Sleep", secret = secret, meta = list(url = "https://redcap.example.edu/api/")), auto_unbox = TRUE)))
    expect_equal(res$status, 200)
    k <- body_of(res)
    expect_null(k$blob)
    expect_false(grepl(secret, datamanual:::read_text(file.path(dm_key_folder(), "keys.json")), fixed = TRUE))

    listed <- body_of(datamanual:::relay_handler(NULL, fake_req("/keys")))
    expect_equal(listed$keys[[1]]$label, "Sleep")
    expect_equal(listed$source, "env")

    rm(list = ls(datamanual:::.key_cache), envir = datamanual:::.key_cache)
    ref <- paste0("token=vault%3A", k$id, "&content=metadata")
    expect_equal(datamanual:::fill_secrets(ref, "https://redcap.example.edu/api/"), paste0("token=", secret, "&content=metadata"))
    expect_error(datamanual:::fill_secrets(ref, "https://evil.example.com/api/"), "different server")

    expect_equal(datamanual:::relay_handler(NULL, fake_req(paste0("/keys/", k$id), "DELETE"))$status, 200)
    expect_equal(nrow(dm_keys()), 0)
  })
})

test_that("the relay only forwards known API URLs", {
  allowed <- datamanual:::relay_allowed
  expect_true(allowed("https://redcap.example.edu/api/", "POST"))
  expect_true(allowed("https://iad1.qualtrics.com/API/v3/surveys", "GET"))
  expect_true(allowed("https://wearables.vmhost.psu.edu/wearables-survey/api/getData/abc?api_token=x", "GET"))
  expect_true(allowed("https://api.anthropic.com/v1/messages", "POST"))
  expect_false(allowed("http://redcap.example.edu/api/", "POST"))
  expect_false(allowed("https://example.com/other", "POST"))
  expect_false(allowed("https://redcap.example.edu/api/", "GET"))
  res <- datamanual:::relay_handler(NULL, fake_req("/proxy/http", "POST", headers = list(HTTP_X_TARGET_URL = "https://example.com/steal")))
  expect_equal(res$status, 403)
})

test_that("the file store reads keys written by the app's Node key store", {
  skip_if_not_installed("openssl")
  node <- Sys.which("node")
  skip_if(!nzchar(node), "node not on PATH")
  with_key_home({
    dir.create(dm_key_folder(), recursive = TRUE)
    key <- openssl::rand_bytes(32)
    writeLines(jsonlite::base64_enc(key), file.path(dm_key_folder(), "master.key"))
    js <- "const c=require('crypto');const k=Buffer.from(process.argv[1],'base64');const iv=c.randomBytes(12);const x=c.createCipheriv('aes-256-gcm',k,iv);const d=Buffer.concat([x.update('hello-secret-123','utf8'),x.final()]);console.log([iv,x.getAuthTag(),d].map(b=>b.toString('base64')).join('.'))"
    blob <- system2(node, c("-e", shQuote(js), jsonlite::base64_enc(key)), stdout = TRUE)
    expect_equal(datamanual:::file_decrypt(blob), "hello-secret-123")
  })
})
