# emRequest: REST and GraphQL API Client for VS Code, Cursor and Antigravity

A fast, lightweight REST and GraphQL API client that lives in your editor. Built by [Emvigo Technologies](https://www.emvigotech.com).

Test APIs without switching to another app. Send a request, see the response, save it, and reuse it with different environments.

## Features

- **Request builder**: method, URL, query params (kept in sync with the URL), headers, body (JSON, XML, text, form).
- **Auth**: Bearer token, Basic auth, API key (in a header or query).
- **Response viewer**: status, time, size, highlighted JSON, response headers. Copy it, or open it in an editor tab.
- **Collections**: save requests into named collections. Rename or delete them with the pencil or bin icons, right-click, or **F2**.
- **History**: every request you send is logged. Click one to open it again.
- **Environments**: variables like `{{baseUrl}}` and `{{token}}` work anywhere in a request. Switch environments from the sidebar or the request tab.
- **cURL**: paste a cURL command to import it (it reads your clipboard), or copy any request as cURL.
- **GraphQL**: pick **GraphQL** in the Body tab to get a query editor and a variables box. Works with any GraphQL endpoint.
  - **Schema**: click **Fetch schema** (it uses the request's own headers and auth), or **Load file** for a `.graphql` or introspection `.json` file. The schema is saved per endpoint.
  - **Autocomplete and checking**: field suggestions while you type, and unknown fields are underlined.
  - **Schema tab**: browse types and fields with their descriptions, search, and click **+** to add a field to the query.
  - **Errors**: GraphQL errors are shown in red even when the server answers 200 OK.
  - **More**: an operation picker when the query has several operations, a **Format** button, GET or POST, `{{env}}` variables inside the query and variables, and cURL import/export.

## Install

| Editor | How |
|---|---|
| **VS Code** | Extensions view → search **emRequest** (VS Code Marketplace) |
| **Cursor** | Extensions view → search **emRequest** (comes from Open VSX) |
| **Antigravity** | Extensions view → search **emRequest** (comes from Open VSX) |
| **Windsurf / VSCodium** | Extensions view → search **emRequest** (Open VSX) |
| **Any of them, from a file** | Extensions → `…` → **Install from VSIX…**, or run `cursor --install-extension emrequest.vsix` (use `code` or `antigravity` for those editors) |

Works with any editor based on VS Code 1.85 or newer.

## Getting started

1. Click the **emRequest** icon in the Activity Bar.
2. Click **+** (New Request), type a URL, and press **Send**.
3. Press **Ctrl/Cmd+S** to save it into a collection.

Shortcuts inside a request tab: **Ctrl/Cmd+Enter** sends, **Ctrl/Cmd+S** saves.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `emrequest.timeoutMs` | 30000 | Request timeout (ms) |
| `emrequest.historyLimit` | 100 | How many history entries to keep |
| `emrequest.followRedirects` | true | Follow 3xx redirects |
| `emrequest.rejectUnauthorized` | true | Set to `false` for self-signed local HTTPS |

## Privacy

Your collections, history and environments are stored only in VS Code's local storage on your machine. emRequest collects no telemetry. The only network traffic is the requests you send.

## Feedback

Found a bug or want a feature? Open an issue on the project repository.
