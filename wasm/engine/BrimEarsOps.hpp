#pragma once

#include <nlohmann/json.hpp>

namespace Slic3r {
class Model;
}

namespace OrcaWasm {

nlohmann::json getBrimEars(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json setBrimEars(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json clearBrimEars(Slic3r::Model& model, const nlohmann::json& args);

} // namespace OrcaWasm
