add_executable(orca_slice_driver slice_driver.cpp)

target_link_libraries(orca_slice_driver PRIVATE libslic3r)

if (EMSCRIPTEN)
    target_link_options(orca_slice_driver PRIVATE
        -sALLOW_MEMORY_GROWTH=1
        -sMAXIMUM_MEMORY=8GB
        -sMALLOC=mimalloc
        -sPROXY_TO_PTHREAD
        -sEXIT_RUNTIME=1
        -sPTHREAD_POOL_SIZE=8
        -sNODERAWFS=1
        -sSTACK_SIZE=8MB
        -sDEFAULT_PTHREAD_STACK_SIZE=8MB
    )
endif ()
