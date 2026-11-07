#pragma once

#include <nlohmann/json.hpp>
#include <vector>

namespace Slic3r {
class Model;
class DynamicPrintConfig;
class PlateData;
using PlateDataPtrs = std::vector<PlateData*>;
}

namespace OrcaWasm {

nlohmann::json getObjectTree(const Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json addVolume(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json getVolume(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json setVolumeTransform(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json deleteInstances(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json deleteVolume(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json moveVolume(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json renameObject(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json renameVolume(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json setObjectConfig(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json resetObjectConfig(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json setVolumeExtruder(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json mergeObjects(Slic3r::Model& model, const nlohmann::json& args, Slic3r::PlateDataPtrs* plates = nullptr, const Slic3r::DynamicPrintConfig* config = nullptr);
nlohmann::json setVolumeType(Slic3r::Model& model, const nlohmann::json& args);

} // namespace OrcaWasm
