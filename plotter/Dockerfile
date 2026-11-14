# ---------- Stage 1: build frontend React ----------
FROM node:20-alpine AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- Stage 2: runtime Python ----------
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 DATA_DIR=/app/data FRONTEND_DIST=/app/frontend/dist PORT=3000
WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install -r /app/backend/requirements.txt
COPY backend/ /app/backend/
COPY --from=frontend-builder /build/frontend/dist /app/frontend/dist
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000
WORKDIR /app/backend
CMD ["python3", "app.py"]
