# Privacy and security

## Where data goes

- **Your files stay on your computer.** The app runs in your browser. Studies and datasets you open are read locally; nothing is uploaded to a Data Manual server (there isn't one).
- **API pulls** (Wear-IT, REDCap, Qualtrics) go from the app's local server straight to the platform. The local server only relays requests to those platforms' API addresses, and only forwards authentication and content headers.
- **The last loaded study** is kept in this browser's storage so it survives a refresh. Clearing site data removes it.

## API keys

Keys (Wear-IT, REDCap and Qualtrics tokens, AI provider keys) are **saved in your computer's own secure storage, never in the browser**:

| Computer | Where saved keys live |
| --- | --- |
| Windows | Encrypted with Windows Data Protection (DPAPI) for your user account |
| macOS | Your login Keychain |
| Linux | The system keyring (Secret Service); if none is installed, an AES-256-GCM encrypted file whose key only your user can read |

How it works:

- Wherever a key is needed, pick a saved key from the list. To add one, give it a name and paste it **once** (or load it from a text file); after that you only ever pick it by name.
- The app's local server keeps the keys. The browser only knows each key's name and a reference to it; the server puts the real key into the request on its way out.
- A saved key is only ever sent to **its own server**: a REDCap key to the REDCap address it was saved with, a Qualtrics key to Qualtrics, a Claude key to the Anthropic API. The server refuses to put it in a request to anywhere else.
- Other websites can't use your saved keys through the local server: key requests must come from the app itself.
- **Use once without saving** is still available: the key stays in memory for this tab and is never written anywhere.
- Delete saved keys in **Settings → Saved API keys**. `~/.data-manual/keys.json` lists their names and masked hints; it never holds a key in plain text.
- The key folder is `~/.data-manual` (on Windows, `C:\Users\<you>\.data-manual`). **Settings → Saved API keys → Change folder…** moves it, for example to an encrypted drive, and saved keys move with it. The `DATA_MANUAL_HOME` environment variable overrides both. On Windows the encrypted keys are in this folder and only open for your Windows account; on macOS and Linux the folder holds only the list, and the keys stay in the Keychain or keyring.
- When the app runs without its local server (a static website), keys can't be saved and are forgotten when the tab closes.
- Earlier versions could keep tokens in browser storage. The app moves any it finds into secure storage automatically and removes them from the browser.
- The MCP server uses the same saved keys (or environment variables), so keys never appear in an AI conversation.

## Codebooks and exports

- Codebooks and the data dictionary describe variables and report **aggregates only**: counts, percentages, means, response rates. They never list individual responses or link a value to a participant (outlier plots show anonymous points; there is no outlier table).
- The "Response rate by participant" chart labels bars with participant IDs. If IDs themselves are sensitive, switch off "Missingness Plots" in the codebook options.
- The **study spec** and **response CSV** exports contain response data. Treat them like the raw data.

## AI features

- The in-app AI Study Generator sends the **study design** (questions, skip logic, schedule) to the provider you choose, using your own API key. **Response data is never sent.**
- MCP tools return designs, summaries and aggregate statistics, never response rows. `describe_variable` gives frequencies and summary statistics only.
- In public MCP mode (`--public`), anyone with the link can call the tools while the server runs, and `pull_data` is disabled. Use it only with folders you're comfortable exposing, and stop the server afterwards.

Check your IRB protocol and data use agreements before sending study materials to third-party AI services.
