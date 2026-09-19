from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]

if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from fastapi.testclient import TestClient

import control_plane_api
import orchestrator


def require(condition: bool, label: str) -> None:
    if not condition:
        raise AssertionError(label)

    print(f"PASS: {label}")


def make_event(
    event_seq: int = 7,
) -> orchestrator.OrchestratorEvent:
    event = orchestrator.OrchestratorEvent(
        schema_version=orchestrator.TRUST_EVENT_SCHEMA_VERSION,
        event_seq=event_seq,
        event_id=f"event-{event_seq:03d}",
        event_type=(
            orchestrator.OrchestratorEventType
            .PROVIDER_INVENTORY_OBSERVED
        ),
        occurred_at="2026-09-18T10:00:00+00:00",
        source_class=(
            orchestrator.OrchestratorEventSource.PROVIDER
        ),
        component="worker_provider_inventory",
        task_id="task-001",
        execution_id=None,
        parent_execution_id=None,
        request_id=None,
        worker_role=None,
        provider_id="stub",
        model_id=None,
        state_before=None,
        state_after=None,
        reason_code="validated_inventory_observed",
        evidence_refs=(),
        payload={
            "model_count": 1,
            "models": ["model-a"],
        },
    )

    orchestrator.validate_orchestrator_event(event)

    return event


def test_route_surface(
    client: TestClient,
) -> None:
    routes = {
        (
            route.path,
            tuple(sorted(route.methods or ())),
        )
        for route in control_plane_api.app.routes
        if route.path.startswith("/api/")
    }

    expected = {
        (
            "/api/v1/health",
            ("GET",),
        ),
        (
            "/api/v1/tasks",
            ("GET",),
        ),
        (
            "/api/v1/tasks/{task_id}",
            ("GET",),
        ),
        (
            "/api/v1/events",
            ("GET",),
        ),
        (
            "/api/v1/events/tail",
            ("GET",),
        ),
        (
            "/api/v1/events/stream",
            ("GET",),
        ),
    }

    require(
        routes == expected,
        "control plane exposes exactly six GET routes",
    )

    for path in (
        "/api/v1/health",
        "/api/v1/tasks",
        "/api/v1/tasks/task-001",
        "/api/v1/events",
        "/api/v1/events/tail",
        "/api/v1/events/stream",
    ):
        for method in (
            "post",
            "put",
            "patch",
            "delete",
        ):
            response = getattr(client, method)(path)

            require(
                response.status_code == 405,
                f"{method.upper()} {path} is rejected",
            )

    for path in (
        "/docs",
        "/redoc",
        "/openapi.json",
    ):
        response = client.get(path)

        require(
            response.status_code == 404,
            f"{path} remains disabled",
        )


def test_health(
    client: TestClient,
) -> None:
    response = client.get("/api/v1/health")

    require(
        response.status_code == 200,
        "health endpoint returns 200",
    )

    require(
        response.json()
        == {
            "status": "ok",
            "service": (
                "trusted-hybrid-ai-orchestrator-control-plane"
            ),
            "api_version": "1.0",
            "authority": "read_only",
        },
        "health response remains bounded",
    )


