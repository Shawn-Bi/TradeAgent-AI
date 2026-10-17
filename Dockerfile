# One Railway service (docs/DEPLOY.md): build the frontend, then run FastAPI, which serves the API and
# frontend/dist on one address. No secrets are baked in: Railway injects the variables at runtime.

# ---- 1. frontend build ------------------------------------------------------------------------------
FROM node:22-slim AS frontend
WORKDIR /app
# The frontend imports the frozen contract from the repo root (contracts/), so keep the same layout.
COPY contracts ./contracts
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci --no-audit --no-fund
COPY frontend ./frontend
RUN cd frontend && npm run build

# ---- 2. backend runtime -----------------------------------------------------------------------------
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend ./backend
COPY simulation ./simulation
COPY contracts ./contracts
COPY two_loss_lock.fixture.json strategy.example.json ./
COPY --from=frontend /app/frontend/dist ./frontend/dist
# Railway sets PORT; 8000 locally.
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
