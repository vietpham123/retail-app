const express = require('express');
const { Pool } = require('pg');
const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// --- Database ---
const pool = new Pool({
  host: process.env.DB_HOST || 'timescaledb',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'appdb',
  user: process.env.DB_USER || 'appuser',
  password: process.env.DB_PASSWORD || 'changeme',
});

// --- Kafka ---
const kafka = new Kafka({
  clientId: 'order-service',
  brokers: [(process.env.KAFKA_BROKER || 'kafka:9092')],
});
const producer = kafka.producer();
let producerReady = false;

(async () => {
  try {
    await producer.connect();
    producerReady = true;
    console.log('Kafka producer connected');
  } catch (err) {
    console.error('Kafka producer failed to connect:', err.message);
  }
})();

// --- Init DB Table ---
const INIT_SQL = `
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  customer_id TEXT NOT NULL,
  store TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'placed',
  total_amount DOUBLE PRECISION NOT NULL,
  items_count INTEGER DEFAULT 0,
  placed_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);
SELECT create_hypertable('orders', 'placed_at', if_not_exists => TRUE);
`;

(async () => {
  try {
    await pool.query(INIT_SQL);
    console.log('Database table initialized');
  } catch (err) {
    console.error('DB init error:', err.message);
  }
})();

// --- Health Check ---
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'order-service' }));

// --- GET all records ---
app.get('/api/orders', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM orders ORDER BY placed_at DESC LIMIT 100'
    );
    res.json(rows);
  } catch (err) {
    console.error('Query error:', err.message);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// --- GET single record ---
app.get('/api/orders/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database query failed' });
  }
});

// --- POST create record ---
app.post('/api/orders', async (req, res) => {
  try {
    const id = uuidv4();
    const { customer_id, store, total_amount, items_count } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO orders (id, customer_id, store, total_amount, items_count, placed_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [id, customer_id || 'CUST-001', store || 'Gap Flagship', total_amount || 0, items_count || 0]
    );

    // Publish event to Kafka
    if (producerReady) {
      await producer.send({
        topic: process.env.KAFKA_TOPIC || 'retail.order.created',
        messages: [{ key: id, value: JSON.stringify(rows[0]) }],
      });
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Insert error:', err.message);
    res.status(500).json({ error: 'Failed to create record' });
  }
});

// --- PUT update record ---
app.put('/api/orders/:id', async (req, res) => {
  try {
    const { customer_id, store, status, total_amount, items_count, delivered_at } = req.body;
    const { rows } = await pool.query(
      `UPDATE orders SET
        customer_id = COALESCE($2, customer_id),
        store = COALESCE($3, store),
        status = COALESCE($4, status),
        total_amount = COALESCE($5, total_amount),
        items_count = COALESCE($6, items_count),
        delivered_at = COALESCE($7, delivered_at)
       WHERE id = $1 RETURNING *`,
      [req.params.id, customer_id, store, status, total_amount, items_count, delivered_at]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update record' });
  }
});

// --- Simulate: generate random orders ---
app.post('/api/orders/simulate', async (req, res) => {
  try {
    const stores = ["Gap Flagship", "Old Navy Mall", "Macy's Downtown", "East Distribution Center", "West Distribution Center"];
    const statuses = ['placed', 'processing', 'shipped'];
    const count = parseInt(req.body.count) || 5;

    const records = [];
    for (let i = 0; i < count; i++) {
      const id = uuidv4();
      const { rows } = await pool.query(
        `INSERT INTO orders (id, customer_id, store, status, total_amount, items_count, placed_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
        [
          id,
          `CUST-${String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0')}`,
          stores[Math.floor(Math.random() * stores.length)],
          statuses[Math.floor(Math.random() * statuses.length)],
          Math.round((Math.random() * 485 + 15) * 100) / 100,
          Math.floor(Math.random() * 12) + 1,
        ]
      );
      records.push(rows[0]);
    }
    res.json({ generated: records.length, records });
  } catch (err) {
    res.status(500).json({ error: 'Simulation failed' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`order-service listening on port ${PORT}`));
