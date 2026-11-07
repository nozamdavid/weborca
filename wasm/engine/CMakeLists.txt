set(ORCA_ENGINE_SOURCES
    Engine.cpp
    ConfigRules.cpp
    ProjectOps.cpp
    ObjectOps.cpp
    PlateOps.cpp
    PaintOps.cpp
    PaintToolsOps.cpp
    LayerHeightOps.cpp
    TextOps.cpp
    EditOps.cpp
    SvgOps.cpp
    BrimEarsOps.cpp
    CutOps.cpp
    CalibOps.cpp
    RepairOps.cpp
    CutConnectorOps.cpp
    LayerEventOps.cpp
    MeasureOps.cpp
    bindings.cpp
    NanoSVGImpl.cpp
    cxa_demangle_stub.cpp
)

add_executable(orca_engine ${ORCA_ENGINE_SOURCES})

# Op glue is cold (JSON handling and calls into libslic3r): -Oz, same size tiers as libslic3r.
# bindings.cpp and NanoSVGImpl.cpp keep the default level.
if (EMSCRIPTEN AND ORCA_WASM_SIZE_TIERS)
    set(_orca_engine_glue ${ORCA_ENGINE_SOURCES})
    list(REMOVE_ITEM _orca_engine_glue bindings.cpp NanoSVGImpl.cpp cxa_demangle_stub.cpp)
    foreach (_f ${_orca_engine_glue})
        set_source_files_properties(${_f} PROPERTIES COMPILE_OPTIONS "-Oz")
    endforeach ()
endif ()

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
        # Extra wasm-opt -O3 passes until the module stops shrinking: +20 s and about 1.6 GB at link time.
        -sBINARYEN_EXTRA_PASSES=--converge
        "-sPTHREAD_POOL_SIZE=Math.min(navigator.hardwareConcurrency,8)+2"
    )
endif ()
