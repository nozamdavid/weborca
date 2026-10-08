#pragma once

#include <nlohmann/json.hpp>
#include <vector>

namespace Slic3r {
class Model;
class DynamicPrintConfig;
struct PlateData;
using PlateDataPtrs = std::vector<PlateData*>;
}

namespace OrcaWasm {

/**
 * Performs a planar cut on a ModelObject with connectors (plugs, dowels, or snaps).
 *
 * Accepts planar cut arguments plus a "connectors" array. Nonempty connector
 * cuts require both halves and keepAsParts:false; fit is not certified.
 * connectors: [
 *   {
 *     pos: [x, y, z], // on cut plane, in world or object coordinateSystem
 *     attrs: {
 *       type: "plug" | "dowel" | "snap",
 *       style: "prism" | "frustum",
 *       shape: "triangle" | "square" | "hexagon" | "circle",
 *       depthRatio: number, // millimeters, or height / depth
 *       size: number,       // diameter, or radius
 *       rotationDeg: number,
 *       tolerance: number,
 *       targetHalf?: "upper" | "lower"
 *     }
 *   }
 * ]
 *
 * Returns a result JSON with createdObjects and connectorCount.
 * The original ModelObject is left completely untouched on any failure or invalid cut plane.
 */
nlohmann::json cutObjectWithConnectors(
    Slic3r::Model& model,
    Slic3r::PlateDataPtrs& plates,
    const Slic3r::DynamicPrintConfig& config,
    const nlohmann::json& args
);

/**
 * Overload for calling without external plates or config.
 */
nlohmann::json cutObjectWithConnectors(
    Slic3r::Model& model,
    const nlohmann::json& args
);

} // namespace OrcaWasm
