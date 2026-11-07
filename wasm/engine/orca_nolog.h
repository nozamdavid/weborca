// Force-included into libslic3r (wasm builds only, see ORCA_WASM_NOLOG in src/libslic3r/CMakeLists.txt).
// Compiles out Boost.Log trace, debug and info statements: the wasm engine installs the runtime filter
// `severity >= warning` (Engine.cpp), so those statements can never produce output there.
// warning, error and fatal keep the real Boost.Log stream.
#pragma once

#include <boost/log/trivial.hpp>
#include <ostream>

namespace orca_nolog {
struct Null {
    template<class T> Null& operator<<(const T&) { return *this; }
    Null& operator<<(std::ostream& (*)(std::ostream&)) { return *this; }
};
} // namespace orca_nolog

#undef BOOST_LOG_TRIVIAL

#define ORCA_LOG_trace   for (; false;) ::orca_nolog::Null()
#define ORCA_LOG_debug   for (; false;) ::orca_nolog::Null()
#define ORCA_LOG_info    for (; false;) ::orca_nolog::Null()
#define ORCA_LOG_warning BOOST_LOG_STREAM_WITH_PARAMS(::boost::log::trivial::logger::get(), (::boost::log::keywords::severity = ::boost::log::trivial::warning))
#define ORCA_LOG_error   BOOST_LOG_STREAM_WITH_PARAMS(::boost::log::trivial::logger::get(), (::boost::log::keywords::severity = ::boost::log::trivial::error))
#define ORCA_LOG_fatal   BOOST_LOG_STREAM_WITH_PARAMS(::boost::log::trivial::logger::get(), (::boost::log::keywords::severity = ::boost::log::trivial::fatal))

// The level argument is expanded before pasting, so a source-local alias such as
// `#define error_level_not_in_cache debug` (Support/TreeModelVolumes.cpp) resolves to one of the levels above.
#define ORCA_LOG_CAT_(a, b) a##b
#define ORCA_LOG_CAT(a, b)  ORCA_LOG_CAT_(a, b)
#define BOOST_LOG_TRIVIAL(lvl) ORCA_LOG_CAT(ORCA_LOG_, lvl)
