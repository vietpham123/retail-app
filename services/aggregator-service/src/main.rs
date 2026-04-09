use actix_web::{web, App, HttpServer, HttpResponse, middleware};
use serde_json::json;
use std::env;
use tokio_postgres::NoTls;

fn env_or(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

async fn get_db_client() -> Result<tokio_postgres::Client, Box<dyn std::error::Error>> {
    let conn_str = format!(
        "host={} port={} dbname={} user={} password={}",
        env_or("DB_HOST", "timescaledb"),
        env_or("DB_PORT", "5432"),
        env_or("DB_NAME", "appdb"),
        env_or("DB_USER", "appuser"),
        env_or("DB_PASSWORD", "changeme"),
    );
    let (client, connection) = tokio_postgres::connect(&conn_str, NoTls).await?;
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("DB connection error: {}", e);
        }
    });
    Ok(client)
}

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(json!({"status": "ok", "service": "aggregator-service"}))
}

// AGENT: Customize aggregation queries for industry-specific data
async fn aggregation() -> HttpResponse {
    let client = match get_db_client().await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().json(json!({"error": e.to_string()})),
    };

    let mut result = json!({});

    // Orders by status
    if let Ok(rows) = client.query(
        "SELECT status, COUNT(*) as count, AVG(total_amount) as avg_total_amount \
         FROM orders WHERE placed_at > NOW() - INTERVAL '24 hours' \
         GROUP BY status ORDER BY count DESC", &[]
    ).await {
        let orders: Vec<serde_json::Value> = rows.iter().map(|r| {
            json!({
                "status": r.get::<_, String>(0),
                "count": r.get::<_, i64>(1),
                "avg_total_amount": r.get::<_, f64>(2),
            })
        }).collect();
        result["orders_by_status"] = json!(orders);
    }

    // Inventory by warehouse
    if let Ok(rows) = client.query(
        "SELECT warehouse, COUNT(*) as count, AVG(quantity) as avg_quantity \
         FROM inventory_readings WHERE recorded_at > NOW() - INTERVAL '24 hours' \
         GROUP BY warehouse ORDER BY count DESC", &[]
    ).await {
        let inventory: Vec<serde_json::Value> = rows.iter().map(|r| {
            json!({
                "warehouse": r.get::<_, String>(0),
                "count": r.get::<_, i64>(1),
                "avg_quantity": r.get::<_, f64>(2),
            })
        }).collect();
        result["inventory_by_warehouse"] = json!(inventory);
    }

    // Demand forecasts by SKU
    if let Ok(rows) = client.query(
        "SELECT sku, COUNT(*) as count, AVG(confidence) as avg_confidence \
         FROM demand_forecasts WHERE created_at > NOW() - INTERVAL '24 hours' \
         GROUP BY sku ORDER BY count DESC", &[]
    ).await {
        let forecasts: Vec<serde_json::Value> = rows.iter().map(|r| {
            json!({
                "sku": r.get::<_, String>(0),
                "count": r.get::<_, i64>(1),
                "avg_confidence": r.get::<_, f64>(2),
            })
        }).collect();
        result["demand_forecasts_by_sku"] = json!(forecasts);
    }

    result["aggregated_at"] = json!(chrono_now());
    HttpResponse::Ok().json(result)
}

async fn aggregation_daily() -> HttpResponse {
    let client = match get_db_client().await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().json(json!({"error": e.to_string()})),
    };

    let mut result = json!({});

    if let Ok(rows) = client.query(
        "SELECT DATE(placed_at) as day, COUNT(*) as count \
         FROM orders WHERE placed_at > NOW() - INTERVAL '30 days' \
         GROUP BY day ORDER BY day", &[]
    ).await {
        let daily: Vec<serde_json::Value> = rows.iter().map(|r| {
            let day: chrono::NaiveDate = r.get(0);
            json!({"date": day.to_string(), "count": r.get::<_, i64>(1)})
        }).collect();
        result["daily_orders"] = json!(daily);
    }

    HttpResponse::Ok().json(result)
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    format!("{}Z", d.as_secs())
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port: u16 = env_or("PORT", "8084").parse().unwrap_or(8084);
    println!("aggregator-service listening on port {}", port);

    HttpServer::new(|| {
        App::new()
            .route("/health", web::get().to(health))
            .route("/api/aggregation", web::get().to(aggregation))
            .route("/api/aggregation/daily", web::get().to(aggregation_daily))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
