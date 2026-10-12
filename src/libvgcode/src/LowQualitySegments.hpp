#pragma once

#include "../include/PathVertex.hpp"
#include "../include/Types.hpp"

#include <cstddef>
#include <cstdint>
#include <vector>

namespace libvgcode {

// Vertex endpoints, rather than source-line IDs. Original vertices remain intact for
// statistics, picking and the move slider. Each pair covers [first, last) segments.
struct SegmentEndpoints
{
    uint32_t first;
    uint32_t last;
};
static_assert(sizeof(SegmentEndpoints) == 2 * sizeof(uint32_t));

// A page-local start and (span - 1) share one R32UI texel. Large pages leave
// fewer span bits, so runs are split at that limit before uploading them.
unsigned int segment_index_bits(size_t page_vertex_capacity);
uint32_t pack_segment_index(SegmentEndpoints segment, uint32_t page_offset, unsigned int index_bits);

// Append only enabled segment starts in ascending order. Streaming avoids retaining
// an additional index per original segment when low quality is selected.
class LowQualitySegments
{
public:
    LowQualitySegments(const std::vector<PathVertex>& vertices,
                       const std::vector<float>& packed_colors,
                       size_t page_vertex_capacity = 0);
    void append(uint32_t segment_start);
    std::vector<SegmentEndpoints> finish();

private:
    bool can_extend(uint32_t segment_start) const;
    const std::vector<PathVertex>& m_vertices;
    const std::vector<float>& m_colors;
    size_t m_page_stride;
    uint32_t m_max_span{ 0 };
    std::vector<SegmentEndpoints> m_segments;
};

// Clip to an inclusive visible vertex interval. Returns false for an empty
// intersection; endpoints inside a coalesced run still refer to original vertices.
bool clip_segment(SegmentEndpoints segment, const Interval& visible,
                  SegmentEndpoints& clipped);

} // namespace libvgcode
