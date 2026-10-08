#pragma once

#include <nlohmann/json.hpp>

namespace Slic3r {
class Model;
}

namespace OrcaWasm {

nlohmann::json getSupportPainting(const Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json setSupportPainting(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json clearSupportPainting(Slic3r::Model& model, const nlohmann::json& args);

nlohmann::json getSeamPainting(const Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json setSeamPainting(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json clearSeamPainting(Slic3r::Model& model, const nlohmann::json& args);

} // namespace OrcaWasm
