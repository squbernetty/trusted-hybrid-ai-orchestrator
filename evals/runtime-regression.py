from __future__ import annotations

import copy
import json
import sqlite3
import sys
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier

ROOT = Path(__file__).resolve().parents[1]

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import orchestrator


class RegressionFailure(RuntimeError):
    pass


def check(label: str, condition: bool) -> None:
    if not condition:
        raise RegressionFailure(label)

    print(f"PASS: {label}")


def expect_orchestrator_error(
    label: str,
    action: Callable[[], object],
) -> None:
    try:
        action()
    except orchestrator.OrchestratorError:
        print(f"PASS: {label}")
        return

    raise RegressionFailure(label)


class CancelProvider:
    def __init__(self, result: object) -> None:
        self.result = result
        self.calls: list[tuple[str, bool]] = []

    def cancel(
        self,
        execution_id: str,
        *,
        force: bool = False,
    ) -> bool:
        self.calls.append((execution_id, force))
        return self.result  # type: ignore[return-value]


class StubProvider:
    def __init__(
        self,
        *,
        provider_ids: list[str] | None = None,
        capabilities: object | None = None,
        models: object | None = None,
        output: object = "OK",
    ) -> None:
        self.provider_ids = provider_ids or ["stub"]
        self.capabilities_value = (
            capabilities
            if capabilities is not None
            else orchestrator.ProviderCapabilities(
                streaming=False,
                cooperative_cancel=False,
                transport_cancel=False,
                backend_cancel=False,
                force_terminate=False,
            )
        )
        self.models_value = (
            models if models is not None else ["qwen/qwen3.5-9b"]
        )
        self.output = output
        self.provider_id_calls = 0
        self.execute_calls: list[
            tuple[orchestrator.WorkerExecutionRequest, float]
        ] = []

    def provider_id(self) -> str:
        index = min(
            self.provider_id_calls,
            len(self.provider_ids) - 1,
        )
        self.provider_id_calls += 1
        return self.provider_ids[index]

    def capabilities(self) -> orchestrator.ProviderCapabilities:
        return self.capabilities_value  # type: ignore[return-value]

    def list_models(self) -> list[str]:
        return self.models_value  # type: ignore[return-value]

    def execute_transport(
        self,
        request: orchestrator.WorkerExecutionRequest,
        timeout_seconds: float,
    ) -> str:
        self.execute_calls.append((request, timeout_seconds))
        return self.output  # type: ignore[return-value]

    def cancel(
        self,
        execution_id: str,
        *,
        force: bool = False,
    ) -> bool:
        return False


def completed_result(
    *,
    execution_id: str = "x0001",
    output: str | None = "OK",
    error: str | None = None,
    state: orchestrator.ExecutionState = (
        orchestrator.ExecutionState.COMPLETED
    ),
) -> orchestrator.WorkerExecutionResult:
    return orchestrator.WorkerExecutionResult(
        execution_id=execution_id,
        state=state,
        output=output,
        error=error,
        telemetry=orchestrator.ExecutionTelemetry(),
    )


def worker_request(
    *,
    provider_id: str = "stub",
) -> orchestrator.WorkerExecutionRequest:
    return orchestrator.WorkerExecutionRequest(
        execution_id="x0001",
        task_id="task-001",
        attempt_id="d001",
        provider_id=provider_id,
        model_id="qwen/qwen3.5-9b",
        system_prompt="system",
        user_prompt="user",
        temperature=0.2,
        max_output_tokens=128,
        budget=orchestrator.ExecutionBudget(
            fallback_timeout_seconds=60,
        ),
    )


def _call_with_isolated_state_dir(action):
    original_state_dir = orchestrator.STATE_DIR

    try:
        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)
            return action()

    finally:
        orchestrator.STATE_DIR = original_state_dir


def test_n4_execution_id_allocator() -> None:
    print("\n=== N4 EXECUTION ID ALLOCATION ===")

    task: dict[str, object] = {}
    before = copy.deepcopy(task)

    check(
        "empty task -> x0001",
        orchestrator.next_execution_id(task) == "x0001",
    )
    check(
        "empty task not mutated",
        task == before,
    )

    task = {
        "delegation": {
            "attempts": [
                {"execution": {"execution_id": "x0001"}},
                {"execution": {"execution_id": "x0002"}},
            ]
        }
    }
    before = copy.deepcopy(task)

    check(
        "sequential IDs -> x0003",
        orchestrator.next_execution_id(task) == "x0003",
    )
    check(
        "sequential task not mutated",
        task == before,
    )

    task = {
        "delegation": {
            "attempts": [
                {"execution": {"execution_id": "x0001"}},
                {"execution": {"execution_id": "x0003"}},
            ]
        }
    }

    check(
        "allocator fills first gap",
        orchestrator.next_execution_id(task) == "x0002",
    )

    task = {
        "delegation": {
            "attempts": [
                None,
                "bad",
                {},
                {"execution": None},
                {"execution": {"execution_id": ""}},
                {"execution": {"execution_id": 7}},
                {"execution": {"execution_id": "x0001"}},
            ]
        }
    }

    check(
        "malformed records ignored",
        orchestrator.next_execution_id(task) == "x0002",
    )


def test_n4_result_admissibility() -> None:
    print("\n=== N4 RESULT ADMISSIBILITY ===")

    check(
        "matching completed RUNNING result admissible",
        orchestrator.execution_output_admissible(
            active_execution_id="x0001",
            current_state=orchestrator.ExecutionState.RUNNING,
            result=completed_result(),
        ),
    )

    check(
        "wrong execution ID rejected",
        not orchestrator.execution_output_admissible(
            active_execution_id="x0001",
            current_state=orchestrator.ExecutionState.RUNNING,
            result=completed_result(execution_id="x0002"),
        ),
    )

    check(
        "non-RUNNING trusted state rejected",
        not orchestrator.execution_output_admissible(
            active_execution_id="x0001",
            current_state=orchestrator.ExecutionState.CANCELLING,
            result=completed_result(),
        ),
    )

    check(
        "non-COMPLETED result rejected",
        not orchestrator.execution_output_admissible(
            active_execution_id="x0001",
            current_state=orchestrator.ExecutionState.RUNNING,
            result=completed_result(
                state=orchestrator.ExecutionState.FAILED,
            ),
        ),
    )

    check(
        "missing output rejected",
        not orchestrator.execution_output_admissible(
            active_execution_id="x0001",
            current_state=orchestrator.ExecutionState.RUNNING,
            result=completed_result(output=None),
        ),
    )

    check(
        "result carrying error rejected",
        not orchestrator.execution_output_admissible(
            active_execution_id="x0001",
            current_state=orchestrator.ExecutionState.RUNNING,
            result=completed_result(error="failure"),
        ),
    )


def test_n4_cancellation_resolution() -> None:
    print("\n=== N4 CANCELLATION RESOLUTION ===")

    provider = CancelProvider(True)

    state = orchestrator.resolve_execution_cancellation(
        provider,
        execution_id="x0007",
        current_state=orchestrator.ExecutionState.CANCELLING,
        force=True,
    )

    check(
        "confirmed cancellation -> CANCELLED",
        state is orchestrator.ExecutionState.CANCELLED,
    )
    check(
        "execution ID and force forwarded unchanged",
        provider.calls == [("x0007", True)],
    )

    provider = CancelProvider(False)

    state = orchestrator.resolve_execution_cancellation(
        provider,
        execution_id="x0008",
        current_state=orchestrator.ExecutionState.CANCELLING,
    )

    check(
        "unconfirmed cancellation -> CANCEL_FAILED",
        state is orchestrator.ExecutionState.CANCEL_FAILED,
    )

    expect_orchestrator_error(
        "empty execution ID rejected",
        lambda: orchestrator.resolve_execution_cancellation(
            CancelProvider(True),
            execution_id="",
            current_state=orchestrator.ExecutionState.CANCELLING,
        ),
    )

    expect_orchestrator_error(
        "cancellation only resolves from CANCELLING",
        lambda: orchestrator.resolve_execution_cancellation(
            CancelProvider(True),
            execution_id="x0009",
            current_state=orchestrator.ExecutionState.CANCEL_REQUESTED,
        ),
    )

    expect_orchestrator_error(
        "provider cancellation must return bool",
        lambda: orchestrator.resolve_execution_cancellation(
            CancelProvider("yes"),
            execution_id="x0010",
            current_state=orchestrator.ExecutionState.CANCELLING,
        ),
    )


def test_n5_budget_resolution() -> None:
    print("\n=== N5 EXECUTION BUDGET RESOLUTION ===")

    budget = orchestrator.resolve_execution_budget(
        {
            "budget": {
                "local_worker_timeout_seconds": 90,
            }
        }
    )

    check(
        "legacy timeout becomes fallback",
        budget.fallback_timeout_seconds == 90.0,
    )
    check(
        "unspecified advanced budgets remain None",
        budget.model_load_timeout_seconds is None
        and budget.first_progress_timeout_seconds is None
        and budget.stall_timeout_seconds is None
        and budget.absolute_timeout_seconds is None,
    )

    budget = orchestrator.resolve_execution_budget(
        {
            "budget": {
                "local_worker_timeout_seconds": 90,
                "worker_execution": {
                    "fallback_timeout_seconds": 120,
                    "model_load_timeout_seconds": 30,
                    "first_progress_timeout_seconds": 15,
                    "stall_timeout_seconds": 20,
                    "absolute_timeout_seconds": 180,
                },
            }
        }
    )

    check(
        "worker execution overrides resolved exactly",
        budget
        == orchestrator.ExecutionBudget(
            fallback_timeout_seconds=120.0,
            model_load_timeout_seconds=30.0,
            first_progress_timeout_seconds=15.0,
            stall_timeout_seconds=20.0,
            absolute_timeout_seconds=180.0,
        ),
    )

    expect_orchestrator_error(
        "boolean legacy timeout rejected",
        lambda: orchestrator.resolve_execution_budget(
            {
                "budget": {
                    "local_worker_timeout_seconds": True,
                }
            }
        ),
    )

    expect_orchestrator_error(
        "absolute timeout below fallback rejected",
        lambda: orchestrator.resolve_execution_budget(
            {
                "budget": {
                    "local_worker_timeout_seconds": 90,
                    "worker_execution": {
                        "fallback_timeout_seconds": 120,
                        "absolute_timeout_seconds": 100,
                    },
                }
            }
        ),
    )


def test_n5_watchdog() -> None:
    print("\n=== N5 EXECUTION WATCHDOG ===")

    budget = orchestrator.ExecutionBudget(
        fallback_timeout_seconds=60,
        first_progress_timeout_seconds=10,
        stall_timeout_seconds=15,
        absolute_timeout_seconds=120,
    )

    decision = orchestrator.evaluate_execution_watchdog(
        budget,
        elapsed_seconds=20,
        progress_observable=False,
    )

    check(
        "unobservable progress stays RUNNING",
        decision.state is orchestrator.ExecutionState.RUNNING
        and decision.reason == "progress_unobservable",
    )

    decision = orchestrator.evaluate_execution_watchdog(
        budget,
        elapsed_seconds=120,
        progress_observable=False,
    )

    check(
        "absolute timeout has watchdog precedence",
        decision.state is orchestrator.ExecutionState.TIMED_OUT
        and decision.reason == "absolute_timeout_exceeded",
    )

    decision = orchestrator.evaluate_execution_watchdog(
        budget,
        elapsed_seconds=10,
        progress_observable=True,
    )

    check(
        "missing first progress can stall",
        decision.state is orchestrator.ExecutionState.STALLED
        and decision.reason == "first_progress_timeout_exceeded",
    )

    decision = orchestrator.evaluate_execution_watchdog(
        budget,
        elapsed_seconds=30,
        progress_observable=True,
        first_progress_elapsed_seconds=5,
        last_progress_elapsed_seconds=15,
    )

    check(
        "stale observable progress can stall",
        decision.state is orchestrator.ExecutionState.STALLED
        and decision.reason == "stall_timeout_exceeded",
    )

    decision = orchestrator.evaluate_execution_watchdog(
        budget,
        elapsed_seconds=20,
        progress_observable=True,
        first_progress_elapsed_seconds=5,
        last_progress_elapsed_seconds=18,
    )

    check(
        "recent progress stays RUNNING",
        decision.state is orchestrator.ExecutionState.RUNNING
        and decision.reason == "progress_within_budget",
    )

    expect_orchestrator_error(
        "progress timestamps rejected when progress unobservable",
        lambda: orchestrator.evaluate_execution_watchdog(
            budget,
            elapsed_seconds=5,
            progress_observable=False,
            first_progress_elapsed_seconds=1,
            last_progress_elapsed_seconds=1,
        ),
    )


def test_n5_timeout_prediction() -> None:
    print("\n=== N5 TIMEOUT PREDICTION ===")

    budget = orchestrator.ExecutionBudget(
        fallback_timeout_seconds=60,
        absolute_timeout_seconds=180,
    )

    prediction = orchestrator.predict_execution_timeout(
        budget,
        max_output_tokens=100,
    )

    check(
        "missing rate data uses fallback",
        prediction.timeout_seconds == 60
        and prediction.source == "fallback",
    )

    prediction = orchestrator.predict_execution_timeout(
        budget,
        max_output_tokens=200,
        estimated_input_tokens=1000,
        prefill_tokens_per_second=100,
        decode_tokens_per_second=10,
        safety_factor=2,
    )

    check(
        "rate estimate uses prefill plus decode with safety factor",
        prediction.timeout_seconds == 60
        and prediction.source == "rate_estimate"
        and prediction.estimated_prefill_seconds == 10
        and prediction.estimated_decode_seconds == 20,
    )

    prediction = orchestrator.predict_execution_timeout(
        orchestrator.ExecutionBudget(
            fallback_timeout_seconds=60,
            absolute_timeout_seconds=90,
        ),
        max_output_tokens=1000,
        estimated_input_tokens=1000,
        prefill_tokens_per_second=10,
        decode_tokens_per_second=5,
        safety_factor=2,
    )

    check(
        "absolute timeout caps rate estimate",
        prediction.timeout_seconds == 90,
    )

    expect_orchestrator_error(
        "boolean max output tokens rejected",
        lambda: orchestrator.predict_execution_timeout(
            budget,
            max_output_tokens=True,
        ),
    )


