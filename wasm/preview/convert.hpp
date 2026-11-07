#pragma once

#include "Types.hpp"
#include "GCodeInputData.hpp"
#include "libslic3r/GCode/GCodeProcessor.hpp"
#include "libslic3r/Point.hpp"
#include "libslic3r/Color.hpp"
#include <string>
#include <vector>

namespace libvgcode {
class Viewer;

// Mapping from Slic3r::Vec3f to libvgcode::Vec3
Vec3 convert(const Slic3r::Vec3f& v);

// Mapping from libvgcode::Vec3 to Slic3r::Vec3f
Slic3r::Vec3f convert(const Vec3& v);

// Mapping from Slic3r::Matrix4f to libvgcode::Mat4x4
Mat4x4 convert(const Slic3r::Matrix4f& m);

// Mapping from libvgcode::Color to Slic3r::ColorRGBA
Slic3r::ColorRGBA convert(const Color& c);

// Mapping from Slic3r::ColorRGBA to libvgcode::ColorWithAlpha
ColorWithAlpha convert(const Slic3r::ColorRGBA& c);

// Mapping from encoded color string to libvgcode::ColorWithAlpha
ColorWithAlpha convert(const std::string& color_str);

// Mapping from libvgcode::EGCodeExtrusionRole to Slic3r::ExtrusionRole
Slic3r::ExtrusionRole convert(EGCodeExtrusionRole role);

// Mapping from Slic3r::ExtrusionRole to libvgcode::EGCodeExtrusionRole
EGCodeExtrusionRole convert(Slic3r::ExtrusionRole role);

// Mapping from Slic3r::EMoveType to libvgcode::EMoveType
EMoveType convert(Slic3r::EMoveType type);

// Mapping from Slic3r::PrintEstimatedStatistics::ETimeMode to libvgcode::ETimeMode
ETimeMode convert(const Slic3r::PrintEstimatedStatistics::ETimeMode& mode);

// Mapping from libvgcode::ETimeMode to Slic3r::PrintEstimatedStatistics::ETimeMode
Slic3r::PrintEstimatedStatistics::ETimeMode convert(const ETimeMode& mode);

// Mapping from Slic3r::GCodeProcessorResult to libvgcode::GCodeInputData
GCodeInputData convert(const Slic3r::GCodeProcessorResult& result,
                       const std::vector<std::string>& str_tool_colors,
                       const std::vector<std::string>& str_color_print_colors,
                       const Viewer& viewer);

} // namespace libvgcode
