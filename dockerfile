# Build stage
FROM denoland/deno:alpine AS builder

WORKDIR /app
COPY . .

RUN deno cache src/main.ts

# Production stage
FROM denoland/deno:alpine

WORKDIR /app
COPY --from=builder /app .

RUN apk update && \
    apk add --no-cache ca-certificates && \
    rm -rf /var/cache/apk/*

EXPOSE 1883

CMD ["deno", "run", "--allow-env", "--allow-net", "src/main.ts"]