def test_n6_worker_execution_supervisor() -> None:
    print("\n=== N6 WORKER EXECUTION SUPERVISOR ===")

    request = worker_request()
    calls: list[float] = []

    def successful_transport(
        received: orchestrator.WorkerExecutionRequest,
        timeout_seconds: float,
    ) -> str:
        check(
            "supervisor forwards exact request object",
            received is request,
        )
        calls.append(timeout_seconds)
        return "worker-output"

    result = _call_with_isolated_state_dir(
        lambda: orchestrator.supervise_worker_execution(
            request,
            successful_transport,
        )
    )

    check(
        "successful transport -> COMPLETED",
        result.state is orchestrator.ExecutionState.COMPLETED
        and result.execution_id == "x0001"
        and result.output == "worker-output"
        and result.error is None,
    )
    check(
        "resolved fallback timeout forwarded",
        calls == [60],
    )
    check(
        "completion telemetry recorded",
        result.telemetry.started_at is not None
        and result.telemetry.completed_at is not None
        and result.telemetry.elapsed_seconds is not None,
    )

    def timeout_transport(
        received: orchestrator.WorkerExecutionRequest,
        timeout_seconds: float,
    ) -> str:
        raise orchestrator.WorkerTimeoutError("worker timeout")

    result = _call_with_isolated_state_dir(
        lambda: orchestrator.supervise_worker_execution(
            request,
            timeout_transport,
        )
    )

    check(
        "WorkerTimeoutError -> TIMED_OUT",
        result.state is orchestrator.ExecutionState.TIMED_OUT
        and result.output is None
        and result.error == "worker timeout",
    )

    def unexpected_transport(
        received: orchestrator.WorkerExecutionRequest,
        timeout_seconds: float,
    ) -> str:
        raise ValueError("boom")

    result = _call_with_isolated_state_dir(
        lambda: orchestrator.supervise_worker_execution(
            request,
            unexpected_transport,
        )
    )

    check(
        "unexpected transport exception contained as FAILED",
        result.state is orchestrator.ExecutionState.FAILED
        and result.output is None
        and result.error is not None
        and "Worker transport raised unexpected ValueError: boom"
        in result.error,
    )

    def malformed_transport(
        received: orchestrator.WorkerExecutionRequest,
        timeout_seconds: float,
    ) -> str:
        return 7  # type: ignore[return-value]

    result = _call_with_isolated_state_dir(
        lambda: orchestrator.supervise_worker_execution(
            request,
            malformed_transport,
        )
    )

    check(
        "non-string transport output -> FAILED",
        result.state is orchestrator.ExecutionState.FAILED
        and result.output is None
        and result.error is not None
        and "invalid output type: int" in result.error,
    )

    def interrupt_transport(
        received: orchestrator.WorkerExecutionRequest,
        timeout_seconds: float,
    ) -> str:
        raise KeyboardInterrupt()

    try:
        _call_with_isolated_state_dir(
            lambda: orchestrator.supervise_worker_execution(
                request,
                interrupt_transport,
            )
        )
    except KeyboardInterrupt:
        interrupt_propagates = True
    else:
        interrupt_propagates = False

    check(
        "KeyboardInterrupt propagates through supervisor",
        interrupt_propagates,
    )


def test_n7_provider_boundary() -> None:
    print("\n=== N7 PROVIDER BOUNDARY ===")

    provider = StubProvider()
    request = worker_request(provider_id="stub")

    result = _call_with_isolated_state_dir(
        lambda: orchestrator.supervise_provider_execution(
            provider,
            request,
        )
    )

    check(
        "provider bridge completes through trusted supervisor",
        result.state is orchestrator.ExecutionState.COMPLETED
        and result.output == "OK",
    )
    check(
        "provider transport invoked once",
        len(provider.execute_calls) == 1,
    )

    mismatch_provider = StubProvider(provider_ids=["provider-a"])

    expect_orchestrator_error(
        "provider/request identity mismatch rejected",
        lambda: orchestrator.supervise_provider_execution(
            mismatch_provider,
            worker_request(provider_id="provider-b"),
        ),
    )

    check(
        "identity mismatch rejected before transport",
        mismatch_provider.execute_calls == [],
    )

    registry: dict[str, orchestrator.WorkerProvider] = {}
    registered = StubProvider(provider_ids=["provider-a"])

    orchestrator.register_worker_provider(
        registry,
        registered,
    )

    check(
        "registered provider resolves by exact ID",
        orchestrator.resolve_worker_provider(
            registry,
            "provider-a",
        )
        is registered,
    )

    expect_orchestrator_error(
        "duplicate provider registration rejected",
        lambda: orchestrator.register_worker_provider(
            registry,
            StubProvider(provider_ids=["provider-a"]),
        ),
    )

    drift_registry: dict[str, orchestrator.WorkerProvider] = {}
    drifting = StubProvider(
        provider_ids=["provider-a", "provider-b"],
    )

    orchestrator.register_worker_provider(
        drift_registry,
        drifting,
    )

    expect_orchestrator_error(
        "registered provider identity drift rejected",
        lambda: orchestrator.resolve_worker_provider(
            drift_registry,
            "provider-a",
        ),
    )

    provider = StubProvider()
    capabilities = orchestrator.resolve_provider_capabilities(
        provider
    )

    check(
        "valid capabilities preserved",
        capabilities
        == orchestrator.ProviderCapabilities(
            streaming=False,
            cooperative_cancel=False,
            transport_cancel=False,
            backend_cancel=False,
            force_terminate=False,
        ),
    )

    invalid_capabilities = StubProvider(
        capabilities=orchestrator.ProviderCapabilities(
            streaming=1,  # type: ignore[arg-type]
            cooperative_cancel=False,
            transport_cancel=False,
            backend_cancel=False,
            force_terminate=False,
        )
    )

    expect_orchestrator_error(
        "non-bool provider capability rejected",
        lambda: orchestrator.resolve_provider_capabilities(
            invalid_capabilities
        ),
    )

    capability_drift = StubProvider(
        provider_ids=["provider-a", "provider-b"],
    )

    expect_orchestrator_error(
        "provider identity drift during capability inspection rejected",
        lambda: orchestrator.resolve_provider_capabilities(
            capability_drift
        ),
    )

    inventory_provider = StubProvider(
        models=[
            "qwen/qwen3.5-4b",
            "qwen/qwen3.5-9b",
        ]
    )

    inventory = _call_with_isolated_state_dir(
        lambda: orchestrator.resolve_provider_models(
            inventory_provider
        )
    )

    check(
        "provider inventory order and IDs preserved exactly",
        inventory
        == [
            "qwen/qwen3.5-4b",
            "qwen/qwen3.5-9b",
        ],
    )

    expect_orchestrator_error(
        "duplicate provider model ID rejected",
        lambda: _call_with_isolated_state_dir(
            lambda: orchestrator.resolve_provider_models(
                StubProvider(
                    models=[
                        "qwen/qwen3.5-9b",
                        "qwen/qwen3.5-9b",
                    ]
                )
            )
        ),
    )

    model_drift = StubProvider(
        provider_ids=["provider-a", "provider-b"],
    )

    expect_orchestrator_error(
        "provider identity drift during inventory rejected",
        lambda: _call_with_isolated_state_dir(
            lambda: orchestrator.resolve_provider_models(
                model_drift
            )
        ),
    )

    bound = _call_with_isolated_state_dir(
        lambda: orchestrator.bind_provider_worker(
            "qwen",
            StubProvider(
                models=[
                    "qwen/qwen3.5-4b",
                    "qwen/qwen3.5-9b",
                ]
            ),
        )
    )

    check(
        "role binding follows canonical model priority",
        bound == "qwen/qwen3.5-9b",
    )

    expect_orchestrator_error(
        "undefined worker role rejected",
        lambda: _call_with_isolated_state_dir(
            lambda: orchestrator.bind_provider_worker(
                "unknown-role",
                StubProvider(),
            )
        ),
    )


def test_n8_lm_studio_adapter() -> None:
    print("\n=== N8 LM STUDIO ADAPTER ===")

    provider = orchestrator.LMStudioProvider()

    check(
        "LM Studio provider ID is canonical",
        provider.provider_id() == "lm_studio",
    )

    check(
        "LM Studio capabilities remain conservative",
        provider.capabilities()
        == orchestrator.ProviderCapabilities(
            streaming=False,
            cooperative_cancel=False,
            transport_cancel=False,
            backend_cancel=False,
            force_terminate=False,
        ),
    )

    original_models = orchestrator.lm_studio_models
    original_call_worker = orchestrator.call_worker

    calls: list[dict[str, object]] = []

    try:
        orchestrator.lm_studio_models = lambda: [
            "model-a",
            "model-b",
        ]

        inventory = provider.list_models()

        check(
            "LM Studio inventory delegates unchanged",
            inventory == ["model-a", "model-b"],
        )

        def fake_call_worker(
            *,
            model: str,
            system_prompt: str,
            user_prompt: str,
            timeout: float,
        ) -> str:
            calls.append(
                {
                    "model": model,
                    "system_prompt": system_prompt,
                    "user_prompt": user_prompt,
                    "timeout": timeout,
                }
            )
            return "adapter-output"

        orchestrator.call_worker = fake_call_worker

        request = worker_request(provider_id="lm_studio")

        output = provider.execute_transport(
            request,
            42.5,
        )

        check(
            "LM Studio transport output preserved",
            output == "adapter-output",
        )

        check(
            "LM Studio transport forwards exact request fields",
            calls
            == [
                {
                    "model": request.model_id,
                    "system_prompt": request.system_prompt,
                    "user_prompt": request.user_prompt,
                    "timeout": 42.5,
                }
            ],
        )

        check(
            "LM Studio cancellation remains unconfirmed",
            provider.cancel("x0001") is False,
        )

        registry = orchestrator.build_worker_provider_registry()

        check(
            "default registry contains LM Studio provider",
            set(registry) == {"lm_studio"}
            and isinstance(
                registry["lm_studio"],
                orchestrator.LMStudioProvider,
            ),
        )

    finally:
        orchestrator.lm_studio_models = original_models
        orchestrator.call_worker = original_call_worker

    project = {
        "model_routing": {
            "local_worker_provider_id": "lm_studio",
        }
    }

    check(
        "project provider ID resolves exactly",
        orchestrator.resolve_project_worker_provider_id(project)
        == "lm_studio",
    )

    registry = {
        "lm_studio": orchestrator.LMStudioProvider(),
    }

    check(
        "project provider resolves through registry",
        orchestrator.resolve_project_worker_provider(
            project,
            registry,
        )
        is registry["lm_studio"],
    )

    expect_orchestrator_error(
        "project provider ID surrounding whitespace rejected",
        lambda: orchestrator.resolve_project_worker_provider_id(
            {
                "model_routing": {
                    "local_worker_provider_id": " lm_studio",
                }
            }
        ),
    )


def test_n9_external_supervisor_boundary() -> None:
    print("\n=== N9 EXTERNAL SUPERVISOR BOUNDARY ===")

    check(
        "external operation set remains closed",
        {
            operation.value
            for operation in orchestrator.ExternalSupervisorOperation
        }
        == {
            "status",
            "preflight",
            "delegate",
            "verify",
        },
    )

    status_mapping = {
        "schema_version": (
            orchestrator.EXTERNAL_SUPERVISOR_SCHEMA_VERSION
        ),
        "request_id": "n11-r0001",
        "supervisor_id": "n11-regression",
        "operation": "status",
        "task": "n11-task.yaml",
        "payload": {},
    }

    request = (
        orchestrator.external_supervisor_request_from_mapping(
            status_mapping
        )
    )

    check(
        "valid mapping becomes typed request",
        isinstance(
            request,
            orchestrator.ExternalSupervisorRequest,
        )
        and request.operation
        is orchestrator.ExternalSupervisorOperation.STATUS,
    )

    unknown = dict(status_mapping)
    unknown["approval"] = "not-allowed"

    expect_orchestrator_error(
        "unknown top-level authority field rejected",
        lambda: orchestrator.external_supervisor_request_from_mapping(
            unknown
        ),
    )

    authority_operation = dict(status_mapping)
    authority_operation["operation"] = "human-approval"

    expect_orchestrator_error(
        "authority-bearing operation cannot be constructed",
        lambda: orchestrator.external_supervisor_request_from_mapping(
            authority_operation
        ),
    )

    delegate_mapping = {
        **status_mapping,
        "operation": "delegate",
        "payload": {
            "role": "qwen",
            "work_product": "EXTRACT",
            "reason": "bounded extraction",
            "expected_output": "evidence packet",
            "context_file": ["a.py"],
            "context_symbol": ["a.py:function_a"],
        },
    }

    delegate_request = (
        orchestrator.external_supervisor_request_from_mapping(
            delegate_mapping
        )
    )

    original_context = delegate_mapping["payload"]["context_file"]
    original_context.append("mutated.py")

    check(
        "delegate context list is caller-isolated",
        delegate_request.payload["context_file"] == ["a.py"],
    )

    smuggled_delegate = {
        **delegate_mapping,
        "payload": {
            **delegate_mapping["payload"],
            "approval": "A2_NOT_ALLOWED",
        },
    }

    expect_orchestrator_error(
        "delegate authority smuggling rejected",
        lambda: orchestrator.external_supervisor_request_from_mapping(
            smuggled_delegate
        ),
    )

    duplicate_json = '''
    {
      "schema_version": "1.0",
      "request_id": "n11-r0001",
      "request_id": "n11-r9999",
      "supervisor_id": "n11-regression",
      "operation": "status",
      "task": "n11-task.yaml",
      "payload": {}
    }
    '''

    expect_orchestrator_error(
        "duplicate JSON keys rejected",
        lambda: orchestrator.external_supervisor_request_from_json(
            duplicate_json
        ),
    )

    with TemporaryDirectory() as temp_dir:
        original_state_dir = orchestrator.STATE_DIR

        try:
            orchestrator.STATE_DIR = Path(temp_dir)

            resolved = (
                orchestrator.resolve_external_supervisor_task_path(
                    "example"
                )
            )

            check(
                "extensionless task resolves inside trusted state root",
                resolved
                == (Path(temp_dir) / "example.yaml").resolve(),
            )

            expect_orchestrator_error(
                "task path traversal rejected",
                lambda: (
                    orchestrator.resolve_external_supervisor_task_path(
                        "../escape.yaml"
                    )
                ),
            )

            expect_orchestrator_error(
                "task directory separator rejected",
                lambda: (
                    orchestrator.resolve_external_supervisor_task_path(
                        "subdir/task.yaml"
                    )
                ),
            )

            expect_orchestrator_error(
                "unsupported task suffix rejected",
                lambda: (
                    orchestrator.resolve_external_supervisor_task_path(
                        "task.json"
                    )
                ),
            )

        finally:
            orchestrator.STATE_DIR = original_state_dir

    originals = {
        "append_external_supervisor_trace": (
            orchestrator.append_external_supervisor_trace
        ),
        "status": orchestrator.status,
        "delegate": orchestrator.delegate,
    }

    events: list[tuple[str, dict[str, object]]] = []

    try:
        def trace_stub(
            request: orchestrator.ExternalSupervisorRequest,
            event: str,
            **kwargs: object,
        ) -> None:
            events.append((event, dict(kwargs)))

        orchestrator.append_external_supervisor_trace = trace_stub
        orchestrator.status = lambda task: 17

        result = orchestrator.dispatch_external_supervisor_request(
            request
        )

        check(
            "status dispatch returns trusted result",
            result == 17,
        )

        check(
            "status dispatch records accepted then completed",
            [event for event, _ in events]
            == [
                "external_request_accepted",
                "external_request_completed",
            ],
        )

        captured_delegate: list[object] = []

        def delegate_stub(args: object) -> int:
            captured_delegate.append(args)
            return 23

        orchestrator.delegate = delegate_stub
        events.clear()

        result = orchestrator.dispatch_external_supervisor_request(
            delegate_request
        )

        check(
            "delegate dispatch returns trusted result",
            result == 23,
        )

        args = captured_delegate[0]

        check(
            "delegate dispatcher constructs bounded namespace",
            vars(args)
            == {
                "task": str(
                    (
                        orchestrator.STATE_DIR
                        / "n11-task.yaml"
                    ).resolve()
                ),
                "role": "qwen",
                "work_product": "EXTRACT",
                "reason": "bounded extraction",
                "expected_output": "evidence packet",
                "context_file": ["a.py"],
                "context_symbol": ["a.py:function_a"],
                "retry_of": None,
                "retry_kind": None,
            },
        )

        events.clear()

        def failing_status(task: str) -> int:
            raise orchestrator.OrchestratorError(
                "trusted status failure"
            )

        orchestrator.status = failing_status

        try:
            orchestrator.dispatch_external_supervisor_request(
                request
            )
        except orchestrator.OrchestratorError as exc:
            preserved = str(exc) == "trusted status failure"
        else:
            preserved = False

        check(
            "trusted operation failure propagates unchanged",
            preserved,
        )

        check(
            "failure provenance records type without raw error",
            events[-1][0] == "external_request_failed"
            and events[-1][1].get("error_type")
            == "OrchestratorError"
            and "error" not in events[-1][1],
        )

    finally:
        for name, value in originals.items():
            setattr(orchestrator, name, value)


