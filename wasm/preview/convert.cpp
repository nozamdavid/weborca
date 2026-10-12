///|/ Standalone WASM preview adaptation of src/slic3r/GUI/LibVGCode/LibVGCodeWrapper.cpp
///|/ Original copyright (c) Prusa Research 2020 - 2023 Enrico Turri @enricoturri1966
///|/ AGPLv3 or higher

#include <Eigen/Geometry>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstddef>
#include <cstring>
#include <iterator>
#include <cassert>
#include <cinttypes>
#include <string>
#include <vector>

// GUI-REMOVAL: Replaced "LibVGCodeWrapper.hpp" with standalone "convert.hpp"
#include "convert.hpp"

// libslic3r core dependencies
#include "libslic3r/libslic3r.h"
#include "libslic3r/Point.hpp"
#include "libslic3r/Color.hpp"
#include "libslic3r/GCode/GCodeProcessor.hpp"

// libvgcode core headers
// GUI-REMOVAL: Updated relative paths from "../../src/libvgcode/include/..." to target includes
#include "GCodeInputData.hpp"
#include "PathVertex.hpp"
#include "Types.hpp"

// GUI-REMOVAL: Removed desktop GUI/Print slicing headers (Print.hpp, Model.hpp, Slicing.hpp,
// WipeTower.hpp, Layer.hpp, ExtrusionEntity.hpp, etc.) because standalone G-code preview
// consumes Slic3r::GCodeProcessorResult rather than the desktop Slic3r::Print pipeline.

