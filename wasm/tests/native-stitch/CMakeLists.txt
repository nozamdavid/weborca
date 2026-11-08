# Focused standalone regression, usable with native and Emscripten builds.
add_executable(native_stitch_regression EXCLUDE_FROM_ALL native_stitch.cpp)
target_link_libraries(native_stitch_regression PRIVATE libslic3r)
if (EMSCRIPTEN)
    set_target_properties(native_stitch_regression PROPERTIES SUFFIX ".js")
    target_link_options(native_stitch_regression PRIVATE -sENVIRONMENT=node -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1)
endif ()
