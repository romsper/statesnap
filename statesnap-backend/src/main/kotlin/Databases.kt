package com.example

import io.ktor.server.application.*
import io.ktor.server.application.ApplicationStopped
import org.litote.kmongo.reactivestreams.KMongo
import org.litote.kmongo.coroutine.coroutine
import org.litote.kmongo.coroutine.CoroutineDatabase
import org.litote.kmongo.coroutine.CoroutineClient

fun Application.configureDatabases(): CoroutineDatabase {
    // Connection details come from application.conf (overridable via the
    // MONGODB_URI / MONGODB_DATABASE env vars) rather than being hardcoded.
    val uri = environment.config.propertyOrNull("mongodb.uri")?.getString()
        ?: "mongodb://localhost:27017"
    val dbName = environment.config.propertyOrNull("mongodb.database")?.getString()
        ?: "testing-snapshots"

    val client: CoroutineClient = KMongo.createClient(uri).coroutine
    val database: CoroutineDatabase = client.getDatabase(dbName)

    environment.monitor.subscribe(ApplicationStopped) {
        client.close()
    }

    return database
}