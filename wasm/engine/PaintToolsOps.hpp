#pragma once

#include <nlohmann/json.hpp>

namespace Slic3r {
class Model;
}

namespace OrcaWasm {

nlohmann::json paintStroke(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json getPaintOverlay(const Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json getPaintData(const Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json setPaintData(Slic3r::Model& model, const nlohmann::json& args);
nlohmann::json clearPaint(Slic3r::Model& model, const nlohmann::json& args);

} // namespace OrcaWasm
