const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// =========================================================
// AGENT: Update service names and ports after industry rename
// =========================================================
// Each route proxies to the corresponding microservice.
// Service names must match K8s service DNS names.

const routes = [
  // order-service (Node.js:3001)
  { path: '/api/orders',         target: 'http://order-service:3001' },
  // inventory-service (Node.js:3002)
  { path: '/api/inventory',      target: 'http://inventory-service:3002' },
  // pos-telemetry-service (.NET:5001)
  { path: '/api/telemetry',      target: 'http://pos-telemetry-service:5001' },
  // catalog-service (Java:8081)
  { path: '/api/catalog',        target: 'http://catalog-service:8081' },
  // store-layout-service (Python:5002)
  { path: '/api/topology',       target: 'http://store-layout-service:5002' },
  // sales-analytics-service (Go:8082)
  { path: '/api/analytics',      target: 'http://sales-analytics-service:8082' },
  // demand-forecast-service (Ruby:4567)
  { path: '/api/forecasts',      target: 'http://demand-forecast-service:4567' },
  // fulfillment-dispatch-service (Kotlin:8083)
  { path: '/api/dispatch',       target: 'http://fulfillment-dispatch-service:8083' },
  // customer-notification-service (PHP:8080)
  { path: '/api/notifications',  target: 'http://customer-notification-service:8080' },
  // supplier-feed-service (Elixir:4000)
  { path: '/api/external',       target: 'http://supplier-feed-service:4000' },
  // aggregator-service (Rust:8084)
  { path: '/api/aggregation',    target: 'http://aggregator-service:8084' },
  // auth-service (Ruby:4568)
  { path: '/api/auth',           target: 'http://auth-service:4568' },
  // audit-service (Go:8085)
  { path: '/api/audit',          target: 'http://audit-service:8085' },
  // dynamic-pricing-service (Python:5003)
  { path: '/api/pricing',        target: 'http://dynamic-pricing-service:5003' },
  // fulfillment-service (Java:8086)
  { path: '/api/work-orders',    target: 'http://fulfillment-service:8086' },
  // fraud-detection-service (.NET:5004)
  { path: '/api/correlation',    target: 'http://fraud-detection-service:5004' },
];

// Register proxy routes
routes.forEach(({ path, target }) => {
  app.use(path, createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: (reqPath) => reqPath, // preserve full path
    onError: (err, req, res) => {
      console.error(`Proxy error for ${path}: ${err.message}`);
      res.status(502).json({ error: `Service unavailable: ${path}`, detail: err.message });
    },
  }));
});

// Gateway health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'api-gateway', routes: routes.length });
});

// Service discovery endpoint (used by UI to know available services)
app.get('/api/services', (req, res) => {
  res.json(routes.map(r => ({ path: r.path, target: r.target })));
});

// Simulation: trigger data generation across all services
app.post('/api/simulate/cycle', async (req, res) => {
  const http = require('http');
  const results = {};

  const simulateEndpoints = [
    { name: 'orders', url: 'http://order-service:3001/api/orders/simulate' },
    { name: 'inventory', url: 'http://inventory-service:3002/api/inventory/simulate' },
    { name: 'store-assets', url: 'http://store-layout-service:5002/api/topology/simulate' },
    { name: 'demand-forecasts', url: 'http://demand-forecast-service:4567/api/forecasts/generate' },
    { name: 'notifications', url: 'http://customer-notification-service:8080/api/notifications/simulate' },
    { name: 'pricing', url: 'http://dynamic-pricing-service:5003/api/pricing/simulate' },
  ];

  for (const ep of simulateEndpoints) {
    try {
      const response = await fetch(ep.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 5 }),
      });
      results[ep.name] = { status: response.status };
    } catch (err) {
      results[ep.name] = { error: err.message };
    }
  }

  res.json({ simulation: 'complete', results });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`api-gateway listening on port ${PORT}`);
  console.log(`Registered ${routes.length} proxy routes`);
});
