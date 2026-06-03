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
import org.litote.kmongo.descending
import org.litote.kmongo.eq

// Resolve a snapshot by Mongo _id first, falling back to its description.
// findOneById throws on a non-ObjectId string, so guard it instead of 500ing.
private suspend fun CoroutineCollection<Snapshot>.findByIdOrDescription(term: String): Snapshot? {
    val byId = try {
        findOneById(term)
    } catch (e: Exception) {
        null
    }
    return byId ?: findOne(Snapshot::description eq term)
}

fun Application.configureRouting(snapshots: CoroutineCollection<Snapshot>) {
    routing {

        openAPI(path = "/openapi")

        get("/") {
            call.respondText("Snapshot Service is running...", ContentType.Text.Plain)
        }

        // List most recent snapshots (newest first).
        get("/snapshots") {
            val limit = call.request.queryParameters["limit"]?.toIntOrNull()?.coerceIn(1, 100) ?: 20
            val list = snapshots.find()
                .sort(descending(Snapshot::timestamp))
                .limit(limit)
                .toList()
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

        // Get snapshot by ID or description.
        get("/snapshot/{id}") {
            val id = call.parameters["id"]
            if (id == null) {
                call.respond(HttpStatusCode.BadRequest, StatusResponse("error", "Missing ID"))
                return@get
            }

            val doc = snapshots.findByIdOrDescription(id)
            if (doc != null) {
                call.respond(doc)
            } else {
                call.respond(HttpStatusCode.NotFound, StatusResponse("error", "Snapshot id:$id not found"))
            }
        }

        delete("/snapshot/{id}") {
            val id = call.parameters["id"]
            if (id == null) {
                call.respond(HttpStatusCode.BadRequest, StatusResponse("error", "Missing ID"))
                return@delete
            }

            val result = try {
                snapshots.deleteOneById(id)
            } catch (e: Exception) {
                call.respond(HttpStatusCode.BadRequest, StatusResponse("error", "Invalid id:$id"))
                return@delete
            }

            if (result.deletedCount > 0) {
                call.respond(HttpStatusCode.OK, StatusResponse("success", "Snapshot id:$id deleted"))
            } else {
                call.respond(HttpStatusCode.NotFound, StatusResponse("error", "Snapshot id:$id not found"))
            }
        }
    }
}
