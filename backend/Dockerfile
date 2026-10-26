# Kadreo backend: Spring Boot modular monolith (Java 21).
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY gradlew settings.gradle.kts build.gradle.kts ./
COPY gradle gradle
RUN ./gradlew --no-daemon -q dependencies > /dev/null
COPY src src
RUN ./gradlew --no-daemon -q bootJar && cp build/libs/*.jar /app.jar

FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 kadreo
USER kadreo
COPY --from=build /app.jar /app/app.jar
EXPOSE 8080
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
