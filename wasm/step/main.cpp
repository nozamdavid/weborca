// Standalone Emscripten entry point for STEP tessellation.
//
// This module links only the OCCT half of the STEP importer
// (Format/STEPTessellate.cpp) plus OCCT itself; it does not link libslic3r or
// the engine. The packed output below is the hand-off format for the main
// engine (or its TypeScript layer), mirroring what Step::mesh() builds from the
// same StepMesh records.

#include "Format/STEPTessellate.hpp"

#include <emscripten/bind.h>

#include <cmath>
#include <cstdint>
#include <fstream>
#include <string>
#include <vector>

namespace {

constexpr char kMagic[4] = {'S', 'T', 'M', '1'};

void write_u32(std::ostream& os, uint32_t value)
{
    const char bytes[4] = {
        static_cast<char>(value & 0xff),
        static_cast<char>((value >> 8) & 0xff),
        static_cast<char>((value >> 16) & 0xff),
        static_cast<char>((value >> 24) & 0xff),
    };
    os.write(bytes, sizeof(bytes));
}

// Layout (little endian):
//   char magic[4] = "STM1"
//   u32 solid_count
//   per solid:
//     u32 name_length, name bytes (UTF-8)
//     u32 vertex_count, u32 triangle_count
//     f32 positions[vertex_count * 3]
//     u32 indices[triangle_count * 3]
bool write_packed(const std::vector<Slic3r::StepMesh>& solids, const std::string& out_path, std::string& error)
{
    std::ofstream os(out_path, std::ios::binary);
    if (!os.is_open()) {
        error = "Cannot open output file for writing: " + out_path;
        return false;
    }
    os.write(kMagic, sizeof(kMagic));
    write_u32(os, static_cast<uint32_t>(solids.size()));
    for (const Slic3r::StepMesh& solid : solids) {
        write_u32(os, static_cast<uint32_t>(solid.name.size()));
        os.write(solid.name.data(), static_cast<std::streamsize>(solid.name.size()));
        write_u32(os, static_cast<uint32_t>(solid.positions.size() / 3));
        write_u32(os, static_cast<uint32_t>(solid.indices.size() / 3));
        if (!solid.positions.empty())
            os.write(reinterpret_cast<const char*>(solid.positions.data()),
                     static_cast<std::streamsize>(solid.positions.size() * sizeof(float)));
        if (!solid.indices.empty())
            os.write(reinterpret_cast<const char*>(solid.indices.data()),
                     static_cast<std::streamsize>(solid.indices.size() * sizeof(uint32_t)));
    }
    os.close();
    if (!os.good()) {
        error = "Failed while writing: " + out_path;
        return false;
    }
    return true;
}

// Returns an empty string on success, or the error message.
std::string step_tessellate_to_file(std::string in_path,
                                    double      linear_deflection,
                                    double      angle_deflection,
                                    bool        split_compound,
                                    std::string out_path)
{
    // Deflection bounds that the engine used to enforce for STEP imports.
    if (!std::isfinite(linear_deflection) || linear_deflection <= 0.0)
        return "linear_deflection must be a positive finite number";
    if (!std::isfinite(angle_deflection) || angle_deflection <= 0.0)
        return "angle_deflection must be a positive finite number";

    std::vector<Slic3r::StepMesh> solids;
    std::string error;
    if (!Slic3r::step_tessellate(in_path, linear_deflection, angle_deflection, split_compound, solids, error))
        return error.empty() ? std::string("STEP tessellation failed") : error;
    if (!write_packed(solids, out_path, error))
        return error;
    return std::string();
}

} // namespace

EMSCRIPTEN_BINDINGS(step_module) {
    emscripten::function("step_tessellate_to_file", &step_tessellate_to_file);
}
