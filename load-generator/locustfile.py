"""
Retail Operations Platform - Locust Load Generator
====================================================
Simulates real user navigation through the retail web UI.
"""

import os
import random
import time
from locust import HttpUser, SequentialTaskSet, task, between

# --- Demo Users (retail store staff + corporate viewers) ---
DEMO_USERNAMES = [
    "admin_retail", "mgr_gap", "mgr_oldnavy", "mgr_macys",
    "assoc_gap_1", "assoc_gap_2", "assoc_oldnavy_1", "assoc_macys_1",
    "wh_east_1", "wh_east_2", "wh_west_1",
    "viewer_corp_1", "viewer_corp_2", "viewer_corp_3", "viewer_corp_4",
]
DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "changeme2026")

# --- Tab endpoints (retail UI tabs) ---
TAB_ENDPOINTS = [
    "/api/analytics/dashboard",
    "/api/orders",
    "/api/inventory",
    "/api/catalog",
    "/api/topology",
    "/api/analytics/trends",
    "/api/forecasts",
    "/api/dispatch",
    "/api/external",
    "/api/notifications",
    "/api/pricing",
    "/api/work-orders",
    "/api/correlation",
    "/api/aggregation",
    "/api/telemetry",
    "/api/audit",
    "/api/auth/users",
]

STORES = ["Gap Flagship", "Old Navy Mall", "Macy's Downtown", "East Distribution Center", "West Distribution Center"]
SKUS = [f"SKU-GAP-{i:03d}" for i in range(1, 20)] + \
       [f"SKU-ON-{i:03d}" for i in range(1, 20)] + \
       [f"SKU-MAC-{i:03d}" for i in range(1, 20)]


def think(min_s=1, max_s=5):
    """Simulate user reading/thinking time."""
    time.sleep(random.uniform(min_s, max_s))


class UISession(SequentialTaskSet):
    """Emulates a user session: login -> navigate tabs -> logout."""

    def on_start(self):
        self.username = random.choice(DEMO_USERNAMES)
        # Login
        resp = self.client.post("/api/auth/login", json={
            "username": self.username,
            "password": DEMO_PASSWORD,
        }, name="POST /api/auth/login")
        if resp.status_code == 200:
            data = resp.json()
            if not data.get("success"):
                self.interrupt()
        else:
            self.interrupt()
        think(1, 2)

    # Load the main page
    @task
    def load_page(self):
        self.client.get("/", name="GET / (main page)")
        think(0.5, 1)

    # Visit dashboard first (always)
    @task
    def visit_dashboard(self):
        self.client.get("/api/analytics/dashboard", name="GET /api/analytics/dashboard")
        think(2, 5)

    # Navigate through random selection of tabs
    @task
    def browse_tabs(self):
        # Pick 5-10 random tabs to visit
        tabs_to_visit = random.sample(TAB_ENDPOINTS[1:], k=random.randint(5, min(10, len(TAB_ENDPOINTS)-1)))
        for endpoint in tabs_to_visit:
            self.client.get(endpoint, name=f"GET {endpoint}")
            think(self.user.think_min, self.user.think_max)

    # Occasionally create data
    @task
    def create_data(self):
        if random.random() < 0.3:
            self.client.post("/api/orders", json={
                "customer_id": f"CUST-{random.randint(1000, 9999)}",
                "store": random.choice(STORES),
                "total_amount": round(random.uniform(9.99, 499.99), 2),
                "items_count": random.randint(1, 12),
                "sku": random.choice(SKUS),
            }, name="POST /api/orders")
            think(1, 3)

        if random.random() < 0.2:
            self.client.post("/api/work-orders", json={
                "order_id": f"ORD-{random.randint(10000, 99999)}",
                "assignee": random.choice(DEMO_USERNAMES),
                "priority": random.choice(["standard", "express", "same_day"]),
            }, name="POST /api/work-orders")
            think(1, 2)

        if random.random() < 0.15:
            self.client.post("/api/inventory", json={
                "sku": random.choice(SKUS),
                "quantity": random.randint(0, 500),
                "warehouse": random.choice(["East Distribution Center", "West Distribution Center"]),
            }, name="POST /api/inventory")
            think(1, 2)

    # Return to dashboard
    @task
    def return_dashboard(self):
        self.client.get("/api/analytics/dashboard", name="GET /api/analytics/dashboard")
        think(2, 4)

    # Logout
    @task
    def logout(self):
        think(0.5, 1)
        self.interrupt()  # End session, Locust will restart


class CasualBrowser(HttpUser):
    """Corporate viewer - browses slowly, mostly views dashboards."""
    tasks = [UISession]
    weight = 5
    wait_time = between(5, 15)
    think_min = 3
    think_max = 8


class ActiveOperator(HttpUser):
    """Store manager - moderate speed, creates orders and checks inventory."""
    tasks = [UISession]
    weight = 3
    wait_time = between(2, 6)
    think_min = 2
    think_max = 5


class PowerUser(HttpUser):
    """Store associate / warehouse worker - fast, creates data frequently."""
    tasks = [UISession]
    weight = 2
    wait_time = between(1, 3)
    think_min = 1
    think_max = 3
