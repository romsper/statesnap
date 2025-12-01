package com.example

import io.ktor.server.application.*
import io.ktor.server.application.ApplicationStopped
import org.litote.kmongo.reactivestreams.KMongo
import org.litote.kmongo.coroutine.coroutine
import org.litote.kmongo.coroutine.CoroutineDatabase
import org.litote.kmongo.coroutine.CoroutineClient

fun Application.configureDatabases(): CoroutineDatabase {
    val client: CoroutineClient = KMongo.createClient("mongodb://localhost:27017").coroutine
    val database: CoroutineDatabase = client.getDatabase("testing-snapshots")

    environment.monitor.subscribe(ApplicationStopped) {
        client.close()
    }

    return database
}