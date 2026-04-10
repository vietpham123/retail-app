const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

// ============================================================
// Dynatrace Business Events Integration
// Sends CloudEvents to the Dynatrace Biz Events Ingest API
// ============================================================
const DT_TENANT_URL = process.env.DT_TENANT_URL || '';
const DT_BIZEVENT_TOKEN = process.env.DT_BIZEVENT_TOKEN || '';
const DT_BIZEVENT_ENABLED = !!(DT_TENANT_URL && DT_BIZEVENT_TOKEN);
const EVENT_PROVIDER = 'genericretail.event.provider';

if (DT_BIZEVENT_ENABLED) {
  console.log('Dynatrace Business Events ENABLED', DT_TENANT_URL);
} else {
  console.log('Dynatrace Business Events DISABLED (set DT_TENANT_URL and DT_BIZEVENT_TOKEN to enable)');
}

async function sendBizEvent(eventType, data) {
  if (!DT_BIZEVENT_ENABLED) return;
  const cloudEvent = {
    specversion: '1.0',
    id: `${eventType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: EVENT_PROVIDER,
    type: eventType,
    time: new Date().toISOString(),
    data
  };
  try {
    await axios.post(
      `${DT_TENANT_URL}/api/v2/bizevents/ingest`,
      cloudEvent,
      {
        headers: {
          'Content-Type': 'application/cloudevent+json',
          Authorization: `Api-Token ${DT_BIZEVENT_TOKEN}`
        },
        timeout: 5000
      }
    );
  } catch (err) {
    console.warn('BizEvent send failed:', eventType, err.message);
  }
}

function sendBizEvents(events) {
  if (!DT_BIZEVENT_ENABLED) return;
  events.forEach(e => sendBizEvent(e.type, e.data));
}

// NOTE: express.json() must NOT be applied before proxy routes,
// as it consumes the request body stream. Only use it for
// gateway-handled endpoints (simulate, etc.) below the proxies.

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
app.post('/api/simulate/cycle', express.json(), async (req, res) => {
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

  // --- Generate fulfillment dispatch, work-orders, and audit data ---
  const stores = ['Store Alpha', 'Store Beta', 'Store Gamma'];
  const teams = ['East Warehouse', 'West Warehouse', 'Store Fulfillment'];
  const users = ['mgr_alpha', 'mgr_beta', 'mgr_gamma', 'wh_east_1', 'wh_west_1'];
  const priorities = ['standard', 'express', 'same_day'];
  const actions = ['login', 'create_order', 'update_inventory', 'approve_dispatch', 'generate_report', 'modify_pricing'];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const dataEndpoints = [
    ...Array.from({ length: 5 }, () => ({
      name: 'dispatch',
      url: 'http://fulfillment-dispatch-service:8083/api/dispatch',
      body: {
        order_id: null,
        assignee: pick(users),
        team: pick(teams),
        priority: pick(priorities),
        status: 'assigned',
      },
    })),
    ...Array.from({ length: 5 }, () => ({
      name: 'work-orders',
      url: 'http://fulfillment-service:8086/api/work-orders',
      body: {
        order_id: null,
        assignee: pick(users),
        priority: pick(priorities),
      },
    })),
    ...Array.from({ length: 5 }, () => ({
      name: 'audit',
      url: 'http://audit-service:8085/api/audit/log',
      body: {
        actor: pick(users),
        action: pick(actions),
        resource_type: pick(['order', 'inventory', 'dispatch', 'pricing', 'forecast']),
        resource_id: `RES-${Math.floor(Math.random() * 90000) + 10000}`,
        details: `Simulated action from ${pick(stores)}`,
      },
    })),
  ];

  for (const ep of dataEndpoints) {
    try {
      const response = await fetch(ep.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ep.body),
      });
      results[ep.name] = results[ep.name] || { status: response.status, count: 0 };
      if (response.status < 300) results[ep.name].count++;
    } catch (err) {
      results[ep.name] = { error: err.message };
    }
  }

  res.json({ simulation: 'complete', results });
});

// ============================================================
// Automatic Simulation Loop — fires every 15 seconds
// Generates data + emits business events per cycle
// ============================================================
const SIMULATE_INTERVAL = parseInt(process.env.SIMULATE_INTERVAL || '15000', 10);

async function runSimulationCycle() {
  const cycleStart = Date.now();
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const rng = () => Math.random();
  const bizEvents = [];

  const stores = ['Store Alpha', 'Store Beta', 'Store Gamma'];
  const regions = ['Northeast', 'Southeast', 'Midwest', 'Southwest', 'West'];
  const categories = ['tops', 'bottoms', 'shoes', 'accessories', 'outerwear'];
  const brands = ['Alpha', 'Beta', 'Gamma'];
  const channels = ['online', 'in-store', 'mobile-app'];
  const paymentTypes = ['Type-A', 'Type-B', 'Type-C', 'Type-D'];
  const fulfillmentStatuses = ['picked', 'packed', 'shipped', 'delivered'];

  // 1. Order placed event
  const orderId = `ORD-${Date.now()}-${Math.floor(rng() * 9000 + 1000)}`;
  const orderTotal = Math.round((rng() * 490 + 10) * 100) / 100;
  const itemsCount = Math.floor(rng() * 8) + 1;
  bizEvents.push({ type: 'order.placed', data: {
    'event.provider': EVENT_PROVIDER,
    'order.id': orderId,
    store: pick(stores),
    region: pick(regions),
    channel: pick(channels),
    'items.count': itemsCount,
    'order.total': orderTotal,
    'payment.type': pick(paymentTypes),
    currency: 'USD',
    timestamp: new Date().toISOString()
  }});

  // 2. Inventory update event
  const sku = `SKU-${pick(['SA', 'SB', 'SC'])}-${String(Math.floor(rng() * 999) + 1).padStart(3, '0')}`;
  const warehouse = pick([...stores, 'East Distribution Center', 'West Distribution Center']);
  bizEvents.push({ type: 'inventory.updated', data: {
    'event.provider': EVENT_PROVIDER,
    sku,
    warehouse,
    'quantity.before': Math.floor(rng() * 200 + 50),
    'quantity.after': Math.floor(rng() * 200 + 10),
    'reorder.triggered': rng() > 0.7,
    reason: pick(['sale', 'restock', 'return', 'adjustment', 'damage']),
    timestamp: new Date().toISOString()
  }});

  // 3. POS telemetry event
  const store = pick(stores);
  bizEvents.push({ type: 'pos.transaction', data: {
    'event.provider': EVENT_PROVIDER,
    'terminal.id': `POS-${store.replace('Store ', '').charAt(0)}-${Math.floor(rng() * 10) + 1}`,
    store,
    region: pick(regions),
    'basket.size': Math.floor(rng() * 12) + 1,
    'transaction.total': Math.round((rng() * 300 + 5) * 100) / 100,
    'payment.type': pick(paymentTypes),
    'scan.rate': Math.round((rng() * 3 + 1) * 100) / 100,
    timestamp: new Date().toISOString()
  }});

  // 4. Catalog product event
  const category = pick(categories);
  const brand = pick(brands);
  bizEvents.push({ type: 'catalog.product.updated', data: {
    'event.provider': EVENT_PROVIDER,
    sku: `SKU-${String(Math.floor(rng() * 9999)).padStart(4, '0')}`,
    brand,
    category,
    'price.current': Math.round((rng() * 190 + 10) * 100) / 100,
    'price.previous': Math.round((rng() * 190 + 10) * 100) / 100,
    'in.stock': rng() > 0.2,
    timestamp: new Date().toISOString()
  }});

  // 5. Demand forecast event
  bizEvents.push({ type: 'demand.forecast.generated', data: {
    'event.provider': EVENT_PROVIDER,
    store: pick(stores),
    sku: `SKU-${pick(['SA', 'SB', 'SC'])}-${String(Math.floor(rng() * 100) + 1).padStart(3, '0')}`,
    'predicted.units': Math.floor(rng() * 500 + 10),
    confidence: Math.round((rng() * 0.3 + 0.7) * 1000) / 1000,
    'period.hours': 24,
    timestamp: new Date().toISOString()
  }});

  // 6. Fulfillment dispatch event
  const dispatchPriority = pick(['standard', 'express', 'same_day']);
  bizEvents.push({ type: 'fulfillment.dispatched', data: {
    'event.provider': EVENT_PROVIDER,
    'dispatch.id': `DSP-${Date.now()}`,
    'order.id': orderId,
    assignee: pick(['mgr_alpha', 'mgr_beta', 'mgr_gamma', 'wh_east_1', 'wh_west_1']),
    team: pick(['East Warehouse', 'West Warehouse', 'Store Fulfillment']),
    priority: dispatchPriority,
    status: pick(fulfillmentStatuses),
    timestamp: new Date().toISOString()
  }});

  // 7. Customer notification event
  bizEvents.push({ type: 'customer.notification.sent', data: {
    'event.provider': EVENT_PROVIDER,
    channel: pick(['email', 'sms', 'push', 'webhook']),
    subject: pick(['Order Shipped', 'Delivery Update', 'Return Approved', 'Price Drop Alert', 'Back In Stock']),
    'delivery.status': rng() > 0.1 ? 'delivered' : 'failed',
    store: pick(stores),
    timestamp: new Date().toISOString()
  }});

  // 8. Pricing update event
  bizEvents.push({ type: 'pricing.adjusted', data: {
    'event.provider': EVENT_PROVIDER,
    sku: `SKU-${String(Math.floor(rng() * 9999)).padStart(4, '0')}`,
    store: pick(stores),
    'price.original': Math.round((rng() * 100 + 20) * 100) / 100,
    'price.adjusted': Math.round((rng() * 100 + 15) * 100) / 100,
    'discount.pct': Math.round(rng() * 40),
    reason: pick(['clearance', 'competitive', 'seasonal', 'promotion', 'demand_surge']),
    timestamp: new Date().toISOString()
  }});

  // 9. Fraud detection event
  if (rng() > 0.6) {
    bizEvents.push({ type: 'fraud.alert', data: {
      'event.provider': EVENT_PROVIDER,
      'order.id': orderId,
      'risk.score': Math.round(rng() * 100),
      'fraud.type': pick(['card_testing', 'account_takeover', 'promo_abuse', 'return_fraud', 'velocity_check']),
      action: pick(['flagged', 'blocked', 'review_required']),
      channel: pick(channels),
      timestamp: new Date().toISOString()
    }});
  }

  // 10. Supplier feed event
  bizEvents.push({ type: 'supplier.feed.received', data: {
    'event.provider': EVENT_PROVIDER,
    'supplier.id': `SUP-${String(Math.floor(rng() * 99) + 1).padStart(3, '0')}`,
    'items.received': Math.floor(rng() * 50) + 1,
    'items.rejected': Math.floor(rng() * 5),
    'lead.time.days': Math.floor(rng() * 14) + 1,
    warehouse: pick(['East Distribution Center', 'West Distribution Center']),
    timestamp: new Date().toISOString()
  }});

  // 11. Audit event
  bizEvents.push({ type: 'audit.action.logged', data: {
    'event.provider': EVENT_PROVIDER,
    actor: pick(['mgr_alpha', 'mgr_beta', 'mgr_gamma', 'admin_retail', 'wh_east_1']),
    action: pick(['login', 'create_order', 'update_inventory', 'approve_dispatch', 'generate_report', 'modify_pricing']),
    'resource.type': pick(['order', 'inventory', 'dispatch', 'pricing', 'forecast']),
    'resource.id': `RES-${Math.floor(rng() * 90000 + 10000)}`,
    store: pick(stores),
    timestamp: new Date().toISOString()
  }});

  // Fire all business events
  sendBizEvents(bizEvents);

  const durationMs = Date.now() - cycleStart;
  console.log(`Simulation cycle complete: ${bizEvents.length} bizevents, ${durationMs}ms`);
}

if (DT_BIZEVENT_ENABLED) {
  setInterval(runSimulationCycle, SIMULATE_INTERVAL);
  console.log(`Auto-simulation enabled: every ${SIMULATE_INTERVAL}ms`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`api-gateway listening on port ${PORT}`);
  console.log(`Registered ${routes.length} proxy routes`);
});
