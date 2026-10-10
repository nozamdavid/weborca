#pragma once

#include <nlohmann/json.hpp>

namespace Slic3r {
class Model;
}

namespace OrcaWasm {

nlohmann::json addSvg(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json updateSvg(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json getSvg(Slic3r::Model& model, const nlohmann::json& args);

} // namespace OrcaWasm
