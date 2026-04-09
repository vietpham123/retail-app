package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	_ "github.com/lib/pq"
)

var db *sql.DB

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	connStr := fmt.Sprintf("host=%s port=%s dbname=%s user=%s password=%s sslmode=disable",
		env("DB_HOST", "timescaledb"), env("DB_PORT", "5432"),
		env("DB_NAME", "appdb"), env("DB_USER", "appuser"), env("DB_PASSWORD", "changeme"))

	var err error
	db, err = sql.Open("postgres", connStr)
	if err != nil {
		log.Printf("DB connection error: %v", err)
	}

	http.HandleFunc("/health", healthHandler)
	// AGENT: Update endpoint paths and metrics for industry-specific analytics
	http.HandleFunc("/api/analytics/dashboard", dashboardHandler)
	http.HandleFunc("/api/analytics/trends", trendsHandler)
	http.HandleFunc("/api/analytics/regions", regionsHandler)

	port := env("PORT", "8082")
	log.Printf("sales-analytics-service listening on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{"status": "ok", "service": "sales-analytics-service"})
}

func dashboardHandler(w http.ResponseWriter, r *http.Request) {
	dashboard := map[string]interface{}{}

	// Orders today
	var ordersToday int64
	if err := db.QueryRow("SELECT COUNT(*) FROM orders WHERE placed_at > CURRENT_DATE").Scan(&ordersToday); err == nil {
		dashboard["orders_today"] = ordersToday
	} else {
		dashboard["orders_today"] = 0
	}

	// Daily revenue
	var dailyRevenue float64
	if err := db.QueryRow("SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE placed_at > CURRENT_DATE").Scan(&dailyRevenue); err == nil {
		dashboard["daily_revenue"] = dailyRevenue
	} else {
		dashboard["daily_revenue"] = 0
	}

	// Total in stock
	var totalInStock int64
	if err := db.QueryRow("SELECT COALESCE(SUM(quantity), 0) FROM inventory_readings").Scan(&totalInStock); err == nil {
		dashboard["total_in_stock"] = totalInStock
	} else {
		dashboard["total_in_stock"] = 0
	}

	// Fulfillment rate
	var totalTasks, completedTasks int64
	db.QueryRow("SELECT COUNT(*) FROM fulfillment_dispatch").Scan(&totalTasks)
	db.QueryRow("SELECT COUNT(*) FROM fulfillment_dispatch WHERE status = 'completed'").Scan(&completedTasks)
	if totalTasks > 0 {
		dashboard["fulfillment_rate_pct"] = float64(completedTasks) / float64(totalTasks) * 100
	} else {
		dashboard["fulfillment_rate_pct"] = 100.0
	}

	// Abandonment rate (mock)
	dashboard["abandonment_pct"] = 23.5

	// Average shipping hours
	var avgShipHours float64
	if err := db.QueryRow(`
		SELECT COALESCE(AVG(EXTRACT(EPOCH FROM delivered_at - placed_at) / 3600), 0)
		FROM orders WHERE delivered_at IS NOT NULL AND placed_at > NOW() - INTERVAL '24 hours'
	`).Scan(&avgShipHours); err == nil {
		dashboard["avg_ship_hours"] = avgShipHours
	} else {
		dashboard["avg_ship_hours"] = 0
	}

	writeJSON(w, dashboard)
}

func trendsHandler(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		SELECT time_bucket('1 hour', placed_at) AS bucket,
		       COUNT(*) AS count
		FROM orders
		WHERE placed_at > NOW() - INTERVAL '24 hours'
		GROUP BY bucket
		ORDER BY bucket
	`)
	if err != nil {
		writeJSON(w, []interface{}{})
		return
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var bucket string
		var count int64
		if err := rows.Scan(&bucket, &count); err == nil {
			results = append(results, map[string]interface{}{
				"time":  bucket,
				"count": count,
			})
		}
	}
	if results == nil {
		results = []map[string]interface{}{}
	}
	writeJSON(w, results)
}

func regionsHandler(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		SELECT store, COUNT(*) AS order_count,
		       COALESCE(SUM(total_amount), 0) AS revenue
		FROM orders
		WHERE placed_at > NOW() - INTERVAL '7 days'
		GROUP BY store ORDER BY revenue DESC
	`)
	if err != nil {
		writeJSON(w, []interface{}{})
		return
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var store string
		var orderCount int64
		var revenue float64
		if err := rows.Scan(&store, &orderCount, &revenue); err == nil {
			results = append(results, map[string]interface{}{
				"store":       store,
				"order_count": orderCount,
				"revenue":     revenue,
			})
		}
	}
	if results == nil {
		results = []map[string]interface{}{}
	}
	writeJSON(w, results)
}

func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}
