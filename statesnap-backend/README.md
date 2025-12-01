# StateSnap Backend

Lightweight Kotlin backend for [StateSnap](https://github.com/romsper/statesnap-extension) extension.

## Overview

- Language: Kotlin  
- Build: Gradle  
- Executable: fat JAR at `build/libs/statesnap-backend-all.jar`  
- Default HTTP port: 8080
- Default MongoDB port: 27017

## Prerequisites

1. JDK 21 installed.
2. Gradle wrapper present: `./gradlew`
3. Docker (optional) for container image

## Build & Run

1. Build (local):
   - `./gradlew clean build`
   - Run: `java -jar build/libs/statesnap-backend-all.jar`

2. Docker (recommended: multi-stage build):
   - Build an image that compiles the project with a Gradle builder image and copies the fat JAR into a runtime image.
   - Run container: `docker run -p 8080:8080 <image-name>`

3. Install MongoDB in Docker: 
   - Run comtainer: `docker run --name mongodb -d -p 27017:27017 mongo`

## Configuration

- Use environment variables or application properties (as implemented in the project) to configure ports, storage, and other features.

## API Endpoints

All endpoints use JSON request and response bodies unless noted.

1. List snapshots
   - Method: GET  
   - Path: `/snapshots`  
   - Query params (optional): `page`, `size`, `sort`  
   - Description: Returns a paginated list of snapshots.

2. Get snapshot by id
   - Method: GET  
   - Path: `/snapshots/{id}`  
   - Description: Retrieve a single snapshot by its identifier.

3. Create snapshot
   - Method: POST  
   - Path: `/snapshots`  
   - Description: Store a new snapshot.

4. Get snapshot by id or description
   - Method: GET  
   - Path: `/snapshot/lookup/{term}`  
   - Description: Lookup by id or description (tries _id first, then description).  

## Notes

- Adjust endpoints and request/response schemas to match the actual controller models in the codebase.
- If `./gradlew` is missing in Docker builds, ensure the project files are copied into the build stage before invoking the wrapper or use a Gradle base image to run the build step.