def test_n10_reference_protocol() -> None:
    print("\n=== N10 REFERENCE PROTOCOL ===")

    def valid_json(request_id: str) -> str:
        return json.dumps(
            {
                "schema_version": (
                    orchestrator.EXTERNAL_SUPERVISOR_SCHEMA_VERSION
                ),
                "request_id": request_id,
                "supervisor_id": "n11-regression",
                "operation": "status",
                "task": "n11-task.yaml",
                "payload": {},
            }
        )

    original_dispatch = (
        orchestrator.dispatch_external_supervisor_request
    )
    original_state_dir = orchestrator.STATE_DIR
    n10_state = TemporaryDirectory()
    orchestrator.STATE_DIR = Path(n10_state.name)

    try:
        response = (
            orchestrator.execute_external_supervisor_json_request(
                "{malformed"
            )
        )

        check(
            "malformed protocol request is rejected",
            response["disposition"] == "rejected"
            and response["request_id"] is None,
        )

        def success_dispatch(
            request: orchestrator.ExternalSupervisorRequest,
        ) -> int:
            print("legacy stdout")
            print("legacy stderr", file=sys.stderr)
            return 17

        orchestrator.dispatch_external_supervisor_request = (
            success_dispatch
        )

        outer_stdout = StringIO()
        outer_stderr = StringIO()

        with (
            redirect_stdout(outer_stdout),
            redirect_stderr(outer_stderr),
        ):
            response = (
                orchestrator.execute_external_supervisor_json_request(
                    valid_json("n10-r0001")
                )
            )

        check(
            "successful protocol request completes",
            response["disposition"] == "completed"
            and response["request_id"] == "n10-r0001"
            and response["result"] == 17,
        )

        check(
            "legacy output captured inside protocol response",
            response["output"] == "legacy stdout\n"
            and response["diagnostics"] == "legacy stderr\n",
        )

        check(
            "legacy output does not escape protocol executor",
            outer_stdout.getvalue() == ""
            and outer_stderr.getvalue() == "",
        )

        def trusted_failure(
            request: orchestrator.ExternalSupervisorRequest,
        ) -> int:
            raise orchestrator.OrchestratorError(
                "trusted refusal"
            )

        orchestrator.dispatch_external_supervisor_request = (
            trusted_failure
        )

        response = (
            orchestrator.execute_external_supervisor_json_request(
                valid_json("n10-r0002")
            )
        )

        check(
            "trusted failure remains explicit protocol failure",
            response["disposition"] == "failed"
            and response["error_type"] == "OrchestratorError"
            and response["error"] == "trusted refusal",
        )

        def internal_failure(
            request: orchestrator.ExternalSupervisorRequest,
        ) -> int:
            print("SECRET-STDOUT")
            print("SECRET-STDERR", file=sys.stderr)
            raise ValueError("SECRET-ERROR")

        orchestrator.dispatch_external_supervisor_request = (
            internal_failure
        )

        response = (
            orchestrator.execute_external_supervisor_json_request(
                valid_json("n10-r0003")
            )
        )

        check(
            "unexpected failure is redacted",
            response["disposition"] == "internal_error"
            and response["error_type"] == "ValueError"
            and response["error"] is None
            and response["output"] == ""
            and response["diagnostics"] == "",
        )

        check(
            "internal error response contains no secret text",
            "SECRET-" not in json.dumps(response),
        )

        def interrupt_dispatch(
            request: orchestrator.ExternalSupervisorRequest,
        ) -> int:
            raise KeyboardInterrupt()

        orchestrator.dispatch_external_supervisor_request = (
            interrupt_dispatch
        )

        try:
            orchestrator.execute_external_supervisor_json_request(
                valid_json("n10-r0004")
            )
        except KeyboardInterrupt:
            interrupt_propagates = True
        else:
            interrupt_propagates = False

        check(
            "KeyboardInterrupt propagates through protocol executor",
            interrupt_propagates,
        )

    finally:
        orchestrator.dispatch_external_supervisor_request = (
            original_dispatch
        )
        orchestrator.STATE_DIR = original_state_dir
        n10_state.cleanup()

    original_argv = sys.argv
    original_stdin = sys.stdin
    original_executor = (
        orchestrator.execute_external_supervisor_json_request
    )

    try:
        calls: list[str] = []

        def fake_executor(text: str) -> dict[str, object]:
            calls.append(text)
            return {
                "schema_version": "1.0",
                "request_id": "cli-r0001",
                "disposition": "completed",
                "result": 0,
                "output": "Türkçe αβγ",
                "diagnostics": "",
                "error_type": None,
                "error": None,
            }

        orchestrator.execute_external_supervisor_json_request = (
            fake_executor
        )

        sys.argv = [
            "orchestrator.py",
            "external-request",
        ]
        sys.stdin = StringIO('{"request":"value"}\n')

        stdout = StringIO()
        stderr = StringIO()

        with (
            redirect_stdout(stdout),
            redirect_stderr(stderr),
        ):
            exit_code = orchestrator.main()

        lines = stdout.getvalue().splitlines()

        check(
            "external-request CLI delivers protocol with exit 0",
            exit_code == 0,
        )

        check(
            "external-request CLI forwards stdin unchanged once",
            calls == ['{"request":"value"}\n'],
        )

        check(
            "external-request CLI emits exactly one JSON line",
            len(lines) == 1
            and json.loads(lines[0])["request_id"]
            == "cli-r0001",
        )

        check(
            "external-request CLI preserves Unicode",
            "Türkçe αβγ" in lines[0],
        )

        check(
            "external-request CLI emits no wrapper stderr",
            stderr.getvalue() == "",
        )

        parser = orchestrator.build_parser()
        parser_stderr = StringIO()

        try:
            with redirect_stderr(parser_stderr):
                parser.parse_args(
                    [
                        "external-request",
                        "--command",
                        "human-approval",
                    ]
                )
        except SystemExit as exc:
            passthrough_rejected = exc.code == 2
        else:
            passthrough_rejected = False

        check(
            "external-request rejects command passthrough",
            passthrough_rejected,
        )

    finally:
        sys.argv = original_argv
        sys.stdin = original_stdin
        orchestrator.execute_external_supervisor_json_request = (
            original_executor
        )


def test_n13_request_replay_control() -> None:
    print("\n=== N13 REQUEST REPLAY / IDEMPOTENCY ===")

    original_state_dir = orchestrator.STATE_DIR
    original_dispatch = orchestrator.dispatch_external_supervisor_request

    try:
        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)

            malformed = (
                orchestrator.execute_external_supervisor_json_request(
                    "{malformed"
                )
            )

            check(
                "malformed request is not reserved",
                malformed["disposition"] == "rejected"
                and not orchestrator.external_request_ledger_path().exists(),
            )

            base_mapping = {
                "schema_version": (
                    orchestrator.EXTERNAL_SUPERVISOR_SCHEMA_VERSION
                ),
                "request_id": "n13-r0001",
                "supervisor_id": "n13-regression",
                "operation": "status",
                "task": "n13-task.yaml",
                "payload": {},
            }

            request = (
                orchestrator.external_supervisor_request_from_mapping(
                    base_mapping
                )
            )

            reordered = (
                orchestrator.external_supervisor_request_from_mapping(
                    {
                        "payload": {},
                        "task": "n13-task.yaml",
                        "operation": "status",
                        "supervisor_id": "n13-regression",
                        "request_id": "n13-r0001",
                        "schema_version": (
                            orchestrator.EXTERNAL_SUPERVISOR_SCHEMA_VERSION
                        ),
                    }
                )
            )

            check(
                "request fingerprint is canonical",
                orchestrator.external_supervisor_request_fingerprint(
                    request
                )
                == orchestrator.external_supervisor_request_fingerprint(
                    reordered
                ),
            )

            init_connection = orchestrator._open_external_request_ledger()
            init_connection.close()

            concurrent_mapping = {
                **base_mapping,
                "request_id": "n13-r-concurrent",
            }
            concurrent_request = (
                orchestrator.external_supervisor_request_from_mapping(
                    concurrent_mapping
                )
            )
            barrier = Barrier(2)

            def reserve_concurrently() -> object:
                barrier.wait()
                return orchestrator.reserve_external_supervisor_request(
                    concurrent_request
                ).state

            with ThreadPoolExecutor(max_workers=2) as executor:
                states = [
                    future.result()
                    for future in (
                        executor.submit(reserve_concurrently),
                        executor.submit(reserve_concurrently),
                    )
                ]

            check(
                "concurrent duplicate reservation has one winner",
                states.count(
                    orchestrator.ExternalRequestReservationState.RESERVED
                )
                == 1
                and states.count(
                    orchestrator.ExternalRequestReservationState
                    .ACTIVE_OR_INDETERMINATE
                )
                == 1,
            )

            calls: list[str] = []

            def success_dispatch(
                request: orchestrator.ExternalSupervisorRequest,
            ) -> int:
                calls.append(request.request_id)
                print("n13 stdout")
                return 17

            orchestrator.dispatch_external_supervisor_request = (
                success_dispatch
            )

            request_json = json.dumps(base_mapping)
            first = orchestrator.execute_external_supervisor_json_request(
                request_json
            )
            replay = orchestrator.execute_external_supervisor_json_request(
                request_json
            )

            check(
                "terminal duplicate replays stored response",
                first == replay
                and first["disposition"] == "completed"
                and first["result"] == 17
                and calls == ["n13-r0001"],
            )

            failure_mapping = {
                **base_mapping,
                "request_id": "n13-r-failed",
            }
            failure_json = json.dumps(failure_mapping)
            failure_calls: list[str] = []

            def failing_dispatch(
                request: orchestrator.ExternalSupervisorRequest,
            ) -> int:
                failure_calls.append(request.request_id)
                print("n13 failure stdout")
                raise orchestrator.OrchestratorError(
                    "n13 trusted failure"
                )

            orchestrator.dispatch_external_supervisor_request = (
                failing_dispatch
            )

            first_failure = (
                orchestrator.execute_external_supervisor_json_request(
                    failure_json
                )
            )
            failure_replay = (
                orchestrator.execute_external_supervisor_json_request(
                    failure_json
                )
            )

            check(
                "terminal failed duplicate replays stored response",
                first_failure == failure_replay
                and first_failure["disposition"] == "failed"
                and first_failure["error_type"] == "OrchestratorError"
                and first_failure["error"] == "n13 trusted failure"
                and first_failure["output"] == "n13 failure stdout\n"
                and failure_calls == ["n13-r-failed"],
            )

            orchestrator.dispatch_external_supervisor_request = (
                success_dispatch
            )

            conflict_mapping = {
                **base_mapping,
                "task": "different-task.yaml",
            }
            conflict = (
                orchestrator.execute_external_supervisor_json_request(
                    json.dumps(conflict_mapping)
                )
            )

            check(
                "same request_id with different content is rejected",
                conflict["disposition"] == "rejected"
                and conflict["error_type"]
                == "ExternalRequestReplayConflictError"
                and calls == ["n13-r0001"],
            )

            interrupt_mapping = {
                **base_mapping,
                "request_id": "n13-r-interrupt",
            }
            interrupt_json = json.dumps(interrupt_mapping)

            def interrupt_dispatch(
                request: orchestrator.ExternalSupervisorRequest,
            ) -> int:
                raise KeyboardInterrupt()

            orchestrator.dispatch_external_supervisor_request = (
                interrupt_dispatch
            )

            try:
                orchestrator.execute_external_supervisor_json_request(
                    interrupt_json
                )
            except KeyboardInterrupt:
                interrupt_propagates = True
            else:
                interrupt_propagates = False

            check(
                "interrupted request remains nonterminal",
                interrupt_propagates,
            )

            post_interrupt_calls: list[str] = []

            def must_not_dispatch(
                request: orchestrator.ExternalSupervisorRequest,
            ) -> int:
                post_interrupt_calls.append(request.request_id)
                return 99

            orchestrator.dispatch_external_supervisor_request = (
                must_not_dispatch
            )

            ambiguous = (
                orchestrator.execute_external_supervisor_json_request(
                    interrupt_json
                )
            )

            check(
                "nonterminal duplicate is never auto-reexecuted",
                ambiguous["disposition"] == "failed"
                and ambiguous["error_type"]
                == "ExternalRequestReplayIndeterminateError"
                and post_interrupt_calls == [],
            )

    finally:
        orchestrator.STATE_DIR = original_state_dir
        orchestrator.dispatch_external_supervisor_request = original_dispatch


