package com.genericapp.workorder;

import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.beans.factory.annotation.Autowired;

import javax.annotation.PostConstruct;
import java.util.*;

@SpringBootApplication
@RestController
public class Application {

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private RabbitTemplate rabbit;

    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }

    @PostConstruct
    public void initDb() {
        try {
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS fulfillment_tasks (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    order_id UUID,
                    assignee TEXT,
                    priority TEXT NOT NULL DEFAULT 'standard',
                    status TEXT NOT NULL DEFAULT 'pending',
                    due_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            """);
            System.out.println("Fulfillment tasks table initialized");
        } catch (Exception e) {
            System.err.println("DB init error: " + e.getMessage());
        }
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok", "service", "fulfillment-service");
    }

    @GetMapping("/api/work-orders")
    public List<Map<String, Object>> getAll(@RequestParam(defaultValue = "all") String status) {
        if ("all".equals(status)) {
            return jdbc.queryForList("SELECT * FROM fulfillment_tasks ORDER BY created_at DESC LIMIT 100");
        }
        return jdbc.queryForList(
            "SELECT * FROM fulfillment_tasks WHERE status = ? ORDER BY created_at DESC LIMIT 100", status);
    }

    @PostMapping("/api/work-orders")
    public Map<String, Object> create(@RequestBody Map<String, Object> body) {
        String id = UUID.randomUUID().toString();
        jdbc.update(
            "INSERT INTO fulfillment_tasks (id, order_id, assignee, priority, status, due_at, created_at) VALUES (?::uuid, ?::uuid, ?, ?, 'pending', NOW() + INTERVAL '3 days', NOW())",
            id,
            body.getOrDefault("order_id", UUID.randomUUID().toString()),
            body.getOrDefault("assignee", "unassigned"),
            body.getOrDefault("priority", "standard")
        );

        // Publish to RabbitMQ for fulfillment processing
        try {
            rabbit.convertAndSend("fulfillment", "fulfillment.task.created",
                String.format("{\"id\":\"%s\",\"priority\":\"%s\"}", id, body.getOrDefault("priority", "standard")));
        } catch (Exception e) {
            System.err.println("RabbitMQ publish error: " + e.getMessage());
        }

        return Map.of("id", id, "status", "created");
    }

    @PutMapping("/api/work-orders/{id}/status")
    public Map<String, Object> updateStatus(@PathVariable String id, @RequestBody Map<String, Object> body) {
        String newStatus = (String) body.getOrDefault("status", "pending");
        int updated = jdbc.update("UPDATE fulfillment_tasks SET status = ? WHERE id = ?::uuid", newStatus, id);
        if (updated == 0) return Map.of("error", "not found");
        return Map.of("id", id, "status", newStatus);
    }

    @GetMapping("/api/work-orders/stats")
    public Map<String, Object> stats() {
        Map<String, Object> result = new HashMap<>();
        result.put("by_status", jdbc.queryForList(
            "SELECT status, COUNT(*) as count FROM fulfillment_tasks GROUP BY status"));
        result.put("by_priority", jdbc.queryForList(
            "SELECT priority, COUNT(*) as count FROM fulfillment_tasks GROUP BY priority"));
        result.put("overdue", jdbc.queryForObject(
            "SELECT COUNT(*) FROM fulfillment_tasks WHERE due_at < NOW() AND status NOT IN ('completed', 'shipped')",
            Long.class));
        return result;
    }

    @RabbitListener(queues = "#{@dispatchQueue}")
    public void onDispatch(String message) {
        System.out.println("Received dispatch message: " + message);
    }

    @org.springframework.context.annotation.Bean
    public org.springframework.amqp.core.Queue dispatchQueue() {
        return new org.springframework.amqp.core.Queue("fulfillment-service.tasks", true);
    }

    @org.springframework.context.annotation.Bean
    public org.springframework.amqp.core.TopicExchange workOrderExchange() {
        return new org.springframework.amqp.core.TopicExchange("fulfillment");
    }
}
