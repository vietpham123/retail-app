import os
import json
import uuid
from flask import Flask, jsonify, request
import psycopg2
import psycopg2.extras
import redis

app = Flask(__name__)

DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'timescaledb'),
    'port': int(os.getenv('DB_PORT', '5432')),
    'dbname': os.getenv('DB_NAME', 'appdb'),
    'user': os.getenv('DB_USER', 'appuser'),
    'password': os.getenv('DB_PASSWORD', 'changeme'),
}

cache = redis.Redis(
    host=os.getenv('REDIS_HOST', 'redis'),
    port=int(os.getenv('REDIS_PORT', '6379')),
    decode_responses=True,
)

def get_conn():
    return psycopg2.connect(**DB_CONFIG)

# AGENT: Customize pricing model for industry (e.g., utility rates, shipping rates, hospital billing)
def init_db():
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS pricing_promotions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
                store TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'general',
                discount_pct DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                min_purchase DOUBLE PRECISION DEFAULT 0,
                promo_code TEXT,
                effective_from TIMESTAMPTZ DEFAULT NOW(),
                effective_to TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        conn.commit()
        cur.close()
        conn.close()
        print("Pricing promotions table initialized")
    except Exception as e:
        print(f"DB init error: {e}")

init_db()


@app.route('/health')
def health():
    return jsonify(status='ok', service='dynamic-pricing-service')


@app.route('/api/pricing')
def get_pricing():
    try:
        cached = cache.get('pricing:all')
        if cached:
            return jsonify(json.loads(cached))

        conn = get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT * FROM pricing_promotions
            WHERE effective_from <= NOW()
              AND (effective_to IS NULL OR effective_to > NOW())
            ORDER BY store, category
        """)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        for r in rows:
            r['id'] = str(r['id'])
            r['effective_from'] = r['effective_from'].isoformat() if r['effective_from'] else None
            r['effective_to'] = r['effective_to'].isoformat() if r['effective_to'] else None
            r['created_at'] = r['created_at'].isoformat() if r['created_at'] else None

        # Group by store
        by_store = {}
        for r in rows:
            store = r['store']
            if store not in by_store:
                by_store[store] = []
            by_store[store].append(r)

        cache.setex('pricing:all', 60, json.dumps(by_store))
        return jsonify(by_store)
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route('/api/pricing/calculate', methods=['POST'])
def calculate():
    """Apply promo discount to a purchase total for a store."""
    data = request.get_json() or {}
    store = data.get('store', 'Gap')
    total = float(data.get('total', 100.0))
    try:
        conn = get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT * FROM pricing_promotions
            WHERE store = %s AND effective_from <= NOW()
              AND (effective_to IS NULL OR effective_to > NOW())
            ORDER BY discount_pct DESC LIMIT 1
        """, (store,))
        promo = cur.fetchone()
        cur.close()
        conn.close()
        if not promo:
            return jsonify(error='No promotion found for store'), 404
        discount = total * (promo['discount_pct'] / 100.0)
        final_total = round(total - discount, 2)
        return jsonify(
            store=store,
            original_total=total,
            discount_pct=promo['discount_pct'],
            discount_amount=round(discount, 2),
            final_total=final_total,
            promo_code=promo['promo_code'],
            category=promo['category'],
        )
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route('/api/pricing', methods=['POST'])
def create_tier():
    data = request.get_json() or {}
    try:
        conn = get_conn()
        cur = conn.cursor()
        promo_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO pricing_promotions (id, name, store, category, discount_pct, min_purchase, promo_code, effective_from)
            VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
        """, (
            promo_id,
            data.get('name', 'New Promotion'),
            data.get('store', 'Gap'),
            data.get('category', 'general'),
            float(data.get('discount_pct', 10.0)),
            float(data.get('min_purchase', 0)),
            data.get('promo_code'),
        ))
        conn.commit()
        cur.close()
        conn.close()
        cache.delete('pricing:all')
        return jsonify(id=promo_id, status='created'), 201
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route('/api/pricing/simulate', methods=['POST'])
def simulate():
    """Seed promotional pricing for all stores."""
    import random
    stores = ["Gap", "Old Navy", "Macy's"]
    promos = ["Summer Sale", "Clearance", "Holiday Doorbuster"]
    categories = ['tops', 'bottoms', 'shoes', 'accessories']
    try:
        conn = get_conn()
        cur = conn.cursor()
        count = 0
        for store, promo in zip(stores, promos):
            for cat in categories:
                discount = random.randint(10, 50)
                cur.execute("""
                    INSERT INTO pricing_promotions (name, store, category, discount_pct, min_purchase, promo_code, effective_from)
                    VALUES (%s, %s, %s, %s, %s, %s, NOW())
                """, (
                    f"{promo} - {store}",
                    store,
                    cat,
                    float(discount),
                    25.0,
                    f"{promo.upper().replace(' ', '')}{discount}",
                ))
                count += 1
        conn.commit()
        cur.close()
        conn.close()
        cache.delete('pricing:all')
        return jsonify(generated=count)
    except Exception as e:
        return jsonify(error=str(e)), 500


if __name__ == '__main__':
    port = int(os.getenv('PORT', '5003'))
    app.run(host='0.0.0.0', port=port)