def test_n14_event_contract() -> None:
    print("\n=== N14.1 EVENT CONTRACT ===")

    T = orchestrator.OrchestratorEventType
    S = orchestrator.OrchestratorEventSource

    expected_sources = {
        "trusted_core",
        "execution_supervisor",
        "provider",
        "verification",
        "human_authority",
        "control_plane",
    }

    check(
        "event source vocabulary matches contract",
        {item.value for item in S} == expected_sources,
    )

    expected_types = {
        "request.accepted",
        "request.rejected",
        "request.replayed",
        "request.conflict",
        "request.indeterminate",
        "request.completed",
        "request.failed",
        "task.state_changed",
        "routing.decided",
        "execution.prepared",
        "execution.started",
        "execution.progress_observed",
        "execution.progress_unobservable",
        "execution.stalled",
        "execution.timed_out",
        "execution.cancel_requested",
        "execution.cancel_resolved",
        "execution.failed",
        "execution.completed",
        "provider.inventory_observed",
        "model.binding_selected",
        "model.load_observed",
        "budget.resolved",
        "evidence.recorded",
        "evidence.promoted",
        "verification.started",
        "verification.completed",
        "approval.required",
        "approval.recorded",
        "transition.proposed",
        "transition.accepted",
        "transition.rejected",
    }

    check(
        "event type vocabulary matches contract",
        {item.value for item in T} == expected_types,
    )

    check(
        "event vocabulary contains no duplicate values",
        len({item.value for item in T}) == len(T),
    )

    def make_event(
        event_type: T = T.REQUEST_ACCEPTED,
        source_class: S = S.TRUSTED_CORE,
        **overrides: object,
    ) -> orchestrator.OrchestratorEvent:
        values: dict[str, object] = {
            "schema_version": orchestrator.TRUST_EVENT_SCHEMA_VERSION,
            "event_seq": 1,
            "event_id": "evt-0001",
            "event_type": event_type.value,
            "occurred_at": "2026-09-18T06:00:00+00:00",
            "source_class": source_class,
            "component": "regression",
            "task_id": "task-001",
            "execution_id": "x0001",
            "parent_execution_id": None,
            "request_id": "request-001",
            "worker_role": "qwen",
            "provider_id": "lm_studio",
            "model_id": "qwen/qwen3.5-9b",
            "state_before": "RUNNING",
            "state_after": "COMPLETED",
            "reason_code": "regression",
            "evidence_refs": ("ev0001",),
            "payload": {
                "nested": {
                    "items": [
                        1,
                        {"selected": True},
                    ]
                }
            },
        }
        values.update(overrides)

        return orchestrator.OrchestratorEvent(**values)  # type: ignore[arg-type]

    valid = make_event()

    orchestrator.validate_orchestrator_event(valid)

    check(
        "valid event passes structural and semantic validation",
        True,
    )

    expect_orchestrator_error(
        "boolean event sequence rejected",
        lambda: orchestrator.validate_orchestrator_event(
            make_event(event_seq=True)
        ),
    )

    expect_orchestrator_error(
        "zero event sequence rejected",
        lambda: orchestrator.validate_orchestrator_event(
            make_event(event_seq=0)
        ),
    )

    expect_orchestrator_error(
        "unsupported schema version rejected",
        lambda: orchestrator.validate_orchestrator_event(
            make_event(schema_version="999")
        ),
    )

    invalid_type = make_event()
    object.__setattr__(
        invalid_type,
        "event_type",
        "request.magic",
    )

    expect_orchestrator_error(
        "unknown event type rejected after construction",
        lambda: orchestrator.validate_orchestrator_event(
            invalid_type
        ),
    )

    expect_orchestrator_error(
        "non-UTC event timestamp rejected",
        lambda: orchestrator.validate_orchestrator_event(
            make_event(
                occurred_at="2026-09-18T08:00:00+02:00"
            )
        ),
    )

    expect_orchestrator_error(
        "naive event timestamp rejected",
        lambda: orchestrator.validate_orchestrator_event(
            make_event(
                occurred_at="2026-09-18T06:00:00"
            )
        ),
    )

    expect_orchestrator_error(
        "duplicate evidence references rejected",
        lambda: orchestrator.validate_orchestrator_event(
            make_event(
                evidence_refs=("ev0001", "ev0001")
            )
        ),
    )

    caller_payload = {
        "route": {
            "models": [
                "qwen/qwen3.5-9b",
                {"selected": True},
            ]
        }
    }

    immutable = make_event(payload=caller_payload)

    caller_payload["route"]["models"][1]["selected"] = False
    caller_payload["route"]["models"].append("mutated")

    check(
        "event payload is detached from caller-owned data",
        immutable.payload["route"]["models"][1]["selected"] is True
        and len(immutable.payload["route"]["models"]) == 2,
    )

    try:
        immutable.payload["new"] = "mutation"  # type: ignore[index]
    except TypeError:
        top_level_mutation_rejected = True
    else:
        top_level_mutation_rejected = False

    check(
        "top-level event payload mutation rejected",
        top_level_mutation_rejected,
    )

    try:
        immutable.payload["route"]["models"][1][
            "selected"
        ] = False
    except TypeError:
        nested_mutation_rejected = True
    else:
        nested_mutation_rejected = False

    check(
        "nested event payload mutation rejected",
        nested_mutation_rejected,
    )

    expect_orchestrator_error(
        "non-string payload mapping key rejected",
        lambda: make_event(payload={1: "bad"}),
    )

    expect_orchestrator_error(
        "set payload value rejected",
        lambda: make_event(payload={"value": {"bad"}}),
    )

    expect_orchestrator_error(
        "bytes payload value rejected",
        lambda: make_event(payload={"value": b"bad"}),
    )

    expect_orchestrator_error(
        "NaN payload value rejected",
        lambda: make_event(payload={"value": float("nan")}),
    )

    expect_orchestrator_error(
        "infinite payload value rejected",
        lambda: make_event(payload={"value": float("inf")}),
    )

    serialized_source = make_event(
        payload={
            "z": [
                3,
                {"b": 2, "a": 1},
            ],
            "a": True,
            "note": "Türkçe αβγ",
        }
    )

    projection = orchestrator.orchestrator_event_to_mapping(
        serialized_source
    )

    check(
        "immutable event projects to JSON-safe values",
        isinstance(projection, dict)
        and isinstance(projection["payload"], dict)
        and isinstance(projection["payload"]["z"], list)
        and isinstance(projection["evidence_refs"], list),
    )

    projection["payload"]["z"].append("mutation")
    projection["evidence_refs"].append("mutation")

    check(
        "serialized projection is detached from trusted event",
        len(serialized_source.payload["z"]) == 2
        and serialized_source.evidence_refs == ("ev0001",),
    )

    canonical = (
        orchestrator.canonical_orchestrator_event_json(
            serialized_source
        )
    )
    decoded = json.loads(canonical)

    check(
        "canonical event JSON round-trips",
        decoded["event_seq"] == 1
        and decoded["source_class"] == "trusted_core"
        and decoded["payload"]["z"][1] == {"a": 1, "b": 2},
    )

    check(
        "canonical event JSON preserves Unicode",
        "Türkçe αβγ" in canonical,
    )

    equivalent = make_event(
        payload={
            "note": "Türkçe αβγ",
            "a": True,
            "z": [
                3,
                {"a": 1, "b": 2},
            ],
        }
    )

    check(
        "equivalent event mappings serialize identically",
        canonical
        == orchestrator.canonical_orchestrator_event_json(
            equivalent
        ),
    )

    expect_orchestrator_error(
        "serializer refuses structurally invalid event",
        lambda: (
            orchestrator.canonical_orchestrator_event_json(
                make_event(event_seq=0)
            )
        ),
    )

    check(
        "every event type has explicit source policy",
        set(orchestrator.ORCHESTRATOR_EVENT_ALLOWED_SOURCES)
        == set(T),
    )

    check(
        "required-field policy references only declared events",
        set(orchestrator.ORCHESTRATOR_EVENT_REQUIRED_FIELDS)
        <= set(T),
    )

    check(
        "control plane cannot author trusted event facts",
        all(
            S.CONTROL_PLANE not in allowed_sources
            for allowed_sources in (
                orchestrator.ORCHESTRATOR_EVENT_ALLOWED_SOURCES.values()
            )
        ),
    )

    allowed_source_validation = True

    for event_type, allowed_sources in (
        orchestrator.ORCHESTRATOR_EVENT_ALLOWED_SOURCES.items()
    ):
        for source_class in allowed_sources:
            try:
                orchestrator.validate_orchestrator_event(
                    make_event(
                        event_type=event_type,
                        source_class=source_class,
                    )
                )
            except orchestrator.OrchestratorError:
                allowed_source_validation = False

    check(
        "declared event source policies accept allowed sources",
        allowed_source_validation,
    )

    expect_orchestrator_error(
        "provider cannot record human approval",
        lambda: orchestrator.validate_orchestrator_event(
            make_event(
                event_type=T.APPROVAL_RECORDED,
                source_class=S.PROVIDER,
            )
        ),
    )

    expect_orchestrator_error(
        "human authority cannot claim execution completion",
        lambda: orchestrator.validate_orchestrator_event(
            make_event(
                event_type=T.EXECUTION_COMPLETED,
                source_class=S.HUMAN_AUTHORITY,
            )
        ),
    )

    expect_orchestrator_error(
        "control plane cannot author request acceptance",
        lambda: orchestrator.validate_orchestrator_event(
            make_event(
                event_type=T.REQUEST_ACCEPTED,
                source_class=S.CONTROL_PLANE,
            )
        ),
    )

    expect_orchestrator_error(
        "request acceptance without request_id rejected",
        lambda: orchestrator.validate_orchestrator_event(
            make_event(request_id=None)
        ),
    )

    expect_orchestrator_error(
        "execution completion without execution_id rejected",
        lambda: orchestrator.validate_orchestrator_event(
            make_event(
                event_type=T.EXECUTION_COMPLETED,
                source_class=S.EXECUTION_SUPERVISOR,
                execution_id=None,
            )
        ),
    )

    expect_orchestrator_error(
        "routing decision without reason_code rejected",
        lambda: orchestrator.validate_orchestrator_event(
            make_event(
                event_type=T.ROUTING_DECIDED,
                reason_code=None,
            )
        ),
    )

    expect_orchestrator_error(
        "no-op task state change rejected",
        lambda: orchestrator.validate_orchestrator_event(
            make_event(
                event_type=T.TASK_STATE_CHANGED,
                state_before="ADJUDICATE",
                state_after="ADJUDICATE",
            )
        ),
    )

    expect_orchestrator_error(
        "evidence event without references rejected",
        lambda: orchestrator.validate_orchestrator_event(
            make_event(
                event_type=T.EVIDENCE_RECORDED,
                source_class=S.VERIFICATION,
                evidence_refs=(),
            )
        ),
    )

    rejected_without_id = make_event(
        event_type=T.REQUEST_REJECTED,
        request_id=None,
    )

    orchestrator.validate_orchestrator_event(
        rejected_without_id
    )

    check(
        "malformed request rejection may omit request_id",
        True,
    )


def test_n14_2_event_journal_write() -> None:
    print("\n=== N14.2a-e EVENT JOURNAL STORAGE / APPEND ===")

    T = orchestrator.OrchestratorEventType
    S = orchestrator.OrchestratorEventSource

    original_state_dir = orchestrator.STATE_DIR

    def make_draft(
        event_id: str,
        *,
        request_id: str | None = "request-001",
        payload: object | None = None,
    ) -> orchestrator.OrchestratorEventDraft:
        return orchestrator.OrchestratorEventDraft(
            schema_version=(
                orchestrator.TRUST_EVENT_SCHEMA_VERSION
            ),
            event_id=event_id,
            event_type=T.REQUEST_ACCEPTED.value,
            occurred_at="2026-09-18T06:00:00+00:00",
            source_class=S.TRUSTED_CORE,
            component="external_supervisor",
            task_id="task-001",
            execution_id=None,
            parent_execution_id=None,
            request_id=request_id,
            worker_role=None,
            provider_id=None,
            model_id=None,
            state_before=None,
            state_after=None,
            reason_code=None,
            evidence_refs=("ev0001",),
            payload=(
                payload
                if payload is not None
                else {"message": "Türkçe αβγ"}
            ),
        )

    try:
        check(
            "event journal filename is stable",
            orchestrator.EVENT_JOURNAL_FILENAME
            == "_event-journal.sqlite3",
        )

        check(
            "event journal schema version is stable",
            orchestrator.EVENT_JOURNAL_USER_VERSION == 1,
        )

        draft = make_draft("evt-materialize")

        check(
            "event draft cannot own event_seq",
            not hasattr(draft, "event_seq"),
        )

        orchestrator.validate_orchestrator_event_draft(
            draft
        )

        materialized = (
            orchestrator.materialize_orchestrator_event(
                draft,
                event_seq=42,
            )
        )

        check(
            "valid draft materializes with assigned event_seq",
            materialized.event_seq == 42
            and materialized.event_id == draft.event_id,
        )

        expect_orchestrator_error(
            "boolean materialized event_seq rejected",
            lambda: orchestrator.materialize_orchestrator_event(
                draft,
                event_seq=True,
            ),
        )

        expect_orchestrator_error(
            "invalid draft required context rejected",
            lambda: (
                orchestrator.validate_orchestrator_event_draft(
                    make_draft(
                        "evt-invalid-context",
                        request_id=None,
                    )
                )
            ),
        )

        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)

            journal_path = orchestrator.event_journal_path()

            check(
                "event journal path is under trusted state root",
                journal_path
                == Path(temp_dir)
                / orchestrator.EVENT_JOURNAL_FILENAME,
            )

            connection = orchestrator._open_event_journal()

            try:
                version = connection.execute(
                    "PRAGMA user_version"
                ).fetchone()[0]

                check(
                    "new journal persists schema version",
                    version
                    == orchestrator.EVENT_JOURNAL_USER_VERSION,
                )

                orchestrator._validate_event_journal_schema(
                    connection
                )

                check(
                    "new journal matches schema integrity contract",
                    True,
                )

            finally:
                connection.close()

            reopened = orchestrator._open_event_journal()

            try:
                orchestrator._validate_event_journal_schema(
                    reopened
                )
            finally:
                reopened.close()

            check(
                "valid journal reopens and revalidates",
                True,
            )

        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)

            journal_path = orchestrator.event_journal_path()

            invalid = make_draft(
                "evt-invalid",
                request_id=None,
            )

            try:
                orchestrator.append_orchestrator_event(
                    invalid
                )
            except orchestrator.OrchestratorError:
                invalid_rejected = True
            else:
                invalid_rejected = False

            check(
                "invalid draft fails before journal creation",
                invalid_rejected
                and not journal_path.exists(),
            )

            first = orchestrator.append_orchestrator_event(
                make_draft(
                    "evt-0001",
                    payload={
                        "message": "Türkçe αβγ",
                        "nested": [
                            1,
                            {"b": 2, "a": 1},
                        ],
                    },
                )
            )

            second = orchestrator.append_orchestrator_event(
                make_draft(
                    "evt-0002",
                    request_id="request-002",
                )
            )

            check(
                "SQLite allocates monotonic event sequences",
                first.event_seq == 1
                and second.event_seq > first.event_seq,
            )

            check(
                "append returns trusted reconstructed event",
                isinstance(
                    first,
                    orchestrator.OrchestratorEvent,
                )
                and first.event_id == "evt-0001"
                and first.payload["message"]
                == "Türkçe αβγ",
            )

            connection = sqlite3.connect(journal_path)
            connection.row_factory = sqlite3.Row

            try:
                rows = connection.execute(
                    """
                    SELECT *
                    FROM orchestrator_events
                    ORDER BY event_seq
                    """
                ).fetchall()

                stored_payload = rows[0]["payload_json"]

                expected_payload = json.dumps(
                    {
                        "message": "Türkçe αβγ",
                        "nested": [
                            1,
                            {"a": 1, "b": 2},
                        ],
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                    ensure_ascii=False,
                    allow_nan=False,
                )

                reconstructed = (
                    orchestrator
                    ._orchestrator_event_from_journal_row(
                        rows[0]
                    )
                )

            finally:
                connection.close()

            check(
                "persisted payload JSON is canonical",
                stored_payload == expected_payload,
            )

            check(
                "persisted row reconstructs trusted event",
                reconstructed == first,
            )

            try:
                orchestrator.append_orchestrator_event(
                    make_draft(
                        "evt-0001",
                        request_id="request-duplicate",
                    )
                )
            except orchestrator.EventJournalError:
                duplicate_rejected = True
            else:
                duplicate_rejected = False

            connection = sqlite3.connect(journal_path)

            try:
                row_count = connection.execute(
                    """
                    SELECT COUNT(*)
                    FROM orchestrator_events
                    """
                ).fetchone()[0]
            finally:
                connection.close()

            check(
                "duplicate event_id rolls back atomically",
                duplicate_rejected and row_count == 2,
            )

            third = orchestrator.append_orchestrator_event(
                make_draft(
                    "evt-0003",
                    request_id="request-003",
                )
            )

            check(
                "journal remains writable after rejected duplicate",
                third.event_seq > second.event_seq,
            )

        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)

            connection = orchestrator._open_event_journal()

            try:
                connection.execute(
                    """
                    DROP INDEX
                    idx_orchestrator_events_request_seq
                    """
                )
                connection.commit()
            finally:
                connection.close()

            try:
                orchestrator._open_event_journal()
            except orchestrator.EventJournalError:
                missing_index_rejected = True
            else:
                missing_index_rejected = False

            check(
                "versioned journal missing required index rejected",
                missing_index_rejected,
            )

        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)
            journal_path = orchestrator.event_journal_path()
            journal_path.parent.mkdir(
                parents=True,
                exist_ok=True,
            )

            connection = sqlite3.connect(journal_path)

            try:
                connection.execute(
                    "PRAGMA user_version = 99"
                )
                connection.commit()
            finally:
                connection.close()

            try:
                orchestrator._open_event_journal()
            except orchestrator.EventJournalError:
                unsupported_version_rejected = True
            else:
                unsupported_version_rejected = False

            check(
                "unsupported journal version rejected",
                unsupported_version_rejected,
            )

    finally:
        orchestrator.STATE_DIR = original_state_dir

    check(
        "STATE_DIR restored after journal write regression",
        orchestrator.STATE_DIR == original_state_dir,
    )


