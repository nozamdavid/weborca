cmake_minimum_required(VERSION 3.13)
project(step_tessellate CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if (NOT EMSCRIPTEN)
    message(FATAL_ERROR "wasm/step is an Emscripten-only target; configure it with emcmake")
endif ()

get_filename_component(REPO_ROOT "${CMAKE_CURRENT_LIST_DIR}/../.." ABSOLUTE)

set(BASE_PREFIX "${REPO_ROOT}/wasm/build/prefix-wasm64" CACHE PATH "wasm dependency prefix")
set(OCCT_PREFIX "${REPO_ROOT}/wasm/build/prefix-occt-step" CACHE PATH "OCCT prefix")

if (NOT EXISTS "${BASE_PREFIX}/lib/libboost_nowide.a")
    message(FATAL_ERROR "Boost wasm prefix not found at ${BASE_PREFIX}")
endif ()
if (NOT EXISTS "${OCCT_PREFIX}/lib/cmake/occt/OpenCASCADEConfig.cmake")
    message(FATAL_ERROR "OCCT wasm prefix not found at ${OCCT_PREFIX}")
endif ()

set(OpenCASCADE_DIR "${OCCT_PREFIX}/lib/cmake/occt" CACHE PATH "" FORCE)
find_package(OpenCASCADE REQUIRED)

# Same toolkit order as libslic3r (dependents first, TKernel last) so the
# static link resolves in one pass.
set(STEP_MODULE_OCCT_TOOLKITS
    TKDESTEP
    TKDE
    TKXCAF
    TKXSBase
    TKVCAF
    TKCAF
    TKLCAF
    TKCDF
    TKV3d
    TKService
    TKMesh
    TKBO
    TKPrim
    TKHLR
    TKShHealing
    TKTopAlgo
    TKGeomAlgo
    TKBRep
    TKGeomBase
    TKG3d
    TKG2d
    TKMath
    TKernel
)

add_executable(step_tessellate
    main.cpp
    ${REPO_ROOT}/src/libslic3r/Format/STEPTessellate.cpp
)

# Drops the Shift-JIS / EUC / GB2312 lookup tables of libTKernel (520 KB raw). Legacy double-byte STEP
# code pages then convert to U+0000. The GBK and Big5 tables stay: they live in Resource_Unicode.cxx.
option(STEP_STUB_CJK_TABLES "Replace OCCT's CJK code-page tables with a stub" ON)
if (STEP_STUB_CJK_TABLES)
    target_sources(step_tessellate PRIVATE cjk_codepage_stub.c)
endif ()

target_include_directories(step_tessellate PRIVATE
    ${REPO_ROOT}/src
    ${REPO_ROOT}/src/libslic3r
    ${BASE_PREFIX}/include
)
target_include_directories(step_tessellate SYSTEM PRIVATE ${OpenCASCADE_INCLUDE_DIR})
target_link_directories(step_tessellate PRIVATE ${OCCT_PREFIX}/lib ${BASE_PREFIX}/lib)

# Same optional-feature switches the wasm engine build uses (build_step_engine.sh).
target_compile_definitions(step_tessellate PRIVATE
    SLIC3R_NO_OPENSSL
    SLIC3R_NO_OPENCV
    SLIC3R_NO_ASSIMP
    SLIC3R_NO_DRACO
    SLIC3R_NO_FREETYPE
    SLIC3R_NO_OPENVDB
)

target_link_libraries(step_tessellate PRIVATE
    ${STEP_MODULE_OCCT_TOOLKITS}
    expat
    boost_nowide
    boost_filesystem
    boost_system
)

set_target_properties(step_tessellate PROPERTIES
    SUFFIX ".mjs"
    RUNTIME_OUTPUT_DIRECTORY "${REPO_ROOT}/wasm/build/step-module"
)

target_link_options(step_tessellate PRIVATE
    -pthread
    -lembind
    -sMODULARIZE=1
    -sEXPORT_ES6=1
    -sEXPORT_NAME=createStepModule
    -sENVIRONMENT=web,worker,node
    -sEXPORTED_RUNTIME_METHODS=FS
    -sALLOW_MEMORY_GROWTH=1
    -sMAXIMUM_MEMORY=4GB
    -sMALLOC=mimalloc
    -sSTACK_SIZE=8MB
    -sDEFAULT_PTHREAD_STACK_SIZE=8MB
    -sEXIT_RUNTIME=0
    -sPTHREAD_POOL_SIZE=0
)
