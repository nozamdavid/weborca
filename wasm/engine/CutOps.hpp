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

nlohmann::json cutObject(
    Slic3r::Model& model,
    Slic3r::PlateDataPtrs& plates,
    const Slic3r::DynamicPrintConfig& config,
    const nlohmann::json& args
);

} // namespace OrcaWasm
