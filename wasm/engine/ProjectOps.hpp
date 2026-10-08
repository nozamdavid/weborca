#pragma once

#include <nlohmann/json.hpp>
#include <string>
#include <vector>
#include <memory>

#include "libslic3r/Model.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/Format/bbs_3mf.hpp"

namespace OrcaEngine {

nlohmann::json op_openProject(
    const nlohmann::json& args,
    Slic3r::Model& model,
    std::unique_ptr<Slic3r::PresetBundle>& bundle,
    Slic3r::DynamicPrintConfig& options_override,
    std::string& selected_printer,
    std::string& selected_process,
    std::vector<std::string>& selected_filaments,
    Slic3r::PlateDataPtrs& plate_data
);

nlohmann::json op_saveProject(
    const nlohmann::json& args,
    Slic3r::Model& model,
    const std::unique_ptr<Slic3r::PresetBundle>& bundle,
    const Slic3r::DynamicPrintConfig& options_override,
    const Slic3r::PlateDataPtrs& plate_data
);

} // namespace OrcaEngine
