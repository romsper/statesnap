FROM amazoncorretto:21.0.9-al2023

WORKDIR /app

COPY build/libs/statesnap-backend-all.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]