def test_n14_2_event_journal_read() -> None:
    print("\n=== N14.2f EVENT JOURNAL READ / CURSOR ===")

    T = orchestrator.OrchestratorEventType
    S = orchestrator.OrchestratorEventSource

    original_state_dir = orchestrator.STATE_DIR

    def make_draft(
        event_id: str,
        *,
        task_id: str,
        request_id: str,
        execution_id: str | None = None,
    ) -> orchestrator.OrchestratorEventDraft:
        return orchestrator.OrchestratorEventDraft(
            schema_version=(
                orchestrator.TRUST_EVENT_SCHEMA_VERSION
            ),
            event_id=event_id,
            event_type=T.REQUEST_ACCEPTED.value,
            occurred_at="2026-09-18T06:00:00+00:00",
            source_class=S.TRUSTED_CORE,
            component="external_supervisor",
            task_id=task_id,
            execution_id=execution_id,
            parent_execution_id=None,
            request_id=request_id,
            worker_role=None,
            provider_id=None,
            model_id=None,
            state_before=None,
            state_after=None,
            reason_code=None,
            evidence_refs=(),
            payload={"event": event_id},
        )

    try:
        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)

            empty = orchestrator.read_orchestrator_events()

            check(
                "empty event journal returns immutable empty tuple",
                empty == () and isinstance(empty, tuple),
            )

            first = orchestrator.append_orchestrator_event(
                make_draft(
                    "evt-0001",
                    task_id="task-a",
                    request_id="req-a",
                    execution_id="x0001",
                )
            )

            second = orchestrator.append_orchestrator_event(
                make_draft(
                    "evt-0002",
                    task_id="task-b",
                    request_id="req-b",
                    execution_id="x0002",
                )
            )

            third = orchestrator.append_orchestrator_event(
                make_draft(
                    "evt-0003",
                    task_id="task-a",
                    request_id="req-c",
                    execution_id="x0003",
                )
            )

            fourth = orchestrator.append_orchestrator_event(
                make_draft(
                    "evt-0004",
                    task_id="task-a",
                    request_id="req-d",
                    execution_id="x0004",
                )
            )

            all_events = (
                orchestrator.read_orchestrator_events()
            )

            check(
                "journal reads return ascending event_seq order",
                isinstance(all_events, tuple)
                and [
                    event.event_id
                    for event in all_events
                ]
                == [
                    "evt-0001",
                    "evt-0002",
                    "evt-0003",
                    "evt-0004",
                ],
            )

            after_first = (
                orchestrator.read_orchestrator_events(
                    after_event_seq=first.event_seq,
                )
            )

            check(
                "event_seq cursor excludes prior events",
                [
                    event.event_id
                    for event in after_first
                ]
                == [
                    "evt-0002",
                    "evt-0003",
                    "evt-0004",
                ],
            )

            limited = orchestrator.read_orchestrator_events(
                limit=2,
            )

            check(
                "journal read limit is enforced",
                [
                    event.event_id
                    for event in limited
                ]
                == [
                    "evt-0001",
                    "evt-0002",
                ],
            )

            task_events = (
                orchestrator.read_orchestrator_events(
                    task_id="task-a",
                )
            )

            check(
                "task_id journal filter is exact",
                [
                    event.event_id
                    for event in task_events
                ]
                == [
                    "evt-0001",
                    "evt-0003",
                    "evt-0004",
                ],
            )

            execution_events = (
                orchestrator.read_orchestrator_events(
                    execution_id="x0002",
                )
            )

            check(
                "execution_id journal filter is exact",
                execution_events == (second,),
            )

            request_events = (
                orchestrator.read_orchestrator_events(
                    request_id="req-c",
                )
            )

            check(
                "request_id journal filter is exact",
                request_events == (third,),
            )

            combined = (
                orchestrator.read_orchestrator_events(
                    after_event_seq=first.event_seq,
                    task_id="task-a",
                    limit=1,
                )
            )

            check(
                "cursor filter and limit compose deterministically",
                combined == (third,),
            )

            exhausted = (
                orchestrator.read_orchestrator_events(
                    after_event_seq=fourth.event_seq,
                )
            )

            check(
                "exhausted journal cursor returns empty tuple",
                exhausted == (),
            )

            invalid_argument_cases = (
                {"after_event_seq": True},
                {"after_event_seq": -1},
                {"limit": 0},
                {"limit": 1001},
                {"task_id": " task-a"},
                {"execution_id": ""},
                {"request_id": "req-a "},
            )

            invalid_arguments_rejected = True

            for kwargs in invalid_argument_cases:
                try:
                    orchestrator.read_orchestrator_events(
                        **kwargs
                    )
                except orchestrator.OrchestratorError:
                    continue

                invalid_arguments_rejected = False
                break

            check(
                "invalid journal read arguments rejected",
                invalid_arguments_rejected,
            )

        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)

            orchestrator.append_orchestrator_event(
                make_draft(
                    "evt-corrupt",
                    task_id="task-corrupt",
                    request_id="req-corrupt",
                )
            )

            journal_path = orchestrator.event_journal_path()

            connection = sqlite3.connect(journal_path)

            try:
                connection.execute(
                    """
                    UPDATE orchestrator_events
                    SET payload_json = ?
                    WHERE event_id = ?
                    """,
                    (
                        "{not-json",
                        "evt-corrupt",
                    ),
                )
                connection.commit()

            finally:
                connection.close()

            try:
                orchestrator.read_orchestrator_events()
            except orchestrator.EventJournalError:
                corruption_rejected = True
            else:
                corruption_rejected = False

            check(
                "corrupted persisted event fails closed",
                corruption_rejected,
            )

    finally:
        orchestrator.STATE_DIR = original_state_dir

    check(
        "STATE_DIR restored after journal read regression",
        orchestrator.STATE_DIR == original_state_dir,
    )


def test_n14_3_external_request_events() -> None:
    print("\n=== N14.3a EXTERNAL REQUEST RUNTIME EVENTS ===")

    T = orchestrator.OrchestratorEventType
    O = orchestrator.ExternalSupervisorOperation

    original_state_dir = orchestrator.STATE_DIR
    original_dispatch = (
        orchestrator.dispatch_external_supervisor_request
    )
    original_persist = (
        orchestrator.persist_external_supervisor_response
    )
    original_append = orchestrator.append_orchestrator_event

    def request_json(
        request_id: str,
        *,
        task: str = "task-001",
    ) -> str:
        return json.dumps(
            {
                "schema_version": (
                    orchestrator
                    .EXTERNAL_SUPERVISOR_SCHEMA_VERSION
                ),
                "request_id": request_id,
                "supervisor_id": "test-supervisor",
                "operation": "status",
                "task": task,
                "payload": {},
            }
        )

    try:
        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)

            request = orchestrator.ExternalSupervisorRequest(
                schema_version=(
                    orchestrator
                    .EXTERNAL_SUPERVISOR_SCHEMA_VERSION
                ),
                request_id="n14-3-helper",
                supervisor_id="test-supervisor",
                operation=O.DELEGATE,
                task="task-001",
                payload={
                    "role": "qwen",
                    "work_product": "SUMMARIZE",
                    "reason": "MUST-NOT-BE-JOURNALED",
                    "expected_output": "summary",
                },
            )

            helper_event = (
                orchestrator.emit_external_supervisor_event(
                    T.REQUEST_ACCEPTED,
                    request=request,
                    reason_code="durable_reservation",
                )
            )

            check(
                "request event helper emits trusted-core event",
                isinstance(
                    helper_event,
                    orchestrator.OrchestratorEvent,
                )
                and helper_event.event_type
                == "request.accepted"
                and helper_event.request_id
                == "n14-3-helper"
                and helper_event.source_class
                is orchestrator.OrchestratorEventSource.TRUSTED_CORE
                and helper_event.component
                == "external_supervisor_protocol",
            )

            serialized_helper = json.dumps(
                orchestrator.orchestrator_event_to_mapping(
                    helper_event
                ),
                ensure_ascii=False,
            )

            check(
                "request event helper omits raw request payload",
                "MUST-NOT-BE-JOURNALED"
                not in serialized_helper,
            )

            expect_orchestrator_error(
                "request event helper rejects non-request events",
                lambda: orchestrator.emit_external_supervisor_event(
                    T.EXECUTION_COMPLETED,
                    request=request,
                ),
            )

        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)

            dispatch_count = [0]

            def successful_dispatch(
                request: orchestrator.ExternalSupervisorRequest,
            ) -> int:
                dispatch_count[0] += 1
                return 17

            orchestrator.dispatch_external_supervisor_request = (
                successful_dispatch
            )

            text_value = request_json("n14-3-r1001")

            first = (
                orchestrator
                .execute_external_supervisor_json_request(
                    text_value
                )
            )

            first_events = (
                orchestrator.read_orchestrator_events(
                    request_id="n14-3-r1001"
                )
            )

            check(
                "fresh request emits accepted then completed",
                first["disposition"] == "completed"
                and first["result"] == 17
                and dispatch_count[0] == 1
                and [
                    event.event_type
                    for event in first_events
                ]
                == [
                    "request.accepted",
                    "request.completed",
                ],
            )

            check(
                "terminal request event follows durable replay persistence",
                first_events[-1].reason_code
                == "terminal_response_persisted",
            )

            replay = (
                orchestrator
                .execute_external_supervisor_json_request(
                    text_value
                )
            )

            replay_events = (
                orchestrator.read_orchestrator_events(
                    request_id="n14-3-r1001"
                )
            )

            check(
                "terminal replay emits replayed without redispatch",
                replay == first
                and dispatch_count[0] == 1
                and replay_events[-1].event_type
                == "request.replayed",
            )

            conflict = (
                orchestrator
                .execute_external_supervisor_json_request(
                    request_json(
                        "n14-3-r1001",
                        task="different-task",
                    )
                )
            )

            conflict_events = (
                orchestrator.read_orchestrator_events(
                    request_id="n14-3-r1001"
                )
            )

            check(
                "request fingerprint conflict emits conflict",
                conflict["disposition"] == "rejected"
                and conflict["error_type"]
                == "ExternalRequestReplayConflictError"
                and dispatch_count[0] == 1
                and conflict_events[-1].event_type
                == "request.conflict",
            )

            malformed = (
                orchestrator
                .execute_external_supervisor_json_request(
                    "{}"
                )
            )

            all_events = orchestrator.read_orchestrator_events()

            check(
                "malformed request emits rejection without request_id",
                malformed["disposition"] == "rejected"
                and malformed["request_id"] is None
                and all_events[-1].event_type
                == "request.rejected"
                and all_events[-1].request_id is None,
            )

            def trusted_failure(
                request: orchestrator.ExternalSupervisorRequest,
            ) -> int:
                raise orchestrator.OrchestratorError(
                    "trusted refusal"
                )

            orchestrator.dispatch_external_supervisor_request = (
                trusted_failure
            )

            failed = (
                orchestrator
                .execute_external_supervisor_json_request(
                    request_json("n14-3-r1002")
                )
            )

            failed_events = (
                orchestrator.read_orchestrator_events(
                    request_id="n14-3-r1002"
                )
            )

            check(
                "persisted trusted failure emits request.failed",
                failed["disposition"] == "failed"
                and [
                    event.event_type
                    for event in failed_events
                ]
                == [
                    "request.accepted",
                    "request.failed",
                ],
            )

            def unexpected_failure(
                request: orchestrator.ExternalSupervisorRequest,
            ) -> int:
                raise ValueError(
                    "SECRET-INTERNAL-ERROR"
                )

            orchestrator.dispatch_external_supervisor_request = (
                unexpected_failure
            )

            internal = (
                orchestrator
                .execute_external_supervisor_json_request(
                    request_json("n14-3-r1003")
                )
            )

            internal_events = (
                orchestrator.read_orchestrator_events(
                    request_id="n14-3-r1003"
                )
            )

            serialized_internal = json.dumps(
                [
                    orchestrator
                    .orchestrator_event_to_mapping(event)
                    for event in internal_events
                ]
            )

            check(
                "internal failure emits redacted request.failed",
                internal["disposition"] == "internal_error"
                and internal["error"] is None
                and [
                    event.event_type
                    for event in internal_events
                ]
                == [
                    "request.accepted",
                    "request.failed",
                ]
                and "SECRET-INTERNAL-ERROR"
                not in serialized_internal,
            )

        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)

            orchestrator.dispatch_external_supervisor_request = (
                lambda request: 23
            )

            def failed_persist(
                request: orchestrator.ExternalSupervisorRequest,
                *,
                request_fingerprint: str,
                response: dict[str, object],
            ) -> None:
                raise orchestrator.ExternalRequestLedgerError(
                    "SECRET-LEDGER-FAILURE"
                )

            orchestrator.persist_external_supervisor_response = (
                failed_persist
            )

            text_value = request_json("n14-3-r2001")

            response = (
                orchestrator
                .execute_external_supervisor_json_request(
                    text_value
                )
            )

            events = orchestrator.read_orchestrator_events(
                request_id="n14-3-r2001"
            )

            serialized_events = json.dumps(
                [
                    orchestrator
                    .orchestrator_event_to_mapping(event)
                    for event in events
                ]
            )

            check(
                "terminal replay persistence failure emits indeterminate",
                response["disposition"] == "internal_error"
                and [
                    event.event_type
                    for event in events
                ]
                == [
                    "request.accepted",
                    "request.indeterminate",
                ]
                and events[-1].reason_code
                == "terminal_replay_persistence_failed"
                and "SECRET-LEDGER-FAILURE"
                not in serialized_events,
            )

            orchestrator.persist_external_supervisor_response = (
                original_persist
            )

            duplicate = (
                orchestrator
                .execute_external_supervisor_json_request(
                    text_value
                )
            )

            duplicate_events = (
                orchestrator.read_orchestrator_events(
                    request_id="n14-3-r2001"
                )
            )

            check(
                "nonterminal duplicate emits indeterminate without redispatch",
                duplicate["disposition"] == "failed"
                and duplicate["error_type"]
                == "ExternalRequestReplayIndeterminateError"
                and duplicate_events[-1].event_type
                == "request.indeterminate"
                and duplicate_events[-1].reason_code
                == "active_or_indeterminate_request",
            )

        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)

            orchestrator.dispatch_external_supervisor_request = (
                lambda request: 31
            )

            def unavailable_journal(
                draft: orchestrator.OrchestratorEventDraft,
            ) -> orchestrator.OrchestratorEvent:
                raise orchestrator.EventJournalError(
                    "SECRET-JOURNAL-FAILURE"
                )

            orchestrator.append_orchestrator_event = (
                unavailable_journal
            )

            stderr = StringIO()

            with redirect_stderr(stderr):
                response = (
                    orchestrator
                    .execute_external_supervisor_json_request(
                        request_json("n14-3-r3001")
                    )
                )

            warning = stderr.getvalue()

            check(
                "event journal outage does not alter request result",
                response["disposition"] == "completed"
                and response["result"] == 31,
            )

            check(
                "runtime event journal warning is redacted",
                "EventJournalError" in warning
                and "SECRET-JOURNAL-FAILURE"
                not in warning,
            )

    finally:
        orchestrator.append_orchestrator_event = original_append
        orchestrator.persist_external_supervisor_response = (
            original_persist
        )
        orchestrator.dispatch_external_supervisor_request = (
            original_dispatch
        )
        orchestrator.STATE_DIR = original_state_dir

    check(
        "N14.3a regression restores patched runtime state",
        orchestrator.STATE_DIR == original_state_dir
        and orchestrator.append_orchestrator_event
        is original_append
        and orchestrator.persist_external_supervisor_response
        is original_persist
        and orchestrator.dispatch_external_supervisor_request
        is original_dispatch,
    )


