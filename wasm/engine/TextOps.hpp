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

nlohmann::json addText(
    Slic3r::Model& model,
    Slic3r::PlateDataPtrs& plates,
    const nlohmann::json& args
);

nlohmann::json updateText(
    Slic3r::Model& model,
    const nlohmann::json& args
);

nlohmann::json getText(
    const Slic3r::Model& model,
    const nlohmann::json& args
);

} // namespace OrcaWasm
