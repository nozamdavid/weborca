#pragma once
#include "GCodeInputData.hpp"
#include <fstream>
#include <type_traits>
#include <stdexcept>
#include <string>
#include <utility>
#include <cmath>
#include <nlohmann/json.hpp>

// This packet is transferable only between instances of the exact same runtime build.
struct PreviewPacket {
    libvgcode::GCodeInputData data;
    std::vector<std::pair<float, float>> bed;
    std::string stats;
    double parse_ms = 0, conversion_ms = 0;
};
namespace preview_packet_detail {
inline void fail() { throw std::runtime_error("Invalid preview packet"); }
template<class T> void write(std::ostream& out, const T& value) {
    static_assert(std::is_trivially_copyable_v<T>);
    out.write(reinterpret_cast<const char*>(&value), sizeof(T));
}
template<class T> void read(std::istream& in, T& value) {
    static_assert(std::is_trivially_copyable_v<T>);
    if (!in.read(reinterpret_cast<char*>(&value), sizeof(T))) fail();
}
template<class C> void write_array(std::ostream& out, const C& values) {
    write(out, uint64_t(values.size()));
    for (const auto& v : values) write(out, v);
}
template<class C> void read_array(std::istream& in, C& values, uint64_t& remaining) {
    if (remaining < sizeof(uint64_t)) fail();
    remaining -= sizeof(uint64_t);
    uint64_t count; read(in, count);
    using T = typename C::value_type;
    if (count > remaining / sizeof(T) || count > 100000000) fail();
    remaining -= count * sizeof(T);
    values.resize(count);
    for (auto& v : values) read(in, v);
}
}
inline void save_packet(const std::string& path, const PreviewPacket& p) {
    using namespace preview_packet_detail;
    std::ofstream out(path, std::ios::binary);
    write(out, uint32_t(0x4f505650)); write(out, uint32_t(1));
    write(out, uint32_t(sizeof(libvgcode::PathVertex)));
    write(out, uint32_t(p.data.spiral_vase_mode));
    write_array(out, p.data.vertices); write_array(out, p.data.tools_colors);
    write_array(out, p.data.color_print_colors);
    write(out, uint64_t(p.bed.size()));
    for (auto v : p.bed) { write(out, v.first); write(out, v.second); }
    write_array(out, p.stats);
    if (!out) fail();
}
inline PreviewPacket read_packet(const std::string& path) {
    using namespace preview_packet_detail;
    std::ifstream in(path, std::ios::binary | std::ios::ate);
    auto size = in.tellg();
    if (size < 16) fail();
    uint64_t remaining = static_cast<uint64_t>(size) - 16;
    in.seekg(0);
    uint32_t magic, version, stride, spiral;
    read(in, magic); read(in, version); read(in, stride); read(in, spiral);
    if (magic != 0x4f505650 || version != 1 || stride != sizeof(libvgcode::PathVertex) || spiral > 1) fail();
    PreviewPacket p; p.data.spiral_vase_mode = spiral;
    read_array(in, p.data.vertices, remaining);
    read_array(in, p.data.tools_colors, remaining);
    read_array(in, p.data.color_print_colors, remaining);
    if (remaining < sizeof(uint64_t)) fail();
    remaining -= sizeof(uint64_t);
    uint64_t count; read(in, count);
    if (count > remaining / 8 || count > 1000000) fail();
    remaining -= count * 8;
    p.bed.resize(count);
    for (auto& v : p.bed) { read(in, v.first); read(in, v.second); }
    read_array(in, p.stats, remaining);
    if (p.data.vertices.empty() || p.stats.empty() || p.stats.front() != '{' || p.stats.back() != '}' || in.peek() != EOF) fail();
    if (p.data.tools_colors.empty() || p.data.color_print_colors.empty()) fail();
    const auto stats = nlohmann::json::parse(p.stats);
    if (!stats.is_object() || !stats.contains("features") || !stats["features"].is_array()) fail();
    const auto finite_number = [](const auto& object, const char* key) {
        return object.contains(key) && object[key].is_number() && std::isfinite(object[key].template get<double>())
            && object[key].template get<double>() >= 0;
    };
    for (const char* key : {"layers", "moves", "timeS", "filamentMm", "filamentG"})
        if (!finite_number(stats, key)) fail();
    for (const auto& feature : stats["features"])
        if (!feature.is_object() || !feature.contains("name") || !feature["name"].is_string()
            || !finite_number(feature, "timeS") || !finite_number(feature, "percent")) fail();
    for (const auto& point : p.bed)
        if (!std::isfinite(point.first) || !std::isfinite(point.second)) fail();
    uint32_t layers = 0;
    for (const auto& v : p.data.vertices) {
        if (v.extruder_id >= p.data.tools_colors.size()) fail();
        if (v.layer_id > layers) fail();
        if (v.layer_id == layers) ++layers;
        for (float coordinate : v.position) if (!std::isfinite(coordinate)) fail();
        for (float time : v.times) if (!std::isfinite(time) || time < 0) fail();
        for (float value : {v.height, v.width, v.feedrate, v.actual_feedrate, v.mm3_per_mm,
            v.fan_speed, v.temperature, v.layer_duration, v.pressure_advance, v.acceleration, v.jerk})
            if (!std::isfinite(value)) fail();
#if VGCODE_ENABLE_COG_AND_TOOL_MARKERS
        if (!std::isfinite(v.weight)) fail();
#endif
        if (v.type >= libvgcode::EMoveType::COUNT || v.role >= libvgcode::EGCodeExtrusionRole::COUNT || v.layer_id > p.data.vertices.size()) fail();
    }
    return p;
}
