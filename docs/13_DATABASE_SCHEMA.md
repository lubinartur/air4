# Database Schema (MVP)

AIR4 uses a simple relational schema + vector embeddings.

## Tables

### events
id (uuid)
timestamp (datetime)
original_text (text)
processed_text (text)
metadata (jsonb)
embedding_id (uuid)

### embeddings
id (uuid)
vector (array)
event_id (uuid)

### meanings
id (uuid)
created_at
hypothesis_text
status (hypothesis | confirmed | rejected)
related_event_ids (array)

### objects
id
type (project | habit | goal | person)
name
metadata

## Notes

- Events are append-only.
- Metadata stores flexible domain information.
- Embeddings enable semantic search.