package com.genericapp.dispatch

import org.springframework.amqp.rabbit.annotation.RabbitListener
import org.springframework.amqp.rabbit.core.RabbitTemplate
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.bind.annotation.*
import java.util.UUID
import jakarta.annotation.PostConstruct

@SpringBootApplication
@RestController
class Application(
    private val jdbc: JdbcTemplate,
    private val rabbit: RabbitTemplate
) {
    @PostConstruct
    fun initDb() {
        try {
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS fulfillment_dispatch (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    order_id UUID,
                    assignee TEXT NOT NULL,
                    team TEXT,
                    status TEXT NOT NULL DEFAULT 'assigned',
                    priority TEXT NOT NULL DEFAULT 'standard',
                    eta TIMESTAMPTZ,
                    dispatched_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            println("Fulfillment dispatch table initialized")
        } catch (e: Exception) {
            println("DB init error: ${e.message}")
        }
    }

    @GetMapping("/health")
    fun health() = mapOf("status" to "ok", "service" to "fulfillment-dispatch-service")

    @GetMapping("/api/dispatch")
    fun getAll(@RequestParam(defaultValue = "all") status: String): List<Map<String, Any>> {
        return if (status == "all") {
            jdbc.queryForList("SELECT * FROM fulfillment_dispatch ORDER BY dispatched_at DESC LIMIT 100")
        } else {
            jdbc.queryForList(
                "SELECT * FROM fulfillment_dispatch WHERE status = ? ORDER BY dispatched_at DESC LIMIT 100",
                status
            )
        }
    }

    @PostMapping("/api/dispatch")
    fun dispatch(@RequestBody body: Map<String, Any>): Map<String, Any> {
        val id = UUID.randomUUID().toString()
        jdbc.update(
            """INSERT INTO fulfillment_dispatch (id, order_id, assignee, team, priority, eta, dispatched_at)
               VALUES (?::uuid, ?::uuid, ?, ?, ?, NOW() + INTERVAL '2 hours', NOW())""",
            id,
            body["order_id"]?.toString(),
            body.getOrDefault("assignee", "picker-1"),
            body.getOrDefault("team", "picking"),
            body.getOrDefault("priority", "standard")
        )
        return mapOf("id" to id, "status" to "dispatched")
    }

    @PutMapping("/api/dispatch/{id}/status")
    fun updateStatus(@PathVariable id: String, @RequestBody body: Map<String, Any>): Map<String, Any> {
        val newStatus = body.getOrDefault("status", "assigned").toString()
        val updated = jdbc.update(
            "UPDATE fulfillment_dispatch SET status = ? WHERE id = ?::uuid",
            newStatus, id
        )
        return if (updated > 0) mapOf("id" to id, "status" to newStatus)
        else mapOf("error" to "not found")
    }

    @GetMapping("/api/dispatch/stats")
    fun stats(): Map<String, Any> = mapOf(
        "by_status" to jdbc.queryForList(
            "SELECT status, COUNT(*) as count FROM fulfillment_dispatch GROUP BY status"
        ),
        "by_team" to jdbc.queryForList(
            "SELECT team, COUNT(*) as count FROM fulfillment_dispatch GROUP BY team"
        ),
        "active" to (jdbc.queryForObject(
            "SELECT COUNT(*) FROM fulfillment_dispatch WHERE status NOT IN ('completed', 'cancelled')",
            Long::class.java
        ) ?: 0L)
    )

    // Listen for new fulfillment tasks from RabbitMQ
    @RabbitListener(queues = ["fulfillment-dispatch-service.tasks"])
    fun onFulfillmentTask(message: String) {
        println("Received fulfillment task for dispatch: $message")
    }
}

fun main(args: Array<String>) {
    runApplication<Application>(*args)
}