def test_n14_3b_worker_execution_events() -> None:
    print("\n=== N14.3b WORKER EXECUTION RUNTIME EVENTS ===")

    T = orchestrator.OrchestratorEventType

    original_state_dir = orchestrator.STATE_DIR
    original_append = orchestrator.append_orchestrator_event

    def make_request(
        execution_id: str,
    ) -> orchestrator.WorkerExecutionRequest:
        return orchestrator.WorkerExecutionRequest(
            execution_id=execution_id,
            task_id="task-001",
            attempt_id="d001",
            provider_id="stub",
            model_id="qwen/qwen3.5-9b",
            system_prompt="SECRET-SYSTEM-PROMPT",
            user_prompt="SECRET-USER-PROMPT",
            temperature=0.2,
            max_output_tokens=128,
            budget=orchestrator.ExecutionBudget(
                fallback_timeout_seconds=60,
            ),
        )

    try:
        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)

            request = make_request("x-n14-3b-helper")

            helper_event = (
                orchestrator.emit_worker_execution_event(
                    T.BUDGET_RESOLVED,
                    request=request,
                    reason_code="execution_timeout_resolved",
                    details={
                        "timeout_seconds": 60,
                        "prediction_source": "fallback",
                    },
                )
            )

            check(
                "worker emitter records trusted execution identity",
                isinstance(
                    helper_event,
                    orchestrator.OrchestratorEvent,
                )
                and helper_event.event_type
                == "budget.resolved"
                and helper_event.task_id == "task-001"
                and helper_event.execution_id
                == "x-n14-3b-helper"
                and helper_event.provider_id == "stub"
                and helper_event.model_id
                == "qwen/qwen3.5-9b"
                and helper_event.source_class
                is orchestrator.OrchestratorEventSource
                .EXECUTION_SUPERVISOR
                and helper_event.component
                == "worker_execution_supervisor",
            )

            helper_serialized = (
                orchestrator.canonical_orchestrator_event_json(
                    helper_event
                )
            )

            check(
                "worker emitter excludes request prompts",
                "SECRET-SYSTEM-PROMPT"
                not in helper_serialized
                and "SECRET-USER-PROMPT"
                not in helper_serialized,
            )

            expect_orchestrator_error(
                "worker emitter rejects unimplemented progress event",
                lambda: orchestrator.emit_worker_execution_event(
                    T.EXECUTION_PROGRESS_OBSERVED,
                    request=request,
                ),
            )

        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)

            request = make_request("x-n14-3b-success")
            transport_calls: list[float] = []

            def successful_transport(
                received: orchestrator.WorkerExecutionRequest,
                timeout_seconds: float,
            ) -> str:
                transport_calls.append(timeout_seconds)
                return "SECRET-WORKER-OUTPUT"

            result = orchestrator.supervise_worker_execution(
                request,
                successful_transport,
            )

            events = orchestrator.read_orchestrator_events(
                execution_id="x-n14-3b-success"
            )

            check(
                "successful execution emits budget start completed",
                result.state
                is orchestrator.ExecutionState.COMPLETED
                and result.output == "SECRET-WORKER-OUTPUT"
                and transport_calls == [60]
                and [
                    event.event_type
                    for event in events
                ]
                == [
                    "budget.resolved",
                    "execution.started",
                    "execution.completed",
                ],
            )

            check(
                "resolved execution budget is observable",
                events[0].reason_code
                == "execution_timeout_resolved"
                and events[0].payload["details"][
                    "timeout_seconds"
                ]
                == 60
                and events[0].payload["details"][
                    "prediction_source"
                ]
                == "fallback",
            )

            serialized = json.dumps(
                [
                    orchestrator
                    .orchestrator_event_to_mapping(event)
                    for event in events
                ],
                ensure_ascii=False,
            )

            check(
                "execution journal excludes prompts and worker output",
                "SECRET-SYSTEM-PROMPT" not in serialized
                and "SECRET-USER-PROMPT" not in serialized
                and "SECRET-WORKER-OUTPUT" not in serialized,
            )

            timeout_request = make_request(
                "x-n14-3b-timeout"
            )

            def timeout_transport(
                received: orchestrator.WorkerExecutionRequest,
                timeout_seconds: float,
            ) -> str:
                raise orchestrator.WorkerTimeoutError(
                    "SECRET-TIMEOUT-DIAGNOSTIC"
                )

            timeout_result = (
                orchestrator.supervise_worker_execution(
                    timeout_request,
                    timeout_transport,
                )
            )

            timeout_events = (
                orchestrator.read_orchestrator_events(
                    execution_id="x-n14-3b-timeout"
                )
            )

            timeout_serialized = json.dumps(
                [
                    orchestrator
                    .orchestrator_event_to_mapping(event)
                    for event in timeout_events
                ]
            )

            check(
                "timeout emits budget start timed_out",
                timeout_result.state
                is orchestrator.ExecutionState.TIMED_OUT
                and [
                    event.event_type
                    for event in timeout_events
                ]
                == [
                    "budget.resolved",
                    "execution.started",
                    "execution.timed_out",
                ],
            )

            check(
                "timeout event excludes raw diagnostic",
                timeout_events[-1].reason_code
                == "worker_timeout"
                and timeout_events[-1].payload["details"][
                    "error_type"
                ]
                == "WorkerTimeoutError"
                and "SECRET-TIMEOUT-DIAGNOSTIC"
                not in timeout_serialized,
            )

            failed_request = make_request(
                "x-n14-3b-failed"
            )

            def failed_transport(
                received: orchestrator.WorkerExecutionRequest,
                timeout_seconds: float,
            ) -> str:
                raise ValueError(
                    "SECRET-TRANSPORT-FAILURE"
                )

            failed_result = (
                orchestrator.supervise_worker_execution(
                    failed_request,
                    failed_transport,
                )
            )

            failed_events = (
                orchestrator.read_orchestrator_events(
                    execution_id="x-n14-3b-failed"
                )
            )

            failed_serialized = json.dumps(
                [
                    orchestrator
                    .orchestrator_event_to_mapping(event)
                    for event in failed_events
                ]
            )

            check(
                "contained transport failure emits execution.failed",
                failed_result.state
                is orchestrator.ExecutionState.FAILED
                and [
                    event.event_type
                    for event in failed_events
                ]
                == [
                    "budget.resolved",
                    "execution.started",
                    "execution.failed",
                ],
            )

            check(
                "failed execution event excludes raw transport error",
                failed_events[-1].reason_code
                == "worker_execution_failed"
                and failed_events[-1].payload["details"][
                    "error_type"
                ]
                == "OrchestratorError"
                and "SECRET-TRANSPORT-FAILURE"
                not in failed_serialized,
            )

            malformed_request = make_request(
                "x-n14-3b-malformed"
            )

            def malformed_transport(
                received: orchestrator.WorkerExecutionRequest,
                timeout_seconds: float,
            ) -> str:
                return 7  # type: ignore[return-value]

            malformed_result = (
                orchestrator.supervise_worker_execution(
                    malformed_request,
                    malformed_transport,
                )
            )

            malformed_events = (
                orchestrator.read_orchestrator_events(
                    execution_id="x-n14-3b-malformed"
                )
            )

            check(
                "invalid worker output emits execution.failed",
                malformed_result.state
                is orchestrator.ExecutionState.FAILED
                and [
                    event.event_type
                    for event in malformed_events
                ]
                == [
                    "budget.resolved",
                    "execution.started",
                    "execution.failed",
                ],
            )

            interrupt_request = make_request(
                "x-n14-3b-interrupt"
            )

            def interrupt_transport(
                received: orchestrator.WorkerExecutionRequest,
                timeout_seconds: float,
            ) -> str:
                raise KeyboardInterrupt()

            try:
                orchestrator.supervise_worker_execution(
                    interrupt_request,
                    interrupt_transport,
                )
            except KeyboardInterrupt:
                interrupt_propagates = True
            else:
                interrupt_propagates = False

            interrupt_events = (
                orchestrator.read_orchestrator_events(
                    execution_id="x-n14-3b-interrupt"
                )
            )

            check(
                "interrupt propagates without fabricated terminal event",
                interrupt_propagates
                and [
                    event.event_type
                    for event in interrupt_events
                ]
                == [
                    "budget.resolved",
                    "execution.started",
                ],
            )

        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)

            def unavailable_journal(
                draft: orchestrator.OrchestratorEventDraft,
            ) -> orchestrator.OrchestratorEvent:
                raise orchestrator.EventJournalError(
                    "SECRET-JOURNAL-FAILURE"
                )

            orchestrator.append_orchestrator_event = (
                unavailable_journal
            )

            stderr = StringIO()

            with redirect_stderr(stderr):
                result = (
                    orchestrator.supervise_worker_execution(
                        make_request(
                            "x-n14-3b-journal-outage"
                        ),
                        lambda received, timeout_seconds: "OK",
                    )
                )

            warning = stderr.getvalue()

            check(
                "worker event journal outage preserves execution result",
                result.state
                is orchestrator.ExecutionState.COMPLETED
                and result.output == "OK",
            )

            check(
                "worker event journal warning remains redacted",
                "EventJournalError" in warning
                and "SECRET-JOURNAL-FAILURE"
                not in warning,
            )

    finally:
        orchestrator.append_orchestrator_event = original_append
        orchestrator.STATE_DIR = original_state_dir

    check(
        "N14.3b regression restores patched runtime state",
        orchestrator.STATE_DIR == original_state_dir
        and orchestrator.append_orchestrator_event
        is original_append,
    )


def test_n14_3c_provider_model_events() -> None:
    print("\n=== N14.3c PROVIDER / MODEL RUNTIME EVENTS ===")

    original_state_dir = orchestrator.STATE_DIR
    original_append = orchestrator.append_orchestrator_event

    try:
        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)

            inventory_event = (
                orchestrator.emit_provider_inventory_event(
                    provider_id="stub",
                    models=[
                        "qwen/qwen3.5-4b",
                        "qwen/qwen3.5-9b",
                    ],
                    task_id="task-001",
                )
            )

            check(
                "provider inventory event carries provider authority",
                isinstance(
                    inventory_event,
                    orchestrator.OrchestratorEvent,
                )
                and inventory_event.event_type
                == "provider.inventory_observed"
                and inventory_event.source_class
                is orchestrator.OrchestratorEventSource.PROVIDER
                and inventory_event.component
                == "worker_provider_inventory"
                and inventory_event.task_id == "task-001"
                and inventory_event.provider_id == "stub"
                and inventory_event.model_id is None
                and inventory_event.reason_code
                == "validated_inventory_observed",
            )

            check(
                "provider inventory event preserves validated inventory",
                inventory_event.payload["model_count"] == 2
                and inventory_event.payload["models"]
                == (
                    "qwen/qwen3.5-4b",
                    "qwen/qwen3.5-9b",
                ),
            )

            binding_event = orchestrator.emit_model_binding_event(
                task_id="task-001",
                worker_role="qwen",
                provider_id="stub",
                model_id="qwen/qwen3.5-9b",
            )

            check(
                "model binding event carries trusted-core authority",
                isinstance(
                    binding_event,
                    orchestrator.OrchestratorEvent,
                )
                and binding_event.event_type
                == "model.binding_selected"
                and binding_event.source_class
                is orchestrator.OrchestratorEventSource.TRUSTED_CORE
                and binding_event.component
                == "worker_model_binding"
                and binding_event.task_id == "task-001"
                and binding_event.worker_role == "qwen"
                and binding_event.provider_id == "stub"
                and binding_event.model_id
                == "qwen/qwen3.5-9b"
                and binding_event.reason_code
                == "canonical_binding_selected",
            )

            events = orchestrator.read_orchestrator_events(
                task_id="task-001"
            )

            check(
                "provider observation precedes binding decision",
                [
                    event.event_type
                    for event in events
                ]
                == [
                    "provider.inventory_observed",
                    "model.binding_selected",
                ],
            )

        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)

            expect_orchestrator_error(
                "invalid provider inventory is rejected before observation",
                lambda: orchestrator.resolve_provider_models(
                    StubProvider(
                        models=[
                            "qwen/qwen3.5-9b",
                            "qwen/qwen3.5-9b",
                        ]
                    )
                ),
            )

            events = orchestrator.read_orchestrator_events()

            check(
                "invalid inventory produces no provider event",
                events == (),
            )

        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)

            inventory = orchestrator.resolve_provider_models(
                StubProvider(
                    models=[
                        "qwen/qwen3.5-9b",
                    ]
                )
            )

            orchestrator.emit_provider_inventory_event(
                provider_id="stub",
                models=inventory,
                task_id="task-001",
            )

            expect_orchestrator_error(
                "unsatisfied role binding remains explicit failure",
                lambda: orchestrator.bind_worker(
                    "gemma",
                    inventory,
                ),
            )

            events = orchestrator.read_orchestrator_events(
                task_id="task-001"
            )

            check(
                "valid inventory may exist without binding selection",
                [
                    event.event_type
                    for event in events
                ]
                == [
                    "provider.inventory_observed",
                ],
            )

        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)

            expect_orchestrator_error(
                "provider emitter rejects noncanonical provider ID",
                lambda: orchestrator.emit_provider_inventory_event(
                    provider_id=" stub ",
                    models=[],
                    task_id="task-001",
                ),
            )

            expect_orchestrator_error(
                "binding emitter rejects noncanonical model ID",
                lambda: orchestrator.emit_model_binding_event(
                    task_id="task-001",
                    worker_role="qwen",
                    provider_id="stub",
                    model_id=" qwen/qwen3.5-9b ",
                ),
            )

        with TemporaryDirectory() as temp_dir:
            orchestrator.STATE_DIR = Path(temp_dir)

            def unavailable_journal(
                draft: orchestrator.OrchestratorEventDraft,
            ) -> orchestrator.OrchestratorEvent:
                raise orchestrator.EventJournalError(
                    "SECRET-PROVIDER-MODEL-JOURNAL-FAILURE"
                )

            orchestrator.append_orchestrator_event = (
                unavailable_journal
            )

            stderr = StringIO()

            with redirect_stderr(stderr):
                inventory_result = (
                    orchestrator.emit_provider_inventory_event(
                        provider_id="stub",
                        models=["qwen/qwen3.5-9b"],
                        task_id="task-001",
                    )
                )

                binding_result = (
                    orchestrator.emit_model_binding_event(
                        task_id="task-001",
                        worker_role="qwen",
                        provider_id="stub",
                        model_id="qwen/qwen3.5-9b",
                    )
                )

            warning = stderr.getvalue()

            check(
                "provider model journal outage is observational only",
                inventory_result is None
                and binding_result is None,
            )

            check(
                "provider model journal warnings remain redacted",
                warning.count("EventJournalError") == 2
                and "SECRET-PROVIDER-MODEL-JOURNAL-FAILURE"
                not in warning,
            )

        inspect_module = __import__("inspect")

        delegate_source = inspect_module.getsource(
            orchestrator.delegate
        )

        provider_except_index = delegate_source.find(
            "except OrchestratorError as exc:"
        )
        inventory_event_index = delegate_source.find(
            "emit_provider_inventory_event("
        )
        binding_index = delegate_source.find(
            "model = bind_worker(args.role, inventory)"
        )
        binding_event_index = delegate_source.find(
            "emit_model_binding_event("
        )

        check(
            "delegate provider event follows provider failure boundary",
            provider_except_index >= 0
            and inventory_event_index > provider_except_index,
        )

        check(
            "delegate provider and binding events preserve semantic order",
            inventory_event_index >= 0
            and inventory_event_index < binding_index < binding_event_index,
        )

        preflight_source = inspect_module.getsource(
            orchestrator.preflight
        )

        check(
            "preflight remains durable-event free",
            "emit_provider_inventory_event("
            not in preflight_source
            and "emit_model_binding_event("
            not in preflight_source,
        )

        inventory_source = inspect_module.getsource(
            orchestrator.resolve_provider_models
        )

        check(
            "generic provider inventory semantics remain unwired",
            "emit_provider_inventory_event("
            not in inventory_source,
        )

        binding_source = inspect_module.getsource(
            orchestrator.bind_worker
        )

        check(
            "generic binding semantics remain unwired",
            "emit_model_binding_event("
            not in binding_source,
        )

        check(
            "model load observation remains unwired",
            "MODEL_LOAD_OBSERVED"
            not in delegate_source,
        )

    finally:
        orchestrator.append_orchestrator_event = original_append
        orchestrator.STATE_DIR = original_state_dir

    check(
        "N14.3c regression restores patched runtime state",
        orchestrator.STATE_DIR == original_state_dir
        and orchestrator.append_orchestrator_event
        is original_append,
    )


