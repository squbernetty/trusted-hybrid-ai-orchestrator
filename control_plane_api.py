from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from dataclasses import asdict
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

import orchestrator

CONTROL_PLANE_API_VERSION = "1.0"

EVENT_STREAM_BATCH_LIMIT = 100
EVENT_STREAM_POLL_SECONDS = 1.0
EVENT_STREAM_KEEPALIVE_SECONDS = 15.0

app = FastAPI(
    title="Trusted Hybrid AI Orchestrator Control Plane",
    version=CONTROL_PLANE_API_VERSION,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


def _parse_last_event_id(
    value: str | None,
) -> int | None:
    if value is None:
        return None

    if (
        not value
        or value != value.strip()
        or not value.isascii()
        or not value.isdigit()
    ):
        raise orchestrator.OrchestratorError(
            "Last-Event-ID must be a canonical non-negative integer"
        )

    parsed = int(value)

    if str(parsed) != value:
        raise orchestrator.OrchestratorError(
            "Last-Event-ID must be a canonical non-negative integer"
        )

    return parsed


def _resolve_event_stream_cursor(
    *,
    after_event_seq: int | None,
    last_event_id: str | None,
) -> int:
    if after_event_seq is not None and (
        type(after_event_seq) is not int
        or after_event_seq < 0
    ):
        raise orchestrator.OrchestratorError(
            "after_event_seq must be a non-negative integer"
        )

    header_cursor = _parse_last_event_id(
        last_event_id
    )

    if (
        after_event_seq is not None
        and header_cursor is not None
        and after_event_seq != header_cursor
    ):
        raise orchestrator.OrchestratorError(
            "Conflicting event stream cursors"
        )

    if header_cursor is not None:
        return header_cursor

    if after_event_seq is not None:
        return after_event_seq

    return 0


def _serialize_sse_event(
    event: orchestrator.OrchestratorEvent,
) -> str:
    canonical = (
        orchestrator.canonical_orchestrator_event_json(
            event
        )
    )

    return (
        f"id: {event.event_seq}\n"
        f"event: {getattr(event.event_type, 'value', event.event_type)}\n"
        f"data: {canonical}\n"
        "\n"
    )


async def _stream_orchestrator_events(
    request: Request,
    *,
    cursor: int,
    initial_events: tuple[
        orchestrator.OrchestratorEvent,
        ...,
    ],
    task_id: str | None,
    execution_id: str | None,
    request_id: str | None,
) -> AsyncIterator[str]:
    current_cursor = cursor
    pending = initial_events
    last_activity = time.monotonic()

    while True:
        if await request.is_disconnected():
            return

        if pending:
            for event in pending:
                if await request.is_disconnected():
                    return

                yield _serialize_sse_event(event)

                current_cursor = event.event_seq
                last_activity = time.monotonic()

            pending = ()
            continue

        await asyncio.sleep(
            EVENT_STREAM_POLL_SECONDS
        )

        if await request.is_disconnected():
            return

        try:
            pending = await run_in_threadpool(
                orchestrator.read_orchestrator_events_read_only,
                after_event_seq=current_cursor,
                limit=EVENT_STREAM_BATCH_LIMIT,
                task_id=task_id,
                execution_id=execution_id,
                request_id=request_id,
            )

        except (
            orchestrator.EventJournalError,
            orchestrator.OrchestratorError,
        ):
            # The HTTP response has already started.
            # Terminate rather than fabricating a trusted event
            # or exposing an internal diagnostic.
            return

        if pending:
            continue

        now = time.monotonic()

        if (
            now - last_activity
            >= EVENT_STREAM_KEEPALIVE_SECONDS
        ):
            # SSE comments keep the transport alive without
            # representing a trusted orchestrator event.
            yield ": keepalive\n\n"
            last_activity = now


@app.get("/api/v1/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "trusted-hybrid-ai-orchestrator-control-plane",
        "api_version": CONTROL_PLANE_API_VERSION,
        "authority": "read_only",
    }


@app.get("/api/v1/tasks")
def task_status_list(
    limit: int = 100,
) -> dict[str, Any]:
    if (
        type(limit) is not int
        or limit < 1
        or limit
        > orchestrator.TASK_STATUS_PROJECTION_LIST_MAX_LIMIT
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid task query",
        )

    try:
        collection = (
            orchestrator.read_task_status_projections_read_only(
                limit=limit,
            )
        )

    except orchestrator.OrchestratorError as exc:
        raise HTTPException(
            status_code=503,
            detail="Task discovery is unavailable",
        ) from exc

    return {
        "tasks": [
            asdict(projection)
            for projection in collection.tasks
        ],
        "limit": collection.limit,
        "truncated": collection.truncated,
    }


@app.get("/api/v1/tasks/{task_id}")
def task_status(task_id: str) -> dict[str, Any]:
    try:
        projection = orchestrator.read_task_status_projection(
            task_id
        )
    except orchestrator.OrchestratorError as exc:
        raise HTTPException(
            status_code=404,
            detail="Task status is unavailable",
        ) from exc

    return asdict(projection)


@app.get("/api/v1/events/tail")
def event_tail(
    limit: int = 100,
) -> dict[str, Any]:
    try:
        observed = (
            orchestrator.read_orchestrator_event_tail_read_only(
                limit=limit,
            )
        )

    except orchestrator.EventJournalError as exc:
        raise HTTPException(
            status_code=503,
            detail="Event journal is unavailable",
        ) from exc

    except orchestrator.OrchestratorError as exc:
        raise HTTPException(
            status_code=400,
            detail="Invalid event tail query",
        ) from exc

    serialized = [
        orchestrator.orchestrator_event_to_mapping(event)
        for event in observed
    ]

    return {
        "events": serialized,
        "count": len(serialized),
        "limit": limit,
    }


@app.get("/api/v1/events")
def events(
    after_event_seq: int = 0,
    limit: int = 100,
    task_id: str | None = None,
    execution_id: str | None = None,
    request_id: str | None = None,
) -> dict[str, Any]:
    try:
        observed = (
            orchestrator.read_orchestrator_events_read_only(
                after_event_seq=after_event_seq,
                limit=limit,
                task_id=task_id,
                execution_id=execution_id,
                request_id=request_id,
            )
        )

    except orchestrator.EventJournalError as exc:
        raise HTTPException(
            status_code=503,
            detail="Event journal is unavailable",
        ) from exc

    except orchestrator.OrchestratorError as exc:
        raise HTTPException(
            status_code=400,
            detail="Invalid event query",
        ) from exc

    serialized = [
        orchestrator.orchestrator_event_to_mapping(event)
        for event in observed
    ]

    next_after_event_seq = (
        observed[-1].event_seq
        if observed
        else after_event_seq
    )

    return {
        "events": serialized,
        "count": len(serialized),
        "after_event_seq": after_event_seq,
        "next_after_event_seq": next_after_event_seq,
    }


@app.get("/api/v1/events/stream")
async def event_stream(
    request: Request,
    after_event_seq: int | None = None,
    task_id: str | None = None,
    execution_id: str | None = None,
    request_id: str | None = None,
    last_event_id: str | None = Header(
        default=None,
        alias="Last-Event-ID",
    ),
) -> StreamingResponse:
    try:
        cursor = _resolve_event_stream_cursor(
            after_event_seq=after_event_seq,
            last_event_id=last_event_id,
        )

        initial_events = await run_in_threadpool(
            orchestrator.read_orchestrator_events_read_only,
            after_event_seq=cursor,
            limit=EVENT_STREAM_BATCH_LIMIT,
            task_id=task_id,
            execution_id=execution_id,
            request_id=request_id,
        )

    except orchestrator.EventJournalError as exc:
        raise HTTPException(
            status_code=503,
            detail="Event journal is unavailable",
        ) from exc

    except orchestrator.OrchestratorError as exc:
        raise HTTPException(
            status_code=400,
            detail="Invalid event stream request",
        ) from exc

    return StreamingResponse(
        _stream_orchestrator_events(
            request,
            cursor=cursor,
            initial_events=initial_events,
            task_id=task_id,
            execution_id=execution_id,
            request_id=request_id,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