namespace libvgcode {
class Viewer;

Vec3 convert(const Slic3r::Vec3f& v)
{
    return { v.x(), v.y(), v.z() };
}

Slic3r::Vec3f convert(const Vec3& v)
{
    return { v[0], v[1], v[2] };
}

Mat4x4 convert(const Slic3r::Matrix4f& m)
{
    Mat4x4 ret;
    std::memcpy(ret.data(), m.data(), 16 * sizeof(float));
    return ret;
}

Slic3r::ColorRGBA convert(const Color& c)
{
    static const float inv_255 = 1.0f / 255.0f;
    return { c[0] * inv_255, c[1] * inv_255, c[2] * inv_255, 1.0f };
}

Color convert(const Slic3r::ColorRGBA& c)
{
    // Preserve the filament's RGB channels, including black and saturated colors.
    return { static_cast<uint8_t>(std::lround(c.r() * 255.0f)),
             static_cast<uint8_t>(std::lround(c.g() * 255.0f)),
             static_cast<uint8_t>(std::lround(c.b() * 255.0f)) };
}

Color convert(const std::string& color_str)
{
    Slic3r::ColorRGBA color_rgba;
    return Slic3r::decode_color(color_str, color_rgba) ? convert(color_rgba) : DUMMY_COLOR;
}

Slic3r::ExtrusionRole convert(EGCodeExtrusionRole role)
{
    switch (role)
    {
    case EGCodeExtrusionRole::None:                     { return Slic3r::ExtrusionRole::erNone; }
    case EGCodeExtrusionRole::Perimeter:                { return Slic3r::ExtrusionRole::erPerimeter; }
    case EGCodeExtrusionRole::ExternalPerimeter:        { return Slic3r::ExtrusionRole::erExternalPerimeter; }
    case EGCodeExtrusionRole::OverhangPerimeter:        { return Slic3r::ExtrusionRole::erOverhangPerimeter; }
    case EGCodeExtrusionRole::InternalInfill:           { return Slic3r::ExtrusionRole::erInternalInfill; }
    case EGCodeExtrusionRole::SolidInfill:              { return Slic3r::ExtrusionRole::erSolidInfill; }
    case EGCodeExtrusionRole::TopSolidInfill:           { return Slic3r::ExtrusionRole::erTopSolidInfill; }
    case EGCodeExtrusionRole::Ironing:                  { return Slic3r::ExtrusionRole::erIroning; }
    case EGCodeExtrusionRole::BridgeInfill:             { return Slic3r::ExtrusionRole::erBridgeInfill; }
    case EGCodeExtrusionRole::GapFill:                  { return Slic3r::ExtrusionRole::erGapFill; }
    case EGCodeExtrusionRole::Skirt:                    { return Slic3r::ExtrusionRole::erSkirt; }
    case EGCodeExtrusionRole::SupportMaterial:          { return Slic3r::ExtrusionRole::erSupportMaterial; }
    case EGCodeExtrusionRole::SupportMaterialInterface: { return Slic3r::ExtrusionRole::erSupportMaterialInterface; }
    case EGCodeExtrusionRole::WipeTower:                { return Slic3r::ExtrusionRole::erWipeTower; }
    case EGCodeExtrusionRole::Custom:                   { return Slic3r::ExtrusionRole::erCustom; }
    // ORCA
    case EGCodeExtrusionRole::BottomSurface:            { return Slic3r::ExtrusionRole::erBottomSurface; }
    case EGCodeExtrusionRole::InternalBridgeInfill:     { return Slic3r::ExtrusionRole::erInternalBridgeInfill; }
    case EGCodeExtrusionRole::Brim:                     { return Slic3r::ExtrusionRole::erBrim; }
    case EGCodeExtrusionRole::SupportTransition:        { return Slic3r::ExtrusionRole::erSupportTransition; }
    case EGCodeExtrusionRole::Mixed:                    { return Slic3r::ExtrusionRole::erMixed; }
    default:                                            { return Slic3r::ExtrusionRole::erNone; }
    }
}

EGCodeExtrusionRole convert(Slic3r::ExtrusionRole role)
{
    switch (role)
    {
    case Slic3r::ExtrusionRole::erNone:                        { return EGCodeExtrusionRole::None; }
    case Slic3r::ExtrusionRole::erPerimeter:                   { return EGCodeExtrusionRole::Perimeter; }
    case Slic3r::ExtrusionRole::erExternalPerimeter:           { return EGCodeExtrusionRole::ExternalPerimeter; }
    case Slic3r::ExtrusionRole::erOverhangPerimeter:           { return EGCodeExtrusionRole::OverhangPerimeter; }
    case Slic3r::ExtrusionRole::erInternalInfill:              { return EGCodeExtrusionRole::InternalInfill; }
    case Slic3r::ExtrusionRole::erSolidInfill:                 { return EGCodeExtrusionRole::SolidInfill; }
    case Slic3r::ExtrusionRole::erTopSolidInfill:              { return EGCodeExtrusionRole::TopSolidInfill; }
    case Slic3r::ExtrusionRole::erIroning:                     { return EGCodeExtrusionRole::Ironing; }
    case Slic3r::ExtrusionRole::erBridgeInfill:                { return EGCodeExtrusionRole::BridgeInfill; }
    case Slic3r::ExtrusionRole::erGapFill:                     { return EGCodeExtrusionRole::GapFill; }
    case Slic3r::ExtrusionRole::erSkirt:                       { return EGCodeExtrusionRole::Skirt; }
    case Slic3r::ExtrusionRole::erSupportMaterial:             { return EGCodeExtrusionRole::SupportMaterial; }
    case Slic3r::ExtrusionRole::erSupportMaterialInterface:    { return EGCodeExtrusionRole::SupportMaterialInterface; }
    case Slic3r::ExtrusionRole::erWipeTower:                   { return EGCodeExtrusionRole::WipeTower; }
    case Slic3r::ExtrusionRole::erCustom:                      { return EGCodeExtrusionRole::Custom; }
    // ORCA
    case Slic3r::ExtrusionRole::erBottomSurface:               { return EGCodeExtrusionRole::BottomSurface; }
    case Slic3r::ExtrusionRole::erInternalBridgeInfill:        { return EGCodeExtrusionRole::InternalBridgeInfill; }
    case Slic3r::ExtrusionRole::erBrim:                        { return EGCodeExtrusionRole::Brim; }
    case Slic3r::ExtrusionRole::erSupportTransition:           { return EGCodeExtrusionRole::SupportTransition; }
    case Slic3r::ExtrusionRole::erMixed:                       { return EGCodeExtrusionRole::Mixed; }
    default:                                                   { return EGCodeExtrusionRole::None; }
    }
}

EMoveType convert(Slic3r::EMoveType type)
{
    switch (type)
    {
    case Slic3r::EMoveType::Noop:         { return EMoveType::Noop; }
    case Slic3r::EMoveType::Retract:      { return EMoveType::Retract; }
    case Slic3r::EMoveType::Unretract:    { return EMoveType::Unretract; }
    case Slic3r::EMoveType::Seam:         { return EMoveType::Seam; }
    case Slic3r::EMoveType::Tool_change:  { return EMoveType::ToolChange; }
    case Slic3r::EMoveType::Color_change: { return EMoveType::ColorChange; }
    case Slic3r::EMoveType::Pause_Print:  { return EMoveType::PausePrint; }
    case Slic3r::EMoveType::Custom_GCode: { return EMoveType::CustomGCode; }
    case Slic3r::EMoveType::Travel:       { return EMoveType::Travel; }
    case Slic3r::EMoveType::Wipe:         { return EMoveType::Wipe; }
    case Slic3r::EMoveType::Extrude:      { return EMoveType::Extrude; }
    default:                              { return EMoveType::COUNT; }
    }
}

// GUI-REMOVAL: Commented-out EOptionType convert(const Slic3r::GUI::Preview::OptionType&) in desktop
// remains omitted as GUI::Preview::OptionType is wxWidgets-GUI specific.

ETimeMode convert(const Slic3r::PrintEstimatedStatistics::ETimeMode& mode)
{
    switch (mode)
    {
    case Slic3r::PrintEstimatedStatistics::ETimeMode::Normal:  { return ETimeMode::Normal; }
    case Slic3r::PrintEstimatedStatistics::ETimeMode::Stealth: { return ETimeMode::Stealth; }
    default:                                                   { return ETimeMode::COUNT; }
    }
}

Slic3r::PrintEstimatedStatistics::ETimeMode convert(const ETimeMode& mode)
{
    switch (mode)
    {
    case ETimeMode::Normal:  { return Slic3r::PrintEstimatedStatistics::ETimeMode::Normal; }
    case ETimeMode::Stealth: { return Slic3r::PrintEstimatedStatistics::ETimeMode::Stealth; }
    default:                 { return Slic3r::PrintEstimatedStatistics::ETimeMode::Count; }
    }
}

GCodeInputData convert(const Slic3r::GCodeProcessorResult& result, const std::vector<std::string>& str_tool_colors,
    const std::vector<std::string>& str_color_print_colors, const Viewer& /*viewer*/)
{
    GCodeInputData ret;

    // collect tool colors
    ret.tools_colors.reserve(str_tool_colors.size());
    for (const std::string& color : str_tool_colors) {
        ret.tools_colors.emplace_back(convert(color));
    }

    // collect color print colors
    const std::vector<std::string>& str_colors = str_color_print_colors.empty() ? str_tool_colors : str_color_print_colors;
    ret.color_print_colors.reserve(str_colors.size());
    for (const std::string& color : str_colors) {
        ret.color_print_colors.emplace_back(convert(color));
    }

    const std::vector<Slic3r::GCodeProcessorResult::MoveVertex>& moves = result.moves;
    const auto starts_path = [](const auto& prev, const auto& curr) {
        return prev.type != curr.type || prev.extrusion_role != curr.extrusion_role ||
            prev.mm3_per_mm != curr.mm3_per_mm || prev.acceleration != curr.acceleration || prev.jerk != curr.jerk;
    };
    // Count the phantom path starts before reserving. Reserving twice the move count and then
    // shrinking temporarily holds two large vertex arrays, which is costly for detailed files.
    size_t vertices_count = moves.empty() ? 0 : moves.size() - 1;
    for (size_t i = 1; i < moves.size(); ++i) {
        const EOptionType option_type = move_type_to_option(convert(moves[i].type));
        if ((option_type == EOptionType::COUNT || option_type == EOptionType::Travels || option_type == EOptionType::Wipes) &&
            (i == 1 || starts_path(moves[i - 1], moves[i])))
            ++vertices_count;
    }
    ret.vertices.reserve(vertices_count);
    for (size_t i = 1; i < moves.size(); ++i) {
        const Slic3r::GCodeProcessorResult::MoveVertex& curr = moves[i];
        const Slic3r::GCodeProcessorResult::MoveVertex& prev = moves[i - 1];
        const EMoveType curr_type = convert(curr.type);
        const EOptionType option_type = move_type_to_option(curr_type);
        if (option_type == EOptionType::COUNT || option_type == EOptionType::Travels || option_type == EOptionType::Wipes) {
            if (ret.vertices.empty() || starts_path(prev, curr)) {
                // to allow libvgcode to properly detect the start/end of a path we need to add a 'phantom' vertex
                // equal to the current one with the exception of the position, which should match the previous move position,
                // and the times, which are set to zero
#if VGCODE_ENABLE_COG_AND_TOOL_MARKERS
                const libvgcode::PathVertex vertex = { convert(prev.position), curr.height, curr.width, curr.feedrate, prev.actual_feedrate,
                    curr.mm3_per_mm, curr.fan_speed, curr.temperature, 0.0f, convert(curr.extrusion_role), curr_type,
                    static_cast<uint32_t>(curr.gcode_id), static_cast<uint32_t>(curr.layer_id),
                    static_cast<uint8_t>(curr.extruder_id), static_cast<uint8_t>(curr.cp_color_id), { 0.0f, 0.0f },
                    /* ORCA: Add Pressure Advance visualization support */ 0.0f, curr.pressure_advance,
                    /* ORCA: Add Acceleration visualization support */ curr.acceleration,
                    /* ORCA: Add Jerk visualization support */ curr.jerk };
#else
              const libvgcode::PathVertex vertex = { convert(prev.position), curr.height, curr.width, curr.feedrate, prev.actual_feedrate,
                    curr.mm3_per_mm, curr.fan_speed, curr.temperature, convert(curr.extrusion_role), curr_type,
                    static_cast<uint32_t>(curr.gcode_id), static_cast<uint32_t>(curr.layer_id),
                    static_cast<uint8_t>(curr.extruder_id), static_cast<uint8_t>(curr.cp_color_id), { 0.0f, 0.0f },
                    /* ORCA: Add Pressure Advance visualization support */ 0.0f, curr.pressure_advance,
                    /* ORCA: Add Acceleration visualization support */ curr.acceleration,
                    /* ORCA: Add Jerk visualization support */ curr.jerk };
#endif // VGCODE_ENABLE_COG_AND_TOOL_MARKERS
                ret.vertices.emplace_back(vertex);
            }
        }

#if VGCODE_ENABLE_COG_AND_TOOL_MARKERS
        const libvgcode::PathVertex vertex = { convert(curr.position), curr.height, curr.width, curr.feedrate, curr.actual_feedrate,
            curr.mm3_per_mm, curr.fan_speed, curr.temperature,
            result.filament_densities.empty() ? 0.0f : (result.filament_densities[curr.extruder_id] * curr.mm3_per_mm * (curr.position - prev.position).norm()),
            convert(curr.extrusion_role), curr_type, static_cast<uint32_t>(curr.gcode_id), static_cast<uint32_t>(curr.layer_id),
            static_cast<uint8_t>(curr.extruder_id), static_cast<uint8_t>(curr.cp_color_id), curr.time,
            /* ORCA: Add Pressure Advance visualization support */ 0.0f, curr.pressure_advance,
            /* ORCA: Add Acceleration visualization support */ curr.acceleration,
            /* ORCA: Add Jerk visualization support */ curr.jerk };
#else
        const libvgcode::PathVertex vertex = { convert(curr.position), curr.height, curr.width, curr.feedrate, curr.actual_feedrate,
            curr.mm3_per_mm, curr.fan_speed, curr.temperature, convert(curr.extrusion_role), curr_type,
            static_cast<uint32_t>(curr.gcode_id), static_cast<uint32_t>(curr.layer_id),
            static_cast<uint8_t>(curr.extruder_id), static_cast<uint8_t>(curr.cp_color_id), curr.time,
            /* ORCA: Add Pressure Advance visualization support */ 0.0f, curr.pressure_advance,
            /* ORCA: Add Acceleration visualization support */ curr.acceleration,
            /* ORCA: Add Jerk visualization support */ curr.jerk };
#endif // VGCODE_ENABLE_COG_AND_TOOL_MARKERS
        ret.vertices.emplace_back(vertex);
    }

    ret.spiral_vase_mode = result.spiral_vase_mode;

    return ret;
}

// GUI-REMOVAL: Omitted desktop convert(const Slic3r::Print& print, ...) and associated helpers
// (convert_lines_to_vertices, convert_to_vertices, convert_brim_skirt_to_vertices,
// WipeTowerHelper, ObjectHelper, convert_object_to_vertices, convert_objects_to_vertices)
// because they are only used during slicing inside the desktop GUI before G-code export.

} // namespace libvgcode
