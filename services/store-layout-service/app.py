import os
import json
import uuid
from datetime import datetime
from flask import Flask, jsonify, request
import psycopg2
import psycopg2.extras

app = Flask(__name__)

DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'timescaledb'),
    'port': int(os.getenv('DB_PORT', '5432')),
    'dbname': os.getenv('DB_NAME', 'appdb'),
    'user': os.getenv('DB_USER', 'appuser'),
    'password': os.getenv('DB_PASSWORD', 'changeme'),
}

def get_conn():
    return psycopg2.connect(**DB_CONFIG)

def init_db():
    """Initialize the store assets table."""
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS store_assets (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                store TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                parent_id UUID REFERENCES store_assets(id),
                metadata JSONB DEFAULT '{}',
                last_inspection TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        conn.commit()
        cur.close()
        conn.close()
        print("Store assets table initialized")
    except Exception as e:
        print(f"DB init error: {e}")

init_db()


@app.route('/health')
def health():
    return jsonify(status='ok', service='store-layout-service')


@app.route('/api/topology')
def get_topology():
    """Return all store assets as a flat list with parent relationships."""
    try:
        conn = get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM store_assets ORDER BY created_at DESC LIMIT 200")
        rows = cur.fetchall()
        cur.close()
        conn.close()
        # Convert to serializable
        for r in rows:
            r['id'] = str(r['id'])
            r['parent_id'] = str(r['parent_id']) if r['parent_id'] else None
            r['created_at'] = r['created_at'].isoformat() if r['created_at'] else None
            r['last_inspection'] = r['last_inspection'].isoformat() if r['last_inspection'] else None
        return jsonify(rows)
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route('/api/topology/tree')
def get_tree():
    """Return store assets as a nested tree structure."""
    try:
        conn = get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM store_assets ORDER BY created_at")
        rows = cur.fetchall()
        cur.close()
        conn.close()

        by_id = {}
        roots = []
        for r in rows:
            r['id'] = str(r['id'])
            r['parent_id'] = str(r['parent_id']) if r['parent_id'] else None
            r['children'] = []
            by_id[r['id']] = r

        for r in by_id.values():
            if r['parent_id'] and r['parent_id'] in by_id:
                by_id[r['parent_id']]['children'].append(r)
            else:
                roots.append(r)

        return jsonify(roots)
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route('/api/topology', methods=['POST'])
def create_asset():
    data = request.get_json() or {}
    try:
        conn = get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        asset_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO store_assets (id, name, type, store, status, parent_id, metadata, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, NOW()) RETURNING *
        """, (
            asset_id,
            data.get('name', 'Asset'),
            data.get('type', 'pos'),
            data.get('store', 'Gap Flagship'),
            data.get('status', 'active'),
            data.get('parent_id'),
            json.dumps(data.get('metadata', {})),
        ))
        row = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        row['id'] = str(row['id'])
        row['parent_id'] = str(row['parent_id']) if row['parent_id'] else None
        return jsonify(row), 201
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route('/api/topology/simulate', methods=['POST'])
def simulate():
    """Generate sample store asset hierarchy."""
    asset_types = ['pos', 'display', 'shelf', 'kiosk', 'refrigerator']
    stores = ["Gap Flagship", "Old Navy Mall", "Macy's Downtown"]
    asset_names = ['POS Terminal', 'Display Rack', 'Shelf Unit', 'Self-Checkout Kiosk', 'Cooler']
    count = int((request.get_json() or {}).get('count', 10))
    try:
        conn = get_conn()
        cur = conn.cursor()
        created = []
        parent_ids = [None]
        for i in range(count):
            asset_id = str(uuid.uuid4())
            parent = parent_ids[i % len(parent_ids)] if i > 0 else None
            type_idx = i % len(asset_types)
            cur.execute("""
                INSERT INTO store_assets (id, name, type, store, status, parent_id, created_at)
                VALUES (%s, %s, %s, %s, 'active', %s, NOW())
            """, (
                asset_id,
                f"{asset_names[type_idx]} {chr(65 + i // 5)}-{i % 5 + 1}",
                asset_types[type_idx],
                stores[i % len(stores)],
                parent,
            ))
            parent_ids.append(asset_id)
            created.append(asset_id)
        conn.commit()
        cur.close()
        conn.close()
        return jsonify(generated=len(created))
    except Exception as e:
        return jsonify(error=str(e)), 500


if __name__ == '__main__':
    port = int(os.getenv('PORT', '5002'))
    app.run(host='0.0.0.0', port=port)
