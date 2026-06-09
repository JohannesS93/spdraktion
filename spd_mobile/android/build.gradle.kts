allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}
subprojects {
    fun applyNamespaceFromManifest() {
        val androidExtension = extensions.findByName("android") ?: return
        val getNamespace = androidExtension.javaClass.methods.find { it.name == "getNamespace" } ?: return
        val setNamespace =
            androidExtension.javaClass.methods.find {
                it.name == "setNamespace" &&
                    it.parameterTypes.size == 1 &&
                    it.parameterTypes[0] == String::class.java
            } ?: return@applyNamespaceFromManifest

        val currentNamespace = getNamespace.invoke(androidExtension) as? String
        if (!currentNamespace.isNullOrBlank()) return

        val manifestFile = project.file("src/main/AndroidManifest.xml")
        if (!manifestFile.exists()) return

        val match = Regex("""package\s*=\s*"([^"]+)"""").find(manifestFile.readText())
        val manifestPackage = match?.groupValues?.getOrNull(1)
        if (!manifestPackage.isNullOrBlank()) {
            setNamespace.invoke(androidExtension, manifestPackage)
        }
    }

    plugins.withId("com.android.library") {
        applyNamespaceFromManifest()
    }
    plugins.withId("com.android.application") {
        applyNamespaceFromManifest()
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
