#pragma once

#include <nlohmann/json.hpp>

namespace Slic3r {
class Model;
}

namespace OrcaWasm {

nlohmann::json getMeasurementFeature(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json measureFeatures(const nlohmann::json& args);

} // namespace OrcaWasm
