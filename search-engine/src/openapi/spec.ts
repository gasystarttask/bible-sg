export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Bible Search Engine API",
    version: "1.0.0",
    description:
      "API documentation for semantic search, hybrid retrieval, grounded answer generation, chat streaming, and verse preview.",
  },
  servers: [
    {
      url: "http://localhost:3000",
      description: "Local development server",
    },
  ],
  tags: [
    { name: "Search" },
    { name: "Hybrid" },
    { name: "Answer" },
    { name: "Chat" },
    { name: "Verse" },
  ],
  paths: {
    "/api/search": {
      post: {
        tags: ["Search"],
        summary: "Semantic verse search",
        description: "Runs vector similarity search over verse embeddings.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SearchRequest" },
              examples: {
                basic: {
                  value: {
                    query: "faith and perseverance",
                    k: 5,
                    minScore: 0.6,
                    filters: { testament: "New", book: "Hebrews" },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Search results",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SearchResponse" },
              },
            },
          },
          "400": {
            description: "Invalid request",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "500": {
            description: "Internal error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/hybrid-search": {
      post: {
        tags: ["Hybrid"],
        summary: "Hybrid search",
        description: "Combines vector retrieval and graph retrieval with routing.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/HybridSearchRequest" },
              examples: {
                genealogy: {
                  value: {
                    query: "Who is the son of Joseph?",
                    k: 8,
                    vectorWeight: 0.2,
                    graphWeight: 0.8,
                    minScore: 0,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Hybrid search results",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HybridSearchResponse" },
              },
            },
          },
          "400": {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "429": {
            description: "Rate limited",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "500": {
            description: "Internal error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/grounded-answer": {
      post: {
        tags: ["Answer"],
        summary: "Generate grounded answer",
        description:
          "Generates an answer grounded in retrieved verses and entity facts. Supports JSON or SSE stream output.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/GroundedAnswerRequest" },
              examples: {
                jsonMode: {
                  value: {
                    query: "What does Romans say about faith?",
                    stream: false,
                    k: 6,
                    vectorWeight: 0.7,
                    graphWeight: 0.3,
                  },
                },
                streamMode: {
                  value: {
                    query: "Who are the relatives of Jacob?",
                    stream: true,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Grounded answer",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GroundedAnswerResponse" },
              },
              "text/event-stream": {
                schema: {
                  type: "string",
                  description: "SSE events: status, token, replace, metadata, done, error",
                },
              },
            },
          },
          "400": {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "429": {
            description: "Rate limited",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "500": {
            description: "Internal error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/chat": {
      post: {
        tags: ["Chat"],
        summary: "Chat completion stream",
        description:
          "Generates grounded chat output from user messages. Response is usually UI stream/SSE.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ChatRequest" },
              examples: {
                ask: {
                  value: {
                    messages: [
                      { role: "user", content: "Who is Abraham?" },
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Chat output stream",
            content: {
              "text/event-stream": {
                schema: { type: "string" },
              },
              "text/plain": {
                schema: { type: "string" },
              },
            },
          },
          "400": {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "429": {
            description: "Rate limited",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "500": {
            description: "Internal error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/verse-preview": {
      get: {
        tags: ["Verse"],
        summary: "Resolve verse preview",
        description: "Looks up verse text by reference or ID.",
        parameters: [
          {
            name: "reference",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Verse reference such as 'Genesis 12:1'",
          },
        ],
        responses: {
          "200": {
            description: "Verse preview",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/VersePreviewResponse" },
              },
            },
          },
          "400": {
            description: "Missing query param",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "404": {
            description: "Verse not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "500": {
            description: "Internal error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string" },
        },
      },
      SearchFilters: {
        type: "object",
        properties: {
          testament: { type: "string", enum: ["Old", "New"] },
          book: { type: "string" },
        },
      },
      SearchRequest: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1, maxLength: 500 },
          k: { type: "integer", minimum: 1, maximum: 20, default: 5 },
          minScore: { type: "number", minimum: 0, maximum: 1, default: 0.6 },
          filters: { $ref: "#/components/schemas/SearchFilters" },
        },
      },
      SearchResult: {
        type: "object",
        required: ["id", "reference", "text", "book", "chapter", "verse", "score"],
        properties: {
          id: { type: "string" },
          reference: { type: "string" },
          text: { type: "string" },
          book: { type: "string" },
          chapter: { type: "integer" },
          verse: { type: "integer" },
          testament: { type: ["string", "null"] },
          score: { type: "number" },
        },
      },
      SearchResponse: {
        type: "object",
        required: ["query", "k", "minScore", "tookMs", "count", "results"],
        properties: {
          query: { type: "string" },
          k: { type: "integer" },
          minScore: { type: "number" },
          tookMs: { type: "integer" },
          count: { type: "integer" },
          results: {
            type: "array",
            items: { $ref: "#/components/schemas/SearchResult" },
          },
        },
      },
      HybridFilters: {
        type: "object",
        properties: {
          testament: {
            type: "string",
            enum: ["Old Testament", "New Testament", "Ancien Testament", "Nouveau Testament"],
          },
          book: { type: "string" },
        },
      },
      VerseResult: {
        type: "object",
        required: ["id", "text", "reference", "score", "source"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          reference: { type: "string" },
          score: { type: "number" },
          source: { type: "string", enum: ["vector", "graph", "hybrid"] },
        },
      },
      EntityRelation: {
        type: "object",
        required: ["type", "targetName", "targetSlug"],
        properties: {
          type: { type: "string" },
          targetName: { type: "string" },
          targetSlug: { type: "string" },
        },
      },
      EntityFact: {
        type: "object",
        required: ["slug", "name", "type"],
        properties: {
          slug: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          description: { type: "string" },
          aliases: {
            type: "array",
            items: { type: "string" },
          },
          relations: {
            type: "array",
            items: { $ref: "#/components/schemas/EntityRelation" },
          },
        },
      },
      RoutingMetadata: {
        type: "object",
        required: ["intent", "source", "reasoning", "latencyMs", "k"],
        properties: {
          intent: {
            type: "string",
            enum: ["THEOLOGY", "GENEALOGY", "GEOGRAPHY", "CHRONOLOGY", "GENERAL"],
          },
          source: { type: "string", enum: ["llm", "heuristic"] },
          reasoning: { type: "string" },
          latencyMs: { type: "number" },
          filters: { $ref: "#/components/schemas/HybridFilters" },
          k: { type: "integer" },
        },
      },
      HybridMetadata: {
        type: "object",
        required: [
          "vectorWeight",
          "graphWeight",
          "totalVectorResults",
          "totalGraphResults",
          "processingTimeMs",
        ],
        properties: {
          vectorWeight: { type: "number" },
          graphWeight: { type: "number" },
          totalVectorResults: { type: "integer" },
          totalGraphResults: { type: "integer" },
          processingTimeMs: { type: "number" },
          routing: { $ref: "#/components/schemas/RoutingMetadata" },
        },
      },
      HybridSearchRequest: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1 },
          k: { type: "integer", minimum: 1 },
          vectorWeight: { type: "number", minimum: 0, maximum: 1 },
          graphWeight: { type: "number", minimum: 0, maximum: 1 },
          filters: { $ref: "#/components/schemas/HybridFilters" },
          minScore: { type: "number", minimum: 0, maximum: 1, default: 0 },
        },
      },
      HybridSearchResponse: {
        type: "object",
        required: ["query", "verses", "entityFacts", "metadata"],
        properties: {
          query: { type: "string" },
          verses: {
            type: "array",
            items: { $ref: "#/components/schemas/VerseResult" },
          },
          entityFacts: {
            type: "array",
            items: { $ref: "#/components/schemas/EntityFact" },
          },
          metadata: { $ref: "#/components/schemas/HybridMetadata" },
        },
      },
      GroundedAnswerRequest: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1 },
          stream: { type: "boolean", default: false },
          retrieval: {
            type: "object",
            required: ["verses", "entityFacts"],
            properties: {
              verses: {
                type: "array",
                items: { $ref: "#/components/schemas/VerseResult" },
              },
              entityFacts: {
                type: "array",
                items: { $ref: "#/components/schemas/EntityFact" },
              },
              metadata: { $ref: "#/components/schemas/HybridMetadata" },
            },
          },
          k: { type: "integer", minimum: 1 },
          vectorWeight: { type: "number", minimum: 0, maximum: 1 },
          graphWeight: { type: "number", minimum: 0, maximum: 1 },
          filters: { $ref: "#/components/schemas/HybridFilters" },
          minScore: { type: "number", minimum: 0, maximum: 1, default: 0 },
        },
      },
      GroundedAnswerResponse: {
        type: "object",
        required: ["query", "answer", "citations", "metadata"],
        properties: {
          query: { type: "string" },
          answer: { type: "string" },
          citations: {
            type: "array",
            items: { type: "string" },
          },
          metadata: {
            type: "object",
            required: [
              "model",
              "promptVersion",
              "uncertain",
              "source",
              "contextVerses",
              "contextEntities",
              "processingTimeMs",
            ],
            properties: {
              model: { type: "string" },
              promptVersion: { type: "string" },
              uncertain: { type: "boolean" },
              source: {
                type: "string",
                enum: ["provided-context", "retrieved-context"],
              },
              contextVerses: { type: "integer" },
              contextEntities: { type: "integer" },
              processingTimeMs: { type: "number" },
              retrieval: { $ref: "#/components/schemas/HybridMetadata" },
            },
          },
        },
      },
      ChatPart: {
        type: "object",
        properties: {
          type: { type: "string" },
          text: { type: "string" },
        },
      },
      ChatMessage: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["system", "user", "assistant"] },
          content: {
            oneOf: [
              { type: "string" },
              {
                type: "array",
                items: { $ref: "#/components/schemas/ChatPart" },
              },
            ],
          },
          parts: {
            type: "array",
            items: { $ref: "#/components/schemas/ChatPart" },
          },
        },
      },
      ChatRequest: {
        type: "object",
        properties: {
          messages: {
            type: "array",
            items: { $ref: "#/components/schemas/ChatMessage" },
          },
        },
      },
      VersePreviewResponse: {
        type: "object",
        required: ["reference", "text"],
        properties: {
          reference: { type: "string" },
          text: { type: "string" },
          book: { type: "string" },
          chapter: { type: "integer" },
          verse: { type: "integer" },
          metadata: {
            type: ["object", "null"],
            properties: {
              testament: { type: "string" },
              version: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;
