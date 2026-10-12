cmake_minimum_required(VERSION 3.13)
project(orca_preview)

add_subdirectory(${CMAKE_SOURCE_DIR}/src/libvgcode ${CMAKE_CURRENT_BINARY_DIR}/libvgcode)

add_executable(orca_preview
    preview.cpp
    convert.cpp
)

target_include_directories(orca_preview PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/src/libvgcode/include
    ${CMAKE_SOURCE_DIR}/src/libvgcode/src
    ${CMAKE_SOURCE_DIR}/src/libvgcode/glad/include
)

target_compile_definitions(orca_preview PRIVATE
    ENABLE_OPENGL_ES
)

target_link_libraries(orca_preview PRIVATE
    libslic3r
    libvgcode
)

set_target_properties(orca_preview PROPERTIES SUFFIX ".js")

if (EMSCRIPTEN)
    target_link_options(orca_preview PRIVATE
        -sMAX_WEBGL_VERSION=2
        -sMIN_WEBGL_VERSION=2
        -lembind
        -sMODULARIZE=1
        -sEXPORT_ES6=1
        -sEXPORT_NAME=createOrcaPreview
        -sENVIRONMENT=web,worker
        -sALLOW_MEMORY_GROWTH=1
        -sMAXIMUM_MEMORY=8GB
        -sMALLOC=dlmalloc
        -sEXPORTED_RUNTIME_METHODS=FS
        -sSTACK_SIZE=8MB
        -sDEFAULT_PTHREAD_STACK_SIZE=8MB
        -sEXIT_RUNTIME=0
        # Preview parsing, conversion and rendering are synchronous; keep one spare worker.
        -sPTHREAD_POOL_SIZE=1
    )

    add_custom_command(TARGET orca_preview POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E make_directory ${CMAKE_CURRENT_SOURCE_DIR}/demo
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE_DIR:orca_preview>/orca_preview.js
            ${CMAKE_CURRENT_SOURCE_DIR}/demo/orca_preview.js
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE_DIR:orca_preview>/orca_preview.wasm
            ${CMAKE_CURRENT_SOURCE_DIR}/demo/orca_preview.wasm
    )
endif ()
