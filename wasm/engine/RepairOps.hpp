#pragma once

#include <nlohmann/json.hpp>

namespace Slic3r {
class Model;
}

namespace OrcaWasm {

/**
 * Computes topology health and integrity metrics for an object or specific volume.
 * Reports boundary/degeneracy checks, import repair counters, shell counts,
 * mesh-local signed volume and bounding boxes. Not a self-intersection proof.
 */
nlohmann::json getMeshHealth(
    const Slic3r::Model& model,
    const nlohmann::json& args
);

/**
 * Runs the upstream CGAL repair pipeline on an object or selected volume.
 * Ensures transactional safety (leaves model untouched on failure).
 * Preserves transforms/configuration and remaps supported paint annotations.
 * Unsupported texture painting and splitParts are explicitly rejected.
 */
nlohmann::json repairObject(
    Slic3r::Model& model,
    const nlohmann::json& args
);

/**
 * High-level alias for getMeshHealth matching alternative RPC naming conventions.
 */
nlohmann::json checkMeshHealth(
    const Slic3r::Model& model,
    const nlohmann::json& args
);

/**
 * High-level alias for repairObject matching alternative RPC naming conventions.
 */
nlohmann::json repairMesh(
    Slic3r::Model& model,
    const nlohmann::json& args
);

} // namespace OrcaWasm
