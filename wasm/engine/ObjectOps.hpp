#pragma once

#include <nlohmann/json.hpp>

namespace Slic3r {
class Model;
}

namespace OrcaWasm {

nlohmann::json getObjectTree(const Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json addVolume(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json deleteVolume(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json renameObject(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json renameVolume(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json setObjectConfig(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json resetObjectConfig(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json setVolumeExtruder(Slic3r::Model& model, const nlohmann::json& args);

} // namespace OrcaWasm