def test_task_list_adapter(
    client: TestClient,
) -> None:
    original = (
        orchestrator.read_task_status_projections_read_only
    )

    projection_a = orchestrator.TaskStatusProjection(
        schema_version="1.0",
        task_id="task-001",
        active_project="project-a",
        task_class="ENGINEERING",
        risk_level="medium",
        reasoning_mode="high",
        status="ADJUDICATE",
        next_action="supervisor_adjudicate",
        worker_calls_used=2,
        worker_calls_max=5,
        parallel_workers_active=0,
        local_runtime_seconds_used=12.5,
        cloud_worker_calls_used=0,
        checkpoint_last="worker_completed",
        checkpoint_resume_from="ADJUDICATE",
        human_gate_status="pending",
        human_gate_approval="A2_COMMIT",
    )

    projection_b = orchestrator.TaskStatusProjection(
        schema_version="1.0",
        task_id="task-002",
        active_project="project-a",
        task_class="ENGINEERING",
        risk_level="low",
        reasoning_mode="standard",
        status="COMPLETE",
        next_action=None,
        worker_calls_used=1,
        worker_calls_max=5,
        parallel_workers_active=0,
        local_runtime_seconds_used=4.0,
        cloud_worker_calls_used=0,
        checkpoint_last="complete",
        checkpoint_resume_from=None,
        human_gate_status=None,
        human_gate_approval=None,
    )

    captured: list[int] = []

    def fake_reader(
        *,
        limit: int = 100,
    ) -> orchestrator.TaskStatusProjectionCollection:
        captured.append(limit)

        return orchestrator.TaskStatusProjectionCollection(
            tasks=(
                projection_a,
                projection_b,
            ),
            limit=limit,
            truncated=True,
        )

    try:
        orchestrator.read_task_status_projections_read_only = (
            fake_reader
        )

        response = client.get(
            "/api/v1/tasks",
            params={
                "limit": 2,
            },
        )

        require(
            response.status_code == 200,
            "task-list endpoint returns 200",
        )

        require(
            captured == [2],
            "task-list limit passes unchanged to observer seam",
        )

        body = response.json()

        require(
            set(body)
            == {
                "tasks",
                "limit",
                "truncated",
            },
            "task-list response surface is exact",
        )

        require(
            body["limit"] == 2
            and body["truncated"] is True
            and len(body["tasks"]) == 2,
            "task-list endpoint returns collection metadata",
        )

        require(
            body["tasks"][0]["task_id"]
            == "task-001"
            and body["tasks"][0]["status"]
            == "ADJUDICATE"
            and body["tasks"][1]["task_id"]
            == "task-002"
            and body["tasks"][1]["status"]
            == "COMPLETE",
            "task-list endpoint serializes observer projections",
        )

        serialized = repr(body)

        require(
            "objective" not in serialized
            and "trace" not in serialized
            and "task_path" not in serialized,
            "task-list endpoint exposes no raw task state",
        )

        # ----------------------------------------------------
        # Default limit.
        # ----------------------------------------------------

        captured.clear()

        response = client.get(
            "/api/v1/tasks"
        )

        require(
            response.status_code == 200,
            "task-list default query returns 200",
        )

        require(
            captured == [100],
            "task-list default limit is 100",
        )

        # ----------------------------------------------------
        # Semantic query errors are HTTP 400 and must not
        # cross the observer boundary.
        # ----------------------------------------------------

        for invalid_limit in (
            0,
            -1,
            (
                orchestrator
                .TASK_STATUS_PROJECTION_LIST_MAX_LIMIT
                + 1
            ),
        ):
            captured.clear()

            response = client.get(
                "/api/v1/tasks",
                params={
                    "limit": invalid_limit,
                },
            )

            require(
                response.status_code == 400,
                (
                    "invalid task-list limit "
                    f"{invalid_limit!r} maps to 400"
                ),
            )

            require(
                captured == [],
                "invalid semantic limit does not invoke observer",
            )

        # ----------------------------------------------------
        # FastAPI type conversion owns syntactically invalid
        # integer query values.
        # ----------------------------------------------------

        captured.clear()

        response = client.get(
            "/api/v1/tasks",
            params={
                "limit": "not-an-integer",
            },
        )

        require(
            response.status_code == 422,
            "non-integer task-list limit maps to 422",
        )

        require(
            captured == [],
            "unparseable limit does not invoke observer",
        )

        # ----------------------------------------------------
        # A valid query whose trusted observer cannot serve
        # the collection is an availability failure, not a
        # client query error.
        # ----------------------------------------------------

        def failing_reader(
            *,
            limit: int = 100,
        ) -> orchestrator.TaskStatusProjectionCollection:
            del limit

            raise orchestrator.OrchestratorError(
                "SECRET-TASK-LIST-DIAGNOSTIC"
            )

        orchestrator.read_task_status_projections_read_only = (
            failing_reader
        )

        response = client.get(
            "/api/v1/tasks",
            params={
                "limit": 10,
            },
        )

        require(
            response.status_code == 503,
            "task discovery failure maps to 503",
        )

        require(
            "SECRET-TASK-LIST-DIAGNOSTIC"
            not in response.text,
            "task-list failure redacts internal diagnostic",
        )

    finally:
        orchestrator.read_task_status_projections_read_only = (
            original
        )


