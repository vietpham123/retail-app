#!/bin/bash
# Push all Docker images to the container registry
# Usage: ./scripts/push-all.sh <registry>

set -e

REGISTRY=${1:?Usage: ./scripts/push-all.sh <registry>}

echo "============================================"
echo "Pushing all images to $REGISTRY"
echo "============================================"

IMAGES=(
  "order-service"
  "inventory-service"
  "pos-telemetry-service"
  "catalog-service"
  "store-layout-service"
  "sales-analytics-service"
  "demand-forecast-service"
  "fulfillment-dispatch-service"
  "customer-notification-service"
  "supplier-feed-service"
  "aggregator-service"
  "auth-service"
  "audit-service"
  "dynamic-pricing-service"
  "fulfillment-service"
  "fraud-detection-service"
  "api-gateway"
  "web-ui"
  "load-generator"
)

for img in "${IMAGES[@]}"; do
  echo "Pushing $img..."
  docker push "$REGISTRY/$img:latest" 2>&1 | tail -3
done

echo ""
echo "============================================"
echo "All ${#IMAGES[@]} images pushed"
echo "============================================"
