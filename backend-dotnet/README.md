# RememberPress — ASP.NET Core 8.0 Web API Backend

This directory contains a complete **ASP.NET Core 8.0 (`net8.0`)** backend implementing every `/api/*` and `/uploads/*` route required by the RememberPress React frontend.

## Project Structure

- `RememberPress.sln` — Visual Studio / .NET CLI solution
- `RememberPress.Api/Program.cs` — Kestrel server (`50 MB` upload limit, CORS, `/uploads` static serving, camelCase JSON, unified JSON error handling)
- `RememberPress.Api/Models/WorkspaceModels.cs` — Strongly-typed book, chapter, photo, prompt, collaborator, and AI request/response DTOs matching `src/types.ts`
- `RememberPress.Api/Services/BookStoreService.cs` — Thread-safe `SemaphoreSlim` JSON persistence (`rememberpress-books-db.json`), media storage, and Cedar Cove seed workspace
- `RememberPress.Api/Services/AiProviderService.cs` — Dual switchable **Groq** (`whisper-large-v3-turbo`, `qwen/qwen3.8-27b` SSE streaming, `llama-3.1-8b-instant` fallback) and **Gemini** (`gemini-3.5-transcribe`, `gemini-3.1-flash-lite`, `gemini-4-hydrogen` with low-thinking mode, `gemini-3.8-flash-lite-tts`) client
- `RememberPress.Api/Controllers/`
  - `BooksController.cs` (`/api`, `/api/book`, `/api/books`, `/api/books/join`, `/api/book/sync`, `/api/book/settings`)
  - `ChaptersController.cs` (`/api/chapters`, `/api/chapters/{id}`, `/api/chapters/{id}/request-editing`, `/api/chapters/reorder`)
  - `PhotosController.cs` (`/api/photos`, `/api/photos/{id}`)
  - `PromptsController.cs` (`/api/prompts/collaborator`, `/api/prompts/custom`, `/api/prompts/{id}`)
  - `AiController.cs` (`/api/ai/status`, `/api/ai/transcribe-and-draft`, `/api/ai/rewrite-memory`, `/api/ai/sequence-book`, `/api/ai/refine-chapter`, `/api/ai/describe-photo`, `/api/ai/photo-memory-questions`, `/api/ai/photo-explanation-story`, `/api/ai/guided-prompts`, `/api/ai/narrate-chapter`)

## Running Locally with .NET 8 SDK

```bash
export GEMINI_API_KEY="your-gemini-key"
export GROQ_API_KEY="your-groq-key"   # optional

cd backend-dotnet
dotnet run --project RememberPress.Api
```

The API listens on `http://localhost:5000` by default (override with `PORT`).

To point the Vite / Node frontend at your running .NET backend:

```bash
export DOTNET_BACKEND_URL="http://localhost:5000"
npm run dev
```

## Running with Docker

```bash
docker build -t rememberpress-dotnet ./backend-dotnet
docker run -p 5000:5000 \
  -e GEMINI_API_KEY="your-gemini-key" \
  -e GROQ_API_KEY="your-groq-key" \
  rememberpress-dotnet
```
