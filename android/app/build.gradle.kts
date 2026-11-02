import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
}

val generatedAssetsDir = layout.buildDirectory.dir("generated/botclient-assets")

val stageEditorAssets = tasks.register<Copy>("stageEditorAssets") {
    from(rootProject.file("../desktop/editor"))
    into(generatedAssetsDir)
}

android {
    namespace = "local.botclient.android"
    compileSdk = 37

    defaultConfig {
        applicationId = "local.botclient.android"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "2.0.0"
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets {
        getByName("main") {
            assets.srcDirs(
                "src/main/assets",
                "../../ios/BotClient/Resources",
                generatedAssetsDir.get().asFile.absolutePath,
            )
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

tasks.named("preBuild").configure { dependsOn(stageEditorAssets) }

tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach {
    dependsOn(stageEditorAssets)
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
}
