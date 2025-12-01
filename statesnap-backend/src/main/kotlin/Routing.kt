package com.example

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.plugins.openapi.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import org.bson.BsonObjectId
import org.bson.BsonString
import org.bson.BsonValue
import org.litote.kmongo.coroutine.CoroutineCollection
import org.litote.kmongo.eq

fun Application.configureRouting(snapshots: CoroutineCollection<Snapshot>) {
    routing {

        openAPI(path = "/openapi")

        get("/") {
            call.respondText("Snapshot Service is running...", ContentType.Text.Plain)
        }

        // Save snapshot state
        post("/snapshot") {
            try {
                val snapshot = call.receive<Snapshot>()
                val result = snapshots.insertOne(snapshot)

                val insertedId = result.insertedId?.let { id: BsonValue ->
                    when (id) {
                        is BsonObjectId -> id.value.toHexString()
                        is BsonString -> id.value
                        else -> id.toString()
                    }
                } ?: snapshot._id ?: ""

                call.respond(HttpStatusCode.Created, mapOf("status" to "saved", "id" to insertedId))
            } catch (e: Exception) {
                e.printStackTrace()
                call.respond(HttpStatusCode.InternalServerError, e.localizedMessage)
            }
        }

        // Get snapshot by ID
        get("/snapshot/{id}") {
            val id = call.parameters["id"]
            if (id == null) {
                call.respond(HttpStatusCode.BadRequest, "Missing ID")
                return@get
            }

            // Try to find by _id
            val doc = snapshots.findOneById(id) ?: run {
                // If not found, try to find by description
                snapshots.findOne(Snapshot::description eq id)
            }

            if (doc != null) {
                call.respond(doc)
            } else {
                call.respond(HttpStatusCode.NotFound, "Snapshot not found")
            }
        }

        // Lookup by id or description (tries _id first, then description)
        get("/snapshot/lookup/{term}") {
            val term = call.parameters["term"]
            if (term == null) {
                call.respond(HttpStatusCode.BadRequest, "Missing term")
                return@get
            }

            var doc = snapshots.findOneById(term)
            if (doc == null) {
                doc = snapshots.findOne(Snapshot::description eq term)
            }

            if (doc != null) {
                call.respond(doc)
            } else {
                call.respond(HttpStatusCode.NotFound, "Snapshot not found")
            }
        }

        // List recent snapshots
        get("/snapshots") {
            val list = snapshots.find().limit(20).toList()
            call.respond(list.map { mapOf("id" to (it._id ?: ""), "url" to it.url, "date" to it.timestamp) })
        }
    }
}