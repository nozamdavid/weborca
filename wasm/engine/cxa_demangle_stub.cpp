// Replaces libc++abi's __cxa_demangle (about 70 KB of code and tables) in the wasm engine and preview.
// The only callers are diagnostics (the terminate handler and boost::core::demangle) that fall back to the
// mangled name when demangling fails. Linked as an object before libc++abi.a, so the archive member that
// defines the real function is never extracted.
#include <cstddef>

extern "C" char* __cxa_demangle(const char* /*mangled_name*/, char* /*output_buffer*/, std::size_t* /*length*/, int* status)
{
    if (status)
        *status = -2; // mangled_name is not a valid name
    return nullptr;
}
