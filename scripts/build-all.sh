#!/bin/bash
# Build all Docker images for the Retail Operations Platform
# Usage: ./scripts/build-all.sh <registry>
# Example: ./scripts/build-all.sh myregistry.azurecr.io

set -e

REGISTRY=${1:?Usage: ./scripts/build-all.sh <registry>}

echo "============================================"
echo "Building all service images"
echo "Registry: $REGISTRY"
echo "============================================"

SERVICES=(
  "services/order-service"
  "services/inventory-service"
  "services/pos-telemetry-service"
  "services/catalog-service"
  "services/store-layout-service"
  "services/sales-analytics-service"
  "services/demand-forecast-service"
  "services/fulfillment-dispatch-service"
  "services/customer-notification-service"
  "services/supplier-feed-service"
  "services/aggregator-service"
  "services/auth-service"
  "services/audit-service"
  "services/dynamic-pricing-service"
  "services/fulfillment-service"
  "services/fraud-detection-service"
  "gateway/api-gateway"
  "ui/web-ui"
  "load-generator"
)

for svc_path in "${SERVICES[@]}"; do
  svc_name=$(basename "$svc_path")
  echo ""
  echo "--- Building $svc_name ---"
  docker build -t "$REGISTRY/$svc_name:latest" "$svc_path" 2>&1 | tail -5
  echo "  ✓ $svc_name built"
done

echo ""
echo "============================================"
echo "All ${#SERVICES[@]} images built successfully"
echo "============================================"
