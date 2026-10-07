add_subdirectory(spike)
add_subdirectory(engine)

option(ORCA_WASM_PREVIEW "Build wasm preview" OFF)
if (ORCA_WASM_PREVIEW)
    add_subdirectory(preview)
endif ()
