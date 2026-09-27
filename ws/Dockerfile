FROM python:3.13-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY ws/requirements.txt .
COPY server/requirements.txt ./server-requirements.txt
RUN pip install -r requirements.txt -r server-requirements.txt

RUN groupadd --system app && useradd --system --gid app --no-create-home app

COPY --chown=app:app ws/app ./app
COPY --chown=app:app server /server
ENV PYTHONPATH=/server

USER app
EXPOSE 8001

HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=4)"

# Trusting forwarded headers from any IP is safe here: only the gateway can reach this container.
# A replacement carries both before and after values of a document capped at 10 MiB.
# Keep the transport ceiling above both values plus the protocol envelope.
# --ws-ping-interval keeps idle collaborators' sockets alive through the gateway.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", \
     "--proxy-headers", "--forwarded-allow-ips", "*", \
     "--no-server-header", "--ws-max-size", "25165824", \
     "--ws-ping-interval", "20", "--ws-ping-timeout", "20"]
