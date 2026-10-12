#include "LowQualitySegments.hpp"
#include "../include/PathVertex.hpp"
#include "../include/Types.hpp"

#include <cstddef>
#include <cstdint>
#include <vector>

#include <algorithm>
#include <cassert>
#include <cmath>
#include <limits>
#include <utility>

namespace libvgcode {
namespace {

bool same_appearance(const PathVertex& a, const PathVertex& b)
{
    return a.type == b.type && a.role == b.role && a.layer_id == b.layer_id &&
           a.extruder_id == b.extruder_id && a.color_id == b.color_id &&
           a.width == b.width && a.height == b.height;
}

// Test against the first segment's fixed line, rather than only adjacent lines:
// small angular errors must never accumulate into a flattened G2/G3 curve.
bool extends_line(const Vec3& origin, const Vec3& direction_end,
                  const Vec3& previous_end, const Vec3& next_end)
{
    double direction[3], offset[3], step[3];
    double norm_sq = 0.0, projection = 0.0, scale = 1.0;
    for (size_t i = 0; i < 3; ++i) {
        direction[i] = double(direction_end[i]) - origin[i];
        offset[i] = double(next_end[i]) - origin[i];
        step[i] = double(next_end[i]) - previous_end[i];
        if (!std::isfinite(direction[i]) || !std::isfinite(offset[i]) || !std::isfinite(step[i]))
            return false;
        norm_sq += direction[i] * direction[i];
        projection += direction[i] * step[i];
        scale = std::max(scale, std::max(std::abs(double(origin[i])), std::abs(double(next_end[i]))));
    }
    if (norm_sq == 0.0 || projection <= 0.0)
        return false;
    const double cross[3] = {
        direction[1] * offset[2] - direction[2] * offset[1],
        direction[2] * offset[0] - direction[0] * offset[2],
        direction[0] * offset[1] - direction[1] * offset[0]
    };
    const double distance_sq = (cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]) / norm_sq;
    // Allow float-coordinate roundoff, bounded to 0.1 micron at any model size.
    const double tolerance = std::min(1e-4, 4.0 * std::numeric_limits<float>::epsilon() * scale);
    return distance_sq <= tolerance * tolerance;
}

} // namespace

unsigned int segment_index_bits(size_t page_vertex_capacity)
{
    assert(page_vertex_capacity > 1 && page_vertex_capacity <= (uint64_t(1) << 31));
    unsigned int bits = 0;
    for (size_t last = page_vertex_capacity - 1; last != 0; last >>= 1)
        ++bits;
    return bits;
}

uint32_t pack_segment_index(SegmentEndpoints segment, uint32_t page_offset, unsigned int index_bits)
{
    assert(index_bits > 0 && index_bits < 32);
    assert(segment.first >= page_offset && segment.last > segment.first);
    const uint32_t first = segment.first - page_offset;
    const uint32_t span = segment.last - segment.first;
    assert(first < (uint32_t(1) << index_bits));
    assert(span <= (uint32_t(1) << (32 - index_bits)));
    return first | ((span - 1) << index_bits);
}

LowQualitySegments::LowQualitySegments(const std::vector<PathVertex>& vertices,
                                       const std::vector<float>& packed_colors,
                                       size_t page_vertex_capacity)
    : m_vertices(vertices), m_colors(packed_colors),
      m_page_stride(page_vertex_capacity > 1 ? page_vertex_capacity - 1 : 0)
{
    assert(vertices.size() == packed_colors.size());
    assert(page_vertex_capacity != 1);
    if (page_vertex_capacity > 1)
        m_max_span = uint32_t(1) << (32 - segment_index_bits(page_vertex_capacity));
}

bool LowQualitySegments::can_extend(uint32_t segment_start) const
{
    const SegmentEndpoints& run = m_segments.back();
    if (run.last != segment_start)
        return false;
    if (m_max_span != 0 && segment_start - run.first >= m_max_span)
        return false;
    if (m_page_stride != 0 && run.first / m_page_stride != segment_start / m_page_stride)
        return false;
    const PathVertex& first = m_vertices[run.first];
    const PathVertex& current = m_vertices[segment_start];
    const PathVertex& end = m_vertices[segment_start + 1];
    if (first.gcode_id != current.gcode_id || !same_appearance(first, current) ||
        !same_appearance(first, end) || m_colors[run.first] != m_colors[segment_start] ||
        m_colors[run.first] != m_colors[segment_start + 1])
        return false;
    // The original run endpoints must also have matching appearance. Otherwise
    // extending the first segment would hide its original endpoint colour.
    if (!same_appearance(first, m_vertices[run.first + 1]) ||
        m_colors[run.first] != m_colors[run.first + 1])
        return false;
    return extends_line(first.position, m_vertices[run.first + 1].position,
                        current.position, end.position);
}

void LowQualitySegments::append(uint32_t segment_start)
{
    assert(size_t(segment_start) + 1 < m_vertices.size());
    assert(m_segments.empty() || segment_start >= m_segments.back().last);
    if (!m_segments.empty() && can_extend(segment_start))
        m_segments.back().last = segment_start + 1;
    else
        m_segments.push_back({ segment_start, segment_start + 1 });
}

std::vector<SegmentEndpoints> LowQualitySegments::finish()
{
    return std::move(m_segments);
}

bool clip_segment(SegmentEndpoints segment, const Interval& visible, SegmentEndpoints& clipped)
{
    const size_t first = std::max(size_t(segment.first), visible[0]);
    const size_t last = std::min(size_t(segment.last), visible[1]);
    if (first >= last)
        return false;
    clipped = { static_cast<uint32_t>(first), static_cast<uint32_t>(last) };
    return true;
}

} // namespace libvgcode
