"""
Retail Operations Platform — Locust Load Generator
====================================================
Simulates real users: login → navigate 10 random pages → end session.
Each page navigation hits the corresponding API endpoint the browser calls.

Dynatrace RUM Integration:
- Real browser User-Agent strings so Dynatrace classifies traffic as real users
- Referer headers chain correctly from page to page for user-action detection
- Proper Accept/Accept-Language headers matching browser fingerprints
- Cookie persistence per session for Dynatrace session correlation
- Unique X-Session-Id header per session for server-side session grouping
- X-Forwarded-For for geo-location simulation
"""

import os
import random
import time
import uuid
from locust import HttpUser, TaskSet, task, between

# --- Demo Users (retail store staff + corporate viewers) ---
DEMO_USERNAMES = [
    "admin_retail", "mgr_alpha", "mgr_beta", "mgr_gamma",
    "assoc_alpha_1", "assoc_alpha_2", "assoc_beta_1", "assoc_gamma_1",
    "wh_east_1", "wh_east_2", "wh_west_1",
    "viewer_corp_1", "viewer_corp_2", "viewer_corp_3", "viewer_corp_4",
]
DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "changeme2026")

# --- Tab endpoints (retail UI tabs) ---
TAB_ENDPOINTS = [
    {"name": "Dashboard", "page": "/dashboard", "endpoint": "/api/analytics/dashboard"},
    {"name": "Orders", "page": "/orders", "endpoint": "/api/orders"},
    {"name": "Inventory", "page": "/inventory", "endpoint": "/api/inventory"},
    {"name": "Catalog", "page": "/catalog", "endpoint": "/api/catalog"},
    {"name": "Topology", "page": "/topology", "endpoint": "/api/topology"},
    {"name": "Trends", "page": "/trends", "endpoint": "/api/analytics/trends"},
    {"name": "Forecasts", "page": "/forecasts", "endpoint": "/api/forecasts"},
    {"name": "Dispatch", "page": "/dispatch", "endpoint": "/api/dispatch"},
    {"name": "External", "page": "/external", "endpoint": "/api/external"},
    {"name": "Notifications", "page": "/notifications", "endpoint": "/api/notifications"},
    {"name": "Pricing", "page": "/pricing", "endpoint": "/api/pricing"},
    {"name": "WorkOrders", "page": "/work-orders", "endpoint": "/api/work-orders"},
    {"name": "Correlation", "page": "/correlation", "endpoint": "/api/correlation"},
    {"name": "Telemetry", "page": "/telemetry", "endpoint": "/api/telemetry"},
    {"name": "Audit", "page": "/audit", "endpoint": "/api/audit"},
    {"name": "Users", "page": "/users", "endpoint": "/api/auth/users"},
]

STORES = ["Store Alpha", "Store Beta", "Store Gamma", "East Distribution Center", "West Distribution Center"]
SKUS = [f"SKU-SA-{i:03d}" for i in range(1, 20)] + \
       [f"SKU-SB-{i:03d}" for i in range(1, 20)] + \
       [f"SKU-SC-{i:03d}" for i in range(1, 20)]

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

MAX_NAVIGATIONS = 10


def think(min_s=1, max_s=5):
    """Simulate user reading/thinking time."""
    time.sleep(random.uniform(min_s, max_s))


