# MiniMax Agent GUI — Production Dockerfile
# Multi-stage build: frontend (Node) + backend (Python)

# ─── Stage 1: Build Frontend ───
FROM node:20-alpine AS frontend-build

WORKDIR /app/web/frontend

# Copy package files first for better layer caching
COPY web/frontend/package*.json ./
RUN npm ci

# Copy frontend source and build
COPY web/frontend/ ./
RUN npm run build

# ─── Stage 2: Python Runtime ───
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy Python dependency files
COPY pyproject.toml .
COPY web/backend/requirements.txt ./backend-requirements.txt

# Install Python dependencies
RUN pip install --no-cache-dir \
    -r backend-requirements.txt \
    pydantic>=2.0.0 \
    pyyaml>=6.0.0 \
    httpx>=0.27.0 \
    mcp>=1.0.0 \
    requests>=2.31.0 \
    tiktoken>=0.5.0 \
    anthropic>=0.39.0 \
    openai>=1.57.4

# Copy backend code
COPY web/backend/ ./web/backend/

# Copy Python packages (mini_agent, mini_max_mcp, tests, config)
COPY mini_agent/ ./mini_agent/
COPY mini_max_mcp/ ./mini_max_mcp/
COPY config/ ./config/
COPY tests/ ./tests/
COPY pyproject.toml .

# Install the local package in editable mode so imports work
RUN pip install -e .

# Copy built frontend from Stage 1
COPY --from=frontend-build /app/web/frontend/dist ./web/frontend/dist

# Create workspace directory for persistence
RUN mkdir -p /app/workspace/conversations \
    /app/workspace/generations/images \
    /app/workspace/generations/videos \
    /app/workspace/generations/music \
    /app/workspace/generations/tts \
    /app/workspace/uploads

# Expose port
EXPOSE 8000

# Use PORT env var if provided (for cloud platforms), default to 8000
ENV PORT=8000
ENV PYTHONUNBUFFERED=1

# Start the FastAPI server
# Note: reload=False for production
CMD ["sh", "-c", "cd /app/web/backend && uvicorn main:app --host 0.0.0.0 --port ${PORT} --reload=False"]
