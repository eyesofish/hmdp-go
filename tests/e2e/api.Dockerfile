FROM golang:1.25.6-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd cmd
COPY internal internal
COPY config config
RUN --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=0 go build -o /api ./cmd/api

FROM scratch
COPY --from=build /api /api
ENTRYPOINT ["/api"]
