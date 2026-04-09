# Retail Operations Platform

A polyglot microservices platform for **retail operations management** across Gap, Old Navy, and Macy's stores. Features 19 services across 10 programming languages, backed by production-grade infrastructure.

## Quick Start

```bash
# Build all images
./scripts/build-all.sh <your-registry>

# Push to registry
./scripts/push-all.sh <your-registry>

# Deploy to Kubernetes
./scripts/deploy.sh <your-namespace> <your-registry>
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   Retail Operations UI (React)                  │
│                     Port 80 / Nginx                             │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                    API Gateway (Node.js)                         │
│                     Port 3000                                    │
│    Routes all /api/* traffic to backend microservices            │
└──┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬──┘
   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │
   ▼   ▼   ▼   ▼   ▼   ▼   ▼   ▼   ▼   ▼   ▼   ▼   ▼   ▼   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend Microservices                         │
│                                                                 │
│  order-service ·············  Node.js    (port 3001)            │
│  inventory-service ·········  Node.js    (port 3002)            │
│  pos-telemetry-service ·····  .NET 6     (port 5001)            │
│  catalog-service ···········  Java 17    (port 8081)            │
│  store-layout-service ······  Python 3.11(port 5002)            │
│  sales-analytics-service ···  Go 1.22    (port 8082)            │
│  demand-forecast-service ···  Ruby 3.2   (port 4567)            │
│  fulfillment-dispatch-svc ··  Kotlin     (port 8083)            │
│  customer-notification-svc ·  PHP 8.2    (port 8080)            │
│  supplier-feed-service ·····  Elixir 1.16(port 4000)            │
│  aggregator-service ········  Rust 1.75  (port 8084)            │
│  auth-service ··············  Ruby 3.2   (port 4568)            │
│  audit-service ·············  Go 1.22    (port 8085)            │
│  dynamic-pricing-service ···  Python 3.11(port 5003)            │
│  fulfillment-service ·······  Java 17    (port 8086)            │
│  fraud-detection-service ···  .NET 6     (port 5004)            │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                    Infrastructure Layer                          │
│                                                                 │
│  TimescaleDB (PostgreSQL 15) ·  Port 5432  ·  Time-series data  │
│  Redis 7 ····················  Port 6379  ·  Cache / pub-sub    │
│  Kafka (KRaft) ··············  Port 9092  ·  Event streaming    │
│  RabbitMQ 3.13 ··············  Port 5672  ·  Task queuing       │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Layer          | Technology                                                        |
|----------------|-------------------------------------------------------------------|
| **Languages**  | Node.js, .NET 6, Java 17, Python 3.11, Go 1.22, Ruby 3.2, Kotlin, PHP 8.2, Elixir 1.16, Rust 1.75 |
| **Frontend**   | React 18, Material UI, Recharts                                   |
| **Gateway**    | Express.js with http-proxy-middleware                             |
| **Databases**  | TimescaleDB (PostgreSQL 15)                                       |
| **Cache**      | Redis 7                                                           |
| **Messaging**  | Apache Kafka (KRaft mode), RabbitMQ 3.13                         |
| **Container**  | Docker, Kubernetes                                                |
| **Traffic**    | Locust (Python) load generator                                    |

## Services Overview

| #  | Service                        | Language   | Purpose                           |
|----|--------------------------------|------------|-----------------------------------|
| 1  | order-service                  | Node.js    | Order lifecycle management        |
| 2  | inventory-service              | Node.js    | Stock levels & warehouse tracking |
| 3  | pos-telemetry-service          | .NET 6     | POS terminal telemetry ingestion  |
| 4  | catalog-service                | Java 17    | Product catalog & categories      |
| 5  | store-layout-service           | Python     | Store asset & layout management   |
| 6  | sales-analytics-service        | Go         | Real-time sales analytics         |
| 7  | demand-forecast-service        | Ruby       | Demand prediction by SKU/store    |
| 8  | fulfillment-dispatch-service   | Kotlin     | Pick/pack/ship task dispatch      |
| 9  | customer-notification-service  | PHP        | Customer & staff notifications    |
| 10 | supplier-feed-service          | Elixir     | Supplier data integration         |
| 11 | aggregator-service             | Rust       | High-perf data aggregation        |
| 12 | auth-service                   | Ruby       | Authentication & user management  |
| 13 | audit-service                  | Go         | Audit trail logging               |
| 14 | dynamic-pricing-service        | Python     | Promotions & dynamic pricing      |
| 15 | fulfillment-service            | Java       | Fulfillment task lifecycle        |
| 16 | fraud-detection-service        | .NET       | Transaction fraud analysis        |
| 17 | api-gateway                    | Node.js    | API routing & aggregation         |
| 18 | web-ui                         | React      | Single-page application           |
| 19 | load-generator                 | Locust     | Traffic simulation                |

## Store Regions

| Store                      | Type            |
|----------------------------|-----------------|
| Gap Flagship               | Retail Store    |
| Old Navy Mall              | Retail Store    |
| Macy's Downtown            | Retail Store    |
| East Distribution Center   | Warehouse       |
| West Distribution Center   | Warehouse       |

## Key Performance Indicators

| KPI                | Description                        |
|--------------------|------------------------------------|
| orders_today       | Total orders placed today          |
| daily_revenue      | Revenue generated today ($)        |
| total_in_stock     | Total SKUs currently in stock      |
| avg_fulfillment_h  | Average fulfillment time (hours)   |
| active_promotions  | Number of active pricing promos    |
| pos_online         | POS terminals currently online     |

## Demo Users

| Username        | Role              |
|-----------------|-------------------|
| admin_retail    | admin             |
| mgr_gap         | store_manager     |
| mgr_oldnavy     | store_manager     |
| mgr_macys       | store_manager     |
| assoc_gap_1/2   | store_associate   |
| assoc_oldnavy_1 | store_associate   |
| assoc_macys_1   | store_associate   |
| wh_east_1/2     | warehouse_worker  |
| wh_west_1       | warehouse_worker  |
| viewer_corp_1-4 | viewer            |

## Deployment

### Prerequisites
- Docker
- Kubernetes cluster (AKS, EKS, GKE, or local)
- Container registry access
- `kubectl` configured

### Deploy

```bash
# 1. Build all service images
./scripts/build-all.sh <your-registry>

# 2. Push to your container registry
./scripts/push-all.sh <your-registry>

# 3. Deploy to Kubernetes
./scripts/deploy.sh <your-namespace> <your-registry>

# 4. (Optional) Add TLS ingress
kubectl apply -f k8s/ingress.yaml
```

### Verify

```bash
kubectl get pods -n <your-namespace>
# All 24 pods should be Running
```

## License

MIT