def test_n15a1_observer_core() -> None:
    print("\n=== N15a1 READ-ONLY OBSERVER CORE ===")

    original_state_dir = orchestrator.STATE_DIR
    original_load_contract = orchestrator.load_contract

    sqlite3_module = __import__("sqlite3")
    inspect_module = __import__("inspect")

    def require(condition: bool, label: str) -> None:
        if not condition:
            raise AssertionError(label)

        print(f"PASS: {label}")

    try:
        with TemporaryDirectory() as temp_dir:
            state_dir = Path(temp_dir)
            orchestrator.STATE_DIR = state_dir

            before = tuple(state_dir.iterdir())

            events = (
                orchestrator.read_orchestrator_events_read_only()
            )

            after = tuple(state_dir.iterdir())

            require(
                events == (),
                "missing observer journal reads as empty",
            )
            require(
                before == () and after == (),
                "missing observer journal creates no trusted state",
            )

        with TemporaryDirectory() as temp_dir:
            state_dir = Path(temp_dir)
            orchestrator.STATE_DIR = state_dir

            orchestrator.emit_provider_inventory_event(
                provider_id="stub",
                models=[
                    "qwen/qwen3.5-4b",
                    "qwen/qwen3.5-9b",
                ],
                task_id="task-001",
            )

            journal = orchestrator.event_journal_path()

            require(
                journal.is_file(),
                "writer path creates qualification journal",
            )

            before_bytes = journal.read_bytes()
            before_stat = journal.stat()
            before_names = sorted(
                item.name
                for item in state_dir.iterdir()
            )

            events = (
                orchestrator.read_orchestrator_events_read_only(
                    task_id="task-001",
                )
            )

            after_bytes = journal.read_bytes()
            after_stat = journal.stat()
            after_names = sorted(
                item.name
                for item in state_dir.iterdir()
            )

            require(
                len(events) == 1
                and events[0].event_type
                == "provider.inventory_observed"
                and events[0].task_id == "task-001",
                "observer reader returns validated trusted event",
            )

            require(
                before_bytes == after_bytes
                and before_names == after_names
                and before_stat.st_size == after_stat.st_size
                and before_stat.st_mtime_ns
                == after_stat.st_mtime_ns,
                "observer event read preserves journal and directory",
            )

            connection = (
                orchestrator._open_event_journal_read_only()
            )

            try:
                query_only = connection.execute(
                    "PRAGMA query_only"
                ).fetchone()

                require(
                    query_only is not None
                    and int(query_only[0]) == 1,
                    "observer SQLite connection enforces query_only",
                )

                try:
                    connection.execute(
                        "CREATE TABLE forbidden_write(value TEXT)"
                    )
                except sqlite3_module.OperationalError:
                    write_blocked = True
                else:
                    write_blocked = False

                require(
                    write_blocked,
                    "observer SQLite connection blocks writes",
                )

            finally:
                connection.close()

            exhausted = (
                orchestrator.read_orchestrator_events_read_only(
                    after_event_seq=events[0].event_seq,
                )
            )

            require(
                exhausted == (),
                "observer reader preserves event cursor semantics",
            )

            try:
                orchestrator.read_orchestrator_events_read_only(
                    after_event_seq=-1,
                )
            except orchestrator.OrchestratorError:
                invalid_cursor_rejected = True
            else:
                invalid_cursor_rejected = False

            require(
                invalid_cursor_rejected,
                "observer reader preserves argument validation",
            )

        with TemporaryDirectory() as temp_dir:
            state_dir = Path(temp_dir)
            orchestrator.STATE_DIR = state_dir

            journal = orchestrator.event_journal_path()
            journal.parent.mkdir(
                parents=True,
                exist_ok=True,
            )

            connection = sqlite3_module.connect(journal)

            try:
                connection.execute(
                    "PRAGMA user_version = 999"
                )
                connection.commit()
            finally:
                connection.close()

            before_bytes = journal.read_bytes()

            try:
                orchestrator.read_orchestrator_events_read_only()
            except orchestrator.EventJournalError:
                invalid_schema_rejected = True
            else:
                invalid_schema_rejected = False

            after_bytes = journal.read_bytes()

            require(
                invalid_schema_rejected,
                "observer reader fails closed on incompatible journal",
            )
            require(
                before_bytes == after_bytes,
                "observer reader never repairs incompatible journal",
            )

        with TemporaryDirectory() as temp_dir:
            state_dir = Path(temp_dir)
            orchestrator.STATE_DIR = state_dir

            task_path = state_dir / "task-001.yaml"
            task_path.write_text(
                "fixture: true\n",
                encoding="utf-8",
            )

            task = {
                "schema_version": "1.0",
                "task": {
                    "task_id": "task-001",
                    "objective": "SECRET-OBJECTIVE",
                    "active_project": "project-a",
                    "class": "ENGINEERING",
                    "risk_level": "medium",
                    "reasoning_mode": "high",
                    "status": "ADJUDICATE",
                },
                "budget": {
                    "worker_calls_used": 2,
                    "parallel_workers_active": 0,
                    "local_runtime_seconds_used": 12.5,
                    "cloud_worker_calls_used": 0,
                },
                "checkpoint": {
                    "last_checkpoint": "worker_completed",
                    "resume_from": "ADJUDICATE",
                },
                "next_action": "supervisor_adjudicate",
                "human_gate": {
                    "status": "pending",
                    "approval": "A2_COMMIT",
                    "decision_note": "SECRET-DECISION-NOTE",
                },
                "trace": {
                    "secret": "SECRET-TRACE",
                },
            }

            project = {
                "budget": {
                    "max_worker_calls": 5,
                }
            }

            policy = {}

            def fake_load_contract(task_arg):
                require(
                    Path(task_arg).resolve()
                    == task_path.resolve(),
                    "task projection loads confined task path",
                )

                return (
                    policy,
                    project,
                    task,
                    task_path,
                )

            orchestrator.load_contract = fake_load_contract

            before_bytes = task_path.read_bytes()
            before_names = sorted(
                item.name
                for item in state_dir.iterdir()
            )

            projection = (
                orchestrator.read_task_status_projection(
                    "task-001"
                )
            )

            after_bytes = task_path.read_bytes()
            after_names = sorted(
                item.name
                for item in state_dir.iterdir()
            )

            require(
                projection.task_id == "task-001"
                and projection.active_project == "project-a"
                and projection.task_class == "ENGINEERING"
                and projection.risk_level == "medium"
                and projection.reasoning_mode == "high"
                and projection.status == "ADJUDICATE"
                and projection.next_action
                == "supervisor_adjudicate",
                "task projection exposes bounded trusted status",
            )

            require(
                projection.worker_calls_used == 2
                and projection.worker_calls_max == 5
                and projection.parallel_workers_active == 0
                and projection.local_runtime_seconds_used == 12.5
                and projection.cloud_worker_calls_used == 0,
                "task projection exposes bounded budget state",
            )

            require(
                projection.checkpoint_last
                == "worker_completed"
                and projection.checkpoint_resume_from
                == "ADJUDICATE"
                and projection.human_gate_status == "pending"
                and projection.human_gate_approval
                == "A2_COMMIT",
                "task projection exposes bounded control state",
            )

            projection_repr = repr(projection)

            require(
                "SECRET-OBJECTIVE" not in projection_repr
                and "SECRET-DECISION-NOTE"
                not in projection_repr
                and "SECRET-TRACE" not in projection_repr
                and str(task_path) not in projection_repr,
                "task projection excludes sensitive raw state",
            )

            require(
                before_bytes == after_bytes
                and before_names == after_names,
                "task projection preserves trusted state",
            )

            require(
                getattr(
                    projection.__dataclass_params__,
                    "frozen",
                    False,
                )
                is True,
                "task projection dataclass is frozen",
            )

            try:
                projection.status = "COMPLETE"
            except AttributeError:
                immutable = True
            else:
                immutable = False

            require(
                immutable,
                "task projection cannot be mutated",
            )

            try:
                orchestrator.read_task_status_projection(
                    "../escape"
                )
            except orchestrator.OrchestratorError:
                traversal_rejected = True
            else:
                traversal_rejected = False

            require(
                traversal_rejected,
                "task projection rejects state-root traversal",
            )

            malformed_task = dict(task)
            malformed_task["budget"] = dict(
                task["budget"]
            )
            malformed_task["budget"][
                "worker_calls_used"
            ] = True

            def malformed_load_contract(task_arg):
                return (
                    policy,
                    project,
                    malformed_task,
                    task_path,
                )

            orchestrator.load_contract = (
                malformed_load_contract
            )

            try:
                orchestrator.read_task_status_projection(
                    "task-001"
                )
            except orchestrator.OrchestratorError:
                malformed_rejected = True
            else:
                malformed_rejected = False

            require(
                malformed_rejected,
                "malformed projection data fails closed",
            )

        observer_sources = {
            "_open_event_journal_read_only": (
                orchestrator._open_event_journal_read_only
            ),
            "read_orchestrator_events_read_only": (
                orchestrator.read_orchestrator_events_read_only
            ),
            "read_task_status_projection": (
                orchestrator.read_task_status_projection
            ),
        }

        forbidden_tokens = (
            "save_yaml_atomic(",
            "append_trace(",
            "append_orchestrator_event(",
            ".write_text(",
            ".write_bytes(",
            ".mkdir(",
            "delegate(",
            "verify(",
            "human_approval(",
            "transition_task(",
            "build_worker_provider_registry(",
            "resolve_provider_models(",
        )

        for name, function in observer_sources.items():
            source = inspect_module.getsource(function)

            found = [
                token
                for token in forbidden_tokens
                if token in source
            ]

            require(
                not found,
                f"{name} contains no mutation/provider primitive",
            )

    finally:
        orchestrator.load_contract = original_load_contract
        orchestrator.STATE_DIR = original_state_dir

    require(
        orchestrator.load_contract is original_load_contract
        and orchestrator.STATE_DIR is original_state_dir,
        "N15a1 regression restores patched runtime state",
    )