class UISession(TaskSet):
    """
    Simulates a user session: login → navigate 10 random pages → end session.
    Starts at the login page. Each navigation picks a random tab endpoint.
    Referer chains correctly from page to page for Dynatrace detection.
    Occasionally creates data (orders, inventory, etc.) during browsing.
    """

    def on_start(self):
        """User starts at the login page and authenticates."""
        self.username = random.choice(DEMO_USERNAMES)
        self.session_id = str(uuid.uuid4())
        self.current_page = "/login"
        self.nav_count = 0

        # POST login — first action in the session
        resp = self.client.post("/api/auth/login", json={
            "username": self.username,
            "password": DEMO_PASSWORD,
        }, headers=self._browser_headers(),
           name="POST /api/auth/login")
        if resp.status_code != 200:
            self.interrupt()
            return
        try:
            if not resp.json().get("success"):
                self.interrupt()
                return
        except Exception:
            self.interrupt()
            return
        think(1, 2)

    @task
    def navigate_page(self):
        """Navigate to a random page. After 10 navigations, end session."""
        if self.nav_count >= MAX_NAVIGATIONS:
            self.interrupt()
            return

        tab = random.choice(TAB_ENDPOINTS)
        h = self._browser_headers()
        self.client.get(tab["endpoint"], headers=h,
                        name=f"GET {tab['endpoint']}")
        self.current_page = tab["page"]
        self.nav_count += 1

        # Occasionally create data during browsing (every ~3rd navigation)
        if self.nav_count % 3 == 0:
            self._create_some_data()

    def _create_some_data(self):
        """Simulate user creating records during their session."""
        action = random.choice(["order", "work-order", "inventory", "dispatch", "audit"])

        if action == "order":
            self.client.post("/api/orders", json={
                "customer_id": f"CUST-{random.randint(1000, 9999)}",
                "store": random.choice(STORES),
                "total_amount": round(random.uniform(9.99, 499.99), 2),
                "items_count": random.randint(1, 12),
                "sku": random.choice(SKUS),
            }, headers=self._browser_headers(),
               name="POST /api/orders")

        elif action == "work-order":
            self.client.post("/api/work-orders", json={
                "assignee": random.choice(DEMO_USERNAMES),
                "priority": random.choice(["standard", "express", "same_day"]),
            }, headers=self._browser_headers(),
               name="POST /api/work-orders")

        elif action == "inventory":
            self.client.post("/api/inventory", json={
                "sku": random.choice(SKUS),
                "quantity": random.randint(0, 500),
                "warehouse": random.choice(["East Distribution Center", "West Distribution Center"]),
            }, headers=self._browser_headers(),
               name="POST /api/inventory")

        elif action == "dispatch":
            self.client.post("/api/dispatch", json={
                "assignee": random.choice(DEMO_USERNAMES),
                "team": random.choice(["East Warehouse", "West Warehouse", "Store Fulfillment"]),
                "priority": random.choice(["standard", "express", "same_day"]),
                "status": "assigned",
            }, headers=self._browser_headers(),
               name="POST /api/dispatch")

        elif action == "audit":
            self.client.post("/api/audit/log", json={
                "actor": self.username,
                "action": random.choice(["login", "create_order", "update_inventory",
                                         "approve_dispatch", "generate_report", "modify_pricing"]),
                "resource_type": random.choice(["order", "inventory", "dispatch", "pricing", "forecast"]),
                "resource_id": f"RES-{random.randint(10000, 99999)}",
                "details": f"Action from {random.choice(STORES)}",
            }, headers=self._browser_headers(),
               name="POST /api/audit/log")

    def _browser_headers(self, accept="application/json, text/plain, */*"):
        """
        Build headers matching a real browser for Dynatrace session detection.
        Referer is set to current_page (the page the user is coming FROM).
        """
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


# ============================================================
# User Classes — different browsing speeds
# Each user gets a persistent browser UA + client IP so
# Dynatrace groups all their requests into one session.
# wait_time controls pause between page navigations.
# ============================================================

class CasualBrowser(HttpUser):
    """Corporate viewer — browses slowly, long pauses between pages."""
    tasks = [UISession]
    weight = 5
    wait_time = between(3, 8)

    def on_start(self):
        self.ua = random.choice(BROWSER_USER_AGENTS)
        self.client_ip = random.choice(CLIENT_IPS)


class ActiveOperator(HttpUser):
    """Store manager — moderate pace between pages."""
    tasks = [UISession]
    weight = 3
    wait_time = between(2, 5)

    def on_start(self):
        self.ua = random.choice(BROWSER_USER_AGENTS)
        self.client_ip = random.choice(CLIENT_IPS)


class PowerUser(HttpUser):
    """Store associate / warehouse worker — fast navigation."""
    tasks = [UISession]
    weight = 2
    wait_time = between(1, 3)

    def on_start(self):
        self.ua = random.choice(BROWSER_USER_AGENTS)
        self.client_ip = random.choice(CLIENT_IPS)
