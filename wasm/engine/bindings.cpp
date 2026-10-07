#include <emscripten/bind.h>
#include "Engine.hpp"

using namespace emscripten;

EMSCRIPTEN_BINDINGS(orca_engine) {
    class_<Engine>("Engine")
        .constructor<>()
        .function("submit", &Engine::submit)
        .function("poll", &Engine::poll)
        .function("progress", &Engine::progress)
        .function("cancel", &Engine::cancel)
        ;
}
