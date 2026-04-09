FROM golang:1.22-alpine AS build
WORKDIR /app
COPY go.mod ./
COPY main.go ./
RUN go mod tidy && CGO_ENABLED=0 go build -o analytics-service .

FROM alpine:3.19
WORKDIR /app
COPY --from=build /app/analytics-service .
EXPOSE 8082
CMD ["./analytics-service"]