def test_task_adapter(
    client: TestClient,
) -> None:
    original = (
        orchestrator.read_task_status_projection
    )

    try:
        projection = orchestrator.TaskStatusProjection(
            schema_version="1.0",
            task_id="task-001",
            active_project="project-a",
            task_class="ENGINEERING",
            risk_level="medium",
            reasoning_mode="high",
            status="ADJUDICATE",
            next_action="supervisor_adjudicate",
            worker_calls_used=2,
            worker_calls_max=5,
            parallel_workers_active=0,
            local_runtime_seconds_used=12.5,
            cloud_worker_calls_used=0,
            checkpoint_last="worker_completed",
            checkpoint_resume_from="ADJUDICATE",
            human_gate_status="pending",
            human_gate_approval="A2_COMMIT",
        )

        captured: list[str] = []

        def fake_reader(
            task_reference: str,
        ) -> orchestrator.TaskStatusProjection:
            captured.append(task_reference)
            return projection

        orchestrator.read_task_status_projection = (
            fake_reader
        )

        response = client.get(
            "/api/v1/tasks/task-001"
        )

        require(
            response.status_code == 200,
            "task status endpoint returns 200",
        )

        require(
            captured == ["task-001"],
            "task reference passes unchanged to observer seam",
        )

        body = response.json()

        require(
            body["task_id"] == "task-001"
            and body["status"] == "ADJUDICATE"
            and body["worker_calls_used"] == 2
            and body["worker_calls_max"] == 5,
            "task endpoint returns observer projection",
        )

        require(
            "objective" not in body
            and "trace" not in body
            and "task_path" not in body,
            "task endpoint excludes sensitive raw state",
        )

        def failing_reader(
            task_reference: str,
        ) -> orchestrator.TaskStatusProjection:
            del task_reference

            raise orchestrator.OrchestratorError(
                "SECRET-TASK-DIAGNOSTIC"
            )

        orchestrator.read_task_status_projection = (
            failing_reader
        )

        response = client.get(
            "/api/v1/tasks/missing"
        )

        require(
            response.status_code == 404,
            "task observer failure maps to 404",
        )

        require(
            "SECRET-TASK-DIAGNOSTIC"
            not in response.text,
            "task error redacts internal diagnostic",
        )

    finally:
        orchestrator.read_task_status_projection = (
            original
        )


