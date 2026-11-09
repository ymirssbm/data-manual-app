# Privacy and security

## Where data goes

- **Your files stay on your computer.** The app runs in your browser. Studies and datasets you open are read locally; nothing is uploaded to a Data Manual server (there isn't one).
- **API pulls** (Wear-IT, REDCap, Qualtrics) go from the app's local server straight to the platform. The local server only relays requests to those platforms' API addresses, and only forwards authentication and content headers.
- **The last loaded study** is kept in this browser's storage so it survives a refresh. Clearing site data removes it.

## API tokens

- Tokens are sent only to the platform they belong to.
- For saved REDCap projects and Qualtrics connections you choose: **remember on this computer** (browser local storage) or **forget when the tab closes** (session storage). Saved tokens are shown masked.
- The MCP server reads tokens from environment variables, so they never appear in an AI conversation.

## Codebooks and exports

- Codebooks and the data dictionary describe variables and report **aggregates only**: counts, percentages, means, response rates. They never list individual responses or link a value to a participant (outlier plots show anonymous points; there is no outlier table).
- The "Response rate by participant" chart labels bars with participant IDs. If IDs themselves are sensitive, switch off "Missingness Plots" in the codebook options.
- The **study spec** and **response CSV** exports contain response data. Treat them like the raw data.

## AI features

- The in-app AI Study Generator sends the **study design** (questions, skip logic, schedule) to the provider you choose, using your own API key. **Response data is never sent.**
- MCP tools return designs, summaries and aggregate statistics, never response rows. `describe_variable` gives frequencies and summary statistics only.
- In public MCP mode (`--public`), anyone with the link can call the tools while the server runs, and `pull_data` is disabled. Use it only with folders you're comfortable exposing, and stop the server afterwards.

Check your IRB protocol and data use agreements before sending study materials to third-party AI services.
