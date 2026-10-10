#pragma once

#include <nlohmann/json.hpp>

namespace Slic3r {
class Model;
}

namespace OrcaWasm {

nlohmann::json autoOrient(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json getPlanarFacets(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json placeOnFace(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json splitObject(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json splitVolume(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json simplifyVolume(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json meshBoolean(Slic3r::Model& model, const nlohmann::json& args);

} // namespace OrcaWasm
