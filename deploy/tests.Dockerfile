FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/server:/ws
COPY server/requirements.txt /requirements-server.txt
COPY ws/requirements.txt ws/requirements-dev.txt /ws/
RUN pip install --no-cache-dir -r /requirements-server.txt -r /ws/requirements-dev.txt
COPY server /server
COPY ws /ws
WORKDIR /server
CMD ["python", "manage.py", "test", "server", "authenticator", "canvas", "marketplace", "--noinput"]
