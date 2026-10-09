#pragma once

#include <nlohmann/json.hpp>
#include "libslic3r/calib.hpp"

namespace Slic3r {
class Model;
class DynamicPrintConfig;
class PresetBundle;
}

namespace OrcaWasm {

nlohmann::json setupCalibration(
    Slic3r::Model& model,
    Slic3r::DynamicPrintConfig& options_override,
    Slic3r::PresetBundle& preset_bundle,
    Slic3r::Calib_Params& calib_params,
    const nlohmann::json& args,
    const std::string& resources_dir
);

} // namespace OrcaWasm
