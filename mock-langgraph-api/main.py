"""Mock LangGraph API Server.

Implements just enough of the LangGraph HTTP API to let the Open Web UI
chat interface work end-to-end.  The real LangGraph agent (parent/subagent
orchestration) will replace this service when it is ready.

Endpoints implemented:
    GET  /info                             — server / graph metadata
    POST /threads                          — create a thread
    POST /threads/search                   — list / search threads
    GET  /threads/{thread_id}              — get thread state
    GET  /threads/{thread_id}/history      — get run history
    POST /threads/{thread_id}/runs/stream  — run the agent (SSE stream)
"""

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Mock LangGraph API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------
_threads: dict[str, dict[str, Any]] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _make_thread(thread_id: str | None = None) -> dict[str, Any]:
    tid = thread_id or str(uuid.uuid4())
    thread: dict[str, Any] = {
        "thread_id": tid,
        "created_at": _now(),
        "updated_at": _now(),
        "metadata": {},
        "status": "idle",
        "config": {},
        "values": None,
    }
    _threads[tid] = thread
    return thread


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/info")
async def get_info():
    """Graph server info — used by the UI health-check."""
    return {
        "version": "0.1.0",
        "graphs": {
            "agent": {
                "description": "ETS Intelligent Assistant (mock)",
                "input_schema": {},
                "output_schema": {},
                "state_schema": {},
                "config_schema": {},
            }
        },
    }


@app.post("/threads")
async def create_thread(request: Request):
    """Create a new conversation thread."""
    thread = _make_thread()
    logger.info(f"[Mock] Created thread: {thread['thread_id']}")
    return thread


@app.post("/threads/search")
async def search_threads(request: Request):
    """Return threads (simplified — returns all in-memory threads)."""
    body: dict = {}
    try:
        body = await request.json()
    except Exception:
        pass
    limit = body.get("limit", 100)
    threads = list(_threads.values())
    return threads[:limit]


@app.get("/threads/{thread_id}")
async def get_thread(thread_id: str):
    """Return an existing thread, creating it if it doesn't exist."""
    thread = _threads.get(thread_id) or _make_thread(thread_id)
    return thread


@app.get("/threads/{thread_id}/history")
async def get_thread_history(thread_id: str):
    """Return run history for a thread."""
    return []


@app.post("/threads/{thread_id}/runs/stream")
async def run_stream(thread_id: str, request: Request):
    """Stream a mock agent response using the LangGraph SSE protocol.

    The LangGraph SDK expects Server-Sent Events with these event types:
        metadata  — run metadata (run_id, attempt)
        values    — complete state snapshot (used to render messages)
        end       — signals the stream is done
    """
    body: dict = {}
    try:
        body = await request.json()
    except Exception:
        pass

    input_messages: list[dict] = body.get("input", {}).get("messages", [])

    # Extract the last user message for a personalised reply
    user_text = ""
    for msg in reversed(input_messages):
        if msg.get("type") == "human":
            user_text = msg.get("content", "")
            break

    run_id = str(uuid.uuid4())
    ai_msg_id = str(uuid.uuid4())

    mock_reply = (
        f"Hello! I'm the **ETS Intelligent Assistant**.\n\n"
        f"I received your message: *\"{user_text}\"*\n\n"
        "This is a **mock response** from the LangGraph API stub. "
        "The real agent orchestration pipeline (parent/subagent flow) will be "
        "connected here once it is ready. Everything else — SSO, the chat UI, "
        "streaming — is fully wired up and working."
    )

    # Build the updated message list (previous messages + new AI reply)
    existing_messages: list[dict] = []
    thread = _threads.get(thread_id)
    if thread and thread.get("values") and thread["values"].get("messages"):
        existing_messages = thread["values"]["messages"]

    response_messages = existing_messages + [
        {
            "type": "ai",
            "id": ai_msg_id,
            "content": mock_reply,
        }
    ]

    # Persist state so thread history works on refresh
    if thread_id in _threads:
        _threads[thread_id]["values"] = {"messages": response_messages}
        _threads[thread_id]["updated_at"] = _now()
        _threads[thread_id]["status"] = "idle"
    else:
        t = _make_thread(thread_id)
        t["values"] = {"messages": response_messages}

    logger.info(f"[Mock] Streaming response for thread={thread_id}, run={run_id}")

    async def sse_stream():
        # 1 — metadata
        yield f"event: metadata\ndata: {json.dumps({'run_id': run_id, 'attempt': 1})}\n\n"
        await asyncio.sleep(0.05)

        # 2 — values (full state snapshot with all messages)
        yield f"event: values\ndata: {json.dumps({'messages': response_messages})}\n\n"
        await asyncio.sleep(0.05)

        # 3 — end
        yield "event: end\ndata: {}\n\n"

    return StreamingResponse(
        sse_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "2024"))
    uvicorn.run(app, host="0.0.0.0", port=port)