def test_event_tail_adapter(
    client: TestClient,
) -> None:
    original_reader = (
        orchestrator.read_orchestrator_event_tail_read_only
    )
    original_serializer = (
        orchestrator.orchestrator_event_to_mapping
    )

    sentinel_a = object()
    sentinel_b = object()

    captured: list[int] = []

    def fake_reader(
        *,
        limit: int = 100,
    ):
        captured.append(limit)

        return (
            sentinel_a,
            sentinel_b,
        )

    def fake_serializer(event):
        if event is sentinel_a:
            return {
                "event_seq": 41,
                "event_type": "qualification.first",
            }

        if event is sentinel_b:
            return {
                "event_seq": 42,
                "event_type": "qualification.second",
            }

        raise AssertionError(
            "unexpected event passed to serializer"
        )

    try:
        orchestrator.read_orchestrator_event_tail_read_only = (
            fake_reader
        )
        orchestrator.orchestrator_event_to_mapping = (
            fake_serializer
        )

        # ----------------------------------------------------
        # Explicit bounded request.
        # ----------------------------------------------------

        response = client.get(
            "/api/v1/events/tail",
            params={
                "limit": 2,
            },
        )

        require(
            response.status_code == 200,
            "event-tail endpoint returns 200",
        )

        require(
            captured == [2],
            "event-tail limit passes unchanged to observer seam",
        )

        body = response.json()

        require(
            set(body)
            == {
                "events",
                "count",
                "limit",
            },
            "event-tail response surface is exact",
        )

        require(
            body["count"] == 2
            and body["limit"] == 2,
            "event-tail response exposes bounded metadata",
        )

        require(
            [
                event["event_seq"]
                for event in body["events"]
            ]
            == [
                41,
                42,
            ],
            "event-tail adapter preserves observer ordering",
        )

        # ----------------------------------------------------
        # Default limit.
        # ----------------------------------------------------

        captured.clear()

        response = client.get(
            "/api/v1/events/tail"
        )

        require(
            response.status_code == 200,
            "event-tail default query returns 200",
        )

        require(
            captured == [100],
            "event-tail default limit is 100",
        )

        # Restore real reader for real semantic validation.
        orchestrator.read_orchestrator_event_tail_read_only = (
            original_reader
        )

        # ----------------------------------------------------
        # Core semantic validation maps to HTTP 400.
        # These fail before journal access.
        # ----------------------------------------------------

        for invalid_limit in (
            0,
            -1,
            1001,
        ):
            response = client.get(
                "/api/v1/events/tail",
                params={
                    "limit": invalid_limit,
                },
            )

            require(
                response.status_code == 400,
                (
                    "invalid event-tail limit "
                    f"{invalid_limit!r} maps to 400"
                ),
            )

        # ----------------------------------------------------
        # FastAPI owns syntactically non-integer values.
        # ----------------------------------------------------

        response = client.get(
            "/api/v1/events/tail",
            params={
                "limit": "not-an-integer",
            },
        )

        require(
            response.status_code == 422,
            "non-integer event-tail limit maps to 422",
        )

        # ----------------------------------------------------
        # Journal availability/integrity failure -> 503.
        # Internal diagnostic must not escape.
        # ----------------------------------------------------

        def failing_reader(
            *,
            limit: int = 100,
        ):
            del limit

            raise orchestrator.EventJournalError(
                "SECRET-EVENT-TAIL-DIAGNOSTIC"
            )

        orchestrator.read_orchestrator_event_tail_read_only = (
            failing_reader
        )

        response = client.get(
            "/api/v1/events/tail",
            params={
                "limit": 10,
            },
        )

        require(
            response.status_code == 503,
            "event-tail journal failure maps to 503",
        )

        require(
            "SECRET-EVENT-TAIL-DIAGNOSTIC"
            not in response.text,
            "event-tail failure redacts internal diagnostic",
        )

        require(
            "Event journal is unavailable"
            in response.text,
            "event-tail failure exposes bounded diagnostic",
        )

    finally:
        orchestrator.read_orchestrator_event_tail_read_only = (
            original_reader
        )
        orchestrator.orchestrator_event_to_mapping = (
            original_serializer
        )

    require(
        orchestrator.read_orchestrator_event_tail_read_only
        is original_reader
        and orchestrator.orchestrator_event_to_mapping
        is original_serializer,
        "event-tail regression restores runtime state",
    )


def test_event_adapter(
    client: TestClient,
) -> None:
    original = (
        orchestrator.read_orchestrator_events_read_only
    )

    event = make_event()

    try:
        captured: dict[str, Any] = {}

        def fake_reader(
            **kwargs: Any,
        ) -> tuple[
            orchestrator.OrchestratorEvent,
            ...,
        ]:
            captured.update(kwargs)
            return (event,)

        orchestrator.read_orchestrator_events_read_only = (
            fake_reader
        )

        response = client.get(
            "/api/v1/events",
            params={
                "after_event_seq": 6,
                "limit": 25,
                "task_id": "task-001",
                "execution_id": "exec-001",
                "request_id": "req-001",
            },
        )

        require(
            response.status_code == 200,
            "event endpoint returns 200",
        )

        require(
            captured
            == {
                "after_event_seq": 6,
                "limit": 25,
                "task_id": "task-001",
                "execution_id": "exec-001",
                "request_id": "req-001",
            },
            "event filters pass unchanged to observer seam",
        )

        body = response.json()

        require(
            body["count"] == 1
            and body["after_event_seq"] == 6
            and body["next_after_event_seq"] == 7,
            "event endpoint exposes stable cursor metadata",
        )

        require(
            body["events"][0]["event_seq"] == 7,
            "event endpoint serializes trusted event",
        )

        def empty_reader(
            **kwargs: Any,
        ) -> tuple[
            orchestrator.OrchestratorEvent,
            ...,
        ]:
            del kwargs
            return ()

        orchestrator.read_orchestrator_events_read_only = (
            empty_reader
        )

        response = client.get(
            "/api/v1/events",
            params={
                "after_event_seq": 9,
            },
        )

        body = response.json()

        require(
            response.status_code == 200
            and body["events"] == []
            and body["count"] == 0
            and body["next_after_event_seq"] == 9,
            "empty event read preserves supplied cursor",
        )

        def unavailable_reader(
            **kwargs: Any,
        ) -> tuple[
            orchestrator.OrchestratorEvent,
            ...,
        ]:
            del kwargs

            raise orchestrator.EventJournalError(
                "SECRET-JOURNAL-DIAGNOSTIC"
            )

        orchestrator.read_orchestrator_events_read_only = (
            unavailable_reader
        )

        response = client.get(
            "/api/v1/events"
        )

        require(
            response.status_code == 503,
            "journal failure maps to 503",
        )

        require(
            "SECRET-JOURNAL-DIAGNOSTIC"
            not in response.text,
            "journal failure redacts internal diagnostic",
        )

    finally:
        orchestrator.read_orchestrator_events_read_only = (
            original
        )


