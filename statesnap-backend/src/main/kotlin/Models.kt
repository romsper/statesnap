package com.example

import kotlinx.serialization.Serializable

@Serializable
data class Snapshot(
    val _id: String? = null,
    val timestamp: Long,
    val url: String,
    val description: String? = null,
    val cookies: List<CookieModel>,
    val localStorage: Map<String, String>,
    val sessionStorage: Map<String, String>,
    val networkLogs: List<NetworkLog>,
    val html: String? = null
)

@Serializable
data class CookieModel(
    val name: String,
    val value: String,
    val domain: String,
    val path: String,
    val secure: Boolean,
    val httpOnly: Boolean,
    val expirationDate: Double? = null
)

@Serializable
data class NetworkLog(
    val method: String,
    val url: String,
    val requestBody: String? = null,
    val status: Int? = null,
    val responseBody: String? = null
)

@Serializable
data class StatusResponse(
    val status: String,
    val message: String
)