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

        // List recent snapshots
        get("/snapshots") {
            val list = snapshots.find().limit(20).toList()
            call.respond(list)
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

                val savedSnapshot = snapshots.findOneById(insertedId)
                if (savedSnapshot != null) {
                    call.respond(HttpStatusCode.Created, savedSnapshot)
                } else {
                    call.respond(
                        HttpStatusCode.InternalServerError,
                        StatusResponse("error", "Failed to retrieve saved snapshot")
                    )
                }
            } catch (e: Exception) {
                e.printStackTrace()
                call.respond(HttpStatusCode.InternalServerError, StatusResponse("error", e.message ?: "Unknown error"))
            }
        }

        // Get snapshot by ID
        get("/snapshot/{id}") {
            val id = call.parameters["id"]
            if (id == null) {
                call.respond(HttpStatusCode.BadRequest, StatusResponse("error", "Missing ID"))
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
                call.respond(HttpStatusCode.NotFound, StatusResponse("error", "Snapshot id:$id not found"))
            }
        }

        // Lookup by id or description (tries _id first, then description)
        get("/snapshot/lookup/{term}") {
            val term = call.parameters["term"]
            if (term == null) {
                call.respond(HttpStatusCode.BadRequest, StatusResponse("error", "Missing term "))
                return@get
            }

            var doc = snapshots.findOneById(term)
            if (doc == null) {
                doc = snapshots.findOne(Snapshot::description eq term)
            }

            if (doc != null) {
                call.respond(doc)
            } else {
                call.respond(HttpStatusCode.NotFound, StatusResponse("error", "Snapshot not found for term:$term"))
            }
        }

        delete("/snapshot/{id}") {
            val id = call.parameters["id"]
            if (id == null) {
                call.respond(HttpStatusCode.BadRequest, StatusResponse("error", "Missing ID"))
                return@delete
            }

            val result = snapshots.deleteOneById(id)
            if (result.deletedCount > 0) {
                call.respond(HttpStatusCode.OK, StatusResponse("success", "Snapshot id:$id deleted"))
            } else {
                call.respond(HttpStatusCode.NotFound, StatusResponse("error", "Snapshot id:$id not found"))
            }
        }
    }
}