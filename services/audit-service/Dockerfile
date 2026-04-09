FROM golang:1.22-alpine AS build
WORKDIR /app
COPY go.mod ./
COPY main.go ./
RUN go mod tidy && CGO_ENABLED=0 go build -o audit-service .

FROM alpine:3.19
WORKDIR /app
COPY --from=build /app/audit-service .
EXPOSE 8085
CMD ["./audit-service"]
