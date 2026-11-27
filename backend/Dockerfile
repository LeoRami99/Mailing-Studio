FROM golang:1.24-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/misiva-backend ./cmd/server

FROM alpine:3.21 AS runner
RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -S -g 1001 misiva && \
    adduser -S -u 1001 -G misiva misiva && \
    mkdir -p /data && chown misiva:misiva /data
WORKDIR /app
COPY --from=builder /out/misiva-backend /app/misiva-backend
ENV GO_HOST=0.0.0.0 \
    GO_PORT=8080 \
    SQLITE_PATH=/data/misiva.db
USER misiva
EXPOSE 8080
VOLUME ["/data"]
CMD ["/app/misiva-backend"]
