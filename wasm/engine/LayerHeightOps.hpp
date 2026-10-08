#pragma once

#include <nlohmann/json.hpp>

namespace Slic3r {
class Model;
class DynamicPrintConfig;
}

namespace OrcaWasm {

nlohmann::json getLayerHeightProfile(
    Slic3r::Model& model,
    const Slic3r::DynamicPrintConfig& config,
    const nlohmann::json& args
);

nlohmann::json setLayerHeightProfile(
    Slic3r::Model& model,
    const Slic3r::DynamicPrintConfig& config,
    const nlohmann::json& args
);

nlohmann::json adaptiveLayerHeights(
    Slic3r::Model& model,
    const Slic3r::DynamicPrintConfig& config,
    const nlohmann::json& args
);

nlohmann::json smoothLayerHeights(
    Slic3r::Model& model,
    const Slic3r::DynamicPrintConfig& config,
    const nlohmann::json& args
);

nlohmann::json adjustLayerHeights(
    Slic3r::Model& model,
    const Slic3r::DynamicPrintConfig& config,
    const nlohmann::json& args
);

nlohmann::json resetLayerHeights(
    Slic3r::Model& model,
    const Slic3r::DynamicPrintConfig& config,
    const nlohmann::json& args
);

nlohmann::json getObjectLayers(
    Slic3r::Model& model,
    const Slic3r::DynamicPrintConfig& config,
    const nlohmann::json& args
);

} // namespace OrcaWasm
