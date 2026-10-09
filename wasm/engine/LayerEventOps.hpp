#pragma once

#include <nlohmann/json.hpp>

namespace Slic3r {
class Model;
}

namespace OrcaWasm {

/**
 * Retrieves configured custom layer events (pause, custom G-code) for a plate.
 *
 * Parameters:
 *   - plateIndex (int, optional, default: 0): target non-negative plate index.
 *
 * Returns:
 *   - plateIndex (int)
 *   - count (size_t)
 *   - events (array of LayerEvent objects)
 */
nlohmann::json getLayerEvents(
    const Slic3r::Model& model,
    const nlohmann::json& args
);

/**
 * Replaces configured layer events for a plate with transactional batch validation.
 *
 * Parameters:
 *   - plateIndex (int, optional, default: 0): target non-negative plate index.
 *   - events (array of LayerEvent objects, required): batch of layer events.
 *
 * Transactional semantics:
 *   The entire batch is validated before mutating the Model. If any event
 *   is invalid (wrong types, out-of-range integer, duplicate same-Z) or attempts
 *   an unsupported type (e.g. filament/color change), an exception is thrown
 *   and the plate's existing events remain unchanged.
 *
 * Returns:
 *   - plateIndex (int)
 *   - count (size_t)
 *   - events (array of validated LayerEvent objects sorted by printZ)
 */
nlohmann::json setLayerEvents(
    Slic3r::Model& model,
    const nlohmann::json& args
);

/**
 * Clears configured layer events for a plate or all plates.
 *
 * Parameters:
 *   - plateIndex (int, optional, default: 0): target non-negative plate index.
 *   - printZ (double, optional): specific finite non-negative print Z height to clear. If omitted, clears all events on plate.
 *   - allPlates (bool, optional, default: false): if true, clears events across all plates.
 *
 * Returns:
 *   - plateIndex (int)
 *   - clearedCount (size_t)
 *   - remainingCount (size_t)
 */
nlohmann::json clearLayerEvents(
    Slic3r::Model& model,
    const nlohmann::json& args
);

} // namespace OrcaWasm
