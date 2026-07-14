# =============================================================================
# Mock LangGraph API — Python / FastAPI
# =============================================================================

FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

EXPOSE 2024

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "2024"]