def test_n16_0a1_task_discovery_observer() -> None:
    print("\n=== N16.0a1 READ-ONLY TASK DISCOVERY ===")

    original_state_dir = orchestrator.STATE_DIR
    original_load_contract = orchestrator.load_contract

    inspect_module = __import__("inspect")

    def require(condition: bool, label: str) -> None:
        if not condition:
            raise AssertionError(label)

        print(f"PASS: {label}")

    def make_task(
        task_id: str,
        *,
        malformed: bool = False,
    ) -> dict:
        task = {
            "schema_version": "1.0",
            "task": {
                "task_id": task_id,
                "objective": f"SECRET-{task_id}",
                "active_project": "project-a",
                "class": "ENGINEERING",
                "risk_level": "medium",
                "reasoning_mode": "high",
                "status": "ADJUDICATE",
            },
            "budget": {
                "worker_calls_used": 1,
                "parallel_workers_active": 0,
                "local_runtime_seconds_used": 2.5,
                "cloud_worker_calls_used": 0,
            },
            "checkpoint": {
                "last_checkpoint": "worker_completed",
                "resume_from": "ADJUDICATE",
            },
            "next_action": "supervisor_adjudicate",
            "human_gate": None,
        }

        if malformed:
            task["budget"]["worker_calls_used"] = True

        return task

    project = {
        "budget": {
            "max_worker_calls": 5,
        }
    }

    policy = {}

    def snapshot_state(root: Path):
        snapshot = []

        for entry in sorted(
            root.iterdir(),
            key=lambda item: item.name,
        ):
            stat = entry.lstat()

            if entry.is_file() and not entry.is_symlink():
                payload = entry.read_bytes()
            else:
                payload = None

            snapshot.append(
                (
                    entry.name,
                    entry.is_dir(),
                    entry.is_symlink(),
                    stat.st_size,
                    stat.st_mtime_ns,
                    payload,
                )
            )

        return tuple(snapshot)

    try:
        # ----------------------------------------------------
        # Missing STATE_DIR must remain absent.
        # ----------------------------------------------------

        with TemporaryDirectory() as temp_dir:
            missing_state = (
                Path(temp_dir)
                / "missing-state"
            )

            orchestrator.STATE_DIR = missing_state

            require(
                not missing_state.exists(),
                "missing task state starts absent",
            )

            result = (
                orchestrator
                .read_task_status_projections_read_only(
                    limit=10,
                )
            )

            require(
                result.tasks == ()
                and result.limit == 10
                and result.truncated is False,
                "missing task state returns empty collection",
            )

            require(
                not missing_state.exists(),
                "missing discovery creates no trusted state",
            )

        # ----------------------------------------------------
        # Empty existing state directory.
        # ----------------------------------------------------

        with TemporaryDirectory() as temp_dir:
            state_dir = Path(temp_dir)
            orchestrator.STATE_DIR = state_dir

            before = snapshot_state(state_dir)

            result = (
                orchestrator
                .read_task_status_projections_read_only()
            )

            after = snapshot_state(state_dir)

            require(
                result.tasks == ()
                and result.limit == 100
                and result.truncated is False,
                "empty task state returns empty collection",
            )

            require(
                before == after,
                "empty discovery preserves trusted state",
            )

        # ----------------------------------------------------
        # Filtering, ordering, projection reuse, immutability.
        # ----------------------------------------------------

        with TemporaryDirectory() as temp_dir:
            state_dir = Path(temp_dir)
            orchestrator.STATE_DIR = state_dir

            for name in (
                "c-task.yaml",
                "a-task.yaml",
                "b-task.yml",
            ):
                (state_dir / name).write_text(
                    "fixture: true\n",
                    encoding="utf-8",
                )

            (state_dir / "ignored.txt").write_text(
                "not a task\n",
                encoding="utf-8",
            )

            (state_dir / "event-journal.sqlite3").write_bytes(
                b"not-a-real-journal"
            )

            (state_dir / "evidence").mkdir()

            loaded_names = []

            def fake_load_contract(task_arg):
                candidate = Path(task_arg)

                loaded_names.append(
                    candidate.name
                )

                return (
                    policy,
                    project,
                    make_task(candidate.stem),
                    candidate,
                )

            orchestrator.load_contract = fake_load_contract

            before = snapshot_state(state_dir)

            result = (
                orchestrator
                .read_task_status_projections_read_only(
                    limit=10,
                )
            )

            after = snapshot_state(state_dir)

            require(
                [
                    item.task_id
                    for item in result.tasks
                ]
                == [
                    "a-task",
                    "b-task",
                    "c-task",
                ],
                "task discovery ordering is deterministic",
            )

            require(
                loaded_names
                == [
                    "a-task.yaml",
                    "b-task.yml",
                    "c-task.yaml",
                ],
                "non-YAML trusted-state artifacts are ignored",
            )

            require(
                result.limit == 10
                and result.truncated is False,
                "untruncated discovery reports correct metadata",
            )

            require(
                isinstance(result.tasks, tuple),
                "task discovery returns immutable task tuple",
            )

            require(
                getattr(
                    result.__dataclass_params__,
                    "frozen",
                    False,
                )
                is True,
                "task discovery collection is frozen",
            )

            try:
                result.truncated = True
            except AttributeError:
                immutable = True
            else:
                immutable = False

            require(
                immutable,
                "task discovery collection cannot be mutated",
            )

            require(
                before == after,
                "task discovery preserves trusted state",
            )

            # -----------------------------------------------
            # Bounded projection work.
            # -----------------------------------------------

            loaded_names.clear()

            bounded = (
                orchestrator
                .read_task_status_projections_read_only(
                    limit=2,
                )
            )

            require(
                [
                    item.task_id
                    for item in bounded.tasks
                ]
                == [
                    "a-task",
                    "b-task",
                ],
                "task discovery applies deterministic limit",
            )

            require(
                bounded.limit == 2
                and bounded.truncated is True,
                "task discovery exposes truncation",
            )

            require(
                loaded_names
                == [
                    "a-task.yaml",
                    "b-task.yml",
                ],
                "limit bounds projection loading work",
            )

        # ----------------------------------------------------
        # Invalid limit validation.
        # ----------------------------------------------------

        with TemporaryDirectory() as temp_dir:
            missing_state = (
                Path(temp_dir)
                / "missing-state"
            )

            orchestrator.STATE_DIR = missing_state

            invalid_limits = (
                0,
                -1,
                True,
                1001,
                1.5,
                "1",
            )

            for invalid_limit in invalid_limits:
                try:
                    (
                        orchestrator
                        .read_task_status_projections_read_only(
                            limit=invalid_limit,
                        )
                    )
                except orchestrator.OrchestratorError:
                    rejected = True
                else:
                    rejected = False

                require(
                    rejected,
                    (
                        "task discovery rejects invalid limit "
                        f"{invalid_limit!r}"
                    ),
                )

            require(
                not missing_state.exists(),
                "invalid limits create no trusted state",
            )

        # ----------------------------------------------------
        # Malformed task outside bounded window must not be
        # projection-loaded. Once selected, it must fail
        # closed.
        # ----------------------------------------------------

        with TemporaryDirectory() as temp_dir:
            state_dir = Path(temp_dir)
            orchestrator.STATE_DIR = state_dir

            for name in (
                "a-task.yaml",
                "b-task.yaml",
                "z-bad.yaml",
            ):
                (state_dir / name).write_text(
                    "fixture: true\n",
                    encoding="utf-8",
                )

            loaded_names = []

            def bounded_load_contract(task_arg):
                candidate = Path(task_arg)

                loaded_names.append(
                    candidate.name
                )

                return (
                    policy,
                    project,
                    make_task(
                        candidate.stem,
                        malformed=(
                            candidate.name
                            == "z-bad.yaml"
                        ),
                    ),
                    candidate,
                )

            orchestrator.load_contract = (
                bounded_load_contract
            )

            before = snapshot_state(state_dir)

            bounded = (
                orchestrator
                .read_task_status_projections_read_only(
                    limit=2,
                )
            )

            after = snapshot_state(state_dir)

            require(
                [
                    item.task_id
                    for item in bounded.tasks
                ]
                == [
                    "a-task",
                    "b-task",
                ]
                and bounded.truncated is True,
                "excluded malformed task does not poison bounded read",
            )

            require(
                loaded_names
                == [
                    "a-task.yaml",
                    "b-task.yaml",
                ],
                "excluded candidate is not projection-loaded",
            )

            require(
                before == after,
                "bounded task discovery preserves trusted state",
            )

            loaded_names.clear()

            try:
                (
                    orchestrator
                    .read_task_status_projections_read_only(
                        limit=3,
                    )
                )
            except orchestrator.OrchestratorError:
                malformed_rejected = True
            else:
                malformed_rejected = False

            require(
                malformed_rejected,
                "selected malformed task fails closed",
            )

            require(
                loaded_names
                == [
                    "a-task.yaml",
                    "b-task.yaml",
                    "z-bad.yaml",
                ],
                "selected malformed candidate is reached deterministically",
            )

        # ----------------------------------------------------
        # YAML directory candidate must fail closed when it is
        # inside the selected window.
        # ----------------------------------------------------

        with TemporaryDirectory() as temp_dir:
            state_dir = Path(temp_dir)
            orchestrator.STATE_DIR = state_dir

            (state_dir / "invalid.yaml").mkdir()

            try:
                (
                    orchestrator
                    .read_task_status_projections_read_only()
                )
            except orchestrator.OrchestratorError:
                rejected = True
            else:
                rejected = False

            require(
                rejected,
                "YAML directory candidate fails closed",
            )

        # ----------------------------------------------------
        # YAML symlink candidate must fail closed.
        #
        # Windows may deny symlink creation without the
        # necessary privilege. Static source checks below
        # still make the guard mandatory in that case.
        # ----------------------------------------------------

        with TemporaryDirectory() as temp_dir:
            state_dir = Path(temp_dir)
            orchestrator.STATE_DIR = state_dir

            target = state_dir / "target.txt"
            target.write_text(
                "target\n",
                encoding="utf-8",
            )

            link = state_dir / "alias.yaml"

            try:
                link.symlink_to(target)
            except (
                OSError,
                NotImplementedError,
            ):
                symlink_supported = False
            else:
                symlink_supported = True

            if symlink_supported:
                try:
                    (
                        orchestrator
                        .read_task_status_projections_read_only()
                    )
                except orchestrator.OrchestratorError:
                    rejected = True
                else:
                    rejected = False

                require(
                    rejected,
                    "YAML symlink candidate fails closed",
                )
            else:
                print(
                    "PASS: runtime symlink creation unavailable; "
                    "static symlink guard remains qualified"
                )

        # ----------------------------------------------------
        # Static authority boundary.
        # ----------------------------------------------------

        observer_source = inspect_module.getsource(
            orchestrator
            .read_task_status_projections_read_only
        )

        required_tokens = (
            "STATE_DIR",
            "iterdir()",
            "is_symlink()",
            "is_file()",
            "read_task_status_projection",
            "truncated",
        )

        missing = [
            token
            for token in required_tokens
            if token not in observer_source
        ]

        require(
            not missing,
            "task discovery retains required observer primitives",
        )

        forbidden_tokens = (
            "save_yaml_atomic(",
            "append_trace(",
            "append_orchestrator_event(",
            ".write_text(",
            ".write_bytes(",
            ".mkdir(",
            "delegate(",
            "verify(",
            "human_approval(",
            "transition_task(",
            "build_worker_provider_registry(",
            "resolve_provider_models(",
            "_open_event_journal(",
            "emit_",
        )

        found = [
            token
            for token in forbidden_tokens
            if token in observer_source
        ]

        require(
            not found,
            (
                "task discovery contains no "
                "mutation/provider/journal primitive"
            ),
        )

    finally:
        orchestrator.load_contract = original_load_contract
        orchestrator.STATE_DIR = original_state_dir

    require(
        orchestrator.load_contract is original_load_contract
        and orchestrator.STATE_DIR is original_state_dir,
        "N16.0a1 regression restores runtime state",
    )


def test_n16_0b1_event_tail_observer() -> None:
    print("\n=== N16.0b1 READ-ONLY EVENT TAIL ===")

    original_state_dir = orchestrator.STATE_DIR
    original_deserializer = (
        orchestrator._orchestrator_event_from_journal_row
    )

    inspect_module = __import__("inspect")

    def require(condition: bool, label: str) -> None:
        if not condition:
            raise AssertionError(label)

        print(f"PASS: {label}")

    try:
        # ----------------------------------------------------
        # Missing journal:
        # empty result and no trusted-state creation.
        # ----------------------------------------------------

        with TemporaryDirectory() as temp_dir:
            state_dir = Path(temp_dir)
            orchestrator.STATE_DIR = state_dir

            before = tuple(state_dir.iterdir())

            tail = (
                orchestrator
                .read_orchestrator_event_tail_read_only(
                    limit=10,
                )
            )

            after = tuple(state_dir.iterdir())

            require(
                tail == (),
                "missing event journal tail reads as empty",
            )

            require(
                before == () and after == (),
                "missing event-tail read creates no trusted state",
            )

        # ----------------------------------------------------
        # Populate journal through the trusted event writer.
        # ----------------------------------------------------

        with TemporaryDirectory() as temp_dir:
            state_dir = Path(temp_dir)
            orchestrator.STATE_DIR = state_dir

            created = []

            for index in range(5):
                event = (
                    orchestrator
                    .emit_provider_inventory_event(
                        provider_id="stub",
                        models=[
                            f"qualification/model-{index}"
                        ],
                        task_id="tail-task",
                    )
                )

                require(
                    event is not None,
                    f"qualification event {index} emitted",
                )

                created.append(event)

            journal = orchestrator.event_journal_path()

            require(
                journal.is_file(),
                "trusted writer created event journal",
            )

            before_bytes = journal.read_bytes()
            before_stat = journal.stat()
            before_names = sorted(
                item.name
                for item in state_dir.iterdir()
            )

            tail = (
                orchestrator
                .read_orchestrator_event_tail_read_only(
                    limit=3,
                )
            )

            after_bytes = journal.read_bytes()
            after_stat = journal.stat()
            after_names = sorted(
                item.name
                for item in state_dir.iterdir()
            )

            expected_sequences = [
                event.event_seq
                for event in created[-3:]
            ]

            actual_sequences = [
                event.event_seq
                for event in tail
            ]

            require(
                actual_sequences
                == expected_sequences,
                "event tail selects newest N events",
            )

            require(
                actual_sequences
                == sorted(actual_sequences),
                "event tail returns ascending event_seq",
            )

            require(
                len(tail) == 3,
                "event tail enforces requested limit",
            )

            require(
                before_bytes == after_bytes
                and before_names == after_names
                and before_stat.st_size
                == after_stat.st_size
                and before_stat.st_mtime_ns
                == after_stat.st_mtime_ns,
                "event-tail observation preserves trusted journal",
            )

            all_events = (
                orchestrator
                .read_orchestrator_event_tail_read_only(
                    limit=100,
                )
            )

            require(
                [
                    event.event_seq
                    for event in all_events
                ]
                == [
                    event.event_seq
                    for event in created
                ],
                "event tail returns all available events when under limit",
            )

            # ------------------------------------------------
            # Ensure only selected tail rows are deserialized.
            #
            # Make the oldest row fail deserialization.
            # With limit=3 it is outside the selected window
            # and must not poison the read.
            # With limit=5 it enters the selected window and
            # the observer must fail closed.
            # ------------------------------------------------

            oldest_seq = created[0].event_seq
            selected_calls = []

            def guarded_deserializer(row):
                event = original_deserializer(row)

                selected_calls.append(
                    event.event_seq
                )

                if event.event_seq == oldest_seq:
                    raise orchestrator.EventJournalError(
                        "qualification malformed event"
                    )

                return event

            orchestrator._orchestrator_event_from_journal_row = (
                guarded_deserializer
            )

            bounded = (
                orchestrator
                .read_orchestrator_event_tail_read_only(
                    limit=3,
                )
            )

            require(
                [
                    event.event_seq
                    for event in bounded
                ]
                == expected_sequences,
                "older malformed event outside tail window is not loaded",
            )

            require(
                selected_calls
                == expected_sequences,
                "tail deserializes only selected newest rows",
            )

            selected_calls.clear()

            try:
                (
                    orchestrator
                    .read_orchestrator_event_tail_read_only(
                        limit=5,
                    )
                )
            except orchestrator.EventJournalError:
                selected_malformed_rejected = True
            else:
                selected_malformed_rejected = False

            require(
                selected_malformed_rejected,
                "malformed event inside selected tail fails closed",
            )

            require(
                oldest_seq in selected_calls,
                "expanded tail reaches malformed selected event",
            )

            orchestrator._orchestrator_event_from_journal_row = (
                original_deserializer
            )

        # ----------------------------------------------------
        # Invalid limits must fail before journal creation.
        # ----------------------------------------------------

        with TemporaryDirectory() as temp_dir:
            state_dir = Path(temp_dir)
            orchestrator.STATE_DIR = state_dir

            for invalid_limit in (
                0,
                -1,
                True,
                1001,
                1.5,
                "3",
            ):
                try:
                    (
                        orchestrator
                        .read_orchestrator_event_tail_read_only(
                            limit=invalid_limit,
                        )
                    )
                except orchestrator.OrchestratorError:
                    rejected = True
                else:
                    rejected = False

                require(
                    rejected,
                    (
                        "event tail rejects invalid limit "
                        f"{invalid_limit!r}"
                    ),
                )

            require(
                tuple(state_dir.iterdir()) == (),
                "invalid event-tail limits create no trusted state",
            )

        # ----------------------------------------------------
        # Static trust-boundary contract.
        # ----------------------------------------------------

        source = inspect_module.getsource(
            orchestrator
            .read_orchestrator_event_tail_read_only
        )

        required_tokens = (
            "_open_event_journal_read_only()",
            "_orchestrator_event_from_journal_row(row)",
            "ORDER BY event_seq DESC",
            "LIMIT ?",
            "reversed(rows)",
        )

        missing = [
            token
            for token in required_tokens
            if token not in source
        ]

        require(
            not missing,
            "event tail retains required read-only primitives",
        )

        forbidden_tokens = (
            "_open_event_journal()",
            "append_orchestrator_event(",
            "save_yaml_atomic(",
            "append_trace(",
            "transition_task(",
            ".write_text(",
            ".write_bytes(",
            ".mkdir(",
            "delegate(",
            "verify(",
            "human_approval(",
            "build_worker_provider_registry(",
            "resolve_provider_models(",
        )

        found = [
            token
            for token in forbidden_tokens
            if token in source
        ]

        require(
            not found,
            (
                "event tail contains no "
                "writer/mutation/provider primitive"
            ),
        )

    finally:
        orchestrator._orchestrator_event_from_journal_row = (
            original_deserializer
        )
        orchestrator.STATE_DIR = original_state_dir

    require(
        orchestrator._orchestrator_event_from_journal_row
        is original_deserializer
        and orchestrator.STATE_DIR is original_state_dir,
        "N16.0b1 regression restores patched runtime state",
    )

def main() -> int:
    print("Trusted Hybrid AI Orchestrator Runtime Regression")
    print("N4-N10 + N13 + N14.1 + N14.2 + N14.3a + N14.3b + N14.3c + N15a1 + N16.0a1 + N16.0b1 deterministic regression harness")
    print("=============================================")

    tests = (
        test_n4_execution_id_allocator,
        test_n4_result_admissibility,
        test_n4_cancellation_resolution,
        test_n5_budget_resolution,
        test_n5_watchdog,
        test_n5_timeout_prediction,
        test_n6_worker_execution_supervisor,
        test_n7_provider_boundary,
        test_n8_lm_studio_adapter,
        test_n9_external_supervisor_boundary,
        test_n10_reference_protocol,
        test_n13_request_replay_control,
        test_n14_event_contract,
        test_n14_2_event_journal_write,
        test_n14_2_event_journal_read,
        test_n14_3_external_request_events,
        test_n14_3b_worker_execution_events,
        test_n14_3c_provider_model_events,
        test_n15a1_observer_core,
        test_n16_0a1_task_discovery_observer,
        test_n16_0b1_event_tail_observer,
    )

    try:
        for test in tests:
            test()

    except RegressionFailure as exc:
        print(f"\nFAIL: {exc}")
        return 1

    print("\nN4-N10 + N13 + N14.1 + N14.2 + N14.3a + N14.3b + N14.3c + N15a1 + N16.0a1 + N16.0b1 regression suite passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
