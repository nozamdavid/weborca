add_executable(orca_engine Engine.cpp ConfigRules.cpp ProjectOps.cpp ObjectOps.cpp bindings.cpp)

target_link_libraries(orca_engine PRIVATE libslic3r)

set_target_properties(orca_engine PROPERTIES SUFFIX ".mjs")

if (EMSCRIPTEN)
    target_link_options(orca_engine PRIVATE
        -lembind
        -sMODULARIZE=1
        -sEXPORT_ES6=1
        -sEXPORT_NAME=createOrcaEngine
        -sENVIRONMENT=web,worker,node
        -sEXPORTED_RUNTIME_METHODS=FS
        -sALLOW_MEMORY_GROWTH=1
        -sMAXIMUM_MEMORY=8GB
        -sMALLOC=mimalloc
        -sSTACK_SIZE=8MB
        -sDEFAULT_PTHREAD_STACK_SIZE=8MB
        -sEXIT_RUNTIME=0
        "-sPTHREAD_POOL_SIZE=Math.min(navigator.hardwareConcurrency,8)+2"
    )
endif ()
