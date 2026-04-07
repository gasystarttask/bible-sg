# User Story: US-011 - Streaming Grounded Responses

**As a** User,  
**I want to** see the AI answer appearing word-by-word in real-time,  
**So that** I don't have to wait for the entire processing (retrieval + generation) to finish before I start reading.

---

## 🎯 Acceptance Criteria

- [x] **Stream Integration:** Refactor the `api/grounded-answer` endpoint to use `streamText` or `LangChainAdapter` for real-time data transmission.
- [x] **Partial Rendering:** The frontend must support reading the `ReadableStream` and updating the UI incrementally.
- [x] **Metadata Handling:** Ensure that citations and metadata (retrieval stats) are sent either at the beginning or the end of the stream without breaking the UI.
- [x] **Loading States:** Implement a "Skeleton" or a subtle pulse animation while the initial retrieval (Phase 3) is happening before the first token arrives.

---

## 🛠️ Technical Notes

* **Backend:** Use `StreamingTextResponse` from the Vercel AI SDK.
* **Frontend:** Use the `useChat` or `useCompletion` hook from `ai/react` to handle the stream easily.
* **Data Protocol:** Implement a "Data Stream" approach if citations need to be sent alongside the text (using `experimental_StreamData`).
* **Latency Goal:** The "Time to First Token" (TTFT) should be under 1.5s after the retrieval phase is completed.

---

## 📖 Example Behavior

1. **User sends:** "Who is Jesus?"
2. **0s - 0.8s:** Router classifies intent and starts Hybrid Search.
3. **0.8s - 1.5s:** Context is injected into the prompt.
4. **1.5s+:** The UI starts displaying: "Jesus... is... the... Son... of... God..."
5. **Final:** Once the stream ends, the citations `[Matthew 16:16]` become interactive links.

---

## 🧪 Definition of Done (DoD)

1. The response is no longer delivered as a single monolithic JSON block but as a stream of tokens.
2. The UI does not flicker or jump during the incremental update of the text.
3. Citations are correctly parsed and rendered as UI components even when delivered via stream.
4. Error handling is implemented: if the stream cuts off, the user is notified.

---

**Priority:** High  
**Estimation:** 3 Story Points  
**Status:** ✅ `done`
**Status:** 📥 `to-do`