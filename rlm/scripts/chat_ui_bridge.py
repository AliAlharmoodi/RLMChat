import json
import os
import pickle
import re
import sys
from typing import Any

from rlm import RLM
from rlm.environments.local_repl import LocalREPL
from rlm.logger import RLMLogger


def _build_default_headers(request: dict[str, Any]) -> dict[str, str]:
    headers: dict[str, str] = {}
    public_origin = (request.get("public_origin") or "").strip()
    app_name = (request.get("app_name") or "").strip()

    if public_origin:
        headers["HTTP-Referer"] = public_origin
    if app_name:
        headers["X-Title"] = app_name

    return headers


def _build_backend_kwargs(request: dict[str, Any], model_name: str) -> dict[str, Any]:
    backend_kwargs: dict[str, Any] = {
        "model_name": model_name,
        "base_url": request["base_url"],
        "api_key": request["api_key"],
    }

    headers = _build_default_headers(request)
    if headers:
        backend_kwargs["default_headers"] = headers

    return backend_kwargs


def _normalize_response(response_text: str) -> str:
    final_match = re.fullmatch(r"\s*FINAL\((.*)\)\s*", response_text, re.DOTALL)
    if final_match:
        response_text = final_match.group(1).strip()

    final_var_match = re.fullmatch(r"\s*FINAL_VAR\((.*)\)\s*", response_text, re.DOTALL)
    if final_var_match:
        response_text = final_var_match.group(1).strip().strip("'").strip('"')

    if response_text.startswith('"') and response_text.endswith('"'):
        try:
            response_text = json.loads(response_text)
        except Exception:
            pass

    return response_text


def _emit_trace(payload: dict[str, Any]) -> None:
    _write_json({"event": "trace", "trace": payload})


def _build_rlm(request: dict[str, Any], trace_enabled: bool = False) -> RLM:
    root_model = request["model"]
    subcall_model = (request.get("subcall_model") or "").strip() or None

    backend_kwargs = _build_backend_kwargs(request, root_model)
    rlm_kwargs: dict[str, Any] = {
        "backend": "openai",
        "backend_kwargs": backend_kwargs,
        "environment": "local",
        "persistent": bool(request.get("persistent", False)),
        "max_depth": int(request.get("max_depth", 2)),
        "max_iterations": int(request.get("max_iterations", 12)),
        "max_concurrent_subcalls": int(request.get("max_concurrent_subcalls", 4)),
        "max_timeout": float(request["max_timeout"]) if request.get("max_timeout") else None,
        "max_budget": float(request["max_budget"]) if request.get("max_budget") else None,
        "max_errors": int(request["max_errors"]) if request.get("max_errors") else None,
        "verbose": False,
        "logger": RLMLogger(),
    }

    if trace_enabled:
        rlm_kwargs["on_subcall_start"] = lambda depth, model, prompt_preview: _emit_trace(
            {
                "kind": "status",
                "status": f"Running worker at depth {depth} with {model}",
            }
        )
        rlm_kwargs["on_subcall_complete"] = lambda depth, model, duration, error: _emit_trace(
            {
                "kind": "status",
                "status": (
                    f"Worker finished in {duration:.1f}s"
                    if error is None
                    else f"Worker error at depth {depth}: {error}"
                ),
            }
        )

    if subcall_model and subcall_model != root_model:
        rlm_kwargs["other_backends"] = ["openai"]
        rlm_kwargs["other_backend_kwargs"] = [_build_backend_kwargs(request, subcall_model)]

    return RLM(**rlm_kwargs)


def _restore_persistent_env(rlm: RLM, request: dict[str, Any]) -> None:
    state_path = (request.get("state_path") or "").strip()
    model_fingerprint = (request.get("model_fingerprint") or "").strip()
    if not state_path or not model_fingerprint or not os.path.exists(state_path):
        return

    with open(state_path, "rb") as handle:
        saved = pickle.load(handle)

    if saved.get("model_fingerprint") != model_fingerprint:
        return

    env = LocalREPL(
        lm_handler_address=None,
        context_payload=None,
        persistent=True,
        depth=rlm.depth + 1,
        subcall_fn=rlm._subcall if rlm.max_depth > 1 else None,
        custom_tools=rlm.custom_tools,
        custom_sub_tools=rlm.custom_sub_tools,
        compaction=rlm.compaction,
        max_concurrent_subcalls=rlm.max_concurrent_subcalls,
    )
    env.locals = saved["locals"]
    env._context_count = saved["context_count"]
    env._history_count = saved["history_count"]
    if saved.get("compaction_history") is not None:
        env._compaction_history = saved["compaction_history"]
        env.locals["history"] = env._compaction_history
    env._restore_scaffold()
    rlm._persistent_env = env


