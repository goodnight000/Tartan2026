# CareBase Agent Guide

This guide defines how LLM agents should read/write memory through CareBase.

## Purpose
CareBase stores user-specific memory as natural-language key/value pairs. Agents embed XML tags in their responses; CareBase extracts and executes those commands.

## Command Tags
All commands use XML-like tags with natural-language keys and values.

### Fetch
```xml
<carebase-fetch>data-key</carebase-fetch>
```
Response format:
```xml
<carebase-resp: data-key>data content</carebase-resp>
```
Errors:
```xml
<carebase-resp: data-key>Error: non-existence key</carebase-resp>
<carebase-resp: data-key>Error: permission denied by user</carebase-resp>
```

### Store
```xml
<carebase-store: data-key>data content</carebase-store>
```
Response format:
```xml
<carebase-resp: data-key>Success: stored</carebase-resp>
<carebase-resp: data-key>Error: storage failed</carebase-resp>
```

### Delete
```xml
<carebase-delete>data-key</carebase-delete>
```
Response format:
```xml
<carebase-resp: data-key>Success: deleted</carebase-resp>
<carebase-resp: data-key>Error: non-existence key</carebase-resp>
```

### List
```xml
<carebase-list></carebase-list>
```
Response format:
```xml
<carebase-resp: list>key1, key2, key3, ...</carebase-resp>
```

### Query (Fuzzy Search)
```xml
<carebase-query>search keywords</carebase-query>
```
Response format:
```xml
<carebase-resp: query>matching-key1: data summary, matching-key2: data summary, ...</carebase-resp>
```

## Dataflow Guard
Each record has a `SensitivityLevel`:

- `Ask` (default): requires user confirmation for every access.
- `Allow`: auto-approve access.

Agents should expect `Ask` to trigger a user prompt and handle permission-denied responses gracefully.

## Authoring Guidelines
- Use concise, human-readable keys (e.g., "user height", "allergies").
- Store values as natural language (no embeddings or binary data).
- Avoid storing sensitive data unless it is explicitly provided by the user.
- Only fetch values you need for the current response.

## Examples

### Store and Fetch
```xml
<carebase-store: allergies>Peanuts</carebase-store>
<carebase-fetch>allergies</carebase-fetch>
```

### Delete
```xml
<carebase-delete>old allergy</carebase-delete>
```

### List
```xml
<carebase-list></carebase-list>
```

## Limitations
- If the user denies access, the agent must proceed without the data.
- CareBase ignores malformed tags.