def test_sse_cursor_contract() -> None:
    require(
        control_plane_api._resolve_event_stream_cursor(
            after_event_seq=None,
            last_event_id=None,
        )
        == 0,
        "SSE defaults to cursor zero",
    )

    require(
        control_plane_api._resolve_event_stream_cursor(
            after_event_seq=7,
            last_event_id=None,
        )
        == 7,
        "SSE query cursor resolves exactly",
    )

    require(
        control_plane_api._resolve_event_stream_cursor(
            after_event_seq=None,
            last_event_id="7",
        )
        == 7,
        "SSE Last-Event-ID resolves exactly",
    )

    require(
        control_plane_api._resolve_event_stream_cursor(
            after_event_seq=7,
            last_event_id="7",
        )
        == 7,
        "matching SSE cursors are accepted",
    )

    invalid_values = (
        "",
        " 7",
        "7 ",
        "-1",
        "+7",
        "007",
        "abc",
    )

    for value in invalid_values:
        rejected = False

        try:
            control_plane_api._resolve_event_stream_cursor(
                after_event_seq=None,
                last_event_id=value,
            )
        except orchestrator.OrchestratorError:
            rejected = True

        require(
            rejected,
            f"noncanonical Last-Event-ID {value!r} rejected",
        )

    rejected = False

    try:
        control_plane_api._resolve_event_stream_cursor(
            after_event_seq=6,
            last_event_id="7",
        )
    except orchestrator.OrchestratorError:
        rejected = True

    require(
        rejected,
        "conflicting SSE cursors fail closed",
    )


def test_sse_serialization() -> None:
    event = make_event()


    # Journal rehydration returns event_type as a plain string. Preserve
    # the existing Enum-shaped fixture above, but also exercise the exact
    # representation observed in the live control-plane failure.
    from dataclasses import replace

    journal_event = replace(
        event,
        event_type=(
            event.event_type.value
            if hasattr(event.event_type, "value")
            else event.event_type
        ),
    )
    require(
        type(journal_event.event_type) is str,
        "SSE serialization accepts journal-style plain-string event type",
    )

    journal_serialized = control_plane_api._serialize_sse_event(
        journal_event
    )
    require(
        (
            f"event: {journal_event.event_type}\n"
            in journal_serialized
        ),
        "SSE serialization preserves plain-string event type",
    )

    serialized = (
        control_plane_api._serialize_sse_event(
            event
        )
    )

    canonical = (
        orchestrator.canonical_orchestrator_event_json(
            event
        )
    )

    require(
        serialized.startswith(
            "id: 7\n"
            "event: provider.inventory_observed\n"
            "data: "
        ),
        "SSE id derives from trusted event sequence",
    )

    require(
        f"data: {canonical}\n\n"
        in serialized,
        "SSE payload uses canonical trusted event JSON",
    )