def _persist_persistent_env(rlm: RLM, request: dict[str, Any]) -> None:
    state_path = (request.get("state_path") or "").strip()
    model_fingerprint = (request.get("model_fingerprint") or "").strip()
    if not state_path or not model_fingerprint or rlm._persistent_env is None:
        return

    os.makedirs(os.path.dirname(state_path), exist_ok=True)
    filtered_locals: dict[str, Any] = {}
    for key, value in rlm._persistent_env.locals.items():
        try:
            pickle.dumps(value)
            filtered_locals[key] = value
        except Exception:
            continue

    compaction_history = getattr(rlm._persistent_env, "_compaction_history", None)
    if compaction_history is not None:
        try:
            pickle.dumps(compaction_history)
        except Exception:
            compaction_history = None

    payload = {
        "model_fingerprint": model_fingerprint,
        "locals": filtered_locals,
        "context_count": rlm._persistent_env.get_context_count(),
        "history_count": rlm._persistent_env.get_history_count(),
        "compaction_history": compaction_history,
    }
    with open(state_path, "wb") as handle:
        pickle.dump(payload, handle)


def _write_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload), flush=True)


def _handle_once(request: dict[str, Any]) -> int:
    rlm = _build_rlm(request)
    if request.get("persistent"):
        _restore_persistent_env(rlm, request)
    completion = rlm.completion(
        prompt=request["context"],
        root_prompt=request["root_prompt"],
    )
    if request.get("persistent"):
        _persist_persistent_env(rlm, request)
    _write_json(
        {
            "response": _normalize_response(completion.response),
            "execution_time": completion.execution_time,
            "root_model": completion.root_model,
            "metadata": completion.metadata,
        }
    )
    return 0


def _handle_session() -> int:
    session_rlm: RLM | None = None
    session_request: dict[str, Any] | None = None

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue

        request = json.loads(raw)
        command = request.get("command")

        try:
            if command == "init":
                if session_rlm is not None:
                    if session_request is not None:
                        _persist_persistent_env(session_rlm, session_request)
                    session_rlm.close()
                session_rlm = _build_rlm(request, trace_enabled=True)
                session_request = request
                _restore_persistent_env(session_rlm, request)
                _write_json({"ok": True})
            elif command == "complete":
                if session_rlm is None:
                    raise RuntimeError("RLM session not initialized")
                _emit_trace({"kind": "status", "status": "Inspecting context"})
                completion = session_rlm.completion(
                    prompt=request["context"],
                    root_prompt=request["root_prompt"],
                )
                _emit_trace({"kind": "status", "status": "Synthesizing answer"})
                if session_request is not None:
                    _persist_persistent_env(session_rlm, session_request)
                _write_json(
                    {
                        "ok": True,
                        "response": _normalize_response(completion.response),
                        "execution_time": completion.execution_time,
                        "root_model": completion.root_model,
                        "metadata": completion.metadata,
                    }
                )
            elif command == "close":
                if session_rlm is not None:
                    if session_request is not None:
                        _persist_persistent_env(session_rlm, session_request)
                    session_rlm.close()
                    session_rlm = None
                    session_request = None
                _write_json({"ok": True})
                break
            else:
                raise RuntimeError(f"Unknown command: {command}")
        except Exception as exc:
            _write_json({"ok": False, "error": str(exc)})

    if session_rlm is not None:
        if session_request is not None:
            _persist_persistent_env(session_rlm, session_request)
        session_rlm.close()

    return 0


def main() -> int:
    try:
        if len(sys.argv) > 1 and sys.argv[1] == "--session":
            return _handle_session()

        raw = sys.stdin.read()
        if not raw.strip():
            raise ValueError("No JSON request received on stdin")
        return _handle_once(json.loads(raw))
    except Exception as exc:
        print(str(exc), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
