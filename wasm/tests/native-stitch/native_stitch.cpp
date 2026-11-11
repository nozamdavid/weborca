#include "libslic3r/Arachne/utils/ExtrusionLine.hpp"
#include "libslic3r/Arachne/utils/PolylineStitcher.hpp"
#include <iostream>

using namespace Slic3r;
using namespace Slic3r::Arachne;

int main()
{
    // Original native oracle: skip the processed parent and snap to the
    // newest endpoint of a tiny line whose two endpoints occupy one cell.
    VariableWidthLines input(2), lines, polygons;
    input[0].junctions = {{Point(0, 0), 1000, 0}, {Point(100000, 0), 1000, 0}};
    input[1].junctions = {{Point(0, 0), 1000, 0}, {Point(3000, 0), 1000, 0}};
    PolylineStitcher<VariableWidthLines, ExtrusionLine, ExtrusionJunction>::stitch(input, lines, polygons, 10000, 5000);
    if (!polygons.empty() || lines.size() != 1 || lines[0].size() != 3 || lines[0].back().p != Point(0, 0)) {
        std::cerr << "newest equal-cell endpoint must win after skipping the processed parent\n";
        return 1;
    }
    std::cout << "native stitch regression passed\n";
}
