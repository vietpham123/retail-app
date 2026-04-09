const express = require('express');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST || 'timescaledb',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'appdb',
  user: process.env.DB_USER || 'appuser',
  password: process.env.DB_PASSWORD || 'changeme',
});

const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS inventory_readings (
  id UUID PRIMARY KEY,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  warehouse TEXT NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);
SELECT create_hypertable('inventory_readings', 'recorded_at', if_not_exists => TRUE);
`;

(async () => {
  try {
    await pool.query(INIT_SQL);
    console.log('Database table initialized');
  } catch (err) {
    console.error('DB init error:', err.message);
  }
})();

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'inventory-service' }));

app.get('/api/inventory', async (req, res) => {
  try {
    const cacheKey = 'inventory:latest';
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const { rows } = await pool.query(
      'SELECT * FROM inventory_readings ORDER BY recorded_at DESC LIMIT 100'
    );
    await redis.setex(cacheKey, 30, JSON.stringify(rows));
    res.json(rows);
  } catch (err) {
    console.error('Query error:', err.message);
    res.status(500).json({ error: 'Database query failed' });
  }
});

app.get('/api/inventory/summary', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT warehouse,
             COUNT(*) as count,
             AVG(quantity) as avg_quantity,
             MAX(quantity) as max_quantity,
             MIN(quantity) as min_quantity
      FROM inventory_readings
      WHERE recorded_at > NOW() - INTERVAL '24 hours'
      GROUP BY warehouse
      ORDER BY warehouse
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Query failed' });
  }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const id = uuidv4();
    const { sku, quantity, warehouse } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO inventory_readings (id, sku, quantity, warehouse, recorded_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
      [id, sku || 'SKU-GAP-001', quantity || 0, warehouse || 'Gap Flagship']
    );
    await redis.del('inventory:latest');
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create reading' });
  }
});

app.post('/api/inventory/simulate', async (req, res) => {
  try {
    const warehouses = ["Gap Flagship", "Old Navy Mall", "Macy's Downtown", "East Distribution Center", "West Distribution Center"];
    const skuPrefixes = ['SKU-GAP', 'SKU-ON', 'SKU-MAC'];
    const count = parseInt(req.body.count) || 10;
    const records = [];
    for (let i = 0; i < count; i++) {
      const id = uuidv4();
      const prefix = skuPrefixes[Math.floor(Math.random() * skuPrefixes.length)];
      const { rows } = await pool.query(
        `INSERT INTO inventory_readings (id, sku, quantity, warehouse, recorded_at)
         VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
        [
          id,
          `${prefix}-${String(Math.floor(Math.random() * 100) + 1).padStart(3, '0')}`,
          Math.floor(Math.random() * 501),
          warehouses[Math.floor(Math.random() * warehouses.length)],
        ]
      );
      records.push(rows[0]);
    }
    await redis.del('inventory:latest');
    res.json({ generated: records.length, records });
  } catch (err) {
    res.status(500).json({ error: 'Simulation failed' });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`inventory-service listening on port ${PORT}`));
