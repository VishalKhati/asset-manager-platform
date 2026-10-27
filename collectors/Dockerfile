# Free gold order-flow collectors. Build from the repository root:
#   docker build -f collectors/Dockerfile -t amp-collectors .
FROM python:3.12-slim
WORKDIR /app
COPY collectors /app/collectors
RUN pip install --no-cache-dir /app/collectors && useradd -u 10001 -m app && mkdir -p /data && chown app /data
USER app
VOLUME /data
CMD ["python", "-m", "goldflow.main", "--out", "/data"]
