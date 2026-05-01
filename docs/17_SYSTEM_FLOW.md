# AIR4 System Flow

This describes how information moves through AIR4.

1. Event Input
User writes a message.

2. Observer Parsing
System extracts metadata and domain.

3. Event Storage
Event saved with timestamp and metadata.

4. Embedding Generation
Vector created for semantic search.

5. Time Layer Aggregation
Events → Daily → Weekly → Monthly summaries.

6. Meaning Engine
Detects patterns and creates hypotheses.

7. Observation Engine
Decides if AIR4 should produce insight.

8. Chat Reasoning
Context assembled from events and meanings.

9. Agent Execution
Specialized tools run when needed.