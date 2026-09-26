FROM python:3.13-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

RUN groupadd --system app && useradd --system --gid app --no-create-home app

COPY --chown=app:app app ./app

USER app
EXPOSE 8001

HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=4)"

# Trusting forwarded headers from any IP is safe here: only the gateway can reach this container.
# --ws-max-size is 1 MiB because one `replace` op can carry a whole block stack; abuse is
# bounded by the per-op caps and per-connection rate limits in app/config.py instead.
# --ws-ping-interval keeps idle collaborators' sockets alive through the gateway.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", \
     "--proxy-headers", "--forwarded-allow-ips", "*", \
     "--no-server-header", "--ws-max-size", "1048576", \
     "--ws-ping-interval", "20", "--ws-ping-timeout", "20"]