def test_sse_generator() -> None:
    event = make_event()

    class ConnectedRequest:
        async def is_disconnected(
            self,
        ) -> bool:
            return False

    async def read_first() -> str:
        generator = (
            control_plane_api
            ._stream_orchestrator_events(
                ConnectedRequest(),
                cursor=6,
                initial_events=(event,),
                task_id="task-001",
                execution_id=None,
                request_id=None,
            )
        )

        try:
            return await anext(generator)
        finally:
            await generator.aclose()

    observed = asyncio.run(
        read_first()
    )

    require(
        observed
        == control_plane_api._serialize_sse_event(
            event
        ),
        "SSE generator replays initial event exactly",
    )


def test_sse_http_adapter(
    client: TestClient,
) -> None:
    original_reader = (
        orchestrator.read_orchestrator_events_read_only
    )

    original_stream = (
        control_plane_api._stream_orchestrator_events
    )

    event = make_event()
    captured: dict[str, Any] = {}

    def fake_reader(
        **kwargs: Any,
    ) -> tuple[
        orchestrator.OrchestratorEvent,
        ...,
    ]:
        captured.update(kwargs)
        return (event,)

    async def finite_stream(
        request: Any,
        *,
        cursor: int,
        initial_events: tuple[
            orchestrator.OrchestratorEvent,
            ...,
        ],
        task_id: str | None,
        execution_id: str | None,
        request_id: str | None,
    ):
        del request
        del task_id
        del execution_id
        del request_id

        require(
            cursor == 6,
            "SSE route passes resolved cursor",
        )

        require(
            initial_events == (event,),
            "SSE route passes initial replay batch",
        )

        yield (
            control_plane_api
            ._serialize_sse_event(
                initial_events[0]
            )
        )

    try:
        orchestrator.read_orchestrator_events_read_only = (
            fake_reader
        )

        control_plane_api._stream_orchestrator_events = (
            finite_stream
        )

        response = client.get(
            "/api/v1/events/stream",
            headers={
                "Last-Event-ID": "6",
            },
        )

        require(
            response.status_code == 200,
            "SSE endpoint returns 200",
        )

        require(
            response.headers[
                "content-type"
            ].startswith(
                "text/event-stream"
            ),
            "SSE endpoint uses event-stream media type",
        )

        require(
            response.headers.get(
                "cache-control"
            )
            == "no-cache",
            "SSE response disables caching",
        )

        require(
            captured["after_event_seq"] == 6,
            "SSE initial read starts strictly after cursor",
        )

        require(
            "id: 7\n" in response.text,
            "SSE HTTP response contains event sequence id",
        )

    finally:
        orchestrator.read_orchestrator_events_read_only = (
            original_reader
        )

        control_plane_api._stream_orchestrator_events = (
            original_stream
        )


def test_authority_source() -> None:
    source = Path(
        "control_plane_api.py"
    ).read_text(
        encoding="utf-8"
    )

    forbidden = (
        "save_yaml_atomic",
        "append_orchestrator_event",
        "append_trace",
        "transition_task",
        "delegate(",
        "verify(",
        "human_approval",
        "build_worker_provider_registry",
        "resolve_provider_models",
        "sqlite3",
        "subprocess",
    )

    found = [
        token
        for token in forbidden
        if token in source
    ]

    require(
        not found,
        "control plane contains no trusted mutation/provider primitive",
    )

    required = (
        "read_task_status_projection",
        "read_task_status_projections_read_only",
        "read_orchestrator_event_tail_read_only",
        "read_orchestrator_events_read_only",
        "Last-Event-ID",
        "text/event-stream",
        ": keepalive",
    )

    missing = [
        token
        for token in required
        if token not in source
    ]

    require(
        not missing,
        "control plane retains observer and SSE contract",
    )


def main() -> None:
    print(
        "N15a + N16.0a2 + N16.0b2 control-plane deterministic regression harness"
    )

    client = TestClient(
        control_plane_api.app
    )

    test_route_surface(client)
    test_health(client)
    test_task_list_adapter(client)
    test_task_adapter(client)
    test_event_tail_adapter(client)
    test_event_adapter(client)
    test_sse_cursor_contract()
    test_sse_serialization()
    test_sse_generator()
    test_sse_http_adapter(client)
    test_authority_source()

    print(
        "N15a + N16.0a2 + N16.0b2 control-plane regression suite passed."
    )


if __name__ == "__main__":
    main()
