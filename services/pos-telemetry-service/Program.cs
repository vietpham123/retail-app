using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Npgsql;
using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var connStr = $"Host={Env("DB_HOST", "timescaledb")};Port={Env("DB_PORT", "5432")};" +
              $"Database={Env("DB_NAME", "appdb")};Username={Env("DB_USER", "appuser")};" +
              $"Password={Env("DB_PASSWORD", "changeme")}";

// --- Init DB ---
try
{
    using var initConn = new NpgsqlConnection(connStr);
    await initConn.OpenAsync();
    using var cmd = initConn.CreateCommand();
    cmd.CommandText = @"
        CREATE TABLE IF NOT EXISTS pos_telemetry (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            terminal_id TEXT NOT NULL,
            metric TEXT NOT NULL,
            value DOUBLE PRECISION NOT NULL,
            store TEXT NOT NULL DEFAULT 'Gap Flagship',
            recorded_at TIMESTAMPTZ DEFAULT NOW()
        );";
    await cmd.ExecuteNonQueryAsync();
    Console.WriteLine("POS telemetry table initialized");
}
catch (Exception ex)
{
    Console.WriteLine($"DB init error: {ex.Message}");
}

// --- Simulation background task ---
var cts = new CancellationTokenSource();
_ = Task.Run(async () =>
{
    while (!cts.Token.IsCancellationRequested)
    {
        try
        {
            using var conn = new NpgsqlConnection(connStr);
            await conn.OpenAsync();
            var rng = new Random();
            string[] metrics = { "transaction_count", "avg_basket_size", "scan_rate", "error_rate", "uptime_pct" };
            string[] stores = { "Gap Flagship", "Old Navy Mall", "Macy's Downtown" };
            string[] prefixes = { "POS-GAP", "POS-ON", "POS-MAC" };
            for (int i = 0; i < 3; i++)
            {
                using var cmd = conn.CreateCommand();
                cmd.CommandText = @"INSERT INTO pos_telemetry (terminal_id, metric, value, store, recorded_at)
                                    VALUES (@d, @m, @v, @u, NOW())";
                var storeIdx = rng.Next(stores.Length);
                cmd.Parameters.AddWithValue("d", $"{prefixes[storeIdx]}-{rng.Next(1, 10):D3}");
                var metric = metrics[rng.Next(metrics.Length)];
                cmd.Parameters.AddWithValue("m", metric);
                cmd.Parameters.AddWithValue("v", Math.Round(rng.NextDouble() * 100, 2));
                cmd.Parameters.AddWithValue("u", stores[storeIdx]);
                await cmd.ExecuteNonQueryAsync();
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Simulation error: {ex.Message}");
        }
        await Task.Delay(TimeSpan.FromSeconds(10), cts.Token);
    }
});

app.MapGet("/health", () => Results.Json(new { status = "ok", service = "pos-telemetry-service" }));

app.MapGet("/api/telemetry", async () =>
{
    try
    {
        using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT * FROM pos_telemetry ORDER BY recorded_at DESC LIMIT 100";
        using var reader = await cmd.ExecuteReaderAsync();
        var results = new System.Collections.Generic.List<object>();
        while (await reader.ReadAsync())
        {
            results.Add(new
            {
                id = reader.GetGuid(0),
                terminal_id = reader.GetString(1),
                metric = reader.GetString(2),
                value = reader.GetDouble(3),
                store = reader.GetString(4),
                recorded_at = reader.GetDateTime(5)
            });
        }
        return Results.Json(results);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = ex.Message }, statusCode: 500);
    }
});

app.MapGet("/api/telemetry/summary", async () =>
{
    try
    {
        using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT metric, COUNT(*) as count, AVG(value) as avg_val,
                            MAX(value) as max_val, MIN(value) as min_val
                            FROM pos_telemetry WHERE recorded_at > NOW() - INTERVAL '1 hour'
                            GROUP BY metric ORDER BY metric";
        using var reader = await cmd.ExecuteReaderAsync();
        var results = new System.Collections.Generic.List<object>();
        while (await reader.ReadAsync())
        {
            results.Add(new
            {
                metric = reader.GetString(0),
                count = reader.GetInt64(1),
                avg_value = reader.GetDouble(2),
                max_value = reader.GetDouble(3),
                min_value = reader.GetDouble(4)
            });
        }
        return Results.Json(results);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = ex.Message }, statusCode: 500);
    }
});

app.Lifetime.ApplicationStopping.Register(() => cts.Cancel());
app.Run($"http://0.0.0.0:{Env("PORT", "5001")}");

static string Env(string key, string fallback) =>
    Environment.GetEnvironmentVariable(key) ?? fallback;
