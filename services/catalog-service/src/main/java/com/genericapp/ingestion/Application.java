package com.genericapp.ingestion;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.*;
import org.springframework.beans.factory.annotation.Autowired;

import jakarta.annotation.PostConstruct;
import java.util.*;

@SpringBootApplication
@EnableScheduling
@RestController
public class Application {

    @Autowired
    private JdbcTemplate jdbc;

    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }

    @PostConstruct
    public void initDb() {
        try {
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS catalog_products (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    sku TEXT NOT NULL,
                    name TEXT NOT NULL,
                    category TEXT NOT NULL,
                    brand TEXT NOT NULL,
                    price DOUBLE PRECISION NOT NULL,
                    in_stock BOOLEAN DEFAULT TRUE,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            """);
            System.out.println("Catalog products table initialized");
        } catch (Exception e) {
            System.err.println("DB init error: " + e.getMessage());
        }
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok", "service", "catalog-service");
    }

    @GetMapping("/api/catalog")
    public List<Map<String, Object>> getAll() {
        return jdbc.queryForList(
            "SELECT * FROM catalog_products ORDER BY updated_at DESC LIMIT 100"
        );
    }

    @GetMapping("/api/catalog/stats")
    public Map<String, Object> getStats() {
        Map<String, Object> stats = new HashMap<>();
        stats.put("total", jdbc.queryForObject("SELECT COUNT(*) FROM catalog_products", Long.class));
        stats.put("in_stock", jdbc.queryForObject(
            "SELECT COUNT(*) FROM catalog_products WHERE in_stock = TRUE", Long.class));
        stats.put("categories", jdbc.queryForList(
            "SELECT category, COUNT(*) as count FROM catalog_products GROUP BY category ORDER BY count DESC"));
        stats.put("brands", jdbc.queryForList(
            "SELECT brand, COUNT(*) as count FROM catalog_products GROUP BY brand ORDER BY count DESC"));
        return stats;
    }

    @PostMapping("/api/catalog")
    public Map<String, Object> createProduct(@RequestBody Map<String, Object> body) {
        String id = UUID.randomUUID().toString();
        String sku = (String) body.getOrDefault("sku", "SKU-000");
        String name = (String) body.getOrDefault("name", "Unknown Product");
        String category = (String) body.getOrDefault("category", "general");
        String brand = (String) body.getOrDefault("brand", "Gap");
        double price = Double.parseDouble(body.getOrDefault("price", 0.0).toString());
        jdbc.update(
            "INSERT INTO catalog_products (id, sku, name, category, brand, price, updated_at) VALUES (?::uuid, ?, ?, ?, ?, ?, NOW())",
            id, sku, name, category, brand, price
        );
        return Map.of("id", id, "status", "created");
    }

    @KafkaListener(topics = "${KAFKA_INGEST_TOPIC:retail.catalog.updated}", groupId = "catalog-service")
    public void onMessage(String message) {
        try {
            jdbc.update(
                "INSERT INTO catalog_products (sku, name, category, brand, price, updated_at) VALUES ('kafka-sku', 'Kafka Product', 'general', 'Gap', 0.0, NOW())"
            );
        } catch (Exception e) {
            System.err.println("Kafka catalog error: " + e.getMessage());
        }
    }

    // Background: generate sample catalog products every 30s
    @Scheduled(fixedRate = 30000)
    public void generateProducts() {
        try {
            String[] categories = {"tops", "bottoms", "shoes", "accessories", "outerwear"};
            String[] brands = {"Gap", "Old Navy", "Macy's Private Label"};
            var rng = new java.util.Random();
            String sku = "SKU-" + String.format("%04d", rng.nextInt(9999));
            String category = categories[rng.nextInt(categories.length)];
            String brand = brands[rng.nextInt(brands.length)];
            double price = Math.round((rng.nextDouble() * 190 + 10) * 100.0) / 100.0;
            jdbc.update(
                "INSERT INTO catalog_products (sku, name, category, brand, price, updated_at) VALUES (?, ?, ?, ?, ?, NOW())",
                sku, brand + " " + category.substring(0, 1).toUpperCase() + category.substring(1), category, brand, price
            );
            System.out.println("Generated catalog product: " + sku);
        } catch (Exception e) {
            System.err.println("Generation error: " + e.getMessage());
        }
    }
}
