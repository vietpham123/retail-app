using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Npgsql;
using System;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var connStr = $"Host={Env("DB_HOST", "timescaledb")};Port={Env("DB_PORT", "5432")};" +
              $"Database={Env("DB_NAME", "appdb")};Username={Env("DB_USER", "appuser")};" +
              $"Password={Env("DB_PASSWORD", "changeme")}";

app.MapGet("/health", () => Results.Json(new { status = "ok", service = "fraud-detection-service" }));

// AGENT: Customize correlation logic for industry-specific event patterns
app.MapGet("/api/correlation", async () =>
{
    try
    {
        using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();

        // Analyze orders by store and status
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT store,
                   status,
                   COUNT(*) as order_count,
                   AVG(total_amount) as avg_amount,
                   SUM(total_amount) as total_amount,
                   MIN(placed_at) as first_order,
                   MAX(placed_at) as last_order
            FROM orders
            WHERE placed_at > NOW() - INTERVAL '24 hours'
            GROUP BY store, status
            ORDER BY order_count DESC";
        using var reader = await cmd.ExecuteReaderAsync();
        var correlations = new System.Collections.Generic.List<object>();
        while (await reader.ReadAsync())
        {
            correlations.Add(new
            {
                store = reader.GetString(0),
                status = reader.GetString(1),
                order_count = reader.GetInt64(2),
                avg_amount = reader.IsDBNull(3) ? 0 : reader.GetDouble(3),
                total_amount = reader.IsDBNull(4) ? 0 : reader.GetDouble(4),
                first_order = reader.GetDateTime(5),
                last_order = reader.GetDateTime(6),
                correlation_type = "transaction_analysis"
            });
        }

        return Results.Json(new
        {
            correlations,
            analyzed_at = DateTime.UtcNow,
            window_hours = 24,
            total_groups = correlations.Count
        });
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = ex.Message }, statusCode: 500);
    }
});

app.MapGet("/api/correlation/patterns", async () =>
{
    try
    {
        using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT store,
                   COUNT(*) as total_orders,
                   AVG(total_amount) as avg_amount,
                   COUNT(*) FILTER (WHERE status = 'returned')::float / NULLIF(COUNT(*), 0) as return_rate
            FROM orders
            WHERE placed_at > NOW() - INTERVAL '7 days'
            GROUP BY store
            ORDER BY total_orders DESC";
        using var reader = await cmd.ExecuteReaderAsync();
        var patterns = new System.Collections.Generic.List<object>();
        while (await reader.ReadAsync())
        {
            patterns.Add(new
            {
                store = reader.GetString(0),
                total_orders = reader.GetInt64(1),
                avg_amount = reader.IsDBNull(2) ? 0 : reader.GetDouble(2),
                return_rate = reader.IsDBNull(3) ? 0 : reader.GetDouble(3)
            });
        }
        return Results.Json(patterns);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = ex.Message }, statusCode: 500);
    }
});

app.Run($"http://0.0.0.0:{Env("PORT", "5004")}");

static string Env(string key, string fallback) =>
    Environment.GetEnvironmentVariable(key) ?? fallback;
