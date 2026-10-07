# Changelog

## 0.3.1
- Added the source repository link: https://github.com/muhassin-emvigo/emrequest

## 0.3.0
- **GraphQL support**: a GraphQL body type with a query editor (highlighting, autocomplete, error underline, Format) and a JSON variables box.
- Fetch the schema from the endpoint (using the request's own headers and auth), or load a `.graphql` / `.json` schema file. Schemas are saved per endpoint.
- New **Schema** tab: browse and search types and fields, and click **+** to add a field to the query.
- GraphQL errors are highlighted even when the status is 200 OK.
- Operation picker for queries with several operations; GraphQL over GET or POST.
- cURL import recognises GraphQL requests; copy as cURL works for them too.
- The GraphQL editor loads only when you pick GraphQL, so REST-only use stays light.

## 0.2.1
- Made compatible with Cursor and Antigravity (and Windsurf / VSCodium). The code uses only the VS Code 1.85 API, so it runs on any editor built on VS Code 1.85 or newer.
- Added install scripts that put emRequest into every supported editor on the machine.

## 0.2.0
- Renamed to **emRequest** by Emvigo.
- Marketplace icon and listing details.

## 0.1.1
- Rename saved requests and collections (pencil icon, right-click, or F2).

## 0.1.0
- First version: request builder, auth, response viewer, collections, history, environments, cURL import/export.
