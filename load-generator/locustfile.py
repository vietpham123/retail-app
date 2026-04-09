"""
Retail Operations Platform - Locust Load Generator
====================================================
Simulates real user navigation through the retail web UI.

Dynatrace RUM Integration:
- Real browser User-Agent strings so Dynatrace classifies traffic as real users
- Referer headers on every request to enable Dynatrace user-action detection
- Proper Accept/Accept-Language headers matching browser fingerprints
- HTML page loads that trigger Dynatrace JS agent injection (Set-Cookie: dtCookie)
- Cookie persistence per session for Dynatrace session correlation
- Unique X-Session-Id header per session for server-side session grouping
"""

import os
import random
import time
import uuid
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

# --- Real browser User-Agent strings for Dynatrace RUM detection ---
BROWSER_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1",
]

# Simulated client IPs for Dynatrace geo-location
CLIENT_IPS = [
    "104.28.45.112",   # San Francisco
    "72.134.201.88",   # New York
    "24.101.55.200",   # Chicago
    "71.178.92.44",    # Los Angeles
    "98.169.118.33",   # Houston
    "50.206.71.129",   # Phoenix
    "75.144.58.201",   # Seattle
    "64.134.200.15",   # Denver
    "69.142.88.160",   # Miami
    "73.162.45.200",   # Boston
]

APP_BASE_URL = os.getenv("LOCUST_HOST", "http://api-gateway:3000")


def think(min_s=1, max_s=5):
    """Simulate user reading/thinking time."""
    time.sleep(random.uniform(min_s, max_s))


class UISession(SequentialTaskSet):
    """Emulates a user session: login -> navigate tabs -> logout."""

    def on_start(self):
        self.username = random.choice(DEMO_USERNAMES)
        self.session_id = str(uuid.uuid4())
        self.current_page = "/"

        # Initial page load — hit the dashboard endpoint as the landing page
        self.client.get("/api/analytics/dashboard",
                        headers=self._browser_headers("/", accept="text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
                        name="GET /api/analytics/dashboard (page load)")
        think(0.5, 1)

        # Login
        self.current_page = "/login"
        resp = self.client.post("/api/auth/login", json={
            "username": self.username,
            "password": DEMO_PASSWORD,
        }, headers=self._browser_headers("/login"),
           name="POST /api/auth/login")
        if resp.status_code == 200:
            data = resp.json()
            if not data.get("success"):
                self.interrupt()
        else:
            self.interrupt()
        think(1, 2)

    # Visit dashboard first (always)
    @task
    def visit_dashboard(self):
        self.current_page = "/dashboard"
        self.client.get("/api/analytics/dashboard",
                        headers=self._browser_headers("/dashboard"),
                        name="GET /api/analytics/dashboard")
        think(2, 5)

    # Navigate through random selection of tabs
    @task
    def browse_tabs(self):
        tabs_to_visit = random.sample(TAB_ENDPOINTS[1:], k=random.randint(5, min(10, len(TAB_ENDPOINTS)-1)))
        for endpoint in tabs_to_visit:
            page = endpoint.replace("/api/", "/")
            self.current_page = page
            self.client.get(endpoint,
                            headers=self._browser_headers(page),
                            name=f"GET {endpoint}")
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
            }, headers=self._browser_headers("/orders"),
               name="POST /api/orders")
            think(1, 3)

        if random.random() < 0.2:
            self.client.post("/api/work-orders", json={
                "assignee": random.choice(DEMO_USERNAMES),
                "priority": random.choice(["standard", "express", "same_day"]),
            }, headers=self._browser_headers("/work-orders"),
               name="POST /api/work-orders")
            think(1, 2)

        if random.random() < 0.15:
            self.client.post("/api/inventory", json={
                "sku": random.choice(SKUS),
                "quantity": random.randint(0, 500),
                "warehouse": random.choice(["East Distribution Center", "West Distribution Center"]),
            }, headers=self._browser_headers("/inventory"),
               name="POST /api/inventory")
            think(1, 2)

        if random.random() < 0.2:
            self.client.post("/api/dispatch", json={
                "assignee": random.choice(DEMO_USERNAMES),
                "team": random.choice(["East Warehouse", "West Warehouse", "Store Fulfillment"]),
                "priority": random.choice(["standard", "express", "same_day"]),
                "status": "assigned",
            }, headers=self._browser_headers("/dispatch"),
               name="POST /api/dispatch")
            think(1, 2)

        if random.random() < 0.25:
            self.client.post("/api/audit/log", json={
                "actor": self.username,
                "action": random.choice(["login", "create_order", "update_inventory", "approve_dispatch", "generate_report", "modify_pricing"]),
                "resource_type": random.choice(["order", "inventory", "dispatch", "pricing", "forecast"]),
                "resource_id": f"RES-{random.randint(10000, 99999)}",
                "details": f"Action from {random.choice(STORES)}",
            }, headers=self._browser_headers("/audit"),
               name="POST /api/audit/log")
            think(0.5, 1)

    # Return to dashboard
    @task
    def return_dashboard(self):
        self.current_page = "/dashboard"
        self.client.get("/api/analytics/dashboard",
                        headers=self._browser_headers("/dashboard"),
                        name="GET /api/analytics/dashboard")
        think(2, 4)

    # End session
    @task
    def end_session(self):
        # No explicit logout endpoint — just end the sequential task set
        think(0.5, 1)
        self.interrupt()

    def _browser_headers(self, page="/", accept="application/json, text/plain, */*"):
        """Build headers matching a real browser for Dynatrace session detection."""
        return {
            "User-Agent": self.user.ua,
            "Accept": accept,
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Referer": f"{APP_BASE_URL}{self.current_page}",
            "Origin": APP_BASE_URL,
            "Connection": "keep-alive",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "X-Requested-With": "XMLHttpRequest",
            "X-Session-Id": self.session_id,
            "X-Username": self.username,
            "X-Forwarded-For": self.user.client_ip,
        }


class CasualBrowser(HttpUser):
    """Corporate viewer - browses slowly, mostly views dashboards."""
    tasks = [UISession]
    weight = 5
    wait_time = between(5, 15)
    think_min = 3
    think_max = 8

    def on_start(self):
        self.ua = random.choice(BROWSER_USER_AGENTS)
        self.client_ip = random.choice(CLIENT_IPS)


class ActiveOperator(HttpUser):
    """Store manager - moderate speed, creates orders and checks inventory."""
    tasks = [UISession]
    weight = 3
    wait_time = between(2, 6)
    think_min = 2
    think_max = 5

    def on_start(self):
        self.ua = random.choice(BROWSER_USER_AGENTS)
        self.client_ip = random.choice(CLIENT_IPS)


class PowerUser(HttpUser):
    """Store associate / warehouse worker - fast, creates data frequently."""
    tasks = [UISession]
    weight = 2
    wait_time = between(1, 3)
    think_min = 1
    think_max = 3

    def on_start(self):
        self.ua = random.choice(BROWSER_USER_AGENTS)
        self.client_ip = random.choice(CLIENT_IPS)
