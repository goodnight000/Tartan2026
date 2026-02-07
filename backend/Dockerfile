FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir \
    fastapi==0.112.2 \
    uvicorn[standard]==0.30.6 \
    pydantic==2.9.2 \
    python-dotenv==1.0.1 \
    httpx==0.27.2

COPY backend /app

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
