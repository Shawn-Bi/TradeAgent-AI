"""TradeAgent AI backend — FastAPI gateway (simulation only, port 8000).

Run from the repo root:  uvicorn backend.main:app --reload --port 8000
Routes are frozen by PRD.md section 8.
"""
from __future__ import annotations

import hmac
import logging
import threading

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from simulation import FIXTURES, FixtureError, get_report, run_simulation
from simulation.scenarios import generate_scenarios

from . import audit, nicrron_client
from .config import setting
from .errors import ApiError, envelope
from .schemas import GenerateRequest, ScenarioRequest, SimulationStartRequest, StrategyRef
from .strategy_service import strategies

CONTRACT_VERSION = "1.0.0"
TOKEN_HEADER = "X-Demo-Token"
OPEN_PATHS = {"/api/health"}
DOCS_PATHS = {"/docs", "/docs/oauth2-redirect", "/redoc", "/openapi.json"}
log = logging.getLogger("tradeagent")

app = FastAPI(title="TradeAgent AI backend (simulation only)", version=CONTRACT_VERSION)


@app.middleware("http")
async def _demo_token_guard(request: Request, call_next):
    """When DEMO_ACCESS_TOKEN is set (public tunnel), every route except health needs the token.

    Registered before CORS so CORS stays outermost: preflights are answered there and 401s
    still carry CORS headers the browser can read.
    """
    token = setting("DEMO_ACCESS_TOKEN")
    if token and request.method != "OPTIONS":
        path = request.url.path
        if path in DOCS_PATHS:
            return JSONResponse(envelope("NOT_FOUND", "Not Found"), status_code=404)
        if path not in OPEN_PATHS:
            supplied = request.headers.get(TOKEN_HEADER, "")
            if not hmac.compare_digest(supplied.encode(), token.encode()):
                return JSONResponse(envelope("UNAUTHORIZED", f"Missing or invalid {TOKEN_HEADER} header",
                                             TOKEN_HEADER), status_code=401)
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in setting(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", TOKEN_HEADER],
)

_sims_lock = threading.Lock()
_simulations: dict[str, dict] = {}


# ---- error envelope ----------------------------------------------------------

@app.exception_handler(ApiError)
async def _api_error(_: Request, exc: ApiError):
    return JSONResponse(envelope(exc.code, exc.message, exc.field), status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError):
    err = exc.errors()[0]
    loc = [str(p) for p in err.get("loc", []) if p != "body"]
    field = ".".join(loc) or None
    return JSONResponse(envelope("VALIDATION_ERROR", f"{field}: {err['msg']}" if field else err["msg"], field),
                        status_code=422)


@app.exception_handler(StarletteHTTPException)
async def _http_error(_: Request, exc: StarletteHTTPException):
    code = "NOT_FOUND" if exc.status_code == 404 else f"HTTP_{exc.status_code}"
    return JSONResponse(envelope(code, str(exc.detail)), status_code=exc.status_code)


@app.exception_handler(Exception)
async def _unhandled(_: Request, exc: Exception):
    log.exception("unhandled error")
    return JSONResponse(envelope("INTERNAL_ERROR", "Unexpected server error"), status_code=500)


# ---- routes ------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"ok": True, "contract_version": CONTRACT_VERSION}


@app.post("/api/strategies/generate")
def generate_strategy(req: GenerateRequest):
    return strategies.generate(req)


@app.post("/api/strategies/approve")
def approve_strategy(req: StrategyRef):
    return strategies.approve(req.strategy_id, req.version)


# Aliases for the v3 names in FIRST_CUSTOMER_STRATEGY.md section F; canonical routes above.
app.add_api_route("/api/strategy/generate", generate_strategy, methods=["POST"], include_in_schema=False)
app.add_api_route("/api/strategy/approve", approve_strategy, methods=["POST"], include_in_schema=False)


@app.post("/api/scenarios/generate")
def scenarios(req: ScenarioRequest):
    spec = strategies.approved_spec(req.strategy_id, req.version)
    return generate_scenarios(spec, req.seed)


@app.post("/api/simulations/start")
def start_simulation(req: SimulationStartRequest):
    if req.fixture not in FIXTURES:
        raise ApiError(400, "UNKNOWN_FIXTURE", f"Unknown fixture '{req.fixture}'. Allowed: {', '.join(FIXTURES)}",
                       "fixture")
    try:
        spec = strategies.approved_spec(req.strategy_id, req.version)
    except ApiError as exc:
        audit.record("SIMULATION_REJECTED", strategy_id=req.strategy_id, version=req.version, code=exc.code)
        raise
    try:
        result = run_simulation(spec, seed=req.seed, fixture=req.fixture)
    except FixtureError as exc:
        raise ApiError(400, "UNKNOWN_FIXTURE", str(exc), "fixture") from exc
    result["report"] = get_report(result)
    sim_id = result["simulation_id"]
    with _sims_lock:
        _simulations[sim_id] = result
    audit.record_simulation_events(sim_id, result["events"])
    audit.record("SIMULATION_COMPLETED", simulation_id=sim_id, strategy_id=req.strategy_id, version=req.version,
                 seed=req.seed, fixture=req.fixture, entry_locked=result["entry_locked"],
                 lock_reason=result["lock_reason"], violations=result["report"]["violations"])
    return {"simulation_id": sim_id, "status": result["status"], "seed": req.seed,
            "fixture": req.fixture, "strategy_id": req.strategy_id, "version": req.version}


def _get_sim(simulation_id: str) -> dict:
    sim = _simulations.get(simulation_id)
    if sim is None:
        raise ApiError(404, "SIMULATION_NOT_FOUND", f"Simulation '{simulation_id}' not found "
                       "(in-memory; start it again after a server restart)", "simulation_id")
    return sim


@app.get("/api/simulations/{simulation_id}")
def get_simulation(simulation_id: str):
    sim = _get_sim(simulation_id)
    return {k: v for k, v in sim.items() if k not in ("events", "report", "orphan_fills")}


@app.get("/api/simulations/{simulation_id}/events")
def get_events(simulation_id: str):
    return {"events": _get_sim(simulation_id)["events"]}


@app.get("/api/simulations/{simulation_id}/report")
def get_sim_report(simulation_id: str):
    return _get_sim(simulation_id)["report"]


def reset_state() -> None:
    """Test helper: clear in-memory strategies and simulations."""
    strategies.reset()
    with _sims_lock:
        _simulations.clear()


log.info("Nicrron adapter status: %s; demo token guard: %s; PRISM: LOCAL_ONLY", nicrron_client.status(),
         "ON" if setting("DEMO_ACCESS_TOKEN") else "OFF")
