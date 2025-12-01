package com.example

import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*

fun main(args: Array<String>) {
    embeddedServer(
        Netty,
        port = 8080,
        host = "0.0.0.0",
        module = Application::module
    ).start(wait = true)
}

fun Application.module() {
//    configureHTTP()
    configureSerialization()
    val database = configureDatabases()
    val snapshots = database.getCollection<Snapshot>("snapshots")
    configureRouting(snapshots)
}
