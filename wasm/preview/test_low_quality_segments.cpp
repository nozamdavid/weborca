// Standalone CPU regression checks, run from the repository root:
// g++ -std=c++17 -O2 -Wall -Wextra -Wpedantic -Werror wasm/preview/test_low_quality_segments.cpp src/libvgcode/src/LowQualitySegments.cpp -o /tmp/orca-low-quality-tests
// /tmp/orca-low-quality-tests --benchmark
#include "../../src/libvgcode/src/LowQualitySegments.hpp"

#include <algorithm>
#include <chrono>
#include <array>
#include <cstddef>
#include <cstdint>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <vector>

using namespace libvgcode;

namespace {

void require(bool condition, const char* message)
{
    if (!condition) {
        std::cerr << "FAIL: " << message << '\n';
        std::exit(1);
    }
}

std::vector<PathVertex> straight(size_t count)
{
    std::vector<PathVertex> vertices(count);
    for (size_t i = 0; i < count; ++i) {
        auto& v = vertices[i];
        v.position = { float(i), 0.0f, 0.2f };
        v.gcode_id = 7;
        v.type = EMoveType::Extrude;
        v.role = EGCodeExtrusionRole::Perimeter;
        v.width = 0.4f;
        v.height = 0.2f;
        v.actual_feedrate = float(i); // Timing subdivisions intentionally differ.
    }
    return vertices;
}

std::vector<SegmentEndpoints> build(const std::vector<PathVertex>& vertices,
                                  const std::vector<float>& colors,
                                  size_t physical_page_capacity = 0,
                                  const std::vector<uint32_t>& enabled = {})
{
    LowQualitySegments segments(vertices, colors, physical_page_capacity);
    if (enabled.empty()) {
        for (uint32_t i = 0; size_t(i) + 1 < vertices.size(); ++i)
            segments.append(i);
    } else {
        for (uint32_t i : enabled)
            segments.append(i);
    }
    return segments.finish();
}

void tests()
{
    auto vertices = straight(10);
    std::vector<float> colors(vertices.size(), 123456.0f);
    auto segments = build(vertices, colors);
    require(segments.size() == 1, "Actual-speed subdivisions on one line coalesce");
    require(segments[0].first == 0 && segments[0].last == 9, "Original endpoints survive");
    require(vertices[4].actual_feedrate == 4.0f, "Original timing data stays intact");
    require(vertices.size() == 10, "Original vertex mapping stays intact");

    auto distinct_lines = vertices;
    for (size_t i = 0; i < distinct_lines.size(); ++i)
        distinct_lines[i].gcode_id = static_cast<uint32_t>(100 + i);
    const auto source_runs = build(distinct_lines, colors);
    require(source_runs.size() == 9, "Distinct source commands retain separate geometry");
    SegmentEndpoints source_clip{};
    require(clip_segment(source_runs[3], { 3, 6 }, source_clip), "Cursor keeps a distinct source command");
    require(source_clip.first == 3 && source_clip.last == 4, "Distinct command retains raw endpoints");
    for (size_t i = 0; i < distinct_lines.size(); ++i)
        require(distinct_lines[i].gcode_id == 100 + i, "Coalescing never changes source-line mapping");

    SegmentEndpoints clipped{};
    require(clip_segment(segments[0], { 3, 6 }, clipped), "Interior cursor range is visible");
    require(clipped.first == 3 && clipped.last == 6, "Interior cursor uses original endpoints");
    require(!clip_segment(segments[0], { 9, 10 }, clipped), "Touching endpoint has no segment");
    require(!clip_segment(segments[0], { 5, 5 }, clipped), "Single-vertex view is empty");
    require(!clip_segment(segments[0], { 6, 3 }, clipped), "Reversed view is empty");
    require(clip_segment(segments[0], { 0, 100 }, clipped), "Visible upper bound may exceed run");
    require(clipped.last == 9, "Clipping never extends run");

    auto gap = build(vertices, colors, 0, { 0, 1, 4, 5 });
    require(gap.size() == 2, "Hidden gaps never bridge");
    require(gap[0].last == 2 && gap[1].first == 4, "Hidden-gap endpoints stay exact");

    segments = build(vertices, colors, 4);
    require(segments.size() == 3, "Texture pages overlap one physical endpoint");
    for (size_t i = 0; i < segments.size(); ++i) {
        require(segments[i].first == i * 3, "Boundary start belongs to next page");
        require(segments[i].last == (i + 1) * 3, "Run ends at shared boundary texel");
    }
    require(build(vertices, colors, 2).size() == 9, "Minimum physical page holds one segment");

    const std::array<size_t, 6> capacities{ 2, 256, 65536, size_t(1) << 24, size_t(1) << 28, size_t(1) << 30 };
    const std::array<unsigned int, 6> expected_bits{ 1, 8, 16, 24, 28, 30 };
    for (size_t i = 0; i < capacities.size(); ++i) {
        const unsigned int bits = segment_index_bits(capacities[i]);
        require(bits == expected_bits[i], "Page index bit width is exact");
        const uint32_t mask = (uint32_t(1) << bits) - 1;
        const uint32_t maximum_span = uint32_t(1) << (32 - bits);
        const uint32_t span = std::min(uint32_t(capacities[i] - 1), maximum_span);
        const uint32_t first = uint32_t(capacities[i] - 1) - span;
        const uint32_t page_offset = uint32_t(capacities[i] - 1);
        const SegmentEndpoints source{ page_offset + first, page_offset + first + span };
        const uint32_t packed = pack_segment_index(source, page_offset, bits);
        require((packed & mask) == first, "Packed start survives every page size");
        require((packed >> bits) + 1 == span, "Maximum packed span survives every page size");
        require(page_offset + (packed & mask) + (packed >> bits) + 1 == source.last,
                "Decoded endpoint preserves the shared page boundary");
    }
    auto long_vertices = straight(300);
    std::vector<float> long_colors(long_vertices.size(), 123456.0f);
    const auto limited = build(long_vertices, long_colors, size_t(1) << 24);
    require(limited.size() == 2, "24-bit page indices split runs at 256 segments");
    require(limited[0].first == 0 && limited[0].last == 256 && limited[1].first == 256 && limited[1].last == 299,
            "Span splitting preserves every original endpoint");
    SegmentEndpoints first_clip{}, second_clip{};
    require(clip_segment(limited[0], { 200, 280 }, first_clip) && clip_segment(limited[1], { 200, 280 }, second_clip),
            "Cursor clips both pieces of a split run");
    require(first_clip.first == 200 && first_clip.last == 256 && second_clip.first == 256 && second_clip.last == 280,
            "Cursor clipping stays continuous at a packed span boundary");
    require(build(long_vertices, long_colors, size_t(1) << 28).size() == 19, "28-bit page indices limit spans to 16");

    for (int boundary = 0; boundary < 9; ++boundary) {
        auto changed = vertices;
        for (size_t i = 5; i < changed.size(); ++i) {
            switch (boundary) {
            case 0: changed[i].gcode_id++; break;
            case 1: changed[i].layer_id++; break;
            case 2: changed[i].extruder_id++; break;
            case 3: changed[i].color_id++; break;
            case 4: changed[i].role = EGCodeExtrusionRole::ExternalPerimeter; break;
            case 5: changed[i].type = EMoveType::Travel; break;
            case 6: changed[i].width = 0.5f; break;
            case 7: changed[i].height = 0.3f; break;
            case 8: break;
            }
        }
        auto palette = colors;
        if (boundary == 8)
            for (size_t i = 5; i < palette.size(); ++i)
                palette[i] = 654321.0f;
        const auto runs = build(changed, palette);
        for (const auto& run : runs)
            require(!(run.first < 5 && run.last > 5), "Metadata and palette boundaries survive");
    }

    auto curved = vertices;
    for (size_t i = 0; i < curved.size(); ++i) {
        const double angle = double(i) * 0.02;
        curved[i].position = { float(20 * std::cos(angle)), float(20 * std::sin(angle)), 0.2f };
    }
    require(build(curved, colors).size() == 9, "G2/G3 chords with one source ID stay curved");
    curved = vertices;
    for (size_t i = 0; i < curved.size(); ++i)
        curved[i].position[1] = float(i * i) * 2e-7f;
    require(build(curved, colors).size() > 1, "Small deviations cannot accumulate across a run");

    auto reversed = vertices;
    reversed[5].position[0] = 3.5f;
    require(build(reversed, colors).size() > 1, "Collinear reversals stay separate");
    auto duplicate = vertices;
    duplicate[5].position = duplicate[4].position;
    require(build(duplicate, colors).size() > 1, "Zero-length moves stay separate");
    auto invalid = vertices;
    invalid[5].position[0] = std::numeric_limits<float>::quiet_NaN();
    require(build(invalid, colors).size() > 1, "Nonfinite geometry never coalesces");

    auto diagonal = vertices;
    for (size_t i = 0; i < diagonal.size(); ++i)
        diagonal[i].position = { float(100.0 + i * 0.02), float(150.0 + i * 0.03), float(0.2 + i * 0.01) };
    require(build(diagonal, colors).size() == 1, "Float rounding on diagonal straight moves is tolerated");
    const std::vector<PathVertex> empty_vertices;
    const std::vector<float> empty_colors;
    LowQualitySegments empty(empty_vertices, empty_colors);
    require(empty.finish().empty(), "Empty input stays empty");
    std::cout << "All low-quality CPU regression checks passed\n";
}

void benchmark()
{
    constexpr size_t source_moves = 1000000;
    constexpr size_t subdivisions = 3;
    auto vertices = straight(source_moves * subdivisions + 1);
    std::vector<float> colors(vertices.size(), 123456.0f);
    for (size_t i = 0; i < vertices.size(); ++i) {
        vertices[i].gcode_id = uint32_t(i / subdivisions);
        // Keep coordinates within a typical print volume, without a huge origin.
        vertices[i].position[0] = float(i % 1200) * 0.1f;
    }
    const auto begin = std::chrono::steady_clock::now();
    const auto segments = build(vertices, colors, 1048576);
    const double elapsed = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - begin).count();
    std::cout << "Synthetic timing: " << vertices.size() - 1 << " segments -> " << segments.size()
              << " runs (" << double(vertices.size() - 1) / segments.size() << "x), " << elapsed
              << " ms; pair storage " << segments.size() * sizeof(SegmentEndpoints) << " bytes\n";
}

} // namespace

int main(int argc, char**)
{
    tests();
    if (argc > 1)
        benchmark();
